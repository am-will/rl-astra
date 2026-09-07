import {chromium} from 'playwright';import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('test-results/feel/live',{recursive:true});const b=await chromium.launch({headless:true,executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});
const context=await b.newContext({viewport:{width:1440,height:900},recordVideo:{dir:'test-results/feel/live',size:{width:1440,height:900}}});const p=await context.newPage(),reports=[],errors=[];p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(()=>Object.defineProperty(navigator,'getGamepads',{value:()=>[]}));
try{
await p.goto('http://127.0.0.1:5179');await p.waitForFunction(()=>window.__game?.view&&!document.querySelector('#loading'));
for(const name of ['loft','wall','goal']){
await p.evaluate(name=>{const g=window.__game;g.scenario('drive');g.controls.clear();g.view.shake=0;g.view.ballCam=true;g.hud.camera(true);g.view.cameraReady=false;g.physics.unlimited=true;
if(name==='loft'){g.physics.resetCar(g.physics.player,0,8);g.physics.ball.setTranslation({x:0,y:14,z:-3},true);g.physics.ball.setLinvel({x:0,y:5,z:6},true);}
if(name==='wall'){g.physics.resetCar(g.physics.player,28,10,-Math.PI/2);}
if(name==='goal'){g.physics.resetCar(g.physics.player,0,55.5,-Math.PI/2);g.physics.ball.setTranslation({x:0,y:1,z:0},true);}
g.testing=false;window.tracking=true;window.trace=[];let last=performance.now(),q=g.view.camera.quaternion.clone();const track=now=>{if(!window.tracking)return;const ball=g.view.ball.position.clone().project(g.view.camera),car=g.view.player.root.position.clone().project(g.view.camera);window.trace.push({dt:now-last,angle:q.angleTo(g.view.camera.quaternion),ball:ball.toArray(),car:car.toArray(),height:g.physics.player.body.translation().y});last=now;q.copy(g.view.camera.quaternion);requestAnimationFrame(track);};requestAnimationFrame(track);},name);
if(name!=='loft'){await p.keyboard.down('w');await p.keyboard.down('Shift');}
await p.waitForTimeout(name==='loft'?2100:1600);await p.screenshot({path:`test-results/feel/live/${name}.png`});await p.waitForTimeout(name==='loft'?3500:1800);
await p.keyboard.up('w');await p.keyboard.up('Shift');
reports.push(await p.evaluate(name=>{window.tracking=false;const frames=window.trace.slice(20),d=frames.map(f=>f.dt).sort((a,b)=>a-b);return{name,frames:frames.length,p95:d[Math.floor(d.length*.95)],maxAngle:Math.max(...frames.map(f=>f.angle)),ballOff:frames.filter(f=>Math.abs(f.ball[0])>1||Math.abs(f.ball[1])>1||f.ball[2]>1).length,carOff:frames.filter(f=>Math.abs(f.car[0])>1||Math.abs(f.car[1])>1||f.car[2]>1).length,maxHeight:Math.max(...frames.map(f=>f.height)),trace:window.trace};},name));
}
await writeFile('test-results/feel/live/report.json',JSON.stringify({reports,errors},null,2));console.log(JSON.stringify({reports:reports.map(({trace,...r})=>r),errors},null,2));assert.ok(reports.every(r=>r.ballOff===0&&r.carOff===0),'Ball and car stay in view during live play');assert.equal(errors.length,0);
}finally{await context.close();await b.close();}
