import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({headless:true,executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[], results=[];
page.on('pageerror', e=>errors.push(e.message));
const check=(name,pass,detail)=>{results.push({name,pass,detail});console.log(`${pass?'PASS':'FAIL'} ${name}${pass?'':' '+JSON.stringify(detail)}`);};
await page.addInitScript(()=>{
  window.testPads=[];
  Object.defineProperty(navigator,'getGamepads',{value:()=>window.testPads});
  window.makePad=(index=0,mapping='standard')=>({index,id:'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',mapping,connected:true,timestamp:0,axes:[0,0,0,0],buttons:Array.from({length:18},()=>({pressed:false,touched:false,value:0}))});
});
const pause=()=>page.waitForTimeout(85);
const button=async(index,value=1)=>{await page.evaluate(({index,value})=>{const b=window.testPads.find(Boolean).buttons[index];b.value=value;b.pressed=value>.5;b.touched=value>0;},{index,value});await pause();};
const axes=async(x,y)=>{await page.evaluate(({x,y})=>{const p=window.testPads.find(Boolean);p.axes[0]=x;p.axes[1]=y;},{x,y});await pause();};
const read=()=>page.evaluate(()=>window.__game.controls.read());
const tap=async index=>{await button(index);await button(index,0);};
try {
  await mkdir('test-results',{recursive:true});
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5179'); await page.waitForFunction(()=>window.__game?.view&&!document.querySelector('#loading'));
  const ceiling = await page.evaluate(async()=>{
    const {Quaternion,Vector3}=await import('/node_modules/.vite/deps/three.js'); const g=window.__game;const runs=[];
    for(const speed of [0,5,20]){
      g.scenario('drive');const c=g.physics.player;c.body.setTranslation({x:0,y:20.145,z:15},true);c.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI),true);c.body.setLinvel({x:0,y:0,z:-speed},true);
      let release=null,hadContact=false,maxY=0;for(let i=0;i<120;i++){g.advance(1/120,{throttle:speed?1:0});hadContact ||= c.grounded; maxY=Math.max(maxY,c.body.translation().y);if(hadContact&&!c.grounded&&!release)release={time:(i+1)/120,distance:15-c.body.translation().z};}
      runs.push({speed,release,hadContact,maxY,y:c.body.translation().y,vy:c.body.linvel().y});
    }return runs;
  });
  for(const c of ceiling)check(`Ceiling releases at speed ${c.speed}`,c.hadContact&&c.release?.time<.8&&c.y<19&&c.vy<0,c);
  check('Speed carries the car farther before ceiling release',ceiling[2].release.distance>ceiling[1].release.distance*2,ceiling);
  const recovery=await page.evaluate(async()=>{const {Quaternion,Vector3}=await import('/node_modules/.vite/deps/three.js');const g=window.__game; const runs=[];
    for(const roll of [Math.PI,-Math.PI+.15,Math.PI-.2]){g.scenario('rollover');g.physics.player.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),roll),true);g.advance(.7);g.physics.player.jumpCount=2;g.physics.player.airTime=4;const before=g.snapshot();g.advance(1/120,{jump:true});const started=g.physics.player.recoveryTime;g.advance(.19);const middle=g.snapshot();g.advance(1);runs.push({roll,before,started,middle,after:g.snapshot()});}return runs;});
  for(const r of recovery)check(`Jump rights grounded inverted car (${r.roll.toFixed(2)})`,r.started>.3&&r.middle.car.y>r.before.car.y+.15&&r.after.grounded&&Math.abs(r.after.rotation.w)>.98,r);
  const invertedAir=await page.evaluate(async()=>{const {Quaternion,Vector3}=await import('/node_modules/.vite/deps/three.js');const g=window.__game;g.scenario('air');g.physics.player.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI),true);g.advance(.01,{jump:true});return g.physics.player.recoveryTime;});
  check('Midair upside-down jump is not a recovery teleport',invertedAir===0,invertedAir);
  await page.evaluate(()=>{const g=window.__game;g.scenario('drive');window.testPads=[null,null,window.makePad(2)];});await pause();
  check('DualSense connects in a sparse Gamepad API slot',await page.evaluate(()=>window.__game.controls.pad?.index===2));
  await button(7,.4);let input=await read();check('R2 preserves analog throttle',Math.abs(input.throttle-.4)<.001,input);await button(7,0);
  await button(6,.65);input=await read();check('L2 preserves analog reverse',Math.abs(input.throttle+.65)<.001,input);await button(6,0);
  await axes(.05,-.08);input=await read();check('Stick drift stays inside deadzone',input.steer===0&&input.pitch===0,input);
  await axes(-.56,-.56);input=await read();check('Left stick steers and pitches proportionally',Math.abs(input.steer-.5)<.01&&Math.abs(input.pitch+.5)<.01,input);
  await button(2);input=await read();check('Square powerslides and converts air yaw to roll',input.drift&&input.yaw===0&&input.roll>.49,input);await button(2,0);await axes(0,0);
  await button(4);input=await read();check('L1 supplies directional air roll',input.roll===1,input);await button(4,0);
  await button(1);input=await read();check('Circle boosts',input.boost,input);await button(1,0);
  await button(0);input=await read();const held=await read();check('Cross jump is a single edge with continuous hold',input.jump&&input.jumpHeld&&!held.jump&&held.jumpHeld,{input,held});await button(0,0);
  await button(7);await button(0);input=await read();check('Gas alone does not cause a directional dodge',input.jump&&input.dodgeForward===0&&input.dodgeSide===0,input);await button(0,0);await button(7,0);
  const camera=await page.evaluate(()=>window.__game.view.ballCam);await button(3);await page.waitForTimeout(200);check('Triangle toggles ball camera once per press',await page.evaluate(before=>window.__game.view.ballCam!==before,camera));await button(3,0);
  await tap(9);check('Options opens pause menu',await page.locator('#pause-panel').isVisible());
  await page.locator('[data-action="resume"]').focus();await tap(13);await tap(0);check('D-pad and Cross open controls settings',await page.locator('#bindings-panel').isVisible());
  check('PS5 labels and connection status are visible',(await page.locator('#binding-rows').innerText()).includes('R2')&&(await page.locator('#controller-name').innerText()).includes('DualSense'));
  // Keyboard capture and cancellation.
  await page.locator('[data-bind="forward"][data-device="keyboard"][data-slot="0"]').click();await page.keyboard.press('i');
  check('Keyboard rebind saves immediately',await page.evaluate(()=>window.__game.controls.settings.keyboard.forward[0]==='KeyI'));
  await page.locator('[data-bind="jump"][data-device="keyboard"][data-slot="0"]').click();await page.keyboard.press('Escape');
  check('Escape cancels capture without changing the binding',await page.evaluate(()=>!window.__game.controls.capture&&window.__game.controls.settings.keyboard.jump[0]==='Space'));
  // Bind R1 to boost through the capture UI.
  await page.locator('[data-bind="boost"][data-device="gamepad"][data-slot="0"]').click();await page.waitForTimeout(260);await button(5);await button(5,0);
  check('Controller button capture saves R1 boost',await page.evaluate(()=>window.__game.controls.settings.gamepad.boost[0].index===5));
  check('Shared binding is explained, not silently overwritten',(await page.locator('#binding-notice').innerText()).includes('air roll right'));
  // Axis capture uses direction, not just axis number.
  await page.locator('[data-bind="left"][data-device="gamepad"][data-slot="0"]').click();await page.waitForTimeout(260);await page.evaluate(()=>window.testPads[2].axes[2]=-.9);await pause();await page.evaluate(()=>window.testPads[2].axes[2]=0);await pause();
  check('Controller stick direction can be rebound',await page.evaluate(()=>{const p=window.__game.controls.settings.gamepad.left[0];return p.type==='axis'&&p.index===2&&p.direction===-1;}));
  for (const key of ['deadzone','steeringSensitivity']) {const slider=page.locator(`[data-setting="${key}"]`);await slider.focus();await page.keyboard.press('Home');for(let i=0;i<17;i++)await page.keyboard.press('ArrowRight');}
  await page.screenshot({path:'test-results/controls-options.png'});
  const overflow=await page.evaluate(()=>{const panel=document.querySelector('.bindings-menu');return{width:panel.clientWidth,scroll:panel.scrollWidth};});check('Options panel has no horizontal overflow',overflow.width===overflow.scroll,overflow);
  await page.locator('.bindings-close').click();await tap(9);check('Options resumes from the controller',!(await page.locator('#pause-panel').isVisible()));
  await page.keyboard.press('Escape');check('Keyboard Escape opens pause',await page.locator('#pause-panel').isVisible());await page.keyboard.press('Escape');check('Keyboard Escape resumes from pause',!(await page.locator('#pause-panel').isVisible()));
  await page.keyboard.down('i');input=await read();await page.keyboard.up('i');check('Rebound keyboard acceleration works',input.throttle===1,input);
  await page.keyboard.down('w');input=await read();await page.keyboard.up('w');check('Old keyboard acceleration is removed',input.throttle===0,input);
  // Wait for a neutral controller sample after keyboard resume before pressing R1.
  await page.waitForFunction(()=>!window.__game.controls.padBlocked);
  await button(5);input=await read();check('Rebound R1 activates boost',input.boost,input);await page.keyboard.press('Escape');await page.keyboard.press('Escape');input=await read();check('Held controls do not leak through pause/resume',!input.boost,input);await button(5,0);
  await page.evaluate(()=>window.testPads=[]);await pause();check('Disconnect pauses safely and clears input',await page.evaluate(()=>window.__game.paused&&window.__game.controls.read().throttle===0));
  await page.reload();await page.waitForFunction(()=>window.__game?.view&&!document.querySelector('#loading'));
  check('Bindings and tuning survive reload',await page.evaluate(()=>{const c=window.__game.controls.settings;return c.keyboard.forward[0]==='KeyI'&&c.gamepad.boost[0].index===5&&c.gamepad.left[0].index===2&&c.deadzone===.2&&c.steeringSensitivity===1.35;}));
  await page.keyboard.press('Escape');await page.locator('[data-action="bindings"]').first().click();
  await page.locator('[data-reset="keyboard"]').click();await page.locator('[data-reset="gamepad"]').click();
  check('Reset restores each default layout and tuning',await page.evaluate(()=>{const c=window.__game.controls.settings;return c.keyboard.forward[0]==='KeyW'&&c.gamepad.boost[0].index===1&&c.deadzone===.12;}));
  await page.setViewportSize({width:600,height:700});await page.screenshot({path:'test-results/controls-options-small.png'});
  check('Compact options remains inside the viewport',await page.locator('.bindings-menu').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));
  // Reconnect while the menu is open, then navigate without mouse input.
  await page.evaluate(()=>window.testPads=[window.makePad()]);await pause();await tap(1);check('Circle closes bindings to pause',!(await page.locator('#bindings-panel').isVisible())&&await page.locator('#pause-panel').isVisible());
  await tap(9);await page.evaluate(()=>{window.__game.scenario('drive');window.__game.testing=false;});await pause();
  const start=await page.evaluate(()=>window.__game.snapshot().car);await button(7);await page.waitForTimeout(500);const end=await page.evaluate(()=>window.__game.snapshot().car);await button(7,0);
  check('Controller drives the live game loop',start.z-end.z>1,{start,end});
  await page.evaluate(()=>{window.__game.scenario('rollover');window.__game.advance(.7);window.__game.testing=false;});await button(0);await button(0,0);await page.waitForTimeout(1100);
  check('Cross recovers an overturned car in live gameplay',await page.evaluate(()=>{const c=window.__game.physics.player;return c.grounded&&Math.abs(c.body.rotation().w)>.98;}));
  // A non-standard device can expose a trigger as an axis resting at -1.
  await page.evaluate(()=>{const g=window.__game;g.scenario('drive');const p=window.makePad(0,'');p.id='Generic USB controller';p.axes[2]=-1;window.testPads=[p];});await pause();
  await page.keyboard.press('Escape');await page.locator('[data-action="bindings"]').first().click();
  await page.locator('[data-bind="forward"][data-device="gamepad"][data-slot="0"]').click();await page.waitForTimeout(260);await page.evaluate(()=>window.testPads[0].axes[2]=.8);await pause();
  check('Raw trigger capture preserves its nonzero resting position',await page.evaluate(()=>{const p=window.__game.controls.settings.gamepad.forward[0];return p.type==='axis'&&p.rest===-1&&p.index===2&&p.direction===1;}));
  await page.evaluate(()=>window.testPads[0].axes[2]=-1);await pause();await page.locator('.bindings-close').click();await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!window.__game.controls.padBlocked);
  await page.evaluate(()=>window.testPads[0].axes[2]=0);await pause();input=await read();check('Raw trigger axis is analog after rebinding',Math.abs(input.throttle-.4318)<.01,input);
  await page.evaluate(()=>localStorage.setItem('champions-field.controls.v1',JSON.stringify({version:1,keyboard:{forward:[null]},gamepad:{jump:[{type:'button',index:-1}]},deadzone:10})));
  await page.reload();await page.waitForFunction(()=>window.__game?.view&&!document.querySelector('#loading'));
  check('Malformed saved bindings fall back safely and numbers clamp',await page.evaluate(()=>{const s=window.__game.controls.settings;return s.keyboard.forward[0]==='KeyW'&&s.gamepad.jump[0].index===0&&s.deadzone===.4;}));
  check('No browser errors',errors.length===0,errors);
  await writeFile('test-results/controls-ceiling-report.json',JSON.stringify({results,errors,ceiling},null,2));
  assert.ok(results.every(r=>r.pass),`${results.filter(r=>!r.pass).length} failed controls/ceiling checks`);
} finally { await browser.close(); }
