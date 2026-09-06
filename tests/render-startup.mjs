import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'test-results/render-startup';
await mkdir(output, { recursive: true });
// SwiftShader does not reproduce the NVIDIA derivative/discard failure.
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || (process.platform === 'linux' ? '/usr/bin/chromium' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  args: process.platform === 'linux' ? ['--use-angle=gl', '--ignore-gpu-blocklist'] : [],
});
const errors = [], results = [];
const check = (name, pass, detail) => { assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); results.push({ name, detail }); console.log(`PASS ${name}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1205, height: 1278 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5179');
  await page.waitForFunction(() => window.__game && !document.querySelector('#loading'), null, { timeout: 120000 });
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; window.__game.testing = true; });
  for (const size of [{ width: 1205, height: 1278 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(size);
    for (const quality of ['performance', 'high', 'ultra']) {
      const frames = await page.evaluate(async quality => {
        const T = await import('/node_modules/.vite/deps/three.js'), g = window.__game, v = g.view, gl = v.renderer.getContext();
        v.setQuality(quality); g.physics.reset(); v.ballCam = true;
        const raw = new T.WebGLRenderTarget(gl.drawingBufferWidth, gl.drawingBufferHeight, { type: T.HalfFloatType });
        const invalid = target => {
          const data = new Uint16Array(target.width * target.height * 4);
          v.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, data);
          return data.reduce((count, bits) => count + Number((bits & 0x7fff) >= 0x7c00), 0);
        };
        const rows = [];
        // Cross different derivative quads at ground level and during high-ball tracking.
        for (const ball of [[0, .92, 0], [.17, 1.12, 1.8], [-.29, 1.4, 2.5], [1, 19, 29]]) {
          g.physics.ball.setTranslation({ x: ball[0], y: ball[1], z: ball[2] }, true);
          v.cameraReady = false; v.update(0, 'ready'); v.draw();
          const pixels = new Uint8Array(128 * 128 * 4);
          gl.readPixels(300, 300, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          const screenColors = new Set(pixels).size;
          const bloomInvalid = v.bloom.enabled ? [v.bloom.renderTargetBright, ...v.bloom.renderTargetsHorizontal, ...v.bloom.renderTargetsVertical].reduce((n, target) => n + invalid(target), 0) : 0;
          v.renderer.setRenderTarget(raw); v.renderer.render(v.scene, v.camera); v.renderer.setRenderTarget(null);
          rows.push({ ball, screenColors, sourceInvalid: invalid(raw), bloomInvalid, glError: gl.getError(), contextLost: gl.isContextLost() });
        }
        raw.dispose(); return rows;
      }, quality);
      check(`${quality} at ${size.width}×${size.height}: source HDR and bloom remain finite and the scene renders`, frames.every(f => f.screenColors > 30 && !f.sourceInvalid && !f.bloomInvalid && !f.glError && !f.contextLost), frames);
    }
  }
  const containment = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js'), { createBloomPass } = await import('/src/bloom-pass.ts');
    const renderer = window.__game.view.renderer, values = new Float32Array(16 * 16 * 4).fill(.02);
    for (let i = 3; i < values.length; i += 4) values[i] = 1;
    values[0] = NaN; values[4] = Infinity; values[8] = -Infinity;
    values.set([20, 12, 4, 1], (8 * 16 + 8) * 4);
    const texture = new T.DataTexture(values, 16, 16, T.RGBAFormat, T.FloatType); texture.needsUpdate = true;
    const material = new T.ShaderMaterial({ uniforms: { sourceTexture: { value: texture } }, vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.);}', fragmentShader: 'varying vec2 vUv;uniform sampler2D sourceTexture;void main(){gl_FragColor=texture2D(sourceTexture,vUv);}' });
    const mesh = new T.Mesh(new T.PlaneGeometry(2, 2), material), scene = new T.Scene(); scene.add(mesh);
    const input = new T.WebGLRenderTarget(16, 16, { type: T.HalfFloatType }), unused = input.clone();
    const bloom = createBloomPass(new T.Vector2(16, 16));
    const stats = target => { const data = new Uint16Array(target.width * target.height * 4); renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, data); return { invalid: data.filter(n => (n & 0x7fff) >= 0x7c00).length, light: data.some((n, i) => i % 4 !== 3 && (n & 0x7fff) > 0 && (n & 0x7fff) < 0x7c00) }; };
    renderer.setRenderTarget(input); renderer.render(scene, new T.Camera()); renderer.setRenderTarget(null);
    const source = stats(input); bloom.render(renderer, unused, input, 0, false); renderer.setRenderTarget(null);
    const filtered = [bloom.renderTargetBright, ...bloom.renderTargetsHorizontal, ...bloom.renderTargetsVertical].map(stats);
    bloom.dispose(); input.dispose(); unused.dispose(); texture.dispose(); mesh.geometry.dispose(); material.dispose();
    return { source, filtered };
  });
  check('Bloom contains NaN and infinite inputs while retaining valid bright light', containment.source.invalid > 0 && containment.filtered.every(s => s.invalid === 0) && containment.filtered.some(s => s.light), containment);
  check('No browser or shader errors', errors.length === 0, errors);
  await writeFile(`${output}/checks.json`, JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); }
