import { MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { FIELD } from './config';

const UP = new Vector3(0, 1, 0);
const shortest = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
// Analytic critically damped spring: the same response at 30, 60 or 144 Hz.
function spring(value: number, velocity: number, target: number, frequency: number, dt: number) {
  const offset = value - target, step = (velocity + frequency * offset) * dt, decay = Math.exp(-frequency * dt);
  return [target + (offset + step) * decay, (velocity - frequency * step) * decay];
}
export class FollowCamera {
  forward = new Vector3(0, 0, -1);
  look = new Vector3();
  private yaw = 0;
  private yawVelocity = 0;
  private distance = 5;
  private distanceVelocity = 0;
  private mode = 0;
  private clearance = 20;
  private aim = new Quaternion();
  private matrix = new Matrix4();
  update(camera: PerspectiveCamera, pos: Vector3, rotation: Quaternion, ball: Vector3, speed: number, ballCam: boolean, flipping: boolean, dt: number, reset: boolean, clear: (from: Vector3, to: Vector3) => number) {
    if (!reset && dt <= 0) return;
    const carForward = new Vector3(0, 0, -1).applyQuaternion(rotation); carForward.y = 0;
    if (carForward.lengthSq() < .1 || flipping) carForward.copy(this.forward); else carForward.normalize();
    const carYaw = Math.atan2(-carForward.x, -carForward.z), toBall = ball.clone().sub(pos);
    const planarDistance = Math.hypot(toBall.x, toBall.z);
    if (reset) { this.yaw = carYaw; this.mode = ballCam ? 1 : 0; this.yawVelocity = this.distanceVelocity = 0; }
    else this.mode = MathUtils.damp(this.mode, ballCam ? 1 : 0, 8, dt);
    // Retain the orbit heading directly underneath the ball; there is no
    // meaningful horizontal direction there. Never lerp antiparallel vectors.
    const ballYaw = planarDistance > .65 ? Math.atan2(-toBall.x, -toBall.z) : this.yaw;
    const stableBallYaw = this.yaw + shortest(ballYaw - this.yaw) * MathUtils.smoothstep(planarDistance, .65, 2.2);
    let desiredYaw = carYaw + shortest(stableBallYaw - carYaw) * this.mode;
    const baseDistance = 4.9 + speed * .025;
    const probe = (yaw: number) => pos.clone().add(new Vector3(Math.sin(yaw) * baseDistance, 2.05, Math.cos(yaw) * baseDistance));
    const directClearance = clear(pos, probe(desiredYaw));
    if (directClearance < baseDistance * .95) {
      // Begin orbiting before a solid ramp reaches the camera. Choose the
      // nearest clear arc, retaining the current side when both are possible.
      const preferredSide = shortest(this.yaw - desiredYaw) < 0 ? -1 : 1;
      let safeYaw = desiredYaw, bestClearance = directClearance;
      search: for (let angle = Math.PI / 12; angle <= Math.PI * .75; angle += Math.PI / 12) for (const sign of [preferredSide, -preferredSide]) {
        const candidate = desiredYaw + sign * angle, available = clear(pos, probe(candidate));
        if (available > bestClearance) { bestClearance = available; safeYaw = candidate; }
        if (available >= baseDistance * .95) break search;
      }
      const blend = 1 - MathUtils.smoothstep(directClearance, baseDistance * .25, baseDistance * .95);
      desiredYaw += shortest(safeYaw - desiredYaw) * blend;
    }
    if (reset) this.yaw = desiredYaw;
    else {
      const [yaw, velocity] = spring(this.yaw, this.yawVelocity, this.yaw + shortest(desiredYaw - this.yaw), 11, dt);
      this.yaw += MathUtils.clamp(yaw - this.yaw, -4 * dt, 4 * dt);
      this.yawVelocity = MathUtils.clamp(velocity, -4, 4);
    }
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const height = 2.05;
    const carFocus = pos.clone().addScaledVector(UP, .2);
    // Fit the angular span of car and ball, rather than capping the look target
    // a few metres above the car. The full-height ball can now stay in frame.
    const elevation = Math.atan2(Math.max(0, toBall.y), Math.max(.1, planarDistance));
    const overheadFov = 8 * MathUtils.smoothstep(elevation, .55, 1.3) * this.mode;
    const baseFov = (camera.aspect < 1.3 ? 78 : 69) + Math.max(0, speed - 14) * .6 + overheadFov;
    const vertical = MathUtils.degToRad(baseFov), horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
    const available = Math.min(vertical, horizontal) * .80;
    let fit = baseDistance;
    if (this.mode > .001) for (; fit < 16.5; fit += .4) {
      const eye = pos.clone().addScaledVector(this.forward, -fit).addScaledVector(UP, height);
      const a = carFocus.clone().sub(eye), b = ball.clone().sub(eye);
      const span = a.angleTo(b) + Math.asin(Math.min(.9, .8 / a.length())) + Math.asin(Math.min(.9, FIELD.ballRadius / b.length()));
      if (span < available) break;
    }
    const desiredDistance = MathUtils.lerp(baseDistance, fit, this.mode);
    if (reset) this.distance = desiredDistance;
    else [this.distance, this.distanceVelocity] = spring(this.distance, this.distanceVelocity, desiredDistance, 10, dt);
    let desired = pos.clone().addScaledVector(this.forward, -this.distance).addScaledVector(UP, height);
    desired.y = MathUtils.clamp(desired.y, .7, FIELD.height - .4);
    // Sweep from the car through opaque floor and ramp collision meshes.
    // The transparent wall/ceiling cage must not pin the lens against a car. This
    // replaces the discontinuous wall-side and height switches with continuous
    // shortening, and releases the camera smoothly after an obstruction.
    const offset = desired.clone().sub(pos), length = offset.length();
    const limit = clear(pos, desired);
    if (reset || limit < this.clearance) this.clearance = limit;
    else this.clearance = MathUtils.damp(this.clearance, limit, 6, dt);
    desired = pos.clone().addScaledVector(offset, Math.min(length, this.clearance) / length);
    camera.position.copy(desired);
    const chaseTarget = pos.clone().addScaledVector(this.forward, 3.75).addScaledVector(UP, .625);
    const chase = chaseTarget.sub(desired).normalize();
    const carDirection = carFocus.clone().sub(desired).normalize(), ballDirection = ball.clone().sub(desired).normalize();
    const span = carDirection.angleTo(ballDirection);
    // When a wall prevents backing up far enough, prioritize keeping the ball
    // in view. Otherwise the car sits below the ball with comfortable margins.
    const weight = Math.max(.54, 1 - available * .44 / Math.max(.001, span));
    const ballAim = carDirection.lerp(ballDirection, weight).normalize();
    const chaseRotation = new Quaternion().setFromRotationMatrix(this.matrix.lookAt(desired, desired.clone().add(chase), UP));
    const ballRotation = new Quaternion().setFromRotationMatrix(this.matrix.lookAt(desired, desired.clone().add(ballAim), UP));
    const targetRotation = chaseRotation.slerp(ballRotation, this.mode);
    if (reset) this.aim.copy(targetRotation);
    else {
      const angle = this.aim.angleTo(targetRotation);
      this.aim.slerp(targetRotation, Math.min(1 - Math.exp(-15 * dt), 6 * dt / Math.max(.001, angle)));
    }
    camera.quaternion.copy(this.aim);
    this.look.copy(desired).add(new Vector3(0, 0, -1).applyQuaternion(this.aim).multiplyScalar(8));
    camera.fov = reset ? baseFov : MathUtils.damp(camera.fov, baseFov, 5, dt);
    camera.updateProjectionMatrix();
  }
}
