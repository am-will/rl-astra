import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const results=[],errors=[];
const check=(name,pass,detail)=>{assert.ok(pass,`${name}: ${JSON.stringify(detail)}`);results.push({name,detail});console.log(`PASS ${name}`);};
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
 await page.goto('http://127.0.0.1:5179');await page.waitForFunction(()=>window.__game?.view&&!document.querySelector('#loading'));
 const slides=await page.evaluate(async()=>{
  const g=window.__game,{emptyInput,STEP}=await import('/src/config.ts'),T=await import('/node_modules/.vite/deps/three.js'),rows=[];
  for(const yaw of [0,Math.PI/2])for(const side of [-1,1])for(const speed of [3,18,23])for(const drift of [false,true]){
   g.scenario('drive');g.physics.ball.setEnabled(false);g.physics.resetCar(g.physics.player,0,0,yaw);
   for(let i=0;i<120;i++)g.physics.step(emptyInput(),emptyInput());
   const c=g.physics.player,start=new T.Vector3().copy(c.body.translation()),right=new T.Vector3(1,0,0).applyQuaternion(c.body.rotation());
   c.body.setLinvel(right.multiplyScalar(side*speed),true);
   let earlySpeed=0,distance=0,grounded=true,finalSpeed=speed;
   for(let i=0;i<5/STEP;i++){
    g.physics.step({...emptyInput(),drift},emptyInput());
    const v=c.body.linvel(),current=Math.hypot(v.x,v.z);
    if(i===59)earlySpeed=current;
    finalSpeed=current;grounded&&=c.grounded;
    distance=Math.max(distance,start.distanceTo(new T.Vector3().copy(c.body.translation())));
   }
   rows.push({yaw,side,speed,drift,earlySpeed,finalSpeed,distance,grounded});
  }
  return rows;
 });
 check('Broadside slides lose speed promptly with and without the e-brake',slides.every(r=>r.earlySpeed<r.speed*(r.drift?.6:.05)),slides);
 check('Sideways slides settle on the tires before reaching a wall',slides.every(r=>r.finalSpeed<.1&&r.distance<18&&r.grounded),slides);
 check('Holding the e-brake allows a longer slide while still slowing down',slides.filter(r=>r.drift).every(r=>r.distance>slides.find(p=>!p.drift&&p.yaw===r.yaw&&p.side===r.side&&p.speed===r.speed).distance*2),slides);
 const release=await page.evaluate(async()=>{
  const g=window.__game,{emptyInput}=await import('/src/config.ts');
  g.scenario('drive');g.physics.ball.setEnabled(false);g.physics.resetCar(g.physics.player,0,0);
  for(let i=0;i<120;i++)g.physics.step(emptyInput(),emptyInput());
  const c=g.physics.player;c.body.setLinvel({x:18,y:0,z:0},true);
  for(let i=0;i<60;i++)g.physics.step({...emptyInput(),drift:true},emptyInput());
  const before=Math.abs(c.body.linvel().x);
  for(let i=0;i<60;i++)g.physics.step(emptyInput(),emptyInput());
  return{before,after:Math.abs(c.body.linvel().x)};
 });
 check('Releasing the e-brake restores grip during an ongoing slide',release.before>3&&release.after<release.before*.05,release);
 const turning=await page.evaluate(async()=>{
  const g=window.__game,{emptyInput}=await import('/src/config.ts'),{Vector3}=await import('/node_modules/.vite/deps/three.js'),rows=[];
  for(const steer of [-1,1])for(const driftTurn of [false,true])for(const driftCoast of [false,true]){
   g.scenario('drive');g.physics.ball.setEnabled(false);g.physics.resetCar(g.physics.player,0,25);
   for(let i=0;i<120;i++)g.physics.step(emptyInput(),emptyInput());
   // Reproduce using driving inputs: accelerate, turn, then keep steering
   // after releasing the throttle, with the e-brake either held or released.
   for(let i=0;i<240;i++)g.physics.step({...emptyInput(),throttle:1},emptyInput());
   for(let i=0;i<90;i++)g.physics.step({...emptyInput(),throttle:1,steer,drift:driftTurn},emptyInput());
   const c=g.physics.player,initialSpeed=c.speed;let maxSideways=0,grounded=true,clearOfWalls=true;
   for(let i=0;i<720;i++){
    g.physics.step({...emptyInput(),steer,drift:driftCoast},emptyInput());
    const v=new Vector3().copy(c.body.linvel()),p=c.body.translation(),right=new Vector3(1,0,0).applyQuaternion(c.body.rotation());
    if(v.length()>1)maxSideways=Math.max(maxSideways,Math.abs(v.dot(right))/v.length());
    grounded&&=c.grounded;clearOfWalls&&=Math.abs(p.x)<30&&Math.abs(p.z)<40;
   }
   const v=c.body.linvel();rows.push({steer,driftTurn,driftCoast,initialSpeed,maxSideways,finalSpeed:Math.hypot(v.x,v.z),grounded,clearOfWalls});
  }
  return rows;
 });
 check('Accelerate, turn and release throttle settles even while steering is held',turning.every(r=>r.initialSpeed>10&&r.finalSpeed<.05&&r.grounded&&r.clearOfWalls),turning);
 check('Driving reproduction reaches a broadside slide in both directions',turning.filter(r=>r.driftTurn||r.driftCoast).every(r=>r.maxSideways>.95),turning);
 const ramps=await page.evaluate(async()=>{
  const g=window.__game,{emptyInput}=await import('/src/config.ts'),rows=[];
  for(const side of [-1,1])for(const speed of [10,18,23]){
   g.scenario('drive');g.physics.ball.setEnabled(false);g.physics.resetCar(g.physics.player,side*34,0,-side*Math.PI/2);
   for(let i=0;i<90;i++)g.physics.step(emptyInput(),emptyInput());
   const c=g.physics.player;c.body.setLinvel({x:side*speed,y:0,z:0},true);let arrival=null,max=0;
   for(let i=0;i<150;i++){g.physics.step({...emptyInput(),throttle:1},emptyInput());const v=c.body.linvel(),s=Math.hypot(v.x,v.y,v.z);max=Math.max(max,s);if(c.body.translation().y>=2.3){arrival=s;break;}}
   rows.push({side,speed,arrival,max});
  }return rows;
 });
 check('Both wall ramps retain at least 86% of approach speed through the curve',ramps.every(r=>r.arrival!==null&&r.arrival>r.speed*.86),ramps);
 check('Ramp transport does not exceed the speed cap',ramps.every(r=>r.max<23.1),ramps);
 const landings=await page.evaluate(async()=>{
  const g=window.__game,{emptyInput}=await import('/src/config.ts'),T=await import('/node_modules/.vite/deps/three.js'),rows=[];
  for(const yaw of [0,.35,.7])for(const drift of [false,true]){
   g.scenario('drive');g.physics.ball.setEnabled(false);const c=g.physics.player;c.body.setTranslation({x:0,y:2,z:20},true);c.body.setRotation(new T.Quaternion().setFromEuler(new T.Euler(.18,yaw,.08)),true);c.body.setLinvel({x:0,y:-6,z:-18},true);
   let min=18,grounded=false;for(let i=0;i<120;i++){g.physics.step({...emptyInput(),throttle:1,drift},emptyInput());const v=c.body.linvel();min=Math.min(min,Math.hypot(v.x,v.z));grounded ||= c.grounded;}
   rows.push({yaw,drift,min,grounded});
  }return rows;
 });
 check('Straight and angled landings retain rolling momentum',landings.every(r=>r.grounded&&r.min>17),landings);
 check('Powerslide keeps more momentum in an angled landing',landings.filter(r=>r.drift&&r.yaw>0).every(r=>r.min>landings.find(p=>!p.drift&&p.yaw===r.yaw).min),landings);
 const collision=await page.evaluate(async()=>{
  const g=window.__game,{emptyInput,FIELD}=await import('/src/config.ts');g.scenario('drive');g.physics.ball.setEnabled(false);g.physics.resetCar(g.physics.player,38,5,-Math.PI/2);const c=g.physics.player;c.body.setTranslation({x:38,y:6,z:5},true);c.body.setLinvel({x:18,y:0,z:0},true);
  for(let i=0;i<30;i++)g.physics.step(emptyInput(),emptyInput());const hit={x:c.body.translation().x,vx:c.body.linvel().x};
  g.scenario('drive');g.physics.ball.setEnabled(false);for(let i=0;i<60;i++)g.physics.step(emptyInput(),emptyInput());c.body.setLinvel({x:0,y:0,z:-18},true);
  for(let i=0;i<60;i++)g.physics.step({...emptyInput(),throttle:-1},emptyInput());const braking=Math.abs(c.body.linvel().z);
  return {...hit,braking,width:FIELD.width};
 });
 check('Head-on wall impacts still block the car and braking still stops it',collision.x<collision.width&&collision.vx<1&&collision.braking<2,collision);
 const cameras=await page.evaluate(async()=>{
  const {FollowCamera}=await import('/src/follow-camera.ts'),T=await import('/node_modules/.vite/deps/three.js'),rows=[];
  for(const fps of [30,60,144])for(const on of [true,false]){
   const f=new FollowCamera(),c=new T.PerspectiveCamera(69,1.6,.1,500),pos=new T.Vector3(0,.38,0),q=new T.Quaternion(),ball=new T.Vector3(20,1,0),clear=(a,b)=>a.distanceTo(b);
   f.update(c,pos,q,ball,18,!on,false,1/fps,true,clear);const trace=[];
   for(let i=0;i<fps*2;i++){f.update(c,pos,q,ball,18,on,false,1/fps,false,clear);trace.push({t:(i+1)/fps,q:c.quaternion.clone(),p:c.position.clone()});}
   const target=trace.at(-1);rows.push({fps,on,settled:trace.find(r=>r.q.angleTo(target.q)<.06&&r.p.distanceTo(target.p)<.2)?.t});
  }return rows;
 });
 check('Camera switching settles in about half the previous 0.77 seconds',cameras.every(r=>r.settled>=.3&&r.settled<=.43),cameras);
 const ends=await page.evaluate(async()=>{
  const {FIELD}=await import('/src/config.ts'),R=await import('/node_modules/.vite/deps/@dimforge_rapier3d-compat.js'),g=window.__game,rows=[];
  for(const end of [-1,1])for(const side of [-1,1])for(const distance of [.3,1.5]){
   const x=side*(FIELD.goalWidth+distance),z=end*(FIELD.length-(distance===1.5?.7:.08)),hit=g.physics.world.castRayAndGetNormal(new R.Ray({x,y:5,z},{x:0,y:-1,z:0}),6,true,R.QueryFilterFlags.EXCLUDE_DYNAMIC);
   rows.push({end,side,distance,height:hit?5-hit.timeOfImpact:null});
  }return rows;
 });
 check('Rounded returns reach the goalposts and regain full radius within 1.5 metres',ends.every(r=>r.height!==null&&(r.distance===1.5?r.height>.7:r.height>.05)),ends);
 const pads=await page.evaluate(async()=>{
  const {createSmallBoostPad}=await import('/src/boost-pad.ts'),p=createSmallBoostPad(),pickup=p.root.getObjectByName('boost-pad-pickup'),housing=p.root.getObjectByName('boost-pad-housing'),energy=p.root.getObjectByName('small-pad-energy');
  p.update(0,0);const active=pickup.visible;p.update(4,1);p.update(3.95,1.05);const fading=energy.children[0].material.uniforms.fade.value;p.update(3.8,1.2);const hidden=!pickup.visible&&housing.visible;p.update(0,5);return{active,fading,hidden,respawn:pickup.visible};
 });
 check('Small pads keep their metal housing while energy fades and respawns',pads.active&&pads.fading>0&&pads.fading<1&&pads.hidden&&pads.respawn,pads);
 check('No browser or shader errors',errors.length===0,errors);
 await mkdir('test-results/momentum',{recursive:true});await writeFile('test-results/momentum/checks.json',JSON.stringify({results,errors},null,2));
}finally{await browser.close()}
