import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'test-results/boost-outlets';
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
  check('Warmup leaves no exhaust or boost on the ready screen', await page.evaluate(() => {
    const v = window.__game.view; return [...v.boosts, ...v.infernos, ...v.exhausts].every(effect => !effect.root.visible);
  }));
  const cold = await page.evaluate(() => {
    const g = window.__game, v = g.view, car = g.physics.player; g.scenario('drive'); g.physics.resetCar(car, 10, 20); v.update(0, 'playing'); v.draw();
    const gl = v.renderer.getContext(), pixel = new Uint8Array(4), rows = [];
    const record = name => { const before = v.renderer.info.programs.length, start = performance.now(); v.draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); rows.push({ name, programsAdded: v.renderer.info.programs.length - before, ms: performance.now() - start }); };
    car.throttle = 1; v.syncCar(v.player, car, .1, 1); car.throttle = 0; v.syncCar(v.player, car, 1 / 60, 1); record('first exhaust backfire');
    for (const style of ['classic', 'inferno']) { v.setBoostStyle(style); car.boosting = true; v.syncCar(v.player, car, .1, 1); record(`first ${style} boost`); }
    car.boosting = false; v.exhausts[0].reset(); v.setBoostStyle('classic'); return rows;
  });
  check('First exhaust flame and both boost styles reuse preloaded shaders', cold.every(row => row.programsAdded === 0), cold);
  const sockets = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js'), g = window.__game, v = g.view, car = g.physics.player, rows = [];
    for (const rotation of [new T.Quaternion(), new T.Quaternion().setFromEuler(new T.Euler(.35, 1.1, 1.45)), new T.Quaternion().setFromEuler(new T.Euler(0, .5, Math.PI))]) {
      car.body.setRotation(rotation, true); car.boosting = true; v.syncCar(v.player, car, .1, 1); v.scene.updateMatrixWorld(true);
      const cores = [], pipes = []; v.player.root.traverse(o => { if (o.name === 'octane-engine-core') cores.push(o.getWorldPosition(new T.Vector3())); if (o.name === 'octane-exhaust-opening') pipes.push(o.getWorldPosition(new T.Vector3())); });
      const boostOffsets = v.boosts[0].root.children.map(o => Math.min(...cores.map(p => p.distanceTo(o.getWorldPosition(new T.Vector3())))));
      const exhaustOffsets = v.exhausts[0].root.children.map(o => Math.min(...pipes.map(p => p.distanceTo(o.getWorldPosition(new T.Vector3())))));
      const inferno = v.infernos[0]; inferno.reset(); inferno.update(v.player.root.position, rotation, new T.Vector3(), true, 1 / 95, v.camera);
      const smokeOffsets = inferno.particles.map(p => Math.min(...cores.map(core => core.distanceTo(p.position))));
      const expectedUp = new T.Vector3(0, 1, 0).applyQuaternion(rotation), expectedRear = new T.Vector3(0, 0, 1).applyQuaternion(rotation);
      rows.push({ boostOffsets, exhaustOffsets, smokeOffsets, smokeUp: inferno.particles.map(p => p.up.dot(expectedUp)), smokeVelocity: inferno.particles.map(p => p.velocity.dot(expectedRear)) });
    }
    v.setBoostStyle('classic'); car.boosting = false; car.body.setRotation(new T.Quaternion(), true); return rows;
  });
  check('Classic and Inferno emit from the lit pillars through turns and rolls; exhaust uses the separate side pipes', sockets.every(r =>
    r.boostOffsets.length === 4 && r.boostOffsets.every(d => d < .004) && r.exhaustOffsets.length === 2 && r.exhaustOffsets.every(d => d < .003) &&
    r.smokeOffsets.length === 2 && r.smokeOffsets.every(d => d < .007) && r.smokeUp.every(d => d > .999) && r.smokeVelocity.every(d => d > 6)), sockets);
  const driving = await page.evaluate(() => {
    const g = window.__game, v = g.view, effect = v.exhausts[0]; g.scenario('drive'); g.physics.resetCar(g.physics.player, 10, 20); effect.reset();
    const frames = (count, input) => { for (let i = 0; i < count; i++) g.advance(1 / 60, input); };
    frames(20, {}); const idle = effect.root.visible;
    frames(20, { throttle: 1 }); const onGas = effect.root.visible;
    frames(1, {}); const release = effect.root.visible, strength = effect.uniforms.strength.value;
    const frozen = JSON.stringify({ age: effect.age, time: effect.uniforms.time.value, strength: effect.uniforms.strength.value });
    for (let i = 0; i < 20; i++) v.syncCar(v.player, g.physics.player, 0, 1);
    const paused = frozen === JSON.stringify({ age: effect.age, time: effect.uniforms.time.value, strength: effect.uniforms.strength.value });
    frames(15, {}); const expired = !effect.root.visible; frames(40, {}); const coasting = effect.root.visible;
    frames(20, { throttle: -1 }); const reverse = effect.root.visible;
    frames(20, { throttle: 1, boost: true }); frames(1, { boost: true }); const boostRelease = effect.root.visible;
    frames(20, { throttle: 1 }); frames(1, {}); const secondRelease = effect.root.visible;
    g.physics.resetCar(g.physics.player, -20, -20); v.update(0, 'playing'); const teleportClears = !effect.root.visible;
    frames(20, { throttle: 1 }); frames(1, {}); g.physics.player.demolished = 1; v.update(0, 'playing'); const demolitionClears = !effect.root.visible && !v.boosts[0].root.visible && !v.infernos[0].root.visible;
    g.physics.botEnabled = true; g.physics.bot.throttle = 1; v.syncCar(v.bot, g.physics.bot, .1, 1); g.physics.bot.throttle = 0; v.syncCar(v.bot, g.physics.bot, .01, 1); const botRelease = v.exhausts[1].root.visible;
    g.physics.botEnabled = false; v.syncCar(v.bot, g.physics.bot, 0, 1); const disabledBotClears = !v.exhausts[1].root.visible;
    return { idle, onGas, release, strength, paused, expired, coasting, reverse, boostRelease, secondRelease, teleportClears, demolitionClears, botRelease, disabledBotClears };
  });
  check('Actual gas release produces one brief puff, freezes on pause, and clears on reset/demo', !driving.idle && !driving.onGas && driving.release && driving.strength > .5 && driving.paused && driving.expired && !driving.coasting && !driving.reverse && !driving.boostRelease && driving.secondRelease && driving.teleportClears && driving.demolitionClears && driving.botRelease && driving.disabledBotClears, driving);
  const thermal = await page.evaluate(() => {
    const g = window.__game, v = g.view; g.scenario('drive'); g.physics.resetCar(g.physics.player, 10, 20);
    const lighting = v.player.lighting, rim = v.player.root.getObjectByName('octane-exhaust-hot-rim').material;
    lighting.update(0, false, false, 0, false);
    const sample = () => ({ exhaust: rim.emissiveIntensity, towers: lighting.uniforms.engineLoad.value, boost: lighting.uniforms.engineHeat.value });
    const samples = [sample()];
    for (let frame = 1; frame <= 120; frame++) { g.advance(1 / 60, { throttle: 1 }); if ([6, 18, 42, 120].includes(frame)) samples.push(sample()); }
    const hot = sample(); g.advance(1 / 60); const lift = sample();
    for (let i = 0; i < 180; i++) g.advance(1 / 60); const cool = sample();
    const beforePause = JSON.stringify(sample()); v.syncCar(v.player, g.physics.player, 0, 1); const paused = JSON.stringify(sample()) === beforePause;
    for (let i = 0; i < 45; i++) g.advance(1 / 60, { boost: true }); const boost = sample();
    const paintColors = []; for (const paint of ['classic', 'ultraviolet', 'glacier']) { v.setPaintJob(paint); paintColors.push({ pipe: rim.emissive.getHexString(), tower: lighting.color.getHexString() }); }
    const rates = [];
    for (const hz of [30, 60, 144]) { lighting.update(0, false, false, 0, false); for (let i = 0; i < hz; i++) lighting.update(1 / hz, false, false, 1); rates.push(sample()); }
    v.setPaintJob('ultraviolet'); return { samples, hot, lift, cool, boost, paused, paintColors, rates };
  });
  check('Acceleration gradually heats the red exhaust rims and paint-colored towers, with lingering heat after lift-off', thermal.samples[0].exhaust === 0 && thermal.samples[0].towers === 0 && thermal.samples.every((s, i, a) => !i || s.exhaust > a[i-1].exhaust && s.towers > a[i-1].towers) && thermal.hot.exhaust > 3 && thermal.hot.towers > .95 && thermal.lift.exhaust > thermal.hot.exhaust * .95 && thermal.cool.exhaust < .05 && thermal.cool.towers < .03 && thermal.boost.boost > .98 && thermal.paused, thermal);
  check('Exhaust stays red across paint changes and heat buildup is consistent at 30/60/144 Hz', new Set(thermal.paintColors.map(c => c.pipe)).size === 1 && new Set(thermal.paintColors.map(c => c.tower)).size === 3 && thermal.rates.every(s => Math.abs(s.exhaust - thermal.rates[0].exhaust) < 1e-10 && Math.abs(s.towers - thermal.rates[0].towers) < 1e-10), thermal);
  await page.evaluate(() => {
    const g = window.__game, v = g.view; g.scenario('drive'); g.physics.resetCar(g.physics.player, 10, 20); for (let i = 0; i < 20; i++) g.advance(1 / 60); v.exhausts.forEach(e => e.reset()); v.setBoostStyle('classic'); v.update(0, 'playing');
    v.player.lighting.update(0, false, false, 0, false);
    const c = v.player.root.position; v.camera.position.set(c.x - 1.3, c.y + .4, c.z + 3.2); v.camera.fov = 30; v.camera.updateProjectionMatrix(); v.camera.lookAt(c.x, c.y, c.z + .4); v.camera.updateMatrixWorld(); v.stadium.grass.update(v.camera.position, c, v.time); g.positionLabels();
    window.capturePixels = () => { v.draw(); const gl = v.renderer.getContext(), pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels); return pixels; };
    window.idlePixels = window.capturePixels();
  });
  await page.screenshot({ path: `${output}/idle.png` });
  const heatPixels = await page.evaluate(() => {
    const v = window.__game.view; v.player.lighting.update(2, false, false, 1);
    const hot = window.capturePixels(), idle = window.idlePixels; let red = 0, violet = 0;
    for (let i = 0; i < hot.length; i += 4) { if (hot[i] - idle[i] > 30 && hot[i] > hot[i + 1] * 1.5 && hot[i] > hot[i + 2] * 1.5) red++; if (hot[i + 2] - idle[i + 2] > 30 && hot[i + 2] > hot[i + 1] * 1.2) violet++; }
    return { red, violet };
  });
  check('Acceleration visibly heats both exhausts red and brightens the colored towers', heatPixels.red > 100 && heatPixels.violet > 500, heatPixels);
  await page.screenshot({ path: `${output}/hot-exhaust.png` });
  await page.evaluate(() => { window.__game.view.player.lighting.update(0, false, false, 0, false); window.idlePixels = window.capturePixels(); });
  const visible = await page.evaluate(() => {
    const g = window.__game, v = g.view, car = g.physics.player; car.throttle = 1; v.syncCar(v.player, car, .1, 1); car.throttle = 0; v.syncCar(v.player, car, 1 / 60, 1);
    const flame = window.capturePixels(), idle = window.idlePixels; let lit = 0;
    for (let i = 0; i < flame.length; i += 4) if (flame[i] - idle[i] > 30 && flame[i] > flame[i + 2] * 1.2) lit++;
    return { lit };
  });
  check('The small exhaust flames are visibly rendered', visible.lit > 100, visible);
  await page.screenshot({ path: `${output}/backfire.png` });
  for (const style of ['classic', 'inferno']) {
    await page.evaluate(style => { const g = window.__game, v = g.view; v.exhausts[0].reset(); v.setBoostStyle(style); g.physics.player.boosting = true; for (let i = 0; i < 10; i++) v.syncCar(v.player, g.physics.player, 1 / 60, 1); v.draw(); }, style);
    await page.screenshot({ path: `${output}/${style}.png` });
  }
  check('No browser or shader errors', errors.length === 0, errors);
  await writeFile(`${output}/checks.json`, JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); }
