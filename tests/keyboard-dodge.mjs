import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:900}});
try{await page.goto('http://127.0.0.1:5179');await page.waitForFunction(()=>window.__game?.view&&!document.querySelector('#loading'));
await page.evaluate(()=>{const g=window.__game;g.scenario('drive');g.physics.resetCar(g.physics.player,12,29);g.testing=false;window.dodgeTrace=[];window.dodgeStarted=0;const trace=()=>{const c=g.physics.player; if(c.flipTime>0&&!window.dodgeStarted)window.dodgeStarted=performance.now();if(window.dodgeStarted)window.dodgeTrace.push({age:(performance.now()-window.dodgeStarted)/1000,q:{...c.body.rotation()},y:c.body.translation().y,flip:c.flipTime,lock:c.pitchLock,grounded:c.grounded,heldForward:g.controls.keys.has('KeyW')});if(window.dodgeTrace.length<200)requestAnimationFrame(trace);};requestAnimationFrame(trace);});
await page.keyboard.down('w');await page.waitForTimeout(500);await page.keyboard.down('Space');await page.waitForTimeout(90);await page.keyboard.up('Space');await page.waitForTimeout(90);await page.keyboard.press('Space');await page.waitForTimeout(1700);await page.keyboard.up('w');await page.waitForTimeout(400);
const trace=await page.evaluate(()=>window.dodgeTrace);await writeFile('test-results/refinements/keyboard-dodge.json',JSON.stringify(trace,null,2));assert.ok(trace.some(f=>Math.abs(f.q.w)<.1),'Real keyboard dodge passes through an inverted attitude');
assert.ok(trace.some(f=>f.age>.65&&f.age<.8&&f.flip===0&&Math.abs(f.q.w)>.97),'Dodge completes upright with W still held');
assert.ok(trace.some(f=>f.age>.8&&f.age<1.2&&f.grounded&&Math.abs(f.q.w)>.99),'Held W lands the car on its wheels');
console.log('PASS Real keyboard dodge completes one turn and lands on its wheels with W held');
}finally{await browser.close();}
