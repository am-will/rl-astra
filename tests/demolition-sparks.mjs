import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'test-results/demolition-sparks';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || (process.platform === 'linux' ? '/usr/bin/chromium' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5179');
  await page.waitForFunction(() => window.__game && !document.querySelector('#loading'));
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; window.__game.testing = true; });
  const pixels = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const v = window.__game.view, burst = v.effects.demolitions.bursts[0];
    const source = burst.root.children.find(o => o.geometry?.getAttribute('velocity'));
    // Render the production spark shader in isolation, including its world transform.
    const geometry = source.geometry.clone(); geometry.instanceCount = 1;
    geometry.setAttribute('velocity', new T.InstancedBufferAttribute(new Float32Array([3, 1, 0]), 3));
    geometry.setAttribute('seed', new T.InstancedBufferAttribute(new Float32Array([0, 2.45, .026]), 3));
    const spark = new T.Mesh(geometry, source.material); spark.frustumCulled = false;
    const scene = new T.Scene(); scene.background = new T.Color(0); scene.add(spark);
    const camera = new T.OrthographicCamera(-3, 3, 4, -2, .1, 30);
    camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0);
    const target = new T.WebGLRenderTarget(512, 512);
    const sample = (height, time) => {
      spark.position.y = height; burst.uniforms.time.value = time; burst.uniforms.drift.value.set(0, 0, 0);
      v.renderer.setRenderTarget(target); v.renderer.render(scene, camera);
      const data = new Uint8Array(512 * 512 * 4); v.renderer.readRenderTargetPixels(target, 0, 0, 512, 512, data);
      let lit = 0, energy = 0;
      for (let i = 0; i < data.length; i += 4) { if (data[i] > 2) lit++; energy += data[i]; }
      return { lit, energy };
    };
    const rows = { airborne: sample(.35, .15), approaching: sample(.35, .5), grounded: sample(.35, .8), late: sample(.35, 1.5), elevated: sample(3, .8), elevatedLanded: sample(3, 1.3), expired: sample(3, 2.6) };
    v.renderer.setRenderTarget(null); target.dispose(); geometry.dispose();
    return rows;
  });
  await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js'), g = window.__game, v = g.view;
    g.scenario('drive'); v.setQuality('ultra'); g.physics.resetCar(g.physics.player, -3, 8);
    g.physics.ball.setTranslation({ x: 0, y: 1, z: -12 }, true); v.update(0, 'playing');
    v.camera.position.set(4, 2.5, 12); v.camera.lookAt(0, 1, 0); v.camera.updateMatrixWorld();
    v.effects.demolitions.trigger(new T.Vector3(0, .35, 0), new T.Vector3(8, 0, 0), new T.Quaternion(), 0xff942e);
  });
  let previous = 0;
  for (const time of [.15, .7, 1.4, 2.4, 3.2]) {
    await page.evaluate(dt => { const v = window.__game.view; for (let i = 0; i < 120; i++) v.effects.demolitions.update(dt / 120); v.draw(); }, time - previous);
    previous = time;
    await page.screenshot({ path: `${output}/${process.env.CAPTURE_LABEL || 'fixed'}-${time}.png` });
  }
  const reset = await page.evaluate(() => {
    const fx = window.__game.view.effects.demolitions, b = fx.bursts[0];
    const expired = !b.root.visible && b.light.intensity === 0;
    b.trigger(b.root.position.clone(), b.uniforms.drift.value.clone(), b.root.quaternion, 0xff942e);
    const reused = b.root.visible && b.uniforms.time.value === 0;
    fx.reset(); return expired && reused && fx.bursts.every(b => !b.root.visible && b.light.intensity === 0);
  });
  await writeFile(`${output}/checks.json`, JSON.stringify({ pixels, reset, errors }, null, 2));
  assert.ok(pixels.airborne.lit > 5, 'Opening sparks must remain visible');
  assert.ok(pixels.approaching.energy < pixels.airborne.energy, 'Sparks must dim as they approach the turf');
  assert.equal(pixels.grounded.lit + pixels.late.lit, 0, 'Landed sparks must not leave glowing ground needles');
  assert.ok(pixels.elevated.lit > 5, 'Airborne demolitions must retain sparks above the world floor');
  assert.equal(pixels.elevatedLanded.lit + pixels.expired.lit, 0, 'Elevated sparks must extinguish on landing or expiry');
  assert.ok(reset, 'Burst expiry, reuse and reset must clear the effect');
  assert.deepEqual(errors, [], 'No browser or shader errors');
  console.log('PASS demolition sparks: airborne visibility, ground fade, elevated impacts, expiry and reuse');
} finally { await browser.close(); }
