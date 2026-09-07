import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});
const results=[],errors=[];const check=(name,pass,detail)=>{assert.ok(pass,`${name}: ${JSON.stringify(detail)}`);results.push({name,detail});console.log(`PASS ${name}`);};
try{
 const p=await browser.newPage({viewport:{width:1440,height:900}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.goto('http://127.0.0.1:5179');await p.waitForFunction(()=>window.__game?.view&&!document.querySelector('#loading'));
 const ui=await p.evaluate(()=>{const g=window.__game;g.scenario('drive');g.kickoff();const counter=g.hud.el('center-message'),badge=g.hud.el('bot-name');return{counter:Number(getComputedStyle(counter).zIndex),badge:Number(getComputedStyle(badge).zIndex),gaugeBindings:document.querySelectorAll('.boost-hud [data-hint],.boost-key').length,stripCount:document.querySelectorAll('.controls-strip').length};});
 check('Countdown stacks above opponent badge',ui.counter>ui.badge,ui);
 check('HUD omits the boost binding and bottom controls strip',ui.gaugeBindings===0&&ui.stripCount===0,ui);
 const falloff=[];
 for(const distance of [5,16,35,55])falloff.push(await p.evaluate(distance=>{const g=window.__game;g.scenario('drive');g.physics.resetCar(g.physics.player,0,-50.55+distance);g.physics.ball.setTranslation({x:0,y:2,z:-53},true);g.advance(.15);g.score('blue');const time=g.remaining;g.advance(.42);const c=g.physics.player;return{distance,velocity:{...c.body.linvel()},position:{...c.body.translation()},timeUnchanged:g.remaining===time,ballEnabled:g.physics.ball.isEnabled(),phase:g.phase};},distance));
 check('Goal blast falls off with distance',falloff[0].velocity.z>falloff[1].velocity.z*1.5&&falloff[1].velocity.z>falloff[2].velocity.z*2&&Math.abs(falloff[3].velocity.z)<.05,falloff);
 check('Nearby car is launched airborne',falloff[0].position.y>1.2&&falloff[0].velocity.y>4,falloff[0]);
 check('Celebration stops clock and removes scored ball',falloff.every(f=>f.timeUnchanged&&!f.ballEnabled&&f.phase==='goal'),{});
 const control=[];
 for(const active of [false,true])control.push(await p.evaluate(active=>{const g=window.__game;g.scenario('drive');g.physics.resetCar(g.physics.player,3,-44);g.physics.ball.setTranslation({x:0,y:2,z:-53},true);g.advance(.15);g.score('blue');g.advance(.3);g.advance(.6,active?{roll:1,pitch:.4,boost:true}:{});const c=g.physics.player;return{boost:c.boost,rotation:{...c.body.rotation()},velocity:{...c.body.linvel()},position:{...c.body.translation()},projection:g.view.player.root.position.clone().project(g.view.camera).toArray(),phase:g.phase};},active));
 const qDistance=await p.evaluate(async cs=>{const T=await import('/node_modules/.vite/deps/three.js');return new T.Quaternion().copy(cs[0].rotation).angleTo(new T.Quaternion().copy(cs[1].rotation));},control);
 check('Air roll and pitch control continue during a goal',qDistance>.8&&control[1].phase==='goal',{qDistance,control});
 check('Boost remains usable during celebration',control[1].boost<control[0].boost-15&&Math.hypot(...['x','y','z'].map(k=>control[1].velocity[k]-control[0].velocity[k]))>2,control);
 const reset=await p.evaluate(()=>{const g=window.__game;g.advance(4);return{phase:g.phase,ballEnabled:g.physics.ball.isEnabled(),car:g.snapshot().car,goalVisible:g.view.effects.explosion.root.visible};});
 check('Next kickoff restores ball and car',reset.phase==='countdown'&&reset.ballEnabled&&!reset.goalVisible&&Math.abs(reset.car.z-29)<.1,reset);
 const demo=await p.evaluate(()=>{const g=window.__game;g.scenario('drive');g.physics.botEnabled=true;g.physics.resetCar(g.physics.player,0,0);g.physics.resetCar(g.physics.bot,0,4,0);g.physics.ball.setTranslation({x:15,y:1,z:0},true);g.physics.bot.body.setLinvel({x:0,y:0,z:-23},true);g.view.cameraReady=false;let minCamera=100,started=false,enabledDuring=false,lowestBody=100;for(let i=0;i<280;i++){g.physics.step({throttle:0,steer:0,pitch:0,roll:0,boost:false,jump:false,jumpHeld:false,drift:false},{throttle:1,steer:0,pitch:0,roll:0,boost:true,jump:false,jumpHeld:false,drift:false});g.view.update(1/120,'playing');if(g.physics.player.demolished>0){started=true;enabledDuring ||=g.physics.player.body.isEnabled();lowestBody=Math.min(lowestBody,g.physics.player.body.translation().y);}minCamera=Math.min(minCamera,g.view.camera.position.y);}const during={started,enabledDuring,lowestBody,minCamera,effect:g.view.effects.demolitions.bursts.some(b=>b.root.visible)};g.advance(.6);return{...during,respawned:g.physics.player.demolished===0&&g.physics.player.body.isEnabled(),respawn:g.snapshot().car};});
 check('Supersonic impact disables the victim and starts firestorm',demo.started&&!demo.enabledDuring&&demo.effect,demo);
 check('Demolition camera stays above the field',demo.lowestBody>0&&demo.minCamera>.5,demo);
 check('Demolished player respawns as a live car',demo.respawned&&demo.respawn.y>0,demo);
 const contacts=await p.evaluate(async()=>{
  const {emptyInput}=await import('/src/config.ts'),g=window.__game,rows=[];
  for(const owner of ['player','bot']){
   g.scenario('collision');const fx=g.view.effects;fx.particles=[];fx.ballStreak.reset();
   g.physics.botEnabled=owner==='bot';
   if(owner==='bot'){g.physics.resetCar(g.physics.player,20,29);g.physics.resetCar(g.physics.bot,0,4.5,0);}
   g.physics[owner].body.setLinvel({x:0,y:0,z:-12},true);const before=g.hits;
   for(let i=0;i<60;i++)g.physics.step(owner==='player'?{...emptyInput(),throttle:1}:emptyInput(),owner==='bot'?{...emptyInput(),throttle:1}:emptyInput());
   g.view.update(1/60,'playing');rows.push({owner,hits:g.hits-before,particles:fx.particles.length,drawn:fx.points.geometry.drawRange.count,streak:fx.ballStreak.mesh.visible});
  }return rows;
 });
 check('Player and bot ball contacts produce no impact particles',contacts.every(c=>c.hits>0&&c.particles===0&&c.drawn===0),contacts);
 const trail=await p.evaluate(async()=>{
  const T=await import('/node_modules/.vite/deps/three.js'),{BallSpeedTrail}=await import('/src/ball-speed-trail.ts'),{FIELD}=await import('/src/config.ts'),rows=[];
  for(const hz of [30,60,144]){
   const scene=new T.Scene(),trail=new BallSpeedTrail(scene),pos=new T.Vector3(0,4,0),velocity=new T.Vector3(18,-6,-30).setLength(36),u=trail.mesh.material.uniforms;
   for(let i=0;i<hz;i++)trail.update(pos,new T.Vector3(0,0,-10),1/hz,true);
   const slowHidden=!trail.mesh.visible;
   for(let i=0;i<hz;i++)trail.update(pos,new T.Vector3(0,0,-18),1/hz,true);
   const moderateVisible=trail.mesh.visible,moderateStrength=u.strength.value,moderateLength=u.head.value.distanceTo(u.tail.value);
   for(let i=0;i<hz;i++){pos.addScaledVector(velocity,1/hz);trail.update(pos,velocity,1/hz,true);}
   const visible=trail.mesh.visible,strength=u.strength.value,delta=u.tail.value.clone().sub(u.head.value),length=delta.length();
   const aligned=delta.clone().normalize().dot(velocity.clone().normalize()),headOffset=pos.distanceTo(u.head.value),before=u.head.value.toArray().concat(u.tail.value.toArray(),u.strength.value);
   trail.update(pos,velocity,0,true);const paused=before.every((n,i)=>n===u.head.value.toArray().concat(u.tail.value.toArray(),u.strength.value)[i]);
   for(let i=0;i<Math.ceil(hz*.1);i++)trail.update(pos,new T.Vector3(0,0,-10),1/hz,true);
   const fading=u.strength.value;
   for(let i=0;i<hz;i++)trail.update(pos,new T.Vector3(),1/hz,true);
   const faded=!trail.mesh.visible;
   for(let i=0;i<hz;i++)trail.update(pos,velocity,1/hz,true);
   trail.update(pos,velocity,0,false);
   rows.push({hz,slowHidden,moderateVisible,moderateStrength,moderateLength,visible,strength,length,aligned,headOffset,ballRadius:FIELD.ballRadius,paused,fading,faded,hiddenClears:!trail.mesh.visible,objects:scene.children.length,vertices:trail.mesh.geometry.getAttribute('position').count});
   trail.mesh.geometry.dispose();trail.mesh.material.dispose();
  }return rows;
 });
 check('Supersonic ball has one straight streak attached behind it, with no particle wake',trail.every(t=>t.slowHidden&&t.visible&&t.objects===1&&t.vertices===4&&t.aligned<-.999&&Math.abs(t.headOffset-t.ballRadius*.8)<.001),trail);
 check('Moderate hits show a substantial streak before supersonic speed',trail.every(t=>t.moderateVisible&&t.moderateStrength>.45&&t.moderateStrength<.55&&t.moderateLength>11.9&&t.moderateLength<12.1),trail);
 check('Ball streak fades out as speed drops and clears when the ball is hidden',trail.every(t=>t.paused&&t.fading>0&&t.fading<t.strength*.3&&t.faded&&t.hiddenClears),trail);
 check('Long streak length and brightness stay consistent at 30, 60 and 144 Hz',trail.every(t=>t.length>17.9&&t.length<18.01&&t.strength>.99),trail);
 const demoReadability=await p.evaluate(async()=>{const T=await import('/node_modules/.vite/deps/three.js'),fx=window.__game.view.effects.demolitions;fx.reset();fx.trigger(new T.Vector3(),new T.Vector3(),new T.Quaternion(),0xff942e);const b=fx.bursts[0];fx.update(.35);fx.updateCamera(new T.Vector3(0,2.6,12));const distant=b.word.material.opacity;fx.update(0);fx.updateCamera(new T.Vector3(0,2.6,2));return{distant,near:b.word.material.opacity};});
 check('Demolition lettering clears the view when driven through',demoReadability.distant>.9&&demoReadability.near<.01,demoReadability);
 const quality=await p.evaluate(()=>{const v=window.__game.view;return{high:v.quality,bloom:v.bloom.enabled,ratio:v.renderer.getPixelRatio(),label:document.querySelector('#quality-value').textContent};});
 check('New browser sessions default to cinematic High quality',quality.high&&quality.bloom&&quality.ratio===1&&quality.label==='HIGH',quality);
 await p.evaluate(()=>window.__game.view.setQuality('performance'));
 await p.evaluate(()=>window.__game.action('quality'));await p.reload();await p.waitForFunction(()=>window.__game?.view&&!document.querySelector('#loading'));
 check('High quality preference survives reload',await p.evaluate(()=>window.__game.view.quality&&window.__game.view.bloom.enabled),{});
 await p.evaluate(()=>window.__game.action('quality'));await p.reload();await p.waitForFunction(()=>window.__game?.view&&!document.querySelector('#loading'));
 check('Ultra quality preference survives reload',await p.evaluate(()=>window.__game.view.qualityLevel==='ultra'&&window.__game.view.stadium.grass.mesh.visible),{});
 await p.evaluate(()=>window.__game.action('quality'));await p.reload();await p.waitForFunction(()=>window.__game?.view&&!document.querySelector('#loading'));
 check('Performance preference survives reload',await p.evaluate(()=>!window.__game.view.quality&&!window.__game.view.bloom.enabled&&localStorage.getItem('champions-field.quality')==='performance'),{});
 const goalFinish=await p.evaluate(()=>{const meshes=window.__game.view.scene.children;const ramps=meshes.filter(m=>m.name==='arena-goal-ramp');const nets=meshes.filter(m=>m.name==='arena-goal-net');return{count:ramps.length,clear:ramps.every(m=>m.material.transparent&&!m.material.depthWrite&&nets.some(n=>n.material===m.material))};});
 check('Both curved goal interiors share transparent net material',goalFinish.count===2&&goalFinish.clear,goalFinish);
 check('No browser or shader errors',errors.length===0,errors);
 await mkdir('test-results/impact',{recursive:true});await writeFile('test-results/impact/behavior.json',JSON.stringify({results,errors},null,2));
}finally{await browser.close();}
