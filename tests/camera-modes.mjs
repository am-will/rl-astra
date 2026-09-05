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
      const regularAim = camera.quaternion.clone();
      rig.update(camera, pos, rotation, ball, 0, true, false, 0, true, clear); camera.updateMatrixWorld();
      const ballScreen = ball.clone().project(camera);
      assert.ok(Math.abs(ballScreen.x) < .9 && Math.abs(ballScreen.y) < .9 && ballScreen.z < 1, `Ball cam must focus on the ball at ${fov} degrees`);
      assert.ok(regularAim.angleTo(camera.quaternion) > .001, 'The focus must change between modes');
    }
  }
  console.log('PASS Both modes keep their focus visible, including 20-degree car cam and overhead ball cam');
} finally {
  await server.close();
}
