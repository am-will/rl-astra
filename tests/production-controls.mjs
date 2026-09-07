import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.pad={index:0,id:'DualSense Wireless Controller (Vendor: 054c Product: 0ce6)',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:18},()=>({pressed:false,touched:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{value:()=>[window.pad]});});
async function button(index,value){await page.evaluate(({index,value})=>Object.assign(window.pad.buttons[index],{value,pressed:value>.5,touched:value>0}),{index,value});await page.waitForTimeout(90);}
try{
  await mkdir('test-results',{recursive:true});await page.goto('http://127.0.0.1:5189');await page.waitForFunction(()=>!document.querySelector('#loading')&&document.querySelector('#game-canvas'));await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>typeof window.__game),'undefined');
  await button(7,1);await page.waitForTimeout(3900);await button(7,0);const speed=Number(await page.locator('#speed').innerText());assert.ok(speed>5,`Controller must drive in production: ${speed}`);
  await button(0,1);await page.waitForTimeout(130);assert.equal(await page.locator('#drive-state').innerText(),'AIRBORNE');await button(0,0);
  await button(9,1);await button(9,0);assert.ok(await page.locator('#pause-panel').isVisible());
  await page.locator('[data-action="bindings"]').first().click();await page.locator('[data-category="aerial"]').click();await page.screenshot({path:'test-results/controls-aerial-production.png'});
  await page.locator('[data-category="match"]').click();await page.locator('[data-bind="pause"][data-device="keyboard"][data-slot="0"]').click();await page.keyboard.press('o');await page.locator('.bindings-close').click();await page.keyboard.press('o');assert.ok(!(await page.locator('#pause-panel').isVisible()));
  await page.keyboard.press('o');assert.ok(await page.locator('#pause-panel').isVisible());await page.locator('[data-action="bindings"]').first().click();await page.locator('[data-reset="keyboard"]').click();
  await page.locator('[data-category="driving"]').click();await page.locator('[data-bind="boost"][data-device="gamepad"][data-slot="0"]').click();await page.waitForTimeout(250);await page.screenshot({path:'test-results/controls-capture-production.png'});await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:640});await page.screenshot({path:'test-results/controls-phone-production.png'});const bounds=await page.locator('.bindings-menu').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);assert.ok(await page.locator('.bindings-close').isVisible());
  assert.equal(errors.length,0,errors.join('\n'));await writeFile('test-results/controls-production-report.json',JSON.stringify({production:true,debugAPI:false,controllerDriveSpeedKmh:speed,jump:true,pause:true,reboundPause:true,capture:true,compactLayout:bounds,errors},null,2));
  console.log('PASS Production controller driving, jump, pause, remapped pause, rebinding UI, compact layout, and no debug API or errors');
}finally{await browser.close();}
