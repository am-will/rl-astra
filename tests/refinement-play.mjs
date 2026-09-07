import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});
await mkdir('test-results/refinements/live',{recursive:true});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,recordVideo:{dir:'test-results/refinements/live',size:{width:1440,height:900}}});
const page=await context.newPage(),errors=[],report=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
try{
await page.goto('http://127.0.0.1:5179');await page.waitForFunction(()=>window.__game?.view&&!document.querySelector('#loading'));
await page.evaluate(()=>{const g=window.__game;g.scenario('drive');g.testing=false;g.physics.unlimited=true;});
await page.keyboard.down('w');await page.keyboard.down('Shift');await page.waitForTimeout(600);await page.keyboard.up('Shift');await page.keyboard.down('Space');await page.waitForTimeout(90);await page.keyboard.up('Space');await page.waitForTimeout(90);await page.keyboard.press('Space');await page.waitForTimeout(650);await page.screenshot({path:'test-results/refinements/live/dodge-recovery.png'});await page.keyboard.up('w');
await page.evaluate(()=>{const g=window.__game;g.scenario('air');g.physics.player.body.setTranslation({x:0,y:14,z:12},true);g.view.cameraReady=false;g.testing=false;});
await page.keyboard.down('e');await page.waitForTimeout(1100);await page.keyboard.up('e');await page.screenshot({path:'test-results/refinements/live/barrel-roll.png'});
for(const team of ['blue','orange']){
 await page.evaluate(team=>{const g=window.__game;g.scenario('goal-'+team);g.advance(.6);g.view.cameraReady=false;g.testing=false;window.frameTimes=[];window.frameAge=[];let last=performance.now();const measure=now=>{if(g.phase==='goal'){window.frameTimes.push(now-last);window.frameAge.push(g.view.effects.explosion.age);last=now;requestAnimationFrame(measure);}};requestAnimationFrame(measure);},team);
 await page.waitForTimeout(850);await page.screenshot({path:`test-results/refinements/live/${team}-eruption.png`});
 await page.waitForTimeout(650);await page.screenshot({path:`test-results/refinements/live/${team}-singularity.png`});
 await page.waitForFunction(()=>window.__game.phase!=='goal');
 report.push(await page.evaluate(team=>{const d=window.frameTimes.slice(3).sort((a,b)=>a-b);return{team,frames:d.length,medianFrameMs:d[Math.floor(d.length*.5)],p95FrameMs:d[Math.floor(d.length*.95)],worstMs:d.at(-1),fps:window.__game.fps,phase:window.__game.phase,explosionReset:!window.__game.view.effects.explosion.root.visible};},team));
}
await page.evaluate(()=>{const g=window.__game;g.restart();g.testing=false;});
await writeFile('test-results/refinements/live/report.json',JSON.stringify({report,errors},null,2));console.log(JSON.stringify({report,errors},null,2));if(errors.length)throw Error(errors.join('\n'));
}finally{await context.close();await browser.close();}
