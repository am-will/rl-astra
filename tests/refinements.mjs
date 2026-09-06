import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox'] });
const page=await browser.newPage({viewport:{width:1440,height:900}});
const results=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
const check=(name,pass,detail)=>{results.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name} ${pass?'':JSON.stringify(detail)}`);};
try {
  await page.goto('http://127.0.0.1:5179');await page.waitForFunction(()=>window.__game?.view && !document.querySelector('#loading'));
  for(const [name,input] of [['forward',{throttle:1,pitch:-1}],['backward',{throttle:-1,pitch:1}],['side',{steer:1}],['diagonal',{throttle:1,steer:-1,pitch:-1}]]){
    const data=await page.evaluate(input=>{const g=window.__game;g.scenario('air');g.advance(.325,{...input,jump:true});const middle=g.snapshot().rotation;g.advance(.325,input);const end=g.snapshot().rotation;const angular=g.physics.player.body.angvel();g.advance(.2,{throttle:input.throttle||0,pitch:input.pitch||0});return{middle,end,angular,recovery:g.snapshot().rotation};},input);
    check(`${name} dodge is upright and settling within 650 ms`,1-2*(data.end.x**2+data.end.z**2)>.96 && Math.hypot(data.angular.x,data.angular.y,data.angular.z)>1 && Math.hypot(data.angular.x,data.angular.y,data.angular.z)<2.5 && Math.abs(data.middle.w)<.35,data);
    check(`${name} dodge follows through near upright`,1-2*(data.recovery.x**2+data.recovery.z**2)>.99,data.recovery);
  }
  const roll=await page.evaluate(()=>{const g=window.__game;g.scenario('air');g.advance(.35,{roll:1});const speed=g.physics.player.body.angvel();const initial=g.view.player.root.quaternion.clone();g.advance(2*Math.PI/5.5,{roll:1});const current=g.view.player.root.quaternion;return{speed,turnError:initial.angleTo(current)};});
  check('Air roll reaches RL angular limit',Math.abs(Math.abs(roll.speed.z)-5.5)<.01,roll);
  check('Sustained barrel roll takes about 1.14 seconds',roll.turnError<.06,roll);
  await page.keyboard.down('PageDown');const key=await page.evaluate(()=>window.__game.controls.read().drift);await page.keyboard.up('PageDown');
  check('PgDn activates e-brake',key,key);
  const marker=await page.evaluate(()=>{const g=window.__game;g.scenario('drive');const values=[];for(const y of [1,5,15]){g.physics.ball.setTranslation({x:0,y,z:0},true);g.view.update(0,'playing');values.push(g.view.ballGround.scale.x);}return values;});
  check('Ball marker grows monotonically with height',marker[0]<marker[1] && marker[1]<marker[2] && marker[2]>marker[0]*1.8,marker);
  const roof=await page.evaluate(async()=>{const {FIELD}=await import('/src/config.ts');const g=window.__game;g.scenario('drive');g.physics.ball.setTranslation({x:0,y:18,z:0},true);g.physics.ball.setLinvel({x:0,y:30,z:0},true);g.advance(.25);return{height:FIELD.height,ball:g.snapshot().ball,velocity:g.snapshot().ballVelocity,wallMeshes:g.view.scene.children.filter(m=>m.name==='arena-wall').length,ceiling:g.view.scene.children.some(m=>m.name==='arena-ceiling')};});
  check('Standard-height ceiling collides and has honeycomb',roof.height===20.48 && roof.velocity.y<0 && roof.ceiling && roof.wallMeshes>=8,roof);
  for(const side of [-1,1]){
    const ride=await page.evaluate(side=>{const g=window.__game;g.scenario('wall-drive');g.physics.resetCar(g.physics.player,side*28,10,side*-Math.PI/2);let max=0,upsideDown=false,escaped=false;const trace=[];for(let i=0;i<210;i++){g.advance(1/60,{throttle:1,boost:true});const s=g.snapshot();max=Math.max(max,s.car.y);const q=g.view.player.root.quaternion;const up=g.view.player.root.position.clone().set(0,1,0).applyQuaternion(q);if(s.car.y>18&&up.y<-.8)upsideDown=true;if(Math.abs(s.car.x)>41.5||s.car.y>21)escaped=true;if(i%30===0)trace.push(s.car);}return{max,upsideDown,escaped,trace};},side);
    check(`Wall-to-ceiling transition ${side}`,ride.max>19 && ride.upsideDown && !ride.escaped,ride);
  }
  for(const end of [-1,1])for(const side of [-1,1]){
    const entrance=await page.evaluate(({end,side})=>{const g=window.__game;g.scenario('drive');g.physics.resetCar(g.physics.player,side*6,end*50.25,side*-Math.PI/2);g.physics.player.body.setLinvel({x:side*7,y:0,z:0},true);const trace=[];let minSpeed=100,maxHeight=0;for(let i=0;i<60;i++){g.advance(1/60,{throttle:1});const s=g.snapshot();minSpeed=Math.min(minSpeed,Math.abs(s.velocity.x));maxHeight=Math.max(maxHeight,s.car.y);if(i%15===0)trace.push({pos:s.car,speed:s.velocity});}return{minSpeed,maxHeight,trace,final:g.snapshot()};},{end,side});
    check(`Goal-mouth ramp remains traversable with tire and chassis friction (${end}, ${side})`,entrance.minSpeed>1.25 && entrance.maxHeight<3 && Math.abs(entrance.final.car.x)>10 && Math.abs(entrance.final.velocity.x)>5,entrance);
  }
  for(const end of [-1,1]){
    const goal=await page.evaluate(end=>{const g=window.__game;g.scenario('drive');g.physics.resetCar(g.physics.player,6,end*53,0);g.physics.player.body.setTranslation({x:6,y:1,z:end*53},true);g.physics.ball.setTranslation({x:0,y:3,z:end*58},true);g.physics.ball.setLinvel({x:0,y:0,z:end*10},true);for(let i=0;i<80;i++)g.physics.step({throttle:0,steer:0,pitch:0,roll:0,jump:false,jumpHeld:false,boost:false,drift:false},{throttle:0,steer:0,pitch:0,roll:0,jump:false,jumpHeld:false,boost:false,drift:false});return{ball:g.snapshot().ball,velocity:g.snapshot().ballVelocity};},end);
    check(`Rounded goal back remains solid (${end})`,Math.abs(goal.ball.z)<60.1&&goal.velocity.z*end<0,goal);
  }
  for(const end of [-1,1])for(const side of [-1,1]){
    const corner=await page.evaluate(async({end,side})=>{const {Raycaster,Vector3}=await import('/node_modules/.vite/deps/three.js');const g=window.__game;g.scenario('drive');g.physics.resetCar(g.physics.player,side*29,end*38,Math.atan2(-side,-end));g.view.cameraReady=false;g.physics.unlimited=true;let maxHeight=0,escaped=false,hidden=0,occluded=0;const trace=[];for(let i=0;i<180;i++){g.advance(1/60,{throttle:1,boost:true});const s=g.snapshot();maxHeight=Math.max(maxHeight,s.car.y);if(Math.abs(s.car.x)>41.5||Math.abs(s.car.z)>51.8||s.car.y>21)escaped=true;const screen=g.view.player.root.position.clone().project(g.view.camera);if(i>15&&(Math.abs(screen.x)>1||Math.abs(screen.y)>1))hidden++;const origin=g.view.camera.position,target=g.view.player.root.position,dir=target.clone().sub(origin).normalize();const hits=new Raycaster(origin,dir).intersectObjects(g.view.scene.children.filter(o=>o.name==='arena-ramp'));if(hits[0]&&hits[0].distance>4&&hits[0].distance<origin.distanceTo(target)-.2)occluded++;if(i%45===0)trace.push({pos:s.car,camera:s.camera});}return{maxHeight,escaped,hidden,occluded,trace};},{end,side});
    check(`Rounded corner ride and camera (${end}, ${side})`,corner.maxHeight>8&&!corner.escaped&&corner.hidden===0&&corner.occluded===0,corner);
  }
  const slope=await page.evaluate(()=>{const g=window.__game;g.scenario('drive');g.physics.ball.setTranslation({x:40,y:9,z:0},true);g.view.update(0,'playing');return{height:g.view.ballGround.position.y,rotation:g.view.ballGround.quaternion.toArray()};});
  check('Ball marker projects onto the curved ramp',slope.height>.3,slope);
  check('No browser or shader errors',errors.length===0,errors);
  await mkdir('test-results/refinements',{recursive:true});await writeFile('test-results/refinements/physics-report.json',JSON.stringify({results,errors},null,2));
  assert.ok(results.every(r=>r.pass),`${results.filter(r=>!r.pass).length} failed refinement checks`);
}finally{await browser.close();}
