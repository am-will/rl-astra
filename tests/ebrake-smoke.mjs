import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('test-results/ebrake-smoke', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const results = [], errors = [], check = (name, pass, detail) => { assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); results.push({ name, detail }); console.log(`PASS ${name}`); };
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
 page.on('pageerror', e => errors.push(e.message)); page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
 await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5179'); await page.waitForFunction(() => window.__game && !document.querySelector('#loading'));
 await page.evaluate(() => { window.requestAnimationFrame = () => 0; window.__game.testing = true; }); await page.waitForTimeout(90);
 for (const quality of ['performance', 'high', 'ultra']) {
  const visible = await page.evaluate(quality => {
   const g = window.__game, v = g.view, fx = v.turfDebris[0]; g.scenario('drive'); g.physics.resetCar(g.physics.player, 10, 20); g.advance(.25); v.setQuality(quality); v.ballCam = false;
   g.physics.player.body.setLinvel({ x: 0, y: 0, z: -16 }, true); fx.reset(); for (let i = 0; i < 45; i++) g.advance(1/60, { throttle: 1, steer: .85, drift: true });
   g.hud.camera(false); g.positionLabels();
   const gl = v.renderer.getContext(), capture = () => { v.draw(); const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels); return pixels; };
   const compare = () => { fx.smoke.mesh.visible = false; const before = capture(); fx.smoke.mesh.visible = true; const after = capture(); let count = 0, max = 0; for (let i = 0; i < before.length; i += 4) { const delta = Math.abs(after[i] - before[i]) + Math.abs(after[i+1] - before[i+1]) + Math.abs(after[i+2] - before[i+2]); if (delta > 24) count++; max = Math.max(max, delta); } return { count, max }; };
   const grass = compare(); const y = fx.smoke.particles.map(p => p.position.y); let bare;
   if (quality === 'ultra') { v.stadium.grass.mesh.visible = false; bare = compare(); v.stadium.grass.mesh.visible = true; }
   fx.smoke.mesh.visible = true; v.draw();
   return { quality, puffs: fx.smoke.mesh.count, minHeight: Math.min(...y), maxHeight: Math.max(...y), grass, bare, depthTest: fx.smoke.mesh.material.depthTest, depthWrite: fx.smoke.mesh.material.depthWrite };
  }, quality);
  check(`${quality}: e-brake smoke changes visible pixels above the turf`, visible.puffs > 8 && visible.minHeight >= .18 && visible.maxHeight > .3 && visible.grass.count > 100 && visible.depthTest && !visible.depthWrite && (!visible.bare || visible.grass.count > visible.bare.count * .65), visible);
  await page.screenshot({ path: `test-results/ebrake-smoke/${quality}.png` });
 }
 const lifecycle = await page.evaluate(() => {
  const g=window.__game,v=g.view,fx=v.turfDebris[0],smoke=fx.smoke;
  const before=JSON.stringify(smoke.particles);v.update(0,'playing');const frozen=before===JSON.stringify(smoke.particles);
  g.physics.player.drifting=false;for(let i=0;i<70;i++)v.update(1/60,'playing');const released=smoke.mesh.count;
  const cases=[];for(const [name,speed,grounded,y,x,z]of [['rest',0,true,.335,10,20],['air',15,false,4,10,20],['pad',15,true,.335,-31,0],['goal',15,true,.335,0,55]]){g.physics.player.body.setTranslation({x,y,z},true);g.physics.player.speed=speed;g.physics.player.grounded=grounded;g.physics.player.drifting=true;fx.reset();for(let i=0;i<30;i++)v.update(1/60,'playing');cases.push({name,count:smoke.mesh.count});}
  g.scenario('drive');g.physics.resetCar(g.physics.player,10,20);g.advance(.25);g.physics.player.body.setLinvel({x:0,y:0,z:-16},true);for(let i=0;i<60;i++)g.advance(1/60,{throttle:1,steer:.8,drift:true});const active=smoke.mesh.count;g.physics.player.demolished=1;v.update(1/60,'playing');const demo=smoke.mesh.count;g.physics.player.demolished=0;
  return{frozen,released,cases,active,demo};
 });
 check('Smoke freezes on pause, clears on release/demo, and stays off at rest or away from grass', lifecycle.frozen&&lifecycle.released===0&&lifecycle.cases.every(c=>c.count===0)&&lifecycle.active>0&&lifecycle.demo===0, lifecycle);
 const timing=await page.evaluate(()=>{const g=window.__game,v=g.view,fx=v.turfDebris[0],rows=[];for(const hz of [30,60,144]){g.scenario('drive');g.physics.resetCar(g.physics.player,10,20);g.advance(.25);g.physics.player.speed=16;g.physics.player.drifting=true;g.physics.player.body.setLinvel({x:5,y:0,z:-15},true);fx.reset();for(let i=0;i<hz;i++)v.update(1/hz,'playing');rows.push({hz,count:fx.smoke.mesh.count});}g.physics.player.body.setTranslation({x:-15,y:.335,z:-10},true);v.update(0,'playing');return{rows,teleported:fx.smoke.mesh.count};});
 check('Emission stays bounded and consistent across refresh rates and clears on teleport',timing.rows.every(r=>r.count>20&&r.count<=96)&&Math.max(...timing.rows.map(r=>r.count))-Math.min(...timing.rows.map(r=>r.count))<10&&timing.teleported===0,timing);
 check('No browser or shader errors',errors.length===0,errors);await writeFile('test-results/ebrake-smoke/checks.json',JSON.stringify({results,errors},null,2));
} finally { await browser.close(); }
