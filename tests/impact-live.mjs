import {chromium} from 'playwright';import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('test-results/impact/live',{recursive:true});const b=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});const context=await b.newContext({viewport:{width:1600,height:900},deviceScaleFactor:1.5,recordVideo:{dir:'test-results/impact/live',size:{width:1280,height:720}}});const p=await context.newPage(),errors=[],reports=[];p.on('pageerror',e=>errors.push(e.message));
try{await p.goto('http://127.0.0.1:5179');await p.waitForFunction(()=>window.__game?.view&&!document.querySelector('#loading'));
for(const name of ['demo-opponent','demo-player','goal-control','fast-ball']){
 await p.evaluate(name=>{const g=window.__game;g.scenario('drive');g.controls.clear();g.view.ballCam=true;g.hud.camera(true);g.physics.botEnabled=true;g.physics.resetCar(g.physics.player,0,8);g.physics.resetCar(g.physics.bot,0,0);g.physics.ball.setTranslation({x:15,y:1,z:-4},true);g.view.cameraReady=false;g.view.shake=0;g.physics.unlimited=true;
 if(name==='goal-control'){g.physics.resetCar(g.physics.player,3,-44);g.physics.resetCar(g.physics.bot,-4,-35);g.physics.ball.setTranslation({x:0,y:2,z:-53},true);g.view.update(0,'playing');g.score('blue');}
 if(name==='fast-ball'){g.physics.ball.setTranslation({x:0,y:4,z:-12},true);g.physics.ball.setLinvel({x:26,y:2,z:4},true);}
 if(name==='demo-opponent')g.physics.demolish(g.physics.bot);
 if(name==='demo-player')g.physics.demolish(g.physics.player);
 g.testing=false;window.tracking=true;window.trace=[];let last=performance.now();const track=now=>{if(!window.tracking)return;const c=g.view.player.root.position.clone().project(g.view.camera);window.trace.push({dt:now-last,car:c.toArray(),cameraY:g.view.camera.position.y,phase:g.phase,demolished:g.physics.player.demolished,boost:g.physics.player.boost,roll:g.physics.player.body.rotation().z});last=now;requestAnimationFrame(track);};requestAnimationFrame(track);},name);
 if(name==='goal-control'){await p.waitForTimeout(350);await p.keyboard.down('e');await p.keyboard.down('Shift');await p.waitForTimeout(650);await p.keyboard.up('Shift');await p.keyboard.up('e');}
 else await p.waitForTimeout(1000);
 await p.screenshot({path:`test-results/impact/live/${name}.png`});await p.waitForTimeout(name==='goal-control'?3100:2300);
 reports.push(await p.evaluate(name=>{window.tracking=false;window.__game.testing=true;const f=window.trace.slice(3),d=f.map(f=>f.dt).sort((a,b)=>a-b);return{name,frames:f.length,p95:d[Math.floor(d.length*.95)],maxFrame:Math.max(...d),minCameraY:Math.min(...f.map(f=>f.cameraY)),carOff:f.filter(f=>f.demolished<=0&&(Math.abs(f.car[0])>1||Math.abs(f.car[1])>1||f.car[2]>1)).length,trace:window.trace};},name));
}
await writeFile('test-results/impact/live/report.json',JSON.stringify({reports,errors},null,2));console.log(JSON.stringify({reports:reports.map(({trace,...r})=>r),errors},null,2));assert.equal(errors.length,0);assert.ok(reports.every(r=>r.minCameraY>.5),'Camera stays out of the floor');assert.equal(reports.find(r=>r.name==='goal-control').carOff,0,'Player remains in view through controllable goal blast');
}finally{await context.close();await b.close();}
