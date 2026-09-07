import {chromium} from 'playwright';
import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {buildFixtureServer} from './collision-server.mjs';
import {scenarioNames,requiredContacts,percentile} from './collision-scenarios.mjs';
import {simulationBuild} from '../scripts/build-id.mjs';
import {assertOutcomes} from './collision-assertions.mjs';
import {assertCorrectionBudget} from './collision-budgets.mjs';
const key='collision-fixture-key-local-only',endpoint='http://127.0.0.1:8788',origin='http://127.0.0.1:5180';
await buildFixtureServer();
const child=spawn(process.execPath,['test-results/fixture-server/index.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:'8788',PUBLIC_ORIGIN:origin,ALPHA_KEY:key,LOG_DIR:'test-results/fixture-replays'},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
const vite=await createServer({configFile:false,define:{__SIM_BUILD__:JSON.stringify(simulationBuild()),'import.meta.env.VITE_GAME_SERVER':JSON.stringify(endpoint)},server:{host:'127.0.0.1',port:5180,strictPort:true}});await vite.listen();
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox','--enable-gpu','--use-angle=gl','--ozone-platform=x11','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
const pages=[],results=[],errors=[];
const api=async path=>{const r=await fetch(endpoint+path,{headers:{authorization:'Bearer '+key}});assert(r.ok,await r.clone().text());return r;};
const profiles=process.env.PROFILE?[process.env.PROFILE]:['direct','regional','stress'];
try{
 for(let slot=0;slot<2;slot++){
  const context=await browser.newContext({viewport:{width:960,height:600},...(process.env.RECORD_VIDEO?{recordVideo:{dir:'test-results/collision-video',size:{width:960,height:600}}}:{})});
  await context.addInitScript(()=>{localStorage.setItem('champions-field.quality','performance');localStorage.setItem('champions-field.motion-blur','off');});
  const p=await context.newPage();pages.push(p);p.on('pageerror',e=>errors.push(e.message));await p.goto(origin);await p.waitForFunction(()=>window.__game&&!document.querySelector('#loading'),null,{timeout:60000});
  const gpu=await p.evaluate(()=>{const g=window.__game.view.renderer.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e.UNMASKED_RENDERER_WEBGL);});assert(!gpu.includes('SwiftShader'),'render test needs real GPU');console.log('GPU',gpu);
  await p.evaluate(delay=>{window.baselineDelay=delay;},Number(process.env.BASELINE_DELAY||0));
  await p.evaluate(async()=>{
   const {Prediction}=await import('/src/network/prediction.ts'),{setupScenario,scenarioInput,poses}=await import('/tests/collision-scenarios.mjs');
   const baseline=Prediction.prototype.baseline,predict=Prediction.prototype.predict;
   Prediction.prototype.baseline=function(saved){for(const sim of [this.predicted,this.confirmed])if(!sim.testConfigured){sim.testConfigured=true;const reset=sim.resetMatch.bind(sim);sim.resetMatch=()=>{reset();setupScenario(sim,window.fixtureName,false);sim.fixtureStart=sim.tickNumber;};sim.kickoff=()=>{sim.phase='playing';sim.phaseTime=0;sim.emit({kind:'kickoff'});sim.emit({kind:'go'});};}return baseline.call(this,saved);};
   Prediction.prototype.predict=function(input){return predict.call(this,scenarioInput(window.fixtureName,this.predicted.tickNumber+1-(this.confirmed.fixtureStart||1e9),this.slot));};
   const {OnlineClient}=await import('/src/network/client.ts');
   if(window.baselineDelay){const base=OnlineClient.prototype.baseline;OnlineClient.prototype.baseline=async function(...args){await new Promise(r=>setTimeout(r,window.baselineDelay));return base.apply(this,args);};}
   window.beginFixture=async ({room,seat,name,profile})=>{
    const g=window.__game;window.fixtureName=name;g.paused=false;g.testing=false;g.hud.pause(false);g.controls.clear();g.view.cameraReady=false;
    const o=new OnlineClient(g,room,seat,()=>{});g.online=o;
    window.measure={confirmed:[],corrections:[],events:[],frames:[],updates:[],visual:[],received:[],sent:0,dropped:0};
    const m=window.measure;let seed=5729;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const delay=profile==='stress'?55:profile==='regional'?20:0,jitter=profile==='stress'?50:profile==='regional'?20:0,loss=profile==='stress'?.1:profile==='regional'?.02:0;
    const frames=o.frames.bind(o),send=o.send.bind(o),control=o.control.bind(o),update=o.update.bind(o);
    o.frames=bytes=>{if(random()<loss){m.dropped++;return;}setTimeout(()=>{if(!o.disposed){m.received.push(new DataView(bytes.buffer,bytes.byteOffset).getUint32(7,true));frames(bytes);}},delay+random()*jitter);};
    o.send=message=>{if(message.type==='ping')setTimeout(()=>send(message),delay+jitter/2);else send(message);};
    o.control=async message=>{if(message.type==='pong')await new Promise(r=>setTimeout(r,delay+jitter/2));await control(message);if(message.type==='welcome'){
     o.prediction.onCorrection=e=>m.corrections.push(e);o.prediction.onConfirmed=f=>m.confirmed.push({tick:f.tick,hash:o.prediction.confirmed.digest(),poses:poses(o.prediction.confirmed)});
     const event=o.prediction.onEvent;o.prediction.onEvent=e=>{m.events.push(e);event(e);};
    }};
    let last=0;o.update=(now,input)=>{const t=performance.now();update(now,input);if(o.ready&&g.phase==='playing'){
     if(last)m.frames.push(now-last);last=now;m.updates.push(performance.now()-t);
     if(o.channel&&!o.channel.testWrapped){const original=o.channel.send.bind(o.channel);o.channel.testWrapped=true;o.channel.send=bytes=>{m.sent++;if(random()<loss){m.dropped++;return;}setTimeout(()=>{if(o.channel.readyState==='open')original(bytes);},delay+random()*jitter);};}
    }};
    const draw=g.view.draw.bind(g.view);if(!g.view.testMeasured){g.view.testMeasured=true;g.view.draw=(...args)=>{draw(...args);const o=g.online;if(o?.ready&&g.phase==='playing'){const m=window.measure;m.visual.push({tick:g.tickNumber,positions:[g.view.player.root,g.view.bot.root,g.view.ball].map(b=>b.position.toArray()),offsets:g.view.networkOffsets.map(v=>v.length()),rotations:g.view.networkRotations.map(q=>2*Math.acos(Math.min(1,Math.abs(q.w))))});}};}
    await o.connect();
   };
  });
 }
 for(const name of (process.env.SCENARIO?[process.env.SCENARIO]:scenarioNames))for(const profile of profiles){
  await api('/api/test/scenario/'+name);
  const r=await fetch(endpoint+'/api/rooms',{method:'POST',headers:{authorization:'Bearer '+key}});assert(r.ok,await r.clone().text());const room=await r.json();
  const joined=await fetch(endpoint+'/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:room.code})});assert(joined.ok);const guest=await joined.json();
  await pages[0].evaluate(x=>window.beginFixture(x),{room:room.id,seat:room.hostToken,name,profile});
  await pages[1].evaluate(x=>window.beginFixture(x),{room:room.id,seat:guest.seatToken,name,profile});
  await Promise.all(pages.map(p=>p.waitForFunction(()=>window.__game.online.ready&&window.__game.phase==='playing',null,{timeout:30000})));
  await new Promise(r=>setTimeout(r,name==='kickoff'?7000:6000));
  const data=await Promise.all(pages.map(p=>p.evaluate(()=>({measure:window.measure,status:window.multiplayerStatus(),gpu:window.__game.view.renderer.info.render}))));
  const states=await (await api('/api/test/states')).json(),byTick=new Map(states.map(s=>[s.tick,s])),seen=new Set(states.flatMap(s=>s.contacts));
  await writeFile('test-results/collision-browser-latest.json',JSON.stringify({name,profile,data,states}));
  assertOutcomes(name,states);
  for(const c of requiredContacts(name))assert(seen.has(c),`${name}/${profile}: missed ${c}; saw ${[...seen]}`);
  for(const [slot,d]of data.entries()){
   assert(d.status.ready,JSON.stringify(d.status));assert.equal(d.status.statistics.desyncs,0);
   assert(d.measure.confirmed.length>400,'must confirm several seconds');
   for(const f of d.measure.confirmed)assert.equal(f.hash,byTick.get(f.tick)?.hash,`${name}/${profile} slot ${slot} tick ${f.tick}`);
   const ids=d.measure.events.map(e=>`${e.tick}:${e.sequence}`);assert.equal(new Set(ids).size,ids.length,'duplicate authoritative effects');
   const serverEvents=states.filter(s=>s.tick>=d.measure.confirmed[0].tick&&s.tick<=d.measure.confirmed.at(-1).tick).flatMap(s=>s.events);assert.deepEqual(d.measure.events,serverEvents);
   assert(d.measure.visual.length>120,'must actually draw both games');
   assertCorrectionBudget(d.measure.corrections,slot,profile,`${name}/${profile}`);
   assert(percentile(d.measure.frames,.95)<22&&percentile(d.measure.frames,.99)<35,'render cadence missed 60fps budget');
   assert(Math.max(...d.measure.frames)<100&&d.measure.frames.filter(x=>x>50).length/d.measure.frames.length<.01,'visible frame stalls');
   assert(percentile(d.measure.updates,.95)<8.33&&Math.max(...d.measure.updates)<35,'netcode blocked frame budget');
   if(profile==='stress')assert(d.measure.dropped>0&&d.measure.received.some((t,i,a)=>i&&t<a[i-1]),'must exercise real loss and reordering');
   const start=states.find(s=>s.start).tick;
   for(let body=0;body<3;body++){
    const last=d.measure.visual.filter(s=>s.offsets[body]>.02||s.rotations[body]>.01).at(-1);
    const recoveryMs=Math.max(0,(last?.tick||0)-start-450)*1000/120;
    assert(recoveryMs<(profile==='stress'?900:650),`body ${body} visual recovery ${recoveryMs}ms exceeds budget`);
   }
  }
  const report={name,profile,contacts:[...seen],contactTicks:states.filter(s=>s.contacts.length).map(s=>({tick:s.tick,contacts:s.contacts})),clients:data.map(d=>({status:d.status,agreementTicks:d.measure.confirmed.length,frameMs:{p50:percentile(d.measure.frames,.5),p95:percentile(d.measure.frames,.95),p99:percentile(d.measure.frames,.99),max:Math.max(...d.measure.frames),over50:d.measure.frames.filter(v=>v>50).length},updateMs:{p95:percentile(d.measure.updates,.95),max:Math.max(...d.measure.updates)},bodies:[0,1,2].map(i=>({maxDistance:Math.max(0,...d.measure.corrections.filter(c=>!c.transition).map(c=>c.bodies[i].distance)),p95Distance:percentile(d.measure.corrections.filter(c=>!c.transition).map(c=>c.bodies[i].distance),.95),maxRadians:Math.max(0,...d.measure.corrections.filter(c=>!c.transition).map(c=>c.bodies[i].radians)),visualRecoveryAfterReleaseMs:Math.max(0,(d.measure.visual.filter(s=>s.offsets[i]>.02||s.rotations[i]>.01).at(-1)?.tick||0)-states.find(s=>s.start).tick-450)*1000/120})),corrections:d.measure.corrections,visual:d.measure.visual,dropped:d.measure.dropped,reordered:d.measure.received.filter((v,i,a)=>i&&v<a[i-1]).length}))};results.push(report);
  console.log('PASS',name,profile,JSON.stringify(report.clients.map(c=>({frames:c.frameMs,bodies:c.bodies.map(b=>+b.maxDistance.toFixed(3))}))));
  if(name==='kickoff'||name==='sideways')for(const [slot,p]of pages.entries())await p.screenshot({path:`test-results/collision-${name}-${profile}-${slot}.png`});
  for(const p of pages)await p.evaluate(()=>{window.__game.online.dispose();window.__game.online=undefined;window.__game.testing=true;});
  for(let i=0;i<40;i++){if((await (await fetch(endpoint+'/api/health')).json()).rooms===0)break;await new Promise(r=>setTimeout(r,50));}
 }
 assert.deepEqual(errors,[]);
}finally{
 await mkdir('test-results',{recursive:true});await writeFile(`test-results/browser-collisions-${process.env.PROFILE||'all'}.json`,JSON.stringify(results,null,2));await writeFile('test-results/fixture-server.log',logs);for(const context of browser.contexts())await context.close();await browser.close();await vite.close();child.kill('SIGTERM');
}
