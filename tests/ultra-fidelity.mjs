import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'test-results/ultra-fidelity';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const results = [], errors = [];
const check = (name, pass, detail) => { assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); results.push({ name, detail }); console.log(`PASS ${name}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5179');
  await page.waitForFunction(() => window.__game && !document.querySelector('#loading'));
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; window.__game.testing = true; });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const g = window.__game, v = g.view;
    g.scenario('drive'); g.physics.resetCar(g.physics.player, 10, 20); g.advance(.25);
    v.setQuality('ultra'); v.ballCam = false; v.cameraReady = false; v.update(0, 'playing'); g.hud.camera(false); g.positionLabels();
    window.captureGrass = time => {
      v.stadium.grass.update(v.camera.position, v.player.root.position, time); v.draw();
      const gl = v.renderer.getContext(), pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels); return pixels;
    };
    window.pixelDifference = (a, b) => { let changed = 0; for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i+1] - b[i+1]), Math.abs(a[i+2] - b[i+2])) > 5) changed++; return changed; };
  });
  const wind = await page.evaluate(() => {
    const v = window.__game.view, grass = v.stadium.grass, version = grass.mesh.instanceMatrix.version;
    window.captureGrass(0);
    const a = window.captureGrass(0), still = window.captureGrass(0), b = window.captureGrass(.8), c = window.captureGrass(1.6);
    let bright = 0; for (let i = 0; i < a.length; i += 4) if (a[i] + a[i+1] + a[i+2] > 140) bright++;
    return { first: window.pixelDifference(a, b), second: window.pixelDifference(b, c), paused: window.pixelDifference(a, still), stableInstances: grass.mesh.instanceMatrix.version === version, bright, count: grass.mesh.count };
  });
  check('Ultra renders a full field and wind visibly changes the driving view without moving the roots', wind.bright > 100000 && wind.first > 5000 && wind.second > 5000 && wind.paused === 0 && wind.stableInstances && wind.count === 1000000, wind);
  await page.screenshot({ path: `${output}/driving.png` });
  const occlusion = await page.evaluate(() => {
    const v = window.__game.view, withAO = window.captureGrass(1.6); v.occlusion.enabled = false; const without = window.captureGrass(1.6); v.occlusion.enabled = true;
    return { changed: window.pixelDifference(withAO, without), composedDepth: v.occlusion.depthTexture === v.composer.renderTarget1.depthTexture || v.occlusion.depthTexture === v.composer.renderTarget2.depthTexture, triangles: v.renderer.info.render.triangles };
  });
  check('Contact shading uses the rendered depth and changes visible pixels', occlusion.changed > 1000 && occlusion.composedDepth, occlusion);
  await page.evaluate(() => {
    const v = window.__game.view, c = v.player.root.position;
    v.camera.fov = 32; v.camera.updateProjectionMatrix(); v.camera.position.set(c.x-.85, c.y+.4, c.z+2.8); v.camera.lookAt(c.x, c.y+.04, c.z); v.camera.updateMatrixWorld();
  });
  const colors = [];
  for (const paint of ['classic', 'rally', 'ultraviolet', 'crimson', 'midnight', 'glacier']) {
    const color = await page.evaluate(paint => {
      const v = window.__game.view; v.setPaintJob(paint); const lit = window.captureGrass(2);
      const cores = []; v.player.root.traverse(o => { if (o.name === 'octane-engine-core') { cores.push(o); o.visible = false; } });
      const unlit = window.captureGrass(2); cores.forEach(o => o.visible = true); v.draw();
      return { paint, color: v.player.lighting.color.getHexString(), cores: cores.length, visible: window.pixelDifference(lit, unlit), opponent: v.bot.lighting.color.getHexString() };
    }, paint);
    colors.push(color);
    if (['classic', 'rally', 'ultraviolet'].includes(paint)) await page.screenshot({ path: `${output}/rear-${paint}.png` });
  }
  check('Both recessed cores visibly glow in all six paint colors without changing the opponent', new Set(colors.map(c => c.color)).size === 6 && colors.every(c => c.cores === 2 && c.visible > 500 && c.opponent === 'ff6b12'), colors);
  const heat = await page.evaluate(() => {
    const v = window.__game.view, lighting = v.player.lighting;
    v.setPaintJob('ultraviolet'); const before = window.captureGrass(2); lighting.update(.7, true); const boosted = window.captureGrass(2), hot = lighting.uniforms.engineHeat.value;
    lighting.update(0, true); const paused = window.pixelDifference(boosted, window.captureGrass(2)); lighting.update(2, false);
    return { changed: window.pixelDifference(before, boosted), paused, hot, cooled: lighting.uniforms.engineHeat.value };
  });
  check('Engine cores pulse, brighten with boost, freeze on pause and cool after release', heat.changed > 500 && heat.paused === 0 && heat.hot > .98 && heat.cooled < .001, heat);
  const tiers = await page.evaluate(() => {
    const v = window.__game.view, rows = [];
    for (const quality of ['performance', 'high', 'ultra', 'performance', 'ultra']) {
      v.setQuality(quality); v.update(0, 'playing'); v.draw();
      const gl = v.renderer.getContext(); rows.push({ quality, grass: v.stadium.grass.mesh.visible, ao: v.occlusion.enabled, antialias: v.antialias.enabled, spill: !!v.scene.getObjectByName('octane-engine-spill'), gl: gl.getError() });
    }
    return rows;
  });
  check('Quality switching gates the expensive effects and keeps the local car spill light removed', tiers.every(r => [r.grass, r.ao, r.antialias].every(enabled => enabled === (r.quality === 'ultra')) && !r.spill && r.gl === 0), tiers);
  await page.setViewportSize({ width: 900, height: 600 });
  const resized = await page.evaluate(() => { const v = window.__game.view; v.draw(); return { width: v.occlusion.width, height: v.occlusion.height, canvasWidth: v.renderer.domElement.width, canvasHeight: v.renderer.domElement.height }; });
  check('The depth and edge effects follow viewport resizing', resized.width === resized.canvasWidth && resized.height === resized.canvasHeight, resized);
  check('No browser or shader errors', errors.length === 0, errors);
  await writeFile(`${output}/checks.json`, JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); }
