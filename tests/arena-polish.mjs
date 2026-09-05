import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('test-results/arena-polish',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),results=[],errors=[];
const check=(name,pass,detail)=>{assert.ok(pass,`${name}: ${JSON.stringify(detail)}`);results.push({name,detail});console.log(`PASS ${name}`)};
try{
 const p=await browser.newPage({viewport:{width:1440,height:900}});p.on('pageerror',e=>errors.push(e.message));p.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
 await p.goto(process.env.GAME_URL||'http://127.0.0.1:5179');await p.waitForFunction(()=>window.__game?.view&&!document.querySelector('#loading'));
 await p.evaluate(()=>{window.requestAnimationFrame=()=>0;window.__game.testing=true;});await p.waitForTimeout(100);
 const directions=await p.evaluate(async()=>{
  const g=window.__game,v=g.view,T=await import('/node_modules/.vite/deps/three.js');g.scenario('drive');v.ballCam=false;const rows=[];
  for(const offset of [[0,1,-12],[12,1,0],[0,1,12],[-12,1,0],[0,12,0],[8,9,-8]]){
   const car=new T.Vector3().copy(g.physics.player.body.translation());g.physics.ball.setTranslation(car.clone().add(new T.Vector3(...offset)),true);v.cameraReady=false;v.update(1/60,'playing');v.draw();
   const arrow=v.ballDirection.root,forward=new T.Vector3(0,0,-1).applyQuaternion(arrow.quaternion),toBall=v.ball.position.clone().sub(arrow.position).normalize();rows.push({offset,visible:arrow.visible,dot:forward.dot(toBall),distance:arrow.position.distanceTo(car)});
  }return rows;
 });
 check('The 3D arrow aims at balls in every direction, including overhead',directions.every(r=>r.visible&&r.dot>.999&&r.distance>1&&r.distance<2),directions);
 const lifecycle=await p.evaluate(()=>{const g=window.__game,v=g.view;v.ballCam=true;v.update(0,'playing');const ballCam=v.ballDirection.root.visible;v.ballCam=false;v.update(0,'playing');const carCam=v.ballDirection.root.visible;v.update(0,'goal');const goal=v.ballDirection.root.visible;g.physics.player.demolished=2;v.update(0,'playing');const demolished=v.ballDirection.root.visible;g.physics.player.demolished=0;v.update(0,'playing');return{ballCam,carCam,goal,demolished,respawn:v.ballDirection.root.visible};});
 check('Camera toggles, goals and demolitions show or hide the arrow immediately',!lifecycle.ballCam&&lifecycle.carCam&&!lifecycle.goal&&!lifecycle.demolished&&lifecycle.respawn,lifecycle);
 for(const quality of ['performance','high','ultra']){
  await p.evaluate(async quality=>{const g=window.__game,v=g.view,{emptyInput}=await import('/src/config.ts');g.scenario('drive');v.setQuality(quality);v.ballCam=false;for(let i=0;i<60;i++)g.physics.step(emptyInput(),emptyInput());g.physics.ball.setTranslation({x:9,y:1,z:19},true);v.cameraReady=false;v.update(0,'playing');g.hud.camera(false);g.hud.set('blue-score',0);g.hud.set('orange-score',0);g.hud.set('timer','4:54');g.hud.set('lighting-label',quality==='ultra'?'SUNSET':'NIGHT');g.hud.set('player-status','OCTANE · BLUE TEAM');g.hud.set('drive-state','GROUNDED');g.positionLabels();v.draw();},quality);
  await p.screenshot({path:`test-results/arena-polish/${quality}-car-cam.png`});
 }
 await p.locator('.scoreboard').screenshot({path:'test-results/arena-polish/scoreboard.png'});
 for(const [name,camera,target]of [['blue-tiles',[33,1.6,32],[40,1.2,23]],['orange-tiles',[33,1.6,-23],[40,1.2,-32]],['corner-tiles',[27,2,42],[36,1.1,46]]]){
  await p.evaluate(({camera,target})=>{const v=window.__game.view;v.camera.position.set(...camera);v.camera.lookAt(...target);v.camera.fov=65;v.camera.updateProjectionMatrix();v.camera.updateMatrixWorld();v.stadium.updateCamera(v.camera.position);v.stadium.grass.update(v.camera.position,v.player.root.position,2);v.draw();},{camera,target});await p.screenshot({path:`test-results/arena-polish/${name}.png`});
 }
 const scoreboard=await p.evaluate(()=>{const g=window.__game;g.hud.set('blue-score',12);g.hud.set('orange-score',10);g.hud.set('timer','+10:09');const score=document.querySelector('#blue-score'),timer=document.querySelector('#timer'),css=s=>getComputedStyle(document.querySelector(s));return{blue:score.textContent,time:timer.textContent,blueTransform:css('.team-blue').transform,orangeTransform:css('.team-orange').transform,clockTransform:css('.clock').transform,scorePaths:score.querySelectorAll('svg path').length,timerPaths:timer.querySelectorAll('svg path').length};});
 check('Thin numerals retain exact multi-digit scores and overtime text',scoreboard.blue==='12'&&scoreboard.time==='+10:09'&&scoreboard.scorePaths===2&&scoreboard.timerPaths===6,scoreboard);
 check('Both score panels have 3D perspective while the clock remains flat',scoreboard.blueTransform.startsWith('matrix3d')&&scoreboard.orangeTransform.startsWith('matrix3d')&&scoreboard.clockTransform==='none',scoreboard);
 await p.setViewportSize({width:390,height:844});
 await p.evaluate(()=>{const g=window.__game;g.view.cameraReady=false;g.view.update(0,'playing');g.positionLabels();g.view.draw();});
 await p.screenshot({path:'test-results/arena-polish/mobile.png'});
 check('No browser or shader errors',errors.length===0,errors);
 await writeFile('test-results/arena-polish/checks.json',JSON.stringify({results,errors},null,2));
}finally{await browser.close()}
