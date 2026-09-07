import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { Vector3, Quaternion, Matrix4 } from 'three';

// Run the real Rapier controller without rendering, so every 120 Hz contact
// can be checked instead of hiding a brief speed loss in an end-of-run value.
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
let physics;
const results = [];
try {
  const { Physics } = await server.ssrLoadModule('/src/physics.ts');
  const { FIELD, CAR, STEP, emptyInput } = await server.ssrLoadModule('/src/config.ts');
  physics = new Physics(); await physics.init(); physics.botEnabled = false; physics.ball.setEnabled(false);
  const up = new Vector3(0, 1, 0);
  const cases = [];
  for (const side of [-1, 1]) {
    cases.push({ name: `side-${side}`, boundary: new Vector3(side * FIELD.width, 0, 10), outward: new Vector3(side, 0, 0), angles: [0, .45, .8, 1.15] });
    cases.push({ name: `end-${side}`, boundary: new Vector3(21, 0, side * FIELD.length), outward: new Vector3(0, 0, side), angles: [0, .3] });
    for (const end of [-1, 1]) cases.push({ name: `corner-${side}-${end}`, boundary: new Vector3(side * (FIELD.width - FIELD.cornerCut / 2), 0, end * (FIELD.length - FIELD.cornerCut / 2)), outward: new Vector3(side, 0, end).normalize(), angles: [0, .3] });
  }
  for (const location of cases) for (const direction of ['up', 'down']) for (const angle of location.angles) for (const speed of [14, 23]) {
    const { boundary, outward } = location, c = physics.player;
    const lateral = new Vector3().crossVectors(up, outward);
    const normal = direction === 'up' ? up.clone() : outward.clone().negate();
    const travel = direction === 'up' ? outward.clone() : up.clone().negate();
    const forward = travel.multiplyScalar(Math.cos(angle)).addScaledVector(lateral, Math.sin(angle));
    const right = new Vector3().crossVectors(forward, normal).normalize();
    const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, normal, forward.clone().negate()));
    const position = direction === 'up' ? boundary.clone().addScaledVector(outward, -FIELD.rampRadius - 4.4).setY(.38) : boundary.clone().addScaledVector(outward, -.335).setY(6);
    physics.resetCar(c, position.x, position.z);
    c.body.setTranslation(position, true); c.body.setRotation(rotation, true);
    for (let i = 0; i < 90; i++) physics.step(emptyInput(), emptyInput());
    c.body.setLinvel(forward.clone().multiplyScalar(speed), true);
    const initialHeight = c.body.translation().y;
    let maxStepLoss = 0, minSpeed = speed, reached = false, scrapeFrames = 0;
    for (let i = 0; i < 360; i++) {
      const before = new Vector3().copy(c.body.linvel()).length();
      physics.step({ ...emptyInput(), throttle: 1 }, emptyInput());
      const pos = new Vector3().copy(c.body.translation()), current = new Vector3().copy(c.body.linvel()).length();
      maxStepLoss = Math.max(maxStepLoss, before - current); minSpeed = Math.min(minSpeed, current);
      physics.world.contactPairsWith(c.collider, other => {
        if (!other.parent()) physics.world.contactPair(c.collider, other, manifold => { if (manifold.numSolverContacts()) scrapeFrames++; });
      });
      reached = direction === 'up' ? pos.y >= 3.3 : pos.clone().sub(boundary).dot(outward) < -FIELD.rampRadius - 1;
      if (reached) break;
    }
    const height = c.body.translation().y;
    const gravityAdjustedSpeed = Math.min(CAR.maxSpeed, Math.sqrt(speed * speed + 2 * CAR.gravity * (initialHeight - height)));
    const row = { location: location.name, direction, angle, speed, reached, minSpeed, maxStepLoss, scrapeFrames, finalSpeed: new Vector3().copy(c.body.linvel()).length(), gravityAdjustedSpeed };
    results.push(row);
  }
  await mkdir('test-results/ramp-transition', { recursive: true });
  await writeFile('test-results/ramp-transition/checks.json', JSON.stringify(results, null, 2));
  const failures = results.filter(r => !r.reached || r.maxStepLoss > .5 || r.finalSpeed < r.gravityAdjustedSpeed * .95);
  assert.deepEqual(failures, [], 'Ramp transitions must remain smooth and retain momentum after accounting for gravity');
  const climbs = results.filter(r => r.direction === 'up');
  assert.ok(climbs.every(r => r.scrapeFrames === 0 && r.maxStepLoss < .12), 'The chassis must not scrape or brake while driving up the curve');
  console.log(`PASS ${results.length} straight and diagonal ramp transitions across side walls, end walls, and corners`);
  console.log('PASS no chassis scraping on ascent; descending transitions retain at least 95% of gravity-adjusted momentum');

  // Follow the entire ride. Stopping just above the lower ramp misses spring
  // rebound at its exit and a chassis impact at the wall-to-ceiling curve.
  const fullClimbs = [];
  physics.unlimited = true;
  for (const location of cases) for (const angle of [-Math.PI / 4, 0, Math.PI / 4]) for (const phase of [0, .07, .14, .21]) for (const approach of [{ speed: CAR.maxSpeed, boost: false }, { speed: CAR.maxSpeed, boost: true }, { speed: 0, boost: true }]) {
    const { speed: initialSpeed, boost } = approach;
    const { boundary, outward } = location, c = physics.player;
    const lateral = new Vector3().crossVectors(up, outward);
    const forward = outward.clone().multiplyScalar(Math.cos(angle)).addScaledVector(lateral, Math.sin(angle));
    const position = boundary.clone().addScaledVector(outward, -FIELD.rampRadius - 5 - phase);
    physics.resetCar(c, position.x, position.z, Math.atan2(-forward.x, -forward.z));
    for (let i = 0; i < 90; i++) physics.step(emptyInput(), emptyInput());
    c.body.setLinvel(forward.clone().multiplyScalar(initialSpeed), true);
    const initialHeight = c.body.translation().y;
    let roof = null, release = null, lostContact = false, maxStepLoss = 0, scrapeFrames = 0, maxPenetration = 0, maxSpeed = 0;
    for (let i = 0; i < 600; i++) {
      const before = new Vector3().copy(c.body.linvel()).length();
      physics.step({ ...emptyInput(), throttle: 1, boost }, emptyInput());
      const position = new Vector3().copy(c.body.translation()), velocity = new Vector3().copy(c.body.linvel());
      const speed = velocity.length(), time = (i + 1) * STEP;
      maxSpeed = Math.max(maxSpeed, speed);
      if (!roof) {
        maxStepLoss = Math.max(maxStepLoss, before - speed);
        lostContact ||= !c.grounded;
        physics.world.contactPairsWith(c.collider, other => {
          if (!other.parent()) physics.world.contactPair(c.collider, other, manifold => {
            if (manifold.numSolverContacts()) scrapeFrames++;
            for (let j = 0; j < manifold.numSolverContacts(); j++) maxPenetration = Math.max(maxPenetration, -manifold.solverContactDist(j));
          });
        });
        // A near-horizontal roof pose alone can still be on the fillet.
        // Require the tire normal to have reached the actual flat ceiling.
        if (c.grounded && c.groundNormal.y < -.9999 && position.y > FIELD.height - .6) roof = { time, speed, height: position.y, position };
      }
      if (roof && !c.grounded && !release) release = { time: time - roof.time, distance: position.distanceTo(roof.position) };
      if (roof && time >= roof.time + 1) break;
    }
    const gravityAdjustedSpeed = roof ? Math.sqrt(Math.max(0, initialSpeed ** 2 + 2 * CAR.gravity * (initialHeight - roof.height))) : 0;
    fullClimbs.push({ location: location.name, angle, phase, initialSpeed, boost, roof, release, lostContact, maxStepLoss, scrapeFrames, maxPenetration, maxSpeed, gravityAdjustedSpeed, finalHeight: c.body.translation().y, finalVy: c.body.linvel().y });
  }
  await writeFile('test-results/ramp-transition/full-climbs.json', JSON.stringify(fullClimbs, null, 2));
  // Starts from rest cross the goal-frame return at a lower height and can
  // produce sub-millimetre solver contacts. Still reject penetration, speed
  // loss, or any chassis contact on the full-speed line above that return.
  const failedClimbs = fullClimbs.filter(r => !r.roof || r.lostContact || r.maxStepLoss > .15 || r.maxPenetration > .005 || (r.initialSpeed > 0 && r.scrapeFrames) || r.maxSpeed > CAR.maxSpeed + .1 || r.roof.speed < (r.initialSpeed === 0 ? CAR.driveSpeed : r.boost ? CAR.maxSpeed * .98 : r.gravityAdjustedSpeed * .97));
  assert.deepEqual(failedClimbs, [], 'Full-speed approaches must follow both curves without detaching, scraping, or losing rolling momentum');
  assert.ok(fullClimbs.every(r => r.release && r.release.time < .8 && r.finalHeight < FIELD.height - 1 && r.finalVy < 0), 'Every completed climb must release from the ceiling under gravity, including with boost held');
  console.log(`PASS ${fullClimbs.length} complete floor/wall/ceiling rides, including exact 45° entries at varied contact phases`);
  console.log('PASS gravity releases every ceiling ride, including with boost held');

  for (const angle of [0, Math.PI / 4]) for (const surface of ['lower-ramp', 'wall', 'upper-ramp', 'ceiling']) {
    const c = physics.player;
    physics.resetCar(c, 32, 12, -Math.PI / 2 + angle);
    for (let i = 0; i < 90; i++) physics.step(emptyInput(), emptyInput());
    c.body.setLinvel({ x: CAR.maxSpeed * Math.cos(angle), y: 0, z: -CAR.maxSpeed * Math.sin(angle) }, true);
    let arrived = false;
    for (let i = 0; i < 400; i++) {
      physics.step({ ...emptyInput(), throttle: 1, boost: true }, emptyInput());
      arrived = surface === 'lower-ramp' ? c.body.translation().y > 1 : surface === 'wall' ? c.body.translation().y > 9 : surface === 'upper-ramp' ? c.groundNormal.y < -.7 : c.groundNormal.y < -.9999;
      if (arrived) break;
    }
    assert.ok(arrived && c.grounded, `Jump setup must reach ${surface}`);
    const normal = c.groundNormal.clone();
    physics.step({ ...emptyInput(), jump: true }, emptyInput());
    assert.ok(!c.grounded && new Vector3().copy(c.body.linvel()).dot(normal) > 2, `Jump must immediately release ${surface} at angle ${angle}`);
    for (let i = 0; i < 18; i++) {
      physics.step(emptyInput(), emptyInput());
      assert.ok(!c.grounded, `Wheel support must not resume during a jump off ${surface}`);
    }
  }
  console.log('PASS jumps release from both curves, vertical walls, and the ceiling at straight and diagonal angles');

  const c = physics.player, R = (await import('@dimforge/rapier3d-deterministic-compat')).default;
  physics.resetCar(c, 0, 0); c.body.setTranslation({ x: 0, y: 3, z: 0 }, true);
  const singleTire = physics.world.createCollider(R.ColliderDesc.cuboid(.1, .05, .1).setTranslation(.375, 3 - .335 - .05, -.475));
  physics.world.step(); physics.step(emptyInput(), emptyInput());
  assert.equal(c.wheels, 1); assert.equal(c.grounded, false, 'A single tire must not count as a new landing');
  c.grounded = true; physics.step(emptyInput(), emptyInput());
  assert.equal(c.grounded, true, 'An existing ride can continue on its last supported tire');
  physics.step({ ...emptyInput(), jump: true }, emptyInput());
  assert.equal(c.grounded, false); assert.ok(c.body.linvel().y > 2, 'Jumping must release the remaining contact immediately');
  physics.world.removeCollider(singleTire, true);
  physics.resetCar(c, 0, 0); c.body.setTranslation({ x: 0, y: 8, z: 0 }, true); c.grounded = true;
  physics.step(emptyInput(), emptyInput());
  assert.equal(c.wheels, 0); assert.equal(c.grounded, false, 'Losing all tire contacts must release the car');
  console.log('PASS single-tire continuity cannot create an airborne landing or prevent jumping/release');

  for (const speed of [0, 5, 20]) {
    physics.resetCar(c, 0, 15); c.body.setTranslation({ x: 0, y: FIELD.height - .335, z: 15 }, true);
    c.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI), true);
    c.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
    let touched = false, releasedAt = Infinity;
    for (let i = 0; i < 120; i++) {
      physics.step({ ...emptyInput(), throttle: speed ? 1 : 0 }, emptyInput()); touched ||= c.grounded;
      if (touched && !c.grounded) releasedAt = Math.min(releasedAt, (i + 1) * STEP);
    }
    assert.ok(touched && releasedAt < .8 && c.body.translation().y < 19 && c.body.linvel().y < 0, `Ceiling must release normally at speed ${speed}`);
  }
  console.log('PASS ceiling release at rest, low speed, and high speed');
} finally {
  physics?.world.free(); await server.close();
}
