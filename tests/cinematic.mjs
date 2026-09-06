import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'test-results/cinematic';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/chromium' });
const errors = [], results = [];
const check = (name, pass, detail) => { assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); results.push({ name, detail }); console.log(`PASS ${name}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5179');
  const ready = () => page.waitForFunction(() => window.__game && !document.querySelector('#loading'), null, { timeout: 120000 });
  await ready();
  check('Fresh sessions enable cinematic High quality', await page.evaluate(() => window.__game.view.qualityLevel === 'high' && window.__game.view.motion.enabled), {});
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; window.__game.testing = true; });
  await page.waitForTimeout(100);
  const movement = await page.evaluate(() => {
    const g = window.__game, v = g.view;
    g.scenario('drive'); g.physics.resetCar(g.physics.player, 10, 20); g.advance(.25);
    v.setQuality('high'); v.ballCam = false; v.cameraReady = false; v.update(0, 'playing'); v.draw();
    window.pixels = () => {
      v.draw(); const gl = v.renderer.getContext(), p = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, p); return p;
    };
    window.difference = (a, b) => { let changed = 0; for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i+1] - b[i+1]), Math.abs(a[i+2] - b[i+2])) > 4) changed++; return changed; };
    // Real simulation and rendered-frame history build speed before comparing one frame.
    for (let i = 0; i < 75; i++) { g.advance(1/60, { throttle: 1, boost: true }); v.draw(); }
    g.advance(1/60, { throttle: 1, boost: true });
    const blurred = window.pixels(), shutter = v.motion.uniforms.shutter.value;
    v.motion.enabled = false; const sharp = window.pixels(); v.motion.enabled = true;
    const width = v.renderer.domElement.width, height = v.renderer.domElement.height;
    const subjectError = subject => {
      const uv = subject.position.clone().project(v.camera), cx = Math.round((uv.x*.5+.5)*width), cy = Math.round((uv.y*.5+.5)*height);
      let sum = 0, count = 0;
      for (let y = cy-4; y <= cy+4; y++) for (let x = cx-4; x <= cx+4; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const p = (y*width+x)*4; for (let c = 0; c < 3; c++) sum += Math.abs(blurred[p+c]-sharp[p+c]); count += 3;
      }
      return count ? sum/count : null;
    };
    return { changed: window.difference(blurred, sharp), carError: subjectError(v.player.root), ballError: subjectError(v.ball), shutter, speed: g.physics.player.speed };
  });
  check('Driving produces visible background blur while car and ball centers stay sharp', movement.changed > 2000 && movement.shutter > 0 && movement.carError < 1 && movement.ballError < 1, movement);
  const resets = await page.evaluate(() => {
    const g = window.__game, v = g.view;
    v.update(0, 'playing'); const paused = window.pixels(), still = window.pixels();
    const pauseShutter = v.motion.uniforms.shutter.value;
    v.cameraReady = false; v.ballCam = true; v.update(1/60, 'playing'); window.pixels(); const cut = v.motion.uniforms.shutter.value;
    v.paintPreview = true; v.update(1/60, 'playing'); window.pixels(); const preview = v.motion.uniforms.shutter.value; v.paintPreview = false;
    v.camera.position.x += 20; v.camera.updateMatrixWorld(); window.pixels(); const teleport = v.motion.uniforms.shutter.value;
    return { pausedDifference: window.difference(paused, still), pauseShutter, cut, preview, teleport };
  });
  check('Pause, camera changes, paint previews and teleports clear motion history', Object.values(resets).every(value => value === 0), resets);
  const tiers = await page.evaluate(() => {
    const v = window.__game.view;
    return ['performance', 'ultra', 'high'].map(quality => {
      v.setQuality(quality); v.update(0, 'playing'); window.pixels();
      return { quality, motion: v.motion.enabled, depth: v.motion.depthPass.enabled, error: v.renderer.getContext().getError() };
    });
  });
  check('Quality switching gates both motion passes without graphics errors', tiers.every(r => r.motion === (r.quality !== 'performance') && r.depth === r.motion && r.error === 0), tiers);
  await page.setViewportSize({ width: 900, height: 600 });
  await page.waitForFunction(() => window.__game.view.renderer.domElement.width === 900 && window.__game.view.renderer.domElement.height === 600);
  const resize = await page.evaluate(() => { const v = window.__game.view; v.update(0, 'playing'); window.pixels(); return { depth: [v.motion.depthPass.target.width, v.motion.depthPass.target.height], color: [v.renderer.domElement.width, v.renderer.domElement.height], resolution: v.motion.uniforms.resolution.value.toArray() }; });
  check('Captured depth and blur resolution follow the viewport', JSON.stringify(resize.depth) === JSON.stringify(resize.color) && JSON.stringify(resize.resolution) === JSON.stringify(resize.color), resize);
  await page.evaluate(() => window.__game.action('visuals'));
  await page.locator('#motion-blur').selectOption('off');
  const off = await page.evaluate(() => { const v = window.__game.view; return !v.motion.enabled && !v.motion.depthPass.enabled && localStorage.getItem('champions-field.motion-blur') === 'off'; });
  check('The visible setting disables blur and saves the choice', off, {});
  await page.reload(); await ready();
  check('Motion preference survives reload', await page.evaluate(() => !window.__game.view.motionBlur && !window.__game.view.motion.enabled), {});
  check('No browser or shader errors', errors.length === 0, errors);
  await writeFile(`${output}/checks.json`, JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); }
