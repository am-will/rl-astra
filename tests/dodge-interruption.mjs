import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const results = [], errors = [];
const check = (name, pass, detail) => {
  assert.ok(pass, `${name}: ${JSON.stringify(detail)}`);
  results.push({ name, detail }); console.log(`PASS ${name}`);
};
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  // Exercise the real physics and controls at fixed simulation steps without
  // tying jump/button timing to the renderer's wall-clock performance.
  await page.route('**/__dodge_tests__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Dodge regression tests</title>' }));
  await page.goto(`${process.env.GAME_URL || 'http://127.0.0.1:5179'}/__dodge_tests__`);
  const data = await page.evaluate(async () => {
    const { Physics } = await import('/src/physics.ts');
    const { Controls } = await import('/src/controls.ts');
    const { emptyInput, STEP } = await import('/src/config.ts');
    const { Quaternion, Vector3 } = await import('/node_modules/.vite/deps/three.js');
    const physics = new Physics(); await physics.init(); physics.botEnabled = false; physics.ball.setEnabled(false);
    const car = physics.player, neutral = emptyInput();
    const rotation = () => new Quaternion().copy(car.body.rotation());
    const up = () => new Vector3(0, 1, 0).applyQuaternion(car.body.rotation()).y;
    const step = input => physics.step({ ...neutral, ...input }, neutral);
    const reset = () => {
      physics.resetCar(car, 0, 0); car.body.setTranslation({ x: 0, y: 9, z: 0 }, true);
      car.jumpCount = 1; car.airTime = .2;
    };
    const uninterrupted = [], pulses = [], held = [], ground = [];
    try {
      for (const [forward, side] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        reset(); const input = { dodgeForward: forward, dodgeSide: side, pitch: -forward };
        step({ ...input, jump: true }); let middleUp = 1;
        for (let i = 1; i < 78; i++) { step(input); middleUp = Math.min(middleUp, up()); }
        const end = rotation(), angular = car.body.angvel();
        for (let i = 0; i < 24; i++) step(input);
        uninterrupted.push({ forward, side, middleUp, endUp: new Vector3(0, 1, 0).applyQuaternion(end).y, endError: end.angleTo(new Quaternion()), recoveryError: rotation().angleTo(end), angularSpeed: Math.hypot(angular.x, angular.y, angular.z) });
        for (const at of [27, 39, 55]) for (const strength of [.31, .5, 1]) {
          reset(); step({ ...input, jump: true }); let activeAfterPulse = false, maxStep = 0;
          for (let i = 1; i < 78; i++) {
            const before = rotation(); step({ ...input, pitch: i === at ? (forward || 1) * strength : 0 });
            maxStep = Math.max(maxStep, before.angleTo(rotation()));
            if (i === at) activeAfterPulse = car.flipTime > 0;
          }
          pulses.push({ forward, side, at, strength, activeAfterPulse, maxStep, endUp: up(), finished: car.flipTime === 0 });
        }
      }
      for (const forward of [-1, 1]) for (const side of [0, 1, -1]) {
        reset(); step({ jump: true, dodgeForward: forward, dodgeSide: side });
        for (let i = 1; i < 30; i++) step({});
        const before = rotation(), pitchSpeedBefore = Math.abs(new Vector3().copy(car.body.angvel()).applyQuaternion(before.clone().invert()).x);
        for (let i = 0; i < 8; i++) step({ pitch: forward });
        const cancelled = rotation(), delta = before.clone().invert().multiply(cancelled), active = car.flipTime > 0;
        const pitchSpeedAfter = Math.abs(new Vector3().copy(car.body.angvel()).applyQuaternion(cancelled.clone().invert()).x);
        for (let i = 0; i < 3; i++) step({});
        held.push({ forward, side, active, pitchSpeedBefore, pitchSpeedAfter, pitchChange: Math.abs(delta.x), yawChange: Math.abs(delta.y), rollChange: Math.abs(delta.z), resumedAngle: cancelled.angleTo(rotation()) });
      }
      for (const speed of [0, 14, 23]) for (const delay of [6, 12, 24, 42]) for (const side of [0, 1, -1]) {
        physics.resetCar(car, 0, 25); for (let i = 0; i < 90; i++) step({});
        car.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
        step({ jump: true, jumpHeld: true });
        for (let i = 1; i < delay; i++) step({ jumpHeld: i < 12 });
        step({ jump: true, dodgeForward: 1, dodgeSide: side });
        const started = car.flipTime > 0; let abortedInverted = false;
        for (let i = 0; i < 240; i++) {
          const before = car.flipTime; step({});
          if (before > STEP * 1.1 && car.flipTime === 0 && up() < -.5) abortedInverted = true;
        }
        ground.push({ speed, delay, side, started, abortedInverted, grounded: car.grounded, up: up() });
      }
      // Read a noisy stick sample through the actual gamepad bindings.
      const pad = { index: 0, id: 'DualSense Wireless Controller', mapping: 'standard', connected: true, timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, () => ({ value: 0, pressed: false, touched: false })) };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
      const controls = new Controls(); controls.poll(0);
      reset(); pad.axes[1] = -1; pad.buttons[0] = { value: 1, pressed: true, touched: true }; controls.poll(1);
      const launch = controls.read(); step(launch); pad.buttons[0] = { value: 0, pressed: false, touched: false };
      let pulsePitch = 0, activeAfterPulse = false;
      for (let i = 1; i < 78; i++) {
        pad.axes[1] = i === 39 ? .56 : 0; controls.poll(i + 1); const input = controls.read(); step(input);
        if (i === 39) { pulsePitch = input.pitch; activeAfterPulse = car.flipTime > 0; }
      }
      const gamepad = { launch: launch.jump && launch.dodgeForward === 1, pulsePitch, activeAfterPulse, endUp: up() };
      // A one-step keyboard direction change should also resume its tackle.
      pad.axes[1] = 0; controls.poll(100); reset();
      const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code }));
      key('keydown', 'KeyW'); key('keydown', 'Space'); step(controls.read()); key('keyup', 'Space');
      for (let i = 1; i < 78; i++) {
        if (i === 39) { key('keyup', 'KeyW'); key('keydown', 'KeyS'); }
        if (i === 40) { key('keyup', 'KeyS'); key('keydown', 'KeyW'); }
        step(controls.read());
      }
      key('keyup', 'KeyW'); const keyboard = { endUp: up(), finished: car.flipTime === 0 };
      return { uninterrupted, pulses, held, ground, gamepad, keyboard };
    } finally { physics.world.free(); }
  });
  // Torque ends at 500 ms. By 650 ms the car is upright with residual
  // angular motion, which recovery damping settles without forcing its pose.
  check('All eight dodges rotate through inversion and settle upright promptly', data.uninterrupted.every(r => r.middleUp < -.99 && r.endUp > .96 && r.endError < .3 && r.recoveryError > .08 && r.recoveryError < .25 && r.angularSpeed > 1 && r.angularSpeed < 2.1), data.uninterrupted);
  check('Brief counter-pitch cannot abort a tackle or cause a pose jump', data.pulses.every(r => r.activeAfterPulse && r.finished && Math.abs(r.endUp - data.uninterrupted.find(b => b.forward === r.forward && b.side === r.side).endUp) < .04 && r.maxStep < .1), data.pulses);
  check('Held counter-pitch damps existing pitch while diagonal roll continues', data.held.every(r => r.active && r.pitchSpeedAfter > 0 && r.pitchSpeedAfter < r.pitchSpeedBefore * .85 && r.pitchChange > .01 && r.yawChange < .02 && (r.side === 0 ? r.rollChange < .001 : r.rollChange > .1)), data.held);
  check('Releasing counter-pitch resumes rotation without snapping', data.held.every(r => r.resumedAngle > .23 && r.resumedAngle < .32), data.held);
  check('Early and late ground tackles land on their wheels at every tested speed', data.ground.every(r => r.started && !r.abortedInverted && r.grounded && r.up > .99), data.ground);
  check('A transient controller stick reversal does not kill the tackle', data.gamepad.launch && data.gamepad.pulsePitch > .3 && data.gamepad.activeAfterPulse && Math.abs(data.gamepad.endUp - data.uninterrupted[0].endUp) < .03, data.gamepad);
  check('A brief keyboard direction reversal preserves the dodge trajectory', data.keyboard.finished && Math.abs(data.keyboard.endUp - data.uninterrupted[0].endUp) < .03, data.keyboard);
  check('No browser errors', errors.length === 0, errors);
  await mkdir('test-results/dodge-interruption', { recursive: true });
  await writeFile('test-results/dodge-interruption/checks.json', JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); }
