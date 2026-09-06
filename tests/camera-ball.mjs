import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'test-results/camera-ball';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || (process.platform === 'linux' ? '/usr/bin/chromium' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  args: process.platform === 'linux' ? ['--use-angle=gl', '--ignore-gpu-blocklist'] : [],
});
const errors = [], results = [];
const check = (name, pass, detail) => {
  assert.ok(pass, `${name}: ${JSON.stringify(detail)}`);
  results.push({ name, detail }); console.log(`PASS ${name}`);
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem('champions-field.quality', 'performance'));
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5179');
  await page.waitForFunction(() => window.__game && !document.querySelector('#loading'), null, { timeout: 120000 });
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; window.__game.testing = true; });
  const sweep = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { FollowCamera } = await import('/src/follow-camera.ts');
    const g = window.__game, rows = [];
    for (const hz of [30, 60, 144]) for (const aspect of [1.6, 390 / 844]) for (const x of [-1, 1]) for (const z of [-1, 1]) {
      const rig = new FollowCamera(), camera = new T.PerspectiveCamera(69, aspect, .15, 550);
      const car = new T.Vector3(x * 32, .335, z * 41), q = new T.Quaternion(), ball = new T.Vector3();
      let hiddenBall = 0, hiddenCar = 0, below = 0, maxStep = 0;
      for (let frame = 0; frame < hz * 4; frame++) {
        const t = frame / hz, before = camera.position.clone();
        ball.set(x * (32 + 2 * Math.sin(t * 1.4)), 1 + 18 * Math.sin(t * Math.PI / 4) ** 2, z * (41 + 2 * Math.cos(t * 1.4)));
        rig.update(camera, car, q, ball, 0, true, false, 1 / hz, frame === 0, (a, b) => g.physics.cameraClearance(a, b));
        camera.updateMatrixWorld();
        const visible = subject => { const p = subject.clone().project(camera); return Math.abs(p.x) < .95 && Math.abs(p.y) < .95 && p.z > -1 && p.z < 1; };
        if (!visible(ball)) hiddenBall++;
        if (!visible(car)) hiddenCar++;
        if (camera.position.y < .7) below++;
        if (frame) maxStep = Math.max(maxStep, before.distanceTo(camera.position));
      }
      rows.push({ hz, aspect, x, z, hiddenBall, hiddenCar, below, maxStep });
    }
    return rows;
  });
  check('High shots in every corner retain the ball at 30, 60 and 144 Hz, including portrait', sweep.every(r => !r.hiddenBall), sweep);
  check('The camera stays above the floor and allows the grounded car to leave view without a camera snap', sweep.every(r => !r.below && r.hiddenCar > 0 && r.maxStep < .75), sweep);

  for (const quality of ['performance', 'high', 'ultra']) {
    for (const aerial of [false, true]) {
      const framing = await page.evaluate(({ quality, aerial }) => {
        const g = window.__game, v = g.view; g.scenario('drive'); v.setQuality(quality);
        g.physics.resetCar(g.physics.player, 32, 41);
        g.physics.player.body.setTranslation({ x: 32, y: aerial ? 12 : .335, z: 41 }, true);
        g.physics.ball.setTranslation({ x: 33, y: aerial ? 14 : 19, z: 42 }, true);
        v.ballCam = true; v.cameraReady = false; v.update(0, 'playing'); g.hud.camera(true); g.positionLabels(); v.draw();
        const gl = v.renderer.getContext(), data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
        const visible = subject => { const p = subject.clone().project(v.camera); return Math.abs(p.x) < .95 && Math.abs(p.y) < .95 && p.z > -1 && p.z < 1; };
        return { camera: v.camera.position.toArray(), ball: visible(v.ball.position), car: visible(v.player.root.position), colors: new Set(data).size, error: gl.getError(), contextLost: gl.isContextLost() };
      }, { quality, aerial });
      check(`${quality}: ${aerial ? 'aerial approach includes the car' : 'grounded corner prioritizes the ball'} with a rendered scene`, framing.camera[1] >= .7 && framing.ball && (aerial ? framing.car : !framing.car) && framing.colors > 100 && !framing.error && !framing.contextLost, framing);
      await page.screenshot({ path: `${output}/${quality}-${aerial ? 'aerial' : 'corner'}.png` });
    }
  }

  // Render the real field alone against a magenta background. Every sampled
  // ray lands well inside its floor: any magenta patch is a hole in the turf.
  const floor = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js'), g = window.__game, v = g.view;
    const scene = new T.Scene(); scene.background = new T.Color(0xff00ff);
    scene.add(new T.HemisphereLight(0xffffff, 0xffffff, 3));
    const field = v.scene.getObjectByName('textured-playing-field');
    const mesh = new T.Mesh(field.geometry, field.material); mesh.rotation.copy(field.rotation); scene.add(mesh);
    const rows = [];
    for (const height of [.335, .8, 2]) {
      g.physics.resetCar(g.physics.player, 0, 0); g.physics.player.body.setTranslation({ x: 0, y: height, z: 0 }, true);
      g.physics.ball.setTranslation({ x: 0, y: .92, z: -2 }, true); v.cameraReady = false; v.update(0, 'playing');
      v.renderer.render(scene, v.camera);
      const gl = v.renderer.getContext(), pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let holes = 0, samples = 0;
      for (let y = 20; y < gl.drawingBufferHeight * .4; y += 2) for (let x = gl.drawingBufferWidth * .3 | 0; x < gl.drawingBufferWidth * .7; x += 2) {
        const i = (y * gl.drawingBufferWidth + x) * 4;
        holes += pixels[i] > 150 && pixels[i + 1] < 60 && pixels[i + 2] > 150 ? 1 : 0; samples++;
      }
      rows.push({ height, holes, samples });
    }
    return rows;
  });
  check('Turf stays solid underneath and ahead of the car before and during a jump', floor.every(r => r.samples > 1000 && !r.holes), floor);
  check('No browser or shader errors', errors.length === 0, errors);
  await writeFile(`${output}/checks.json`, JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); }
