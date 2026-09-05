import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const output = 'test-results/render-fixes';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const results = [], errors = [];
const check = (name, pass, detail) => { assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); results.push({ name, detail }); console.log(`PASS ${name}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => localStorage.setItem('champions-field.quality', 'ultra'));
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5179');
  await page.waitForFunction(() => window.__game && !document.querySelector('#loading'));
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; window.__game.testing = true; });
  await page.waitForTimeout(80);
  const startup = await page.evaluate(() => { const g = window.__game, v = g.view; return { phase: g.phase, goals: g.goalCount, goal: v.effects.explosion.root.visible, demos: v.effects.demolitions.bursts.some(b => b.root.visible), flash: v.effects.explosion.light.intensity + v.effects.demolitions.bursts.reduce((sum, b) => sum + b.light.intensity, 0), canvas: v.composer.renderToScreen, spill: !!v.scene.getObjectByName('octane-engine-spill') }; });
  check('Preloading leaves the actual game ready, without explosions, light flashes or local car light spill', startup.phase === 'ready' && startup.goals === 0 && !startup.goal && !startup.demos && startup.flash === 0 && startup.canvas && !startup.spill, startup);
  const firstUse = await page.evaluate(() => {
    const g = window.__game, v = g.view; g.scenario('drive'); v.update(0, 'playing'); v.draw();
    const gl = v.renderer.getContext(), pixel = new Uint8Array(4), rows = [];
    const record = name => {
      const before = v.renderer.info.programs.length, start = performance.now(); v.draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      let lights = 0; v.scene.traverseVisible(o => { if (o.isPointLight) lights++; });
      rows.push({ name, programsAdded: v.renderer.info.programs.length - before, lights, ms: performance.now() - start });
    };
    record('baseline');
    for (const attempt of [1, 2]) {
      v.effects.goal(v.ball.position, 0x39b7ff);
      for (const dt of [0, .08, .17, .18, .4, 1.5, 2.5]) { v.update(dt, 'goal'); record(`goal ${attempt} at ${v.effects.explosion.age.toFixed(2)}`); }
      v.effects.explosion.reset(); v.update(0, 'playing'); record('goal reset');
      for (const [i, burst] of v.effects.demolitions.bursts.entries()) {
        const model = i === 0 ? v.player : v.bot; model.root.visible = false;
        burst.trigger(model.root.position, model.root.position.clone().set(0, 0, 0), model.root.quaternion, 0xff931f);
        v.effects.demolitions.update(.1); record(`demo ${attempt}, ${i+1} cars hidden`);
      }
      v.effects.demolitions.update(.8); record('smoke/debris'); v.effects.demolitions.reset(); v.update(0, 'playing'); record('demo reset');
    }
    return rows;
  });
  check('First goals, delayed blast phases and simultaneous demolitions create no new shader programs', firstUse.every(r => r.programsAdded === 0) && new Set(firstUse.map(r => r.lights)).size === 1, firstUse);
  await page.evaluate(() => {
    const g = window.__game, v = g.view; g.scenario('drive'); g.physics.resetCar(g.physics.player, 10, 20); g.advance(.25); v.ballCam = false; v.cameraReady = false; v.update(0, 'playing');
    const c = v.player.root.position; v.camera.fov = 32; v.camera.updateProjectionMatrix(); v.camera.position.set(c.x-.85, c.y+.4, c.z+2.8); v.camera.lookAt(c.x, c.y+.04, c.z); v.camera.updateMatrixWorld();
    window.brakePixels = () => { v.draw(); const gl=v.renderer.getContext(), a=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4); gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,a); return a; };
  });
  const brakes = await page.evaluate(() => {
    const g = window.__game, v = g.view, car = g.physics.player, rows = [];
    const lens = v.player.root.getObjectByName('octane-tail-lens').material;
    const poses = [
      ['rest',0,0,false,false,false], ['forward',1,-8,false,false,false], ['brake',-1,-8,false,false,true],
      ['reverse',-1,4,false,false,true], ['forward braking reverse',1,4,false,false,true],
      ['handbrake',1,-8,true,false,true], ['boosting handbrake',1,-8,true,true,true], ['boost overrides reverse',-1,-8,false,true,false],
      ['release',0,-8,false,false,false],
    ];
    let dark, bright;
    for (const [name, throttle, z, drift, boost, expected] of poses) {
      car.throttle = throttle; car.drifting = drift; car.boosting = boost; car.speed = Math.abs(z); car.body.setLinvel({x:0,y:0,z},true);
      v.syncCar(v.player, car, 0, 1); const pixels = window.brakePixels();
      if (name === 'forward') dark = pixels; if (name === 'brake') bright = pixels;
      rows.push({name, expected, lit: lens.emissiveIntensity > 2, intensity: lens.emissiveIntensity});
    }
    let changed = 0; for (let i=0;i<dark.length;i+=4) if(bright[i]-dark[i]>20) changed++;
    return {rows,changed};
  });
  check('Taillights visibly brighten for braking/reversing and dim for forward drive or release', brakes.rows.every(r => r.lit === r.expected) && brakes.changed > 400, brakes);
  for (const active of [false, true]) {
    await page.evaluate(active => { const g=window.__game,v=g.view;g.physics.player.throttle=active?-1:0;g.physics.player.boosting=false;g.physics.player.drifting=false;v.syncCar(v.player,g.physics.player,0,1);v.draw(); }, active);
    await page.screenshot({ path: `${output}/taillights-${active ? 'braking' : 'idle'}.png` });
  }
  const controls = await page.evaluate(() => { const g=window.__game,v=g.view;g.scenario('drive');g.physics.resetCar(g.physics.player,10,20);g.advance(.3);g.advance(.8,{throttle:1});g.advance(.1,{throttle:-1});const lit=v.player.root.getObjectByName('octane-tail-lens').material.emissiveIntensity;g.advance(.1,{throttle:0});return {lit, released:v.player.root.getObjectByName('octane-tail-lens').material.emissiveIntensity}; });
  check('Actual physics throttle input drives the brake lamps', controls.lit > 2 && controls.released < .1, controls);
  check('No browser or shader errors', errors.length === 0, errors);
  await writeFile(`${output}/checks.json`, JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); }
