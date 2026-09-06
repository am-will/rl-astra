import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { Vector3 } from 'three';

// Reference: RocketSim c2baacb8f4b441dd8505e63c2aeb5a1679b60b02,
// RLConst.h / Car.cpp / btVehicleRL.cpp. These run the actual Rapier world.
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const results = [];
let physics;
const check = (name, pass, detail) => {
  assert.ok(pass, `${name}: ${JSON.stringify(detail)}`);
  results.push({ name, detail }); console.log(`PASS ${name}`);
};
try {
  const { Physics } = await server.ssrLoadModule('/src/physics.ts');
  const { emptyInput, STEP, CAR } = await server.ssrLoadModule('/src/config.ts');
  physics = new Physics(); await physics.init(); physics.botEnabled = false; physics.ball.setEnabled(false);
  const car = physics.player;
  const step = input => physics.step({ ...emptyInput(), ...input }, emptyInput());
  const velocity = () => new Vector3().copy(car.body.linvel());
  const position = () => new Vector3().copy(car.body.translation());
  const reset = (x = 0, z = 20, yaw = 0) => {
    physics.resetCar(car, x, z, yaw); for (let i = 0; i < 90; i++) step({});
  };

  const coasting = [];
  for (const speed of [7, 14, 23]) {
    reset(); car.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
    for (let i = 0; i < 120; i++) step({});
    coasting.push({ speed, after: velocity().length() });
  }
  check('Flat-ground coasting loses 525 reference units per second', coasting.every(r => Math.abs(r.after - (r.speed - 5.25)) < .02), coasting);

  const turns = [];
  for (const direction of [-1, 1]) for (const steer of [.35, .7, 1]) {
    reset(); car.body.setLinvel({ x: 0, y: 0, z: -18 }, true);
    let peakSlip = 0, maxSpeed = 18;
    for (let i = 0; i < 120; i++) {
      step({ throttle: 1, steer: direction * steer });
      const v = velocity(), right = new Vector3(1, 0, 0).applyQuaternion(car.body.rotation());
      peakSlip = Math.max(peakSlip, Math.abs(v.dot(right)) / v.length()); maxSpeed = Math.max(maxSpeed, v.length());
    }
    turns.push({ direction, steer, peakSlip, maxSpeed, endSpeed: velocity().length() });
  }
  check('Ordinary turns keep lateral slip below 15% without adding speed back', turns.every(r => r.peakSlip < .15 && r.maxSpeed <= 18.01 && r.endSpeed > 14), turns);
  check('Tighter turns shed more speed through the tires', [-1, 1].every(direction => {
    const rows = turns.filter(r => r.direction === direction); return rows[0].endSpeed > rows[1].endSpeed && rows[1].endSpeed > rows[2].endSpeed;
  }), turns);

  const ramps = [];
  for (const side of [-1, 1]) for (const mode of ['coast', 'drive']) {
    reset(side * 31, 0, -side * Math.PI / 2); car.body.setLinvel({ x: side * 14, y: 0, z: 0 }, true);
    const initialEnergy = velocity().lengthSq() + 2 * CAR.gravity * position().y;
    let speedAtThree = null, speedAtFifteen = null, maxEnergyGain = 0;
    for (let i = 0; i < 360; i++) {
      step({ throttle: mode === 'drive' ? 1 : 0 });
      const p = position(), v = velocity();
      maxEnergyGain = Math.max(maxEnergyGain, v.lengthSq() + 2 * CAR.gravity * p.y - initialEnergy);
      if (p.y >= 3 && speedAtThree === null) speedAtThree = v.length();
      if (p.y >= 15 && speedAtFifteen === null) speedAtFifteen = v.length();
    }
    ramps.push({ side, mode, speedAtThree, speedAtFifteen, maxEnergyGain });
  }
  check('Coasting into ramps sheds speed and cannot create mechanical energy', ramps.filter(r => r.mode === 'coast').every(r => r.speedAtThree > 6 && r.speedAtThree < 8.2 && r.speedAtFifteen === null && r.maxEnergyGain < 1), ramps);
  check('Throttle-only climbing slows under gravity while retaining engine power', ramps.filter(r => r.mode === 'drive').every(r => r.speedAtThree > 12 && r.speedAtFifteen > 9 && r.speedAtFifteen < 11), ramps);
  await mkdir('test-results/handling-source', { recursive: true });
  await writeFile('test-results/handling-source/checks.json', JSON.stringify(results, null, 2));
} finally { physics?.world.free(); await server.close(); }
