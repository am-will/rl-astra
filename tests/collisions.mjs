import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import {scenarioNames,setupScenario,scenarioInput,contacts,requiredContacts,poses,percentile} from './collision-scenarios.mjs';
import {assertOutcomes} from './collision-assertions.mjs';
import {assertCorrectionBudget} from './collision-budgets.mjs';
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom'});
const results=[];
const profiles=[{name:'ideal',delay:0,jitter:0,loss:0,lead:4},{name:'regional',delay:3,jitter:3,loss:.02,lead:9},{name:'stress',delay:7,jitter:6,loss:.1,lead:16}];
try {
 const {Authority}=await vite.ssrLoadModule('/src/network/authority.ts'),{Prediction}=await vite.ssrLoadModule('/src/network/prediction.ts'),{Simulation}=await vite.ssrLoadModule('/src/simulation.ts');
 const P=await vite.ssrLoadModule('/src/network/protocol.ts');
 for(const name of (process.env.SCENARIO?[process.env.SCENARIO]:scenarioNames))for(const profile of profiles){
  const a=new Authority();await a.init();setupScenario(a.sim,name);a.ready=[true,true];
  const baseline=a.sim.checkpoint(),clients=[],corrections=[[],[]],events=[[],[]],authoritativeEvents=[],seen=new Set(),contactTicks={},history=new Map(),timings=[];
  a.sim.onEvent=e=>authoritativeEvents.push(e);
  for(const slot of [0,1]){const sim=new Simulation();await sim.initPhysics();const p=new Prediction(sim,slot);await p.init();p.baseline(baseline);p.onCorrection=e=>corrections[slot].push(e);p.onEvent=e=>events[slot].push(e);
   p.onConfirmed=f=>{assert.equal(p.confirmed.digest(),history.get(f.tick).hash,`${name}/${profile.name} slot ${slot} confirmed tick ${f.tick}`);};clients.push(p);}
  let seed=0x13bcaa4;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const outgoing=[],incoming=[],recent=[[],[]];let reordered=0,lastArrival=[0,0];
  const deliver=(queue,now,fn)=>{queue.sort((a,b)=>a.at-b.at);while(queue[0]?.at<=now)fn(queue.shift());};
  const total=name==='kickoff'?720:600;
  for(let now=0;now<total;now++){
   for(const [slot,p]of clients.entries())while(p.predicted.tickNumber<a.sim.tickNumber+profile.lead){const command=p.predict(scenarioInput(name,p.predicted.tickNumber+1,slot));recent[slot].push(command);if(recent[slot].length>12)recent[slot].shift();if(command.tick%2===0&&random()>=profile.loss)outgoing.push({at:now+profile.delay+Math.floor(random()*profile.jitter),slot,bytes:P.encodeCommands(17,recent[slot])});}
   deliver(outgoing,now,x=>a.receive(x.slot,P.decodeCommands(x.bytes,17)));
   const frame=a.step();history.set(frame.tick,{tick:frame.tick,hash:a.sim.digest(),poses:poses(a.sim),contacts:contacts(a.sim)});
   for(const c of contacts(a.sim)){seen.add(c);(contactTicks[c]??=[]).push(frame.tick);}
   if(now%2===0)for(const slot of[0,1])if(random()>=profile.loss)incoming.push({at:now+profile.delay+Math.floor(random()*profile.jitter),slot,tick:frame.tick,bytes:P.encodeFrames(17,[...a.frames.values()].slice(-12))});
   deliver(incoming,now,x=>{if(x.tick<lastArrival[x.slot])reordered++;lastArrival[x.slot]=x.tick;clients[x.slot].receive(P.decodeFrames(x.bytes,17));});
   for(const p of clients){if(now%48===0)p.receive([...a.frames.values()].filter(f=>f.tick>p.confirmed.tickNumber&&f.tick<=a.sim.tickNumber-profile.delay-profile.jitter));const t=performance.now();assert(p.reconcile());timings.push(performance.now()-t);}
  }
  assertOutcomes(name,[...history.values()]);
  for(const c of requiredContacts(name))assert(seen.has(c),`${name}/${profile.name} missed intended ${c}: ${JSON.stringify(contactTicks)}`);
  for(const [slot,p]of clients.entries()){
   p.receive([...a.frames.values()]);while(p.confirmed.tickNumber<a.sim.tickNumber)assert(p.reconcile());assert.equal(p.confirmed.digest(),a.sim.digest());
   assert.deepEqual(events[slot],authoritativeEvents,`${name}: missing or duplicate authoritative events`);
   const ids=events[slot].map(e=>`${e.tick}:${e.sequence}`);assert.equal(new Set(ids).size,ids.length);
  }
  if(profile.name==='stress')assert(reordered>0,'stress must actually reorder packets');
  for(const slot of [0,1]){
   assertCorrectionBudget(corrections[slot],slot,profile.name,name);
   const last=corrections[slot].filter(c=>!c.transition&&c.bodies.some(b=>b.distance>.05||b.radians>.02)).at(-1)?.tick||0;
   assert(last<=450+profile.lead+profile.delay+profile.jitter+24,`${name}: correction failed to settle after controls released at tick 450: ${last}`);
  }
  assert(percentile(timings,.99)<8.33,'p99 reconcile work exceeds one physics tick');
  const report={name,profile:profile.name,contactTicks,agreementTicks:history.size*2,reordered,
   clients:corrections.map((list,slot)=>({count:list.length,bodies:[0,1,2].map(i=>({maxDistance:Math.max(0,...list.map(c=>c.bodies[i].distance)),p95Distance:percentile(list.map(c=>c.bodies[i].distance),.95),maxRadians:Math.max(0,...list.map(c=>c.bodies[i].radians)),recoveryAfterReleaseMs:Math.max(0,(list.filter(c=>c.bodies[i].distance>.05||c.bodies[i].radians>.02).at(-1)?.tick||0)-450)*1000/120})),lastCorrectionTick:list.filter(c=>c.bodies.some(b=>b.distance>.05||b.radians>.02)).at(-1)?.tick||0,stats:clients[slot].stats})),
   reconcileMs:{p95:percentile(timings,.95),p99:percentile(timings,.99),max:Math.max(...timings)}};
  results.push(report);console.log('PASS',name,profile.name,JSON.stringify(report.clients.map(c=>c.bodies.map(b=>+b.maxDistance.toFixed(3)))));
  for(const p of clients){p.dispose();p.predicted.physics.world.free();}a.sim.physics.world.free();
 }
}finally{await mkdir('test-results',{recursive:true});await writeFile('test-results/collisions.json',JSON.stringify(results,null,2));await vite.close();}
