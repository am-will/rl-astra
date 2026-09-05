import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await mkdir('test-results/audio', { recursive: true });
const results = [], errors = [], check = (name, pass, detail) => { assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); results.push({ name, detail }); console.log(`PASS ${name}`); };
const manifest = JSON.parse(await readFile('public/audio/rocket-league/manifest.json', 'utf8'));
for (const clip of manifest.clips) {
 const bytes = await readFile(`public/audio/rocket-league/${clip.file}`);
 assert.equal(createHash('sha256').update(bytes).digest('hex'), clip.sha256);
 assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex'),clip.sourceGitBlob);
}
check('All local clips match the upstream original bytes', manifest.clips.length === 23, { bytes: manifest.clips.reduce((n,c)=>n+c.bytes,0), commit: manifest.commit });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
 const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
 p.on('pageerror', e => errors.push(e.message)); p.on('console', e => { if(e.type()==='error') errors.push(e.text()); });
 await p.goto(process.env.GAME_URL || 'http://127.0.0.1:5179'); await p.waitForFunction(()=>window.__game&&!document.querySelector('#loading'));
 const decoded = await p.evaluate(()=>{const a=window.__game.view.audio;return{context:!!a.ctx,failures:a.failures,clips:[...a.buffers].map(([key,b])=>({key,seconds:b.duration,channels:b.numberOfChannels}))}});
 check('Every original Ogg decodes before play, with no audible context before a gesture', !decoded.context && decoded.failures.length===0 && decoded.clips.length===23 && decoded.clips.every(c=>c.seconds>0), decoded);
 const startPosition = await p.evaluate(()=>({...window.__game.physics.player.body.translation()}));
 await p.keyboard.down('w'); await p.waitForFunction(()=>window.__game.view.audio.ctx?.state==='running');
 await p.waitForFunction(()=>window.__game.view.audio.loops.get('engineHigh')?.source.playbackRate.value>1.32);
 const kickoff = await p.evaluate(async()=>{
  const g=window.__game,a=g.view.audio,probe=a.ctx.createAnalyser(),samples=new Float32Array(2048);
  probe.fftSize=2048;a.engineGain.connect(probe);let sum=0,peak=0;
  for(let i=0;i<8;i++){await new Promise(r=>setTimeout(r,20));probe.getFloatTimeDomainData(samples);for(const x of samples){sum+=x*x;peak=Math.max(peak,Math.abs(x));}}
  a.engineGain.disconnect(probe);
  return {phase:g.phase,position:{...g.physics.player.body.translation()},boost:g.physics.player.boost,boosting:g.physics.player.boosting,rate:a.loops.get('engineHigh').source.playbackRate.value,rms:Math.sqrt(sum/(8*samples.length)),peak};
 });
 check('Held kickoff throttle reaches an audible redline while the car and boost stay locked',kickoff.phase==='countdown'&&kickoff.rate>1.32&&kickoff.rate<1.42&&kickoff.rms>.01&&kickoff.rms<.08&&kickoff.peak<.4&&Math.hypot(kickoff.position.x-startPosition.x,kickoff.position.z-startPosition.z)<.01&&kickoff.boost===100&&!kickoff.boosting,kickoff);
 await p.keyboard.up('w');
 await p.waitForFunction(()=>window.__game.view.audio.engineRevs<.1);
 const releasedKickoff=await p.evaluate(()=>({phase:window.__game.phase,load:window.__game.view.audio.engineLoad,revs:window.__game.view.audio.engineRevs}));
 check('Releasing kickoff throttle drops back to idle during the countdown',releasedKickoff.phase==='countdown'&&releasedKickoff.load<.02&&releasedKickoff.revs<.1,releasedKickoff);
 await p.evaluate(()=>{window.requestAnimationFrame=()=>0;});await p.waitForTimeout(80);
 await p.evaluate(()=>{
  const g=window.__game,a=g.view.audio;g.practice=true;g.physics.botEnabled=false;g.scenario('drive');a.reset();a.setPaused(false);
  window.audioProbe=a.ctx.createAnalyser();window.audioProbe.fftSize=2048;a.master.connect(window.audioProbe);
  window.audioEnergy=async(ms=180)=>{let sum=0,peak=0,count=0;const samples=new Float32Array(window.audioProbe.fftSize);for(let i=0;i<Math.ceil(ms/20);i++){await new Promise(r=>setTimeout(r,20));window.audioProbe.getFloatTimeDomainData(samples);for(const x of samples){sum+=x*x;peak=Math.max(peak,Math.abs(x));count++;}}return{rms:Math.sqrt(sum/count),peak};};
 });
 const engine=await p.evaluate(async()=>{
  const a=window.__game.view.audio, car={speed:0,boosting:false,grounded:true,drifting:false,steer:0,demolished:0,throttle:0};a.update(car,true,1/60);await new Promise(r=>setTimeout(r,250));const idle=await window.audioEnergy();
  car.speed=20;car.throttle=1;for(let i=0;i<150;i++)a.update(car,true,1/60);await new Promise(r=>setTimeout(r,400));const fast=await window.audioEnergy();const mix=[...a.loops].map(([key,l])=>({key,rate:l.source.playbackRate.value,gain:l.gain.gain.value,buffer:!!l.source.buffer}));return{idle,fast,mix};
 });
 check('Driving reaches a higher redline with controlled output volume',engine.idle.rms>.003&&engine.fast.rms>.02&&engine.fast.rms<.04&&engine.mix.every(x=>x.buffer)&&engine.mix.find(x=>x.key==='engineIdle').gain<.01&&engine.mix.find(x=>x.key==='engineHigh').gain>.1&&engine.mix.find(x=>x.key==='engineHigh').rate>1.32&&engine.mix.find(x=>x.key==='engineHigh').rate<1.42&&engine.mix.filter(x=>x.key.startsWith('engine')).every(x=>x.rate<1.7),engine);
 const unload=await p.evaluate(async()=>{const a=window.__game.view.audio,c={speed:20,boosting:false,grounded:true,drifting:false,steer:0,demolished:0,throttle:0};for(let i=0;i<120;i++)a.update(c,true,1/60);await new Promise(r=>setTimeout(r,350));const coast={revs:a.engineRevs,load:a.engineLoad,high:a.loops.get('engineHigh').gain.gain.value};c.grounded=false;c.throttle=1;for(let i=0;i<120;i++)a.update(c,true,1/60);return{coast,air:a.engineRevs};});
 check('Releasing throttle at high speed unloads the motor; aerials cannot force a redline',unload.coast.revs<.15&&unload.coast.load<.01&&unload.coast.high<.001&&unload.air<.4,unload);
 const boost=await p.evaluate(async()=>{const a=window.__game.view.audio,c={speed:20,boosting:true,grounded:true,drifting:false,steer:0,demolished:0,throttle:0};a.update(c,true,1/60);const start=[...a.voices].some(v=>v.source.buffer===a.buffers.get('boostStart'));await new Promise(r=>setTimeout(r,2000));const energy=await window.audioEnergy();c.boosting=false;a.update(c,true,1/60);const release=[...a.voices].some(v=>v.source.buffer===a.buffers.get('boostStop'));await new Promise(r=>setTimeout(r,450));return{start,release,energy,loopGain:a.loops.get('boostLoop').gain.gain.value};});
 check('Standard boost has actual start, sustain and release clips',boost.start&&boost.release&&boost.energy.rms>engine.fast.rms*1.15&&boost.loopGain<.002,boost);
 const tires=await p.evaluate(async()=>{const a=window.__game.view.audio,c={speed:18,boosting:false,grounded:true,drifting:true,steer:1,demolished:0,throttle:1};a.update(c,true,1/60);await new Promise(r=>setTimeout(r,250));const ground=a.loops.get('drift').gain.gain.value;c.grounded=false;a.update(c,true,1/60);await new Promise(r=>setTimeout(r,400));return{ground,air:a.loops.get('drift').gain.gain.value,rolling:a.loops.get('tires').gain.gain.value};});
 check('Tire scrub is audible in a ground drift and silent in the air',tires.ground>.08&&tires.air<.002&&tires.rolling<.002,tires);
 const events=await p.evaluate(async()=>{
  const a=window.__game.view.audio,out=[];a.update({speed:0,boosting:false,grounded:false,drifting:false,steer:0,demolished:0,throttle:0},false,1/60);await new Promise(r=>setTimeout(r,300));
  for(const [name,fn]of [['hit',()=>a.hit(22)],['small pickup',()=>window.__game.physics.onPad(false)],['big pickup',()=>window.__game.physics.onPad(true)],['jump',()=>a.jump(false)],['dodge',()=>a.jump(true)],['land',()=>a.land(9)],['countdown',()=>a.countdown(false)],['go',()=>a.countdown(true)],['goal',()=>a.goal()],['demolition',()=>a.demolition(0)],['flip reset',()=>a.flipReset()]]){a.reset();await new Promise(r=>setTimeout(r,100));fn();const energy=await window.audioEnergy(250);out.push({name,...energy,voices:a.voices.size});}a.reset();return out;
 });
 check('Every gameplay cue renders non-silent, unclipped PCM',events.every(e=>e.rms>.0003&&e.peak<.99),events);
 const pickupMix = await p.evaluate(async () => {
  const { GameAudio } = await import('/src/game-audio.ts');
  const nativeContext = window.AudioContext, buffers = window.__game.view.audio.buffers;
  const render = async (pickup, world) => {
   const ctx = new OfflineAudioContext(2, 48000 * 2, 48000);
   // Use the production graph and playback method with an offline clock.
   Object.defineProperty(ctx, 'state', { get: () => 'running' });
   window.AudioContext = function () { return ctx; };
   let audio;
   try { audio = new GameAudio(); audio.init(); } finally { window.AudioContext = nativeContext; }
   for (const [key, buffer] of buffers) audio.buffers.set(key, buffer);
   if (world) { audio.goal(); audio.demolition(0); }
   if (pickup) audio.pickup();
   return (await ctx.startRendering()).getChannelData(0);
  };
  const solo = await render(true, false), world = await render(false, true), mixed = await render(true, true);
  let error = 0, peak = 0, energy = 0;
  for (let i = 0; i < solo.length; i++) { error = Math.max(error, Math.abs(mixed[i] - world[i] - solo[i])); peak = Math.max(peak, Math.abs(mixed[i])); energy += solo[i] * solo[i]; }
  return { error, peak, rms: Math.sqrt(energy / solo.length) };
 });
 check('Loud world effects do not compress or chop the pickup waveform',pickupMix.error<.00001&&pickupMix.peak<.99&&pickupMix.rms>.01,pickupMix);
 const pickupVoices = await p.evaluate(() => {
  const a = window.__game.view.audio; a.reset(); a.pickup();
  const pickup = [...a.voices][0];
  for (let i = 0; i < 30; i++) a.play('hitSoft', .01);
  const result = { retained: a.voices.has(pickup), voices: a.voices.size, loop: pickup.source.loop, rate: pickup.source.playbackRate.value };
  a.reset(); return result;
 });
 check('Contact bursts preserve the full pickup voice at its original speed',pickupVoices.retained&&pickupVoices.voices===24&&!pickupVoices.loop&&pickupVoices.rate===1,pickupVoices);
 const positions=await p.evaluate(()=>{const a=window.__game.view.audio;a.reset();a.hit(20,0,-.8);const near=[...a.voices][0],n={gain:near.gain.gain.value,pan:near.pan.pan.value};a.reset();a.hit(20,50,.8);const far=[...a.voices][0];return{near:n,far:{gain:far.gain.gain.value,pan:far.pan.pan.value}};});
 check('Distant world effects attenuate and pan across the stereo field',positions.far.gain<positions.near.gain*.4&&positions.near.pan<-.7&&positions.far.pan>.7,positions);
 const wires=await p.evaluate(()=>{const g=window.__game,a=g.view.audio,seen={},names=['hit','jump','land','pickup','countdown','demolition','goal','flipReset'];const originals={};for(const k of names){originals[k]=a[k];a[k]=(...args)=>{seen[k]=(seen[k]||0)+1;originals[k].apply(a,args)}}
  g.scenario('collision');g.advance(1,{throttle:1});const hit=seen.hit||0;
  g.scenario('jump');g.advance(.1);g.advance(.05,{jump:true,jumpHeld:true});g.advance(.15);g.advance(.05,{jump:true,throttle:1});g.advance(3);const jump=seen.jump||0,land=seen.land||0;
  g.scenario('pad');g.advance(.85,{throttle:1});
  g.physics.ball.setTranslation({x:10,y:5,z:10},true);g.physics.ball.setLinvel({x:0,y:-8,z:0},true);g.advance(1);const bounce=(seen.hit||0)>hit;
  g.practice=false;g.restart();g.kickoff();g.advance(3.1);
  g.physics.demolish(g.physics.bot);g.phase='playing';g.score('blue');g.physics.onFlipReset();
  for(const k of names)a[k]=originals[k];return{seen,jump,land,bounce};});
 check('Real simulation contacts and state transitions trigger their sound cues',wires.seen.hit>0&&wires.jump>=2&&wires.land>0&&wires.bounce&&wires.seen.pickup>0&&wires.seen.countdown>=4&&wires.seen.demolition>0&&wires.seen.goal>0&&wires.seen.flipReset>0,wires);
 const lifecycle=await p.evaluate(async()=>{const g=window.__game,a=g.view.audio;g.testing=false;const c={speed:20,boosting:true,grounded:true,drifting:true,steer:1,demolished:0,throttle:1};a.setPaused(false);a.update(c,true,1/60);a.goal();g.paused=false;g.action('pause');await new Promise(r=>setTimeout(r,450));const paused={...(await window.audioEnergy()),voices:a.voices.size,engine:a.engineGain.gain.value};g.action('resume');a.update(c,true,1/60);await new Promise(r=>setTimeout(r,250));const resumed=await window.audioEnergy();a.toggle();await new Promise(r=>setTimeout(r,350));const muted=await window.audioEnergy();a.toggle();a.update({...c,demolished:2},true,1/60);await new Promise(r=>setTimeout(r,400));const demolished=a.engineGain.gain.value;for(let i=0;i<50;i++){a.reset();a.update(c,true,1/60);}g.restart();await new Promise(r=>setTimeout(r,350));return{paused,resumed,muted,demolished,restarted:await window.audioEnergy(),voices:a.voices.size,loops:a.loops.size};});
 check('Pause and mute silence the mix; resume restores it; demolition and restart stop engine and tails',lifecycle.paused.rms<.0001&&lifecycle.paused.voices===0&&lifecycle.paused.engine<.001&&lifecycle.resumed.rms>.005&&lifecycle.muted.rms<.0001&&lifecycle.demolished<.001&&lifecycle.restarted.rms<.0001&&lifecycle.voices===0&&lifecycle.loops===6,lifecycle);
 await p.evaluate(()=>{window.__game.view.audio.toggle();});await p.reload();await p.waitForFunction(()=>window.__game&&!document.querySelector('#loading'));
 check('Sound preference persists after reload',await p.evaluate(()=>window.__game.view.audio.muted&&document.querySelector('#sound-value').textContent==='OFF'),{});
 const missing=await browser.newPage();await missing.route('**/audio/rocket-league/SFX_Motor_Car01_0005.ogg',route=>route.fulfill({status:404,body:'missing'}));await missing.goto(process.env.GAME_URL||'http://127.0.0.1:5179');await missing.waitForFunction(()=>window.__game&&!document.querySelector('#loading'));const degraded=await missing.evaluate(()=>({failed:window.__game.view.audio.failures.length,loaded:window.__game.view.audio.buffers.size,phase:window.__game.phase}));
 check('A missing clip leaves the game and remaining sounds available',degraded.failed===1&&degraded.loaded===22&&degraded.phase==='ready',degraded);await missing.close();
 check('No browser or audio graph errors',errors.length===0,errors);await writeFile('test-results/audio/checks.json',JSON.stringify({results,errors},null,2));
} finally { await browser.close(); }
