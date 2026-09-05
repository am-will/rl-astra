import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, Quaternion, Matrix4, MathUtils } from 'three';
import { FIELD, CAR, STEP, type Input } from './config';
import { arenaSurfaces, goalArchHeight } from './arena';

const UP = new Vector3(0, 1, 0);
const v3 = (v: { x: number; y: number; z: number }) => new Vector3(v.x, v.y, v.z);
export interface Pad { x: number; z: number; big: boolean; cooldown: number; }
export interface Car {
  body: RAPIER.RigidBody; collider: RAPIER.Collider; boost: number; grounded: boolean; wheels: number;
  jumpCount: number; airTime: number; jumpTime: number; flipTime: number; flipAxis: Vector3; flipRotation: Quaternion; pitchLock: number;
  boosting: boolean; speed: number; supersonic: boolean; supersonicGrace: number; touchCooldown: number; resetCooldown: number; demolished: number;
  steer: number; drifting: boolean; throttle: number;
  previousPosition: Vector3; previousRotation: Quaternion;
  recoveryTime: number; recoveryStart: Quaternion; recoveryTarget: Quaternion;
  blastTime: number;
  groundNormal: Vector3;
}
export class Physics {
  world!: RAPIER.World;
  ball!: RAPIER.RigidBody;
  ballCollider!: RAPIER.Collider;
  ballPreviousPosition = new Vector3(); ballPreviousRotation = new Quaternion();
  player!: Car;
  bot!: Car;
  pads: Pad[] = [];
  private cameraSolids = new Set<number>();
  private incomingCarVelocities = [new Vector3(), new Vector3()];
  unlimited = false;
  botEnabled = true;
  onHit: (position: Vector3, speed: number, player: boolean) => void = () => {};
  onPad: (big: boolean) => void = () => {};
  onFlipReset: () => void = () => {};
  onDemo: (car: Car) => void = () => {};
  onJump: (car: Car, dodge: boolean) => void = () => {};
  onLand: (car: Car, speed: number) => void = () => {};
  onBounce: (position: Vector3, speed: number) => void = () => {};
  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -CAR.gravity, z: 0 });
    this.world.timestep = STEP;
    this.world.numSolverIterations = 8;
    this.buildArena();
    this.ball = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, FIELD.ballRadius + .08, 0).setLinearDamping(.045).setAngularDamping(.13).setCcdEnabled(true));
    // Explicit pair friction keeps the ball's existing response while letting
    // the chassis slide without the arena's friction dominating it. Max wins
    // over the car's Min: ball/car=.225, ball/floor=.5, ball/wall=.475.
    this.ballCollider = this.world.createCollider(RAPIER.ColliderDesc.ball(FIELD.ballRadius).setMass(30).setRestitution(.6).setFriction(.225).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max), this.ball);
    this.player = this.createCar(0, 29, 0);
    this.bot = this.createCar(0, -29, Math.PI);
    for (const z of [-35, -18, 0, 18, 35]) for (const x of [-19, 0, 19]) {
      if (z === 0 && x === 0) continue;
      this.pads.push({ x, z, big: false, cooldown: 0 });
    }
    for (const x of [-31, 31]) for (const z of [-37, 0, 37]) this.pads.push({ x, z, big: true, cooldown: 0 });
  }
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, rotation?: Quaternion) {
    const collider = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(x, y, z).setFriction(.5).setRestitution(.62);
    if (rotation) collider.setRotation(rotation);
    this.cameraSolids.add(this.world.createCollider(collider).handle);
  }
  buildArena() {
    const { width: w, length: l, goalDepth: d } = FIELD;
    this.box(0, -1, 0, w * 2 + 4, 2, (l + d) * 2 + 4);
    for (const { geometry } of arenaSurfaces()) {
      const vertices = new Float32Array(geometry.getAttribute('position').array);
      const indices = new Uint32Array(geometry.index!.array);
      // Ramps collide with cars and the ball, but let the lens pass through
      // their transparent backs just like the surrounding arena cage.
      this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(.475).setRestitution(.62));
      geometry.dispose();
    }
  }

  createCar(x: number, z: number, yaw: number): Car {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, .38, z).setRotation(new Quaternion().setFromAxisAngle(UP, yaw)).setLinearDamping(.05).setAngularDamping(0).setCcdEnabled(true).setCanSleep(false));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.roundCuboid(.44, .15, .695, .04).setMass(180).setFriction(.035).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setRestitution(.08), body);
    return { body, collider, previousPosition: v3(body.translation()), previousRotation: new Quaternion().copy(body.rotation()), boost: 100, grounded: false, groundNormal: UP.clone(), wheels: 0, jumpCount: 0, airTime: 0, jumpTime: 0, flipTime: 0, flipAxis: new Vector3(), flipRotation: new Quaternion(), pitchLock: 0, boosting: false, speed: 0, supersonic: false, supersonicGrace: 0, touchCooldown: 0, resetCooldown: 0, demolished: 0, steer: 0, drifting: false, throttle: 0, recoveryTime: 0, recoveryStart: new Quaternion(), recoveryTarget: new Quaternion(), blastTime: 0 };
  }
  resetCar(car: Car, x = 0, z = car === this.player ? 29 : -29, yaw = car === this.player ? 0 : Math.PI) {
    car.body.setEnabled(car !== this.bot || this.botEnabled);
    car.body.setTranslation({ x, y: .38, z }, true);
    car.body.setRotation(new Quaternion().setFromAxisAngle(UP, yaw), true);
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    car.body.resetForces(true);
    car.previousPosition.copy(car.body.translation()); car.previousRotation.copy(car.body.rotation());
    car.groundNormal.copy(UP);
    Object.assign(car, { speed: 0, supersonic: false, supersonicGrace: 0, steer: 0, drifting: false, throttle: 0, boosting: false, grounded: false, wheels: 0, touchCooldown: 0, boost: 100, jumpCount: 0, airTime: 0, jumpTime: 0, flipTime: 0, pitchLock: 0, recoveryTime: 0, demolished: 0, resetCooldown: 0, blastTime: 0 });
  }
  reset() {
    this.resetCar(this.player); this.resetCar(this.bot);
    this.ball.setEnabled(true);
    this.ball.setTranslation({ x: 0, y: FIELD.ballRadius + .08, z: 0 }, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.ballPreviousPosition.copy(this.ball.translation()); this.ballPreviousRotation.copy(this.ball.rotation());
    for (const pad of this.pads) pad.cooldown = 0;
  }
  demolish(car: Car) {
    if (car.demolished > 0) return;
    car.demolished = 2.5;
    car.supersonic = false; car.supersonicGrace = 0;
    this.onDemo(car);
    // Keep its last world pose for the respawn camera. Parking a live body
    // below the floor pulled the camera through the arena and into geometry.
    car.body.setEnabled(false); car.boosting = false; car.grounded = false; car.wheels = 0;
  }
  goalBlast(origin: Vector3) {
    for (const car of [this.player, ...(this.botEnabled ? [this.bot] : [])]) {
      if (car.demolished > 0) continue;
      const away = v3(car.body.translation()).sub(origin), distance = away.length();
      const strength = 34 / (1 + (distance / 12) ** 2) * (1 - MathUtils.smoothstep(distance, 32, 48));
      if (strength < .05) continue;
      // Lift cars clear of the turf; the horizontal direction still radiates
      // from the explosion, including cars inside the goal.
      if (away.lengthSq() < .001) away.set(0, 0, -Math.sign(origin.z) || 1);
      away.normalize(); away.y = Math.max(.38, away.y + .55); away.normalize();
      car.body.applyImpulse(away.clone().multiplyScalar(strength * car.body.mass()), true);
      car.body.setAngvel(new Vector3(away.z * 2, away.x * .8, -away.x * 2).multiplyScalar(Math.min(1, strength / 18)), true);
      car.flipTime = car.recoveryTime = car.pitchLock = car.jumpTime = 0;
      car.blastTime = .18; car.grounded = false; car.wheels = 0;
    }
  }
  groundBelow(position: Vector3) {
    const ray = new RAPIER.Ray(position, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRayAndGetNormal(ray, FIELD.height + 2, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
    if (!hit) return { position: new Vector3(position.x, 0, position.z), normal: UP.clone() };
    return { position: new Vector3(position.x, position.y - hit.timeOfImpact, position.z), normal: v3(hit.normal) };
  }
  cameraClearance(origin: Vector3, target: Vector3) {
    const direction = target.clone().sub(origin), distance = direction.length();
    if (distance < .001) return distance;
    const hit = this.world.castRay(new RAPIER.Ray(origin, direction.divideScalar(distance)), distance, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, undefined, undefined, undefined, collider => this.cameraSolids.has(collider.handle));
    return hit ? Math.max(.12, hit.timeOfImpact - .22) : distance;
  }
  updateCar(car: Car, input: Input, dt: number) {
    const wasGrounded = car.grounded;
    car.steer = input.steer; car.drifting = input.drift; car.throttle = input.throttle;
    car.pitchLock = Math.max(0, car.pitchLock - dt);
    if (car.demolished > 0) { car.demolished -= dt; if (car.demolished <= 0) this.resetCar(car, car === this.player ? -20 : 20); return; }
    const body = car.body, pos = v3(body.translation()), q = new Quaternion().copy(body.rotation());
    car.blastTime = Math.max(0, car.blastTime - dt);
    const up = UP.clone().applyQuaternion(q), forward = new Vector3(0, 0, -1).applyQuaternion(q), right = new Vector3(1, 0, 0).applyQuaternion(q);
    let velocity = v3(body.linvel());
    body.resetForces(true); body.resetTorques(true);
    let contacts = 0, ballContacts = 0;
    const normal = new Vector3();
    if (car.blastTime <= 0) for (const x of [-.375, .375]) for (const z of [-.475, .475]) {
      const origin = new Vector3(x, -.03, z).applyQuaternion(q).add(pos);
      const ray = new RAPIER.Ray(origin, up.clone().negate());
      const hit = this.world.castRayAndGetNormal(ray, .62, true, undefined, undefined, car.collider, body);
      if (hit && hit.collider.handle === this.ballCollider.handle && hit.timeOfImpact < .60 && v3(hit.normal).dot(up) > .25) ballContacts++;
      if (hit && hit.timeOfImpact < .425 && v3(hit.normal).dot(up) > .25) {
        contacts++; normal.add(v3(hit.normal));
        const compression = .305 - hit.timeOfImpact;
        // Suspension pushes the chassis away from the surface; it cannot pull
        // the car back onto a ceiling as an extended spring would.
        const contactNormal = v3(hit.normal);
        const support = Math.max(0, 180 * CAR.gravity / 4 * Math.max(0, contactNormal.y) + compression * 10000 - velocity.dot(contactNormal) * 620);
        if (car.jumpTime <= 0 && car.flipTime <= 0 && !input.jump) body.addForce(contactNormal.multiplyScalar(support), true);
      }
    }
    car.wheels = contacts;
    if (contacts >= 3 && car.flipTime > 0 && up.y > .65 && car.airTime > .08) car.flipTime = 0;
    car.grounded = contacts >= 2 && car.jumpTime <= 0 && car.flipTime <= 0;
    if (car.grounded && !wasGrounded && car.airTime > .1) {
      const impact = Math.max(0, -velocity.dot(normal.clone().normalize()));
      if (impact > 1.5) this.onLand(car, impact);
    }
    if (contacts > 0 && car.jumpTime <= 0 && car.flipTime <= 0 && !input.jump) {
      // RocketSim _UpdateWheels: half gravity of baseline adhesion, with an
      // orientation-dependent extra force on walls while driving. On a flat
      // ceiling only 0.5 g remains, so gravity always wins. Entry momentum and
      // tangential speed determine the distance traveled before wheel release.
      const contactNormal = normal.clone().normalize();
      const moving = Math.abs(input.throttle) > .001 || input.boost || Math.abs(velocity.dot(forward)) > .25;
      const stick = .5 + (moving ? 1 - Math.abs(contactNormal.y) : 0);
      body.addForce(contactNormal.multiplyScalar(-180 * CAR.gravity * stick), true);
    }
    car.resetCooldown = Math.max(0, car.resetCooldown - dt);
    if (ballContacts === 4 && car.resetCooldown === 0 && car.jumpCount > 0) {
      car.jumpCount = 0; car.airTime = 0; car.resetCooldown = .7;
      if (car === this.player) this.onFlipReset();
    }
    car.speed = velocity.length();
    // RL's trail activates at 2200 uu/s and has a one-second grace band down
    // to 2100 uu/s, preventing flicker when speed briefly dips in a turn.
    car.supersonicGrace = car.speed >= CAR.supersonic ? 1 : car.speed < CAR.supersonic - 1 ? 0 : Math.max(0, car.supersonicGrace - dt);
    car.supersonic = car.supersonicGrace > 0;
    car.boosting = input.boost && (car.boost > 0 || (this.unlimited && car === this.player));
    // RocketSim _UpdateWheels forces full throttle while boosting. Do not
    // apply coasting resistance just because the accelerator is released.
    const throttle = car.boosting ? 1 : input.throttle;
    body.setLinearDamping(car.grounded ? 0 : .015);
    const signedSpeed = velocity.dot(forward);
    if (car.grounded) {
      car.airTime = 0; car.jumpCount = 0; car.pitchLock = 0;
      normal.normalize();
      // Roll momentum around a continuous surface instead of repeatedly
      // projecting it away at each ramp facet. Landing/jumping never converts
      // impact velocity into forward speed.
      if (wasGrounded && !input.jump && ballContacts === 0 && car.groundNormal.dot(normal) > .8) {
        velocity.applyQuaternion(new Quaternion().setFromUnitVectors(car.groundNormal, normal));
      }
      car.groundNormal.copy(normal);
      const heading = forward.clone().projectOnPlane(normal).normalize();
      const sideways = new Vector3().crossVectors(heading, normal).normalize();
      const target = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(sideways, normal, heading.clone().negate()));
      q.slerp(target, 1 - Math.exp(-28 * dt));
      body.setRotation(q, true);
      // Steering follows tire travel: zero yaw at rest, gradually increasing
      // through walking speed, and reversed naturally when rolling backward.
      const rollingForwardSpeed = velocity.dot(heading);
      const turn = input.steer * MathUtils.clamp(rollingForwardSpeed / 3.5, -1, 1) * 2.1 * (input.drift ? 1.5 : 1);
      body.setAngvel(normal.clone().multiplyScalar(turn), true);
      const grip = input.drift ? 1.65 : 9.5;
      const normalSpeed = velocity.dot(normal), tangent = velocity.clone().addScaledVector(normal, -normalSpeed), rollingSpeed = tangent.length();
      tangent.addScaledVector(sideways, -tangent.dot(sideways) * Math.min(1, grip * dt));
      // Tire grip mostly redirects rolling momentum. A small scrub loss
      // remains, while powersliding retains more of an angled landing.
      if (tangent.lengthSq() > .001) tangent.setLength(MathUtils.lerp(tangent.length(), rollingSpeed, input.drift ? .97 : .88));
      velocity.copy(tangent).addScaledVector(normal, normalSpeed);
      if (throttle) {
        const braking = signedSpeed * throttle < -.5, speed = Math.abs(signedSpeed);
        // Reference throttle curve: 1600 -> 160 uu/s² over 0 -> 1400 uu/s,
        // then zero at 1410. Boost remains additive above that speed.
        const acceleration = speed < 14 ? 16 - speed * (14.4 / 14) : Math.max(0, (CAR.driveSpeed - speed) * 16);
        velocity.addScaledVector(forward, throttle * (braking ? 35 : acceleration) * dt);
      } else velocity.addScaledVector(forward, -Math.sign(signedSpeed) * Math.min(Math.abs(signedSpeed), 3.1 * dt));
    } else {
      car.airTime += dt;
      if (car.flipTime <= 0) {
        // RocketSim's measured torque/damping, integrated in car-local axes.
        // Roll reaches the 5.5 rad/s cap in ~0.24 s (one sustained turn: 1.14 s).
        const angular = v3(body.angvel()).applyQuaternion(q.clone().invert());
        const pitch = car.pitchLock > 0 ? 0 : input.pitch;
        const scale = 2 * Math.PI / 65536 * 1000;
        angular.x += (pitch * 130 - angular.x * 30 * (1 - Math.abs(pitch))) * scale * dt;
        const yaw = input.yaw ?? input.steer;
        angular.y += (yaw * 95 - angular.y * 20 * (1 - Math.abs(yaw))) * scale * dt;
        angular.z += (-input.roll * 400 - angular.z * 50) * scale * dt;
        if (car.pitchLock > 0) angular.x = 0;
        if (angular.length() > 5.5) angular.setLength(5.5);
        body.setAngvel(angular.applyQuaternion(q), true);
      }
    }
    // Jump on the roof starts a short self-righting hop. The surface test
    // prevents a midair inverted car or a ceiling ride from triggering it.
    if (input.jump && car.recoveryTime <= 0 && !car.grounded && up.y < -.7) {
      const surface = this.groundBelow(pos);
      if (pos.y - surface.position.y < .32 && surface.normal.y > Math.SQRT1_2 && Math.abs(velocity.y) < 1.5) {
        const heading = forward.clone().projectOnPlane(surface.normal).normalize();
        const sideways = new Vector3().crossVectors(heading, surface.normal).normalize();
        car.recoveryStart.copy(q);
        car.recoveryTarget.setFromRotationMatrix(new Matrix4().makeBasis(sideways, surface.normal, heading.negate()));
        car.recoveryTime = .4; car.flipTime = 0; car.jumpTime = 0; car.jumpCount = 2;
        velocity.addScaledVector(up, -2); body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    if (input.jump && car.recoveryTime <= 0) {
      if (car.grounded) {
        velocity.addScaledVector(up, CAR.jumpSpeed); car.jumpCount = 1; car.jumpTime = .2; car.grounded = false;
        this.onJump(car, false);
      } else if (car.jumpCount < 2 && (car.airTime < 1.45 || car.jumpCount === 0)) {
        car.jumpCount = 2;
        const dodgeForward = input.dodgeForward ?? input.throttle, dodgeSide = input.dodgeSide ?? input.steer;
        if (Math.abs(dodgeForward) + Math.abs(dodgeSide) > .1) {
          const direction = forward.clone().multiplyScalar(dodgeForward).addScaledVector(right, -dodgeSide).normalize();
          velocity.addScaledVector(direction, 5); velocity.y = Math.max(velocity.y, 1.3);
          car.flipAxis.copy(new Vector3(-dodgeForward, 0, dodgeSide).normalize()); car.flipRotation.copy(q); car.flipTime = .65;
        } else velocity.addScaledVector(up, CAR.jumpSpeed);
        this.onJump(car, car.flipTime > 0);
      }
    }
    if (car.jumpTime > 0) { if (input.jumpHeld) velocity.addScaledVector(up, CAR.jumpHoldAcceleration * dt); car.jumpTime -= dt; }
    if (car.flipTime > 0) {
      if (input.pitch * car.flipAxis.x < -.3 && car.flipTime < .45) {
        car.flipTime = 0; car.pitchLock = 0; body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      } else {
        // A bounded rotation prevents residual angular velocity adding a second
        // fraction of a flip. Translational momentum and collision remain live.
        car.flipTime = Math.max(0, car.flipTime - dt);
        const progress = 1 - car.flipTime / .65;
        const rotation = car.flipRotation.clone().multiply(new Quaternion().setFromAxisAngle(car.flipAxis, progress * Math.PI * 2));
        body.setRotation(rotation, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        if (car.flipTime < 1e-7) { car.flipTime = 0; car.pitchLock = .3; body.setRotation(car.flipRotation, true); }
      }
    }
    if (car.recoveryTime > 0) {
      car.recoveryTime = Math.max(0, car.recoveryTime - dt);
      const t = 1 - car.recoveryTime / .4;
      body.setRotation(car.recoveryStart.clone().slerp(car.recoveryTarget, t * t * (3 - 2 * t)), true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true); car.grounded = false;
    }
    if (car.boosting) {
      velocity.addScaledVector(forward, (car.grounded ? CAR.boostGroundAcceleration : CAR.boostAirAcceleration) * dt);
      car.boost = this.unlimited && car === this.player ? 100 : Math.max(0, car.boost - CAR.boostDrain * dt);
    }
    if (velocity.length() > CAR.maxSpeed) velocity.setLength(CAR.maxSpeed);
    body.setLinvel(velocity, true);
    if (pos.y < -5 || Math.abs(pos.x) > FIELD.width + 8 || Math.abs(pos.z) > FIELD.length + 12) this.resetCar(car);
    // Recover an overturned stationary car without disturbing deliberate aerials.
    if (pos.y < .35 && up.y < .25 && car.speed < 1 && car.airTime > 1.2 && input.throttle !== 0) {
      body.setRotation(new Quaternion().setFromAxisAngle(UP, Math.atan2(-forward.x, -forward.z)), true);
      body.setTranslation({ x: pos.x, y: .5, z: pos.z }, true);
    }
  }
  step(input: Input, botInput: Input, dt = STEP) {
    for (const car of [this.player, this.bot]) { car.previousPosition.copy(car.body.translation()); car.previousRotation.copy(car.body.rotation()); }
    this.ballPreviousPosition.copy(this.ball.translation()); this.ballPreviousRotation.copy(this.ball.rotation());
    const incomingBallVelocity = v3(this.ball.linvel());
    this.updateCar(this.player, input, dt);
    if (this.botEnabled) this.updateCar(this.bot, botInput, dt);
    this.incomingCarVelocities[0].copy(this.player.body.linvel());
    this.incomingCarVelocities[1].copy(this.bot.body.linvel());
    this.bot.body.setEnabled(this.botEnabled && this.bot.demolished <= 0);
    this.world.step();
    if (this.ball.isEnabled()) {
      const impact = v3(this.ball.linvel()).sub(incomingBallVelocity).length();
      if (impact > 2) {
        let arenaContact = false;
        this.world.contactPairsWith(this.ballCollider, other => { if (!other.parent()) arenaContact = true; });
        if (arenaContact) this.onBounce(v3(this.ball.translation()), impact);
      }
    }
    for (const car of [this.player, ...(this.botEnabled ? [this.bot] : [])]) {
      car.touchCooldown = Math.max(0, car.touchCooldown - dt);
      let touching = false;
      this.world.contactPair(car.collider, this.ballCollider, manifold => { if (manifold.numContacts() > 0) touching = true; });
      if (touching && car.touchCooldown === 0) {
        const delta = v3(this.ball.translation()).sub(v3(car.body.translation())).normalize();
        const speed = v3(car.body.linvel()).length();
        const impulse = delta.clone().multiplyScalar(30 * (1.3 + speed * .26));
        impulse.y += 17.5 + speed * .9;
        this.ball.applyImpulse(impulse, true);
        // Trim the velocity gained from a gentle touch, preserving incoming
        // ball momentum and the existing power of fast hits. Only head-on,
        // grounded touches receive the very small extra reduction in lift.
        const strength = .9 + .1 * MathUtils.smoothstep(speed, 3, 11);
        const gain = v3(this.ball.linvel()).sub(incomingBallVelocity).multiplyScalar(strength);
        const forward = new Vector3(0, 0, -1).applyQuaternion(car.body.rotation());
        if (car.grounded && delta.dot(forward) > .65 && gain.y > 0) gain.y *= .96;
        this.ball.setLinvel(incomingBallVelocity.clone().add(gain), true);
        incomingBallVelocity.copy(this.ball.linvel());
        // Keep a fast, square hit from draining the car's entire speed margin.
        // Restore part of the forward loss only at high speed, after computing
        // the ball response, so gentle touches and ball power stay unchanged.
        const incoming = this.incomingCarVelocities[car === this.player ? 0 : 1];
        if (car.grounded && delta.dot(forward) > .65) {
          const retained = .75 * MathUtils.smoothstep(incoming.length(), 15, CAR.supersonic);
          const current = v3(car.body.linvel()), loss = Math.max(0, incoming.dot(forward) - current.dot(forward));
          current.addScaledVector(forward, loss * retained);
          car.body.setLinvel(current, true);
        }
        car.touchCooldown = .18;
        this.onHit(v3(this.ball.translation()), speed, car === this.player);
      }
      if (car.demolished <= 0) for (const pad of this.pads) {
        const p = car.body.translation();
        if (pad.cooldown <= 0 && p.y < 1.1 && Math.hypot(p.x - pad.x, p.z - pad.z) < (pad.big ? 1.1 : .8) && car.boost < 100) {
          car.boost = Math.min(100, car.boost + (pad.big ? 100 : 12)); pad.cooldown = pad.big ? 10 : 4;
          if (car === this.player) this.onPad(pad.big);
        }
      }
    }
    if (this.ball.isEnabled() && this.botEnabled && this.player.demolished <= 0 && this.bot.demolished <= 0) {
      let victim: Car | undefined;
      this.world.contactPair(this.player.collider, this.bot.collider, m => {
        const attacker = this.player.speed > this.bot.speed ? this.player : this.bot;
        if (m.numContacts() && attacker.supersonic) victim = attacker === this.player ? this.bot : this.player;
      });
      if (victim) this.demolish(victim);
    }
    const bv = v3(this.ball.linvel()); if (bv.length() > 60) this.ball.setLinvel(bv.setLength(60), true);
    const angular = v3(this.ball.angvel()); if (angular.length() > 6) this.ball.setAngvel(angular.setLength(6), true);
    for (const pad of this.pads) pad.cooldown = Math.max(0, pad.cooldown - dt);
  }
  goal(): 'blue' | 'orange' | null {
    if (!this.ball.isEnabled()) return null;
    const p = this.ball.translation(), r = FIELD.ballRadius;
    if (Math.abs(p.x) + r > FIELD.goalWidth || p.y + r > goalArchHeight(p.x)) return null;
    if (p.z < -FIELD.length - r) return 'blue';
    if (p.z > FIELD.length + r) return 'orange';
    return null;
  }
}
