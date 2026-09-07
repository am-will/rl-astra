import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { Euler, Quaternion, Vector3 } from 'three';

// Reference: https://rocketscience.fyi/know/videos/dodges and RocketSim RLConst.h.
// Exercise real Rapier steps, independently of rendering or wall-clock timing.
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const results = [];
const check = (name, pass, detail) => {
  assert.ok(pass, `${name}: ${JSON.stringify(detail)}`);
  results.push({ name, detail }); console.log(`PASS ${name}`);
};
let physics;
try {
  const { Physics } = await server.ssrLoadModule('/src/physics.ts');
  const { emptyInput, STEP } = await server.ssrLoadModule('/src/config.ts');
  physics = new Physics(); await physics.init(); physics.botEnabled = false;
  const car = physics.player, neutral = emptyInput();
  const step = input => physics.step({ ...neutral, ...input }, neutral);
  const rotation = () => new Quaternion().copy(car.body.rotation()).normalize();
  const angular = () => new Vector3().copy(car.body.angvel());
  const airborne = () => {
    physics.reset(); physics.ball.setEnabled(false);
    car.body.setTranslation({ x: 0, y: 9, z: 0 }, true); car.jumpCount = 1; car.airTime = .2;
  };

  const spin = [];
  for (const [forward, side] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    airborne(); const first = [], angles = []; let cutoff, cutoffRotation, uprightAt = null;
    for (let i = 0; i < 138; i++) {
      const before = rotation(); step({ jump: i === 0, dodgeForward: forward, dodgeSide: side });
      if (i < 3) first.push(angular().length());
      angles.push(before.angleTo(rotation()));
      if (i === 59) { cutoff = angular().length(); cutoffRotation = rotation(); }
      if (i > 48 && uprightAt === null && new Vector3(0, 1, 0).applyQuaternion(rotation()).y > .95) uprightAt = (i + 1) * STEP;
    }
    spin.push({ forward, side, first, cutoff, uprightAt, recoverySpin: angular().length(), endUp: new Vector3(0, 1, 0).applyQuaternion(rotation()).y, totalAngle: angles.reduce((a, b) => a + b, 0), followThrough: cutoffRotation.angleTo(rotation()), poweredAngle: angles.slice(0, 60).reduce((a, b) => a + b, 0), maxStep: Math.max(...angles) });
  }
  check('Dodge torque builds to its spin cap in three physics ticks', spin.every(r => r.first[0] > 2.7 && r.first[0] < 3.3 && r.first[1] > r.first[0] && Math.abs(r.first[2] - 8.25) < .001), spin);
  check('All eight dodges get upright within 650 ms and settle without excess rotation', spin.every(r => r.uprightAt !== null && r.uprightAt <= .65 && r.endUp > .99 && r.totalAngle > 6.1 && r.totalAngle < 6.4 && r.recoverySpin < .1), spin);
  check('Powered dodges retain smooth physical follow-through', spin.every(r => r.poweredAngle > 5.35 && r.poweredAngle < 5.7 && Math.abs(r.cutoff - 8.25) < .001 && r.followThrough > .6 && r.followThrough < .9 && r.maxStep < .1), spin);

  const impulses = [];
  for (const pitch of [0, .8, -1.2]) for (const roll of [0, 1.1]) {
    airborne(); car.body.setRotation(new Quaternion().setFromEuler(new Euler(pitch, .4, roll)), true);
    car.body.setLinvel({ x: 0, y: -.5, z: 0 }, true);
    step({ jump: true, dodgeForward: 1, dodgeSide: 0 });
    const v = car.body.linvel(); impulses.push({ pitch, roll, horizontal: Math.hypot(v.x, v.z), vertical: v.y });
  }
  check('Pitched and rolled dodges push horizontally without a forced upward hop', impulses.every(r => r.horizontal > 4.99 && r.horizontal < 5.01 && r.vertical < -.5 && r.vertical > -.57), impulses);
  const lateral = [];
  for (const speed of [0, 10, 20]) {
    airborne(); car.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
    step({ jump: true, dodgeForward: 0, dodgeSide: 1 }); lateral.push({ speed, side: Math.abs(car.body.linvel().x) });
  }
  check('Side dodge power scales with forward momentum', lateral.every(r => Math.abs(r.side - 5 * (1 + .9 * r.speed / 23)) < .01), lateral);

  const vertical = [];
  for (const initial of [-6, 6]) {
    airborne(); car.body.setLinvel({ x: 0, y: initial, z: 0 }, true);
    const trace = [];
    for (let i = 0; i < 61; i++) { step({ jump: i === 0, dodgeForward: 1, dodgeSide: 0 }); trace.push(car.body.linvel().y); }
    vertical.push({ initial, early: trace[16], damped: trace[25], late: trace[58], released: trace[60] });
  }
  check('Vertical momentum survives the first 150 ms, then the dodge floats before gravity resumes', vertical.every(r => Math.abs(r.early - r.initial) < 1 && Math.abs(r.damped) < .3 && Math.abs(r.late) < .2 && r.released < r.late - .04), vertical);

  const collisions = [];
  for (const side of [-1, 1]) {
    airborne(); car.body.setTranslation({ x: side * 37, y: 8, z: 0 }, true);
    car.body.setLinvel({ x: side * 17, y: 0, z: -4 }, true);
    let found = false;
    for (let i = 0; i < 70; i++) {
      step({ jump: i === 0, dodgeForward: 1, dodgeSide: side });
      let contact = false;
      physics.world.contactPairsWith(car.collider, other => {
        if (!other.parent()) physics.world.contactPair(car.collider, other, manifold => {
          for (let j = 0; j < manifold.numContacts(); j++) if (manifold.contactDist(j) < .005) contact = true;
        });
      });
      if (contact && car.flipTime > 0) {
        const pose = rotation();
        physics.updateCar(car, neutral, STEP);
        collisions.push({ side, time: (i + 1) * STEP, poseJump: pose.angleTo(rotation()), spin: angular().length() });
        found = true; break;
      }
    }
    assert.ok(found, `Expected a physical wall strike on side ${side}`);
  }
  check('Wall contacts during a dodge keep the solver pose instead of snapping back to an animation', collisions.every(r => r.poseJump < .00001 && r.spin > .1), collisions);

  // Ball trajectories now use compiled RocketSim fixtures in ball-physics.mjs.
  await mkdir('test-results/physics-feel', { recursive: true });
  await writeFile('test-results/physics-feel/checks.json', JSON.stringify(results, null, 2));
} finally { physics?.world.free(); await server.close(); }
