import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';

// Exercise the real camera without rendering the stadium or requiring Chrome.
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { FollowCamera } = await server.ssrLoadModule('/src/follow-camera.ts');
  const { CAMERA_DEFAULTS } = await server.ssrLoadModule('/src/camera-settings.ts');
  const clear = (a, b) => a.distanceTo(b), rotation = new Quaternion();
  const lens = (camera, car) => [camera.fov, camera.position.y - car.y, Math.hypot(camera.position.x - car.x, camera.position.z - car.z)];
  const sameLens = (a, b, car, label) => {
    const actual = lens(a, car), expected = lens(b, car);
    assert.ok(actual.every((value, i) => Math.abs(value - expected[i]) < 1e-7), `${label}: ${actual} != ${expected}`);
  };
  const create = (settings, aspect) => {
    const rig = new FollowCamera(), camera = new PerspectiveCamera(69, aspect, .15, 550);
    Object.assign(rig.settings, settings);
    return { rig, camera };
  };
  const presets = [CAMERA_DEFAULTS, { ...CAMERA_DEFAULTS, fov: 20 }, { fov: 86, height: 3.1, distance: 6.7, angle: 18 }, { fov: 35, height: .45, distance: 10, angle: 0 }, { fov: 110, height: 4.5, distance: 2.8, angle: 30 }];
  const balls = [new Vector3(0, 1, -40), new Vector3(12, 3, -8), new Vector3(0, 19, 0), new Vector3(-2, 16, 4)];
  let switches = 0;
  for (const settings of presets) for (const aspect of [16 / 9, 390 / 844]) for (const y of [.335, 19.8]) for (const speed of [0, 23]) for (const ball of balls) {
    const pos = new Vector3(0, y, 0), regular = create(settings, aspect), toggled = create(settings, aspect);
    regular.rig.update(regular.camera, pos, rotation, ball, speed, false, false, 0, true, clear);
    toggled.rig.update(toggled.camera, pos, rotation, ball, speed, true, false, 0, true, clear);
    sameLens(toggled.camera, regular.camera, pos, 'Initial ball cam');
    for (const mode of [false, true, false]) for (let frame = 0; frame < 90; frame++) {
      toggled.rig.update(toggled.camera, pos, rotation, ball, speed, mode, false, 1 / 60, false, clear);
      sameLens(toggled.camera, regular.camera, pos, 'Switching camera mode');
    }
    switches += 3;
  }
  console.log(`PASS ${switches} mode switches preserve FOV, height and distance across camera settings, speeds, aspect ratios and car heights`);

  for (const hz of [30, 60, 144]) for (const startMode of [false, true]) {
    const pos = new Vector3(0, .335, 0), ball = new Vector3(12, 19, -8);
    const baseline = create(CAMERA_DEFAULTS, 1.6), toggled = create(CAMERA_DEFAULTS, 1.6);
    for (const { rig, camera } of [baseline, toggled]) rig.update(camera, pos, rotation, ball, 0, startMode, false, 0, true, clear);
    for (let frame = 1; frame <= hz * 4; frame++) {
      const speed = 23 * Math.sin(frame / hz * Math.PI / 4) ** 2;
      pos.set(frame / hz * 3, .335 + Math.sin(frame / hz) ** 2, -frame / hz * 4);
      const previous = toggled.camera.quaternion.clone();
      baseline.rig.update(baseline.camera, pos, rotation, ball, speed, startMode, false, 1 / hz, false, clear);
      toggled.rig.update(toggled.camera, pos, rotation, ball, speed, Math.floor(frame / (hz / 2)) % 2 === 0 ? startMode : !startMode, false, 1 / hz, false, clear);
      sameLens(toggled.camera, baseline.camera, pos, `Accelerating and toggling at ${hz} Hz`);
      assert.ok(previous.angleTo(toggled.camera.quaternion) <= 12 / hz + 1e-7, 'Focus must turn smoothly');
    }
  }
  console.log('PASS Rapid toggles share the same speed response and smoothly change focus at 30, 60 and 144 Hz');

  for (const fov of [20, 50, 69, 110]) for (const aspect of [1.6, 390 / 844]) {
    const pos = new Vector3(0, .335, 0), { rig, camera } = create({ ...CAMERA_DEFAULTS, fov }, aspect);
    for (const ball of balls) {
      rig.update(camera, pos, rotation, ball, 0, false, false, 0, true, clear); camera.updateMatrixWorld();
      const carScreen = pos.clone().project(camera);
      assert.ok(Math.abs(carScreen.y) < .95 && carScreen.z < 1, `Car cam must keep the car visible at ${fov} degrees`);
      rig.update(camera, pos, rotation, ball, 0, true, false, 0, true, clear); camera.updateMatrixWorld();
      const framedCar = pos.clone().project(camera);
      assert.ok(Math.abs(framedCar.x) < .9 && Math.abs(framedCar.y) < .9 && framedCar.z > -1 && framedCar.z < 1, `Ball cam must keep the car visible at ${fov} degrees with ball ${ball.toArray()}`);
      if (fov >= 50 && ball.y <= 3) {
        const ballScreen = ball.clone().project(camera);
        assert.ok(Math.abs(ballScreen.x) < .9 && Math.abs(ballScreen.y) < .9 && ballScreen.z < 1, 'Ball cam must keep both subjects visible when they fit');
      }
    }
  }
  console.log('PASS Both modes keep the car visible, including 20-degree overhead ball cam, and track the ball when both fit');

  // Check every frame of a pop, overhead crossing, landing, lens adjustment,
  // manual look and mode switch. Endpoint-only tests miss smoothing overshoot.
  let frames = 0;
  for (const hz of [30, 60, 144]) for (const aspect of [16 / 9, 1, 390 / 844]) for (const settings of presets) {
    const { rig, camera } = create(settings, aspect), pos = new Vector3(0, .335, 0), ball = new Vector3(0, 1, -12), q = new Quaternion();
    rig.update(camera, pos, q, ball, 0, true, false, 0, true, clear);
    for (let frame = 0; frame < hz * 8; frame++) {
      const t = frame / hz, speed = 23 * Math.sin(t) ** 2;
      pos.set(4 * Math.sin(t), .335 + 19 * Math.sin(t * Math.PI / 8) ** 4, -t * 3);
      q.setFromAxisAngle(new Vector3(0, 1, 0), t * 1.5);
      ball.copy(pos).add(new Vector3(4 * Math.sin(t * 2), t < 1 ? .6 : 19 * Math.sin(t * .8) ** 2, -8 * Math.cos(t)));
      if (frame === hz * 3) rig.settings.fov = 20;
      if (frame === hz * 5) rig.settings.fov = 110;
      const ballCam = t < 4 || t > 4.5, look = t > 6 && t < 7 ? .7 : 0;
      rig.update(camera, pos, q, ball, speed, ballCam, false, 1 / hz, false, clear, look);
      camera.updateMatrixWorld();
      const screen = pos.clone().project(camera);
      assert.ok(Math.abs(screen.x) < .95 && Math.abs(screen.y) < .95 && screen.z > -1 && screen.z < 1,
        `Car left frame at ${hz} Hz, aspect ${aspect}, settings ${JSON.stringify(settings)}, t=${t}: ${screen.toArray()}`);
      frames++;
    }
  }
  console.log(`PASS Car stays visible through ${frames} frames of high balls, aerials, lens changes, mode switches and manual look`);

  // The reported close-FOV pop must retain the body and all four wheels, not
  // just a sliver of the car's origin at the bottom edge of the viewport.
  for (const fov of [20, 35, 69]) for (const distance of [2.8, 4.9, 10]) for (const yaw of [0, Math.PI / 2]) {
    if (fov === 20 && distance === 2.8) continue; // The entire car exceeds this lens even when centered.
    const pos = new Vector3(0, .335, 0), ball = new Vector3(0, 19, 0), q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    const { rig, camera } = create({ ...CAMERA_DEFAULTS, fov, distance }, 16 / 9);
    rig.update(camera, pos, q, ball, 0, true, false, 0, true, clear);
    camera.updateMatrixWorld();
    for (const x of [-.55, .55]) for (const y of [-.32, .45]) for (const z of [-.82, .82]) {
      const screen = new Vector3(x, y, z).applyQuaternion(q).add(pos).project(camera);
      assert.ok(Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1 && screen.z > -1 && screen.z < 1,
        `High-ball framing crops the car body at FOV ${fov}, distance ${distance}: ${screen.toArray()}`);
    }
  }
  console.log('PASS Close-FOV overhead framing retains the car body and wheels');
} finally {
  await server.close();
}
