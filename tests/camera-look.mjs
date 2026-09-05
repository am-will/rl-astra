import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('test-results/camera-look', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const results = [], errors = [];
const check = (name, pass, detail = {}) => { assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); results.push({ name, detail }); console.log(`PASS ${name}`); };
try {
  const p = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  p.on('pageerror', e => errors.push(e.message)); p.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await p.addInitScript(() => {
    window.testPad = { index: 0, id: 'DualSense Wireless Controller', mapping: 'standard', connected: true, timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, touched: false, value: 0 })) };
    window.testPads = [window.testPad]; Object.defineProperty(navigator, 'getGamepads', { value: () => window.testPads });
  });
  await p.goto('http://127.0.0.1:5179'); await p.waitForFunction(() => window.__game && !document.querySelector('#loading'));
  await p.waitForFunction(() => !window.__game.controls.padBlocked);
  await p.evaluate(() => window.testPad.axes[2] = .08);
  check('Right-stick drift is ignored without starting the match', await p.evaluate(() => window.__game.controls.cameraLook() === 0 && window.__game.phase === 'ready'));
  await p.evaluate(() => window.testPad.axes[2] = .56);
  check('Right-stick travel remains analog and does not steer the car', await p.evaluate(() => { const c = window.__game.controls, input = c.read(); return Math.abs(c.cameraLook() - .5) < .001 && input.steer === 0 && input.yaw === 0 && input.throttle === 0; }));
  await p.evaluate(() => { const g = window.__game; window.testPad.axes[2] = 0; g.scenario('drive'); g.physics.resetCar(g.physics.player, 0, 12); g.testing = false; g.view.ballCam = true; g.view.cameraReady = false; });
  const baseline = await p.evaluate(() => ({ position: window.__game.physics.player.body.translation(), settings: JSON.stringify(window.__game.view.followCamera.settings) }));
  for (const side of [-1, 1]) {
    await p.evaluate(side => window.testPad.axes[2] = side, side);
    await p.waitForFunction(() => { const v = window.__game.view, car = v.player.root.position, front = car.clone().set(0, 0, -1).applyQuaternion(v.player.root.quaternion), offset = v.camera.position.clone().sub(car).setY(0).normalize(); return offset.dot(front) > .999; }, { timeout: 5000 });
    const live = await p.evaluate(() => { const g = window.__game, v = g.view, dir = v.camera.getWorldDirection(v.look.clone()); return { look: v.cameraLook, camera: v.camera.position.toArray(), car: v.player.root.position.toArray(), direction: dir.toArray(), projected: v.player.root.position.clone().project(v.camera).toArray(), ballCam: v.ballCam, settings: JSON.stringify(v.followCamera.settings) }; });
    check(`Holding ${side < 0 ? 'left' : 'right'} reaches the front of the car and looks backward in the live loop`, live.camera[2] < live.car[2] - 4 && live.direction[2] > .96 && Math.abs(live.projected[0]) < .1 && Math.abs(live.projected[1]) < .8 && live.ballCam && live.settings === baseline.settings, live);
    await p.screenshot({ path: `test-results/camera-look/live-${side < 0 ? 'left' : 'right'}.png` });
    await p.evaluate(() => window.testPad.axes[2] = 0);
    await p.waitForFunction(() => { const v = window.__game.view; return v.camera.position.z > v.player.root.position.z + 4 && v.camera.getWorldDirection(v.look.clone()).z < -.96; });
    check('Releasing the right stick returns to the selected ball camera', await p.evaluate(() => window.__game.view.ballCam && window.__game.view.cameraLook === 0));
  }
  await p.evaluate(() => { window.testPad.axes[2] = 1; window.__game.action('pause'); });
  check('Paused menus suppress held camera input', await p.evaluate(() => window.__game.controls.cameraLook() === 0));
  await p.evaluate(() => window.__game.action('resume'));
  check('A stick held across pause stays blocked until released', await p.evaluate(() => window.__game.controls.cameraLook() === 0));
  await p.evaluate(() => window.testPad.axes[2] = 0); await p.waitForFunction(() => !window.__game.controls.padBlocked);
  await p.evaluate(() => window.__game.action('bindings')); await p.locator('[data-category="match"]').click();
  check('Both look directions are available for rebinding in controls', await p.locator('[data-bind="lookLeft"][data-device="gamepad"]').count() > 0 && await p.locator('[data-bind="lookRight"][data-device="gamepad"]').count() > 0);
  await p.locator('[data-bind="lookRight"][data-device="gamepad"][data-slot="0"]').click(); await p.waitForTimeout(260);
  await p.evaluate(() => { window.testPad.buttons[11].value = 1; window.testPad.buttons[11].pressed = true; });
  await p.waitForFunction(() => window.__game.controls.settings.gamepad.lookRight[0].type === 'button');
  await p.evaluate(() => { window.testPad.buttons[11].value = 0; window.testPad.buttons[11].pressed = false; });
  await p.locator('.bindings-close').click(); await p.keyboard.press('Escape'); await p.waitForFunction(() => !window.__game.controls.padBlocked);
  await p.evaluate(() => window.testPad.buttons[11].value = 1);
  check('Rebound camera hold uses the chosen button', await p.evaluate(() => window.__game.controls.cameraLook() === 1));
  await p.reload(); await p.waitForFunction(() => window.__game && !document.querySelector('#loading'));
  check('Custom look bindings survive reload', await p.evaluate(() => window.__game.controls.settings.gamepad.lookRight[0].index === 11));
  await p.evaluate(() => { window.__game.controls.reset('gamepad'); window.testPad.axes[2] = 0; });
  await p.waitForFunction(() => !window.__game.controls.padBlocked);
  await p.evaluate(() => window.testPads = []); await p.waitForFunction(() => window.__game.controls.pad === null);
  check('Disconnect clears camera input and pauses', await p.evaluate(() => window.__game.controls.cameraLook() === 0 && window.__game.paused));
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; }); await p.waitForTimeout(80);
  const traces = await p.evaluate(async () => {
    const { FollowCamera } = await import('/src/follow-camera.ts'), { PerspectiveCamera, Vector3, Quaternion } = await import('/node_modules/.vite/deps/three.js');
    const pos = new Vector3(0, .335, 0), ball = new Vector3(12, 3, -8), clear = (a, b) => a.distanceTo(b), rows = [];
    for (const ballCam of [false, true]) for (const sign of [-1, 1]) for (const hz of [30, 60, 144]) {
      const rig = new FollowCamera(), camera = new PerspectiveCamera(69, 1.6, .15, 550), q = new Quaternion();
      rig.update(camera, pos, q, ball, 0, ballCam, false, 0, true, clear);
      for (let i = 0; i < hz * 2; i++) rig.update(camera, pos, q, ball, 0, ballCam, false, 1 / hz, false, clear);
      const baseline = camera.position.clone(); let maxStep = 0, hidden = 0, intermediate;
      for (let i = 0; i < hz; i++) {
        const before = camera.position.clone(); rig.update(camera, pos, q, ball, 0, ballCam, false, 1 / hz, false, clear, sign); camera.updateMatrixWorld();
        maxStep = Math.max(maxStep, before.distanceTo(camera.position)); const screen = pos.clone().project(camera);
        if (Math.abs(screen.x) > 1 || Math.abs(screen.y) > 1 || screen.z > 1) hidden++;
        if (i === Math.round(hz / 10)) intermediate = camera.position.x;
      }
      const held = camera.position.toArray(), direction = camera.getWorldDirection(new Vector3()).toArray();
      for (let i = 0; i < hz * 2; i++) rig.update(camera, pos, q, ball, 0, ballCam, false, 1 / hz, false, clear, 0);
      rows.push({ ballCam, sign, hz, held, direction, intermediate, maxStep, hidden, returned: camera.position.distanceTo(baseline) });
    }
    const partial = [];
    for (const input of [-.5, .5]) { const rig = new FollowCamera(), camera = new PerspectiveCamera(69, 1.6, .15, 550); rig.update(camera, pos, new Quaternion(), ball, 0, false, false, 0, true, clear); for (let i = 0; i < 60; i++) rig.update(camera, pos, new Quaternion(), ball, 0, false, false, 1 / 60, false, clear, input); partial.push({ input, camera: camera.position.toArray(), direction: camera.getWorldDirection(new Vector3()).toArray() }); }
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2), rig = new FollowCamera(), camera = new PerspectiveCamera(69, 1.6, .15, 550);
    rig.update(camera, pos, q, ball, 0, true, false, 0, true, clear, 1); const rotated = camera.position.clone().sub(pos).setY(0).normalize().dot(new Vector3(0, 0, -1).applyQuaternion(q));
    return { rows, partial, rotated };
  });
  check('Both sides reach 180 degrees in car cam and off-axis ball cam at 30/60/144 Hz', traces.rows.every(r => r.held[2] < -4.89 && Math.abs(r.held[0]) < .08 && r.direction[2] > .96), traces.rows);
  check('Each stick direction travels through its own side of the car', traces.rows.filter(r => !r.ballCam).every(r => r.intermediate * r.sign < 0), traces.rows);
  check('The car stays visible through the entire sweep', traces.rows.every(r => r.hidden === 0), traces.rows);
  check('Release restores the original framing in both camera modes', traces.rows.every(r => r.returned < .03), traces.rows);
  check('Half stick holds a 90-degree side view and full look follows car heading', traces.partial.every(r => Math.abs(r.camera[2]) < .001 && r.camera[0] * r.input < 0) && traces.rotated > .99999, { partial: traces.partial, rotated: traces.rotated });
  const framing = await p.evaluate(async () => {
    const { FollowCamera } = await import('/src/follow-camera.ts'), { PerspectiveCamera, Vector3, Quaternion } = await import('/node_modules/.vite/deps/three.js'), rows = [];
    for (const ballCam of [false, true]) for (const look of [-1, 1]) {
      const normal = new FollowCamera(), orbit = new FollowCamera(), a = new PerspectiveCamera(69, 1.6, .15, 550), b = a.clone();
      const pos = new Vector3(0, .335, 0), q = new Quaternion(), ball = new Vector3(1, 19, -2), clear = (a, b) => a.distanceTo(b);
      Object.assign(normal.settings, { fov: 83, distance: 6.1, height: 3.2, angle: 12 }); Object.assign(orbit.settings, normal.settings);
      normal.update(a, pos, q, ball, 0, ballCam, false, 0, true, clear); orbit.update(b, pos, q, ball, 0, ballCam, false, 0, true, clear);
      const difference = { distance: 0, height: 0, fov: 0, pitch: 0 };
      for (let i = 0; i < 120; i++) {
        normal.update(a, pos, q, ball, 0, ballCam, false, 1 / 60, false, clear); orbit.update(b, pos, q, ball, 0, ballCam, false, 1 / 60, false, clear, look);
        difference.distance = Math.max(difference.distance, Math.abs(a.position.distanceTo(pos) - b.position.distanceTo(pos)));
        difference.height = Math.max(difference.height, Math.abs(a.position.y - b.position.y));
        difference.fov = Math.max(difference.fov, Math.abs(a.fov - b.fov));
        difference.pitch = Math.max(difference.pitch, Math.abs(a.getWorldDirection(new Vector3()).y - b.getWorldDirection(new Vector3()).y));
      }
      rows.push({ ballCam, look, difference, normalDistance: a.position.distanceTo(pos), heldDistance: b.position.distanceTo(pos) });
    }
    return rows;
  });
  check('The entire orbit preserves normal height, FOV, distance and pitch, including overhead ball framing', framing.every(row => Object.values(row.difference).every(delta => delta < .000001)), framing);
  const consistency = [-1, 1].flatMap(sign => [false, true].map(ballCam => { const rows = traces.rows.filter(r => r.sign === sign && r.ballCam === ballCam), a = rows[0].held, b = rows.at(-1).held; return Math.hypot(...a.map((v, i) => v - b[i])); }));
  check('Held framing is consistent across refresh rates', consistency.every(distance => distance < .015), consistency);
  check('No browser or shader errors', errors.length === 0, errors);
  await writeFile('test-results/camera-look/checks.json', JSON.stringify({ results, errors, traces }, null, 2));
} finally { await browser.close(); }
