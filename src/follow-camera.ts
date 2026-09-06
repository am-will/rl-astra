import { MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { loadCameraSettings } from './camera-settings';
import { FIELD } from './config';

const UP = new Vector3(0, 1, 0);
const shortest = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
// Analytic critically damped spring: the same response at 30, 60 or 144 Hz.
function spring(value: number, velocity: number, target: number, frequency: number, dt: number) {
  const offset = value - target, step = (velocity + frequency * offset) * dt, decay = Math.exp(-frequency * dt);
  return [target + (offset + step) * decay, (velocity - frequency * step) * decay];
}
// Limit the aim in screen space, leaving room for the car around its focus.
// If the selected lens is too tight for the whole car, keep its center visible.
function frameCar(aim: Quaternion, carAim: Quaternion, direction: Vector3, horizontal: number, vertical: number, distance: number) {
  const padding = Math.asin(Math.min(1, 1.1 / distance));
  const xLimit = Math.tan(Math.max(0, horizontal * .45 - padding));
  const yLimit = Math.tan(Math.max(0, vertical * .45 - padding));
  const local = new Vector3(), inverse = new Quaternion();
  const fits = (rotation: Quaternion) => {
    local.copy(direction).applyQuaternion(inverse.copy(rotation).invert());
    return local.z < 0 && Math.abs(local.x) <= -local.z * xLimit + 1e-9 && Math.abs(local.y) <= -local.z * yLimit + 1e-9;
  };
  if (fits(aim)) return;
  const candidate = new Quaternion();
  let low = 0, high = 1;
  for (let i = 0; i < 12; i++) {
    const weight = (low + high) / 2;
    candidate.copy(carAim).slerp(aim, weight);
    if (fits(candidate)) low = weight; else high = weight;
  }
  aim.copy(candidate.copy(carAim).slerp(aim, low));
}
// Fit a sphere around each subject inside the smaller dimension of the lens.
// At extreme user zooms a subject can fill the lens; retain its center.
function framing(eye: Vector3, car: Vector3, ball: Vector3, halfFov: number) {
  const carDirection = car.clone().sub(eye), ballDirection = ball.clone().sub(eye);
  const carLimit = Math.max(0, halfFov - Math.asin(Math.min(1, 1.1 / carDirection.length())));
  const ballLimit = Math.max(0, halfFov - Math.asin(Math.min(1, FIELD.ballRadius / ballDirection.length())));
  carDirection.normalize(); ballDirection.normalize();
  const span = carDirection.angleTo(ballDirection);
  return { carDirection, ballDirection, carLimit, ballLimit, span, fits: span <= carLimit + ballLimit };
}

function frameBall(aim: Quaternion, safeAim: Quaternion, car: Vector3, ball: Vector3, carLimit: number, ballLimit: number, fitCar: boolean) {
  const forward = new Vector3();
  const fits = (q: Quaternion) => {
    forward.set(0, 0, -1).applyQuaternion(q);
    return (!fitCar || forward.angleTo(car) <= carLimit + 1e-6) && forward.angleTo(ball) <= ballLimit + 1e-6;
  };
  if (fits(aim)) return;
  const candidate = new Quaternion();
  let low = 0, high = 1;
  for (let i = 0; i < 14; i++) {
    const weight = (low + high) / 2;
    if (fits(candidate.copy(safeAim).slerp(aim, weight))) low = weight; else high = weight;
  }
  aim.copy(candidate.copy(safeAim).slerp(aim, low));
}
export class FollowCamera {
  settings = loadCameraSettings();
  forward = new Vector3(0, 0, -1);
  look = new Vector3();
  private yaw = 0;
  private yawVelocity = 0;
  private lookYaw = 0;
  private lookVelocity = 0;
  private lookWeight = 0;
  private lookWeightVelocity = 0;
  private distance = 5;
  private distanceVelocity = 0;
  private mode = 0;
  private previousMode = false;
  private switchTime = 0;
  private clearance = 1;
  private aim = new Quaternion();
  private matrix = new Matrix4();
  update(camera: PerspectiveCamera, pos: Vector3, rotation: Quaternion, ball: Vector3, speed: number, ballCam: boolean, flipping: boolean, dt: number, reset: boolean, clear: (from: Vector3, to: Vector3) => number, lookInput = 0) {
    if (!reset && dt <= 0) return;
    const look = Number.isFinite(lookInput) ? MathUtils.clamp(lookInput, -1, 1) : 0;
    const targetLook = -look * Math.PI;
    // Keep a signed offset instead of wrapping at PI: each stick direction
    // travels through its own side and returns along that side on release.
    const looking = Math.abs(look) >= .001 ? 1 : 0;
    if (reset) { this.lookYaw = targetLook; this.lookWeight = looking; this.lookVelocity = this.lookWeightVelocity = 0; }
    else {
      [this.lookYaw, this.lookVelocity] = spring(this.lookYaw, this.lookVelocity, targetLook, 14, dt);
      [this.lookWeight, this.lookWeightVelocity] = spring(this.lookWeight, this.lookWeightVelocity, looking, 14, dt);
    }
    if (reset) { this.previousMode = ballCam; this.switchTime = 0; }
    else if (ballCam !== this.previousMode) { this.previousMode = ballCam; this.switchTime = .65; }
    const response = this.switchTime > 0 ? 2 : 1;
    this.switchTime = Math.max(0, this.switchTime - dt);
    const carForward = new Vector3(0, 0, -1).applyQuaternion(rotation); carForward.y = 0;
    if (carForward.lengthSq() < .1 || flipping) carForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); else carForward.normalize();
    const carYaw = Math.atan2(-carForward.x, -carForward.z), toBall = ball.clone().sub(pos);
    const planarDistance = Math.hypot(toBall.x, toBall.z);
    if (reset) { this.yaw = carYaw; this.mode = ballCam ? 1 : 0; this.yawVelocity = this.distanceVelocity = 0; }
    else this.mode = MathUtils.damp(this.mode, ballCam ? 1 : 0, 8 * response, dt);
    // Retain the orbit heading directly underneath the ball; there is no
    // meaningful horizontal direction there. Never lerp antiparallel vectors.
    const ballYaw = planarDistance > .65 ? Math.atan2(-toBall.x, -toBall.z) : this.yaw;
    const stableBallYaw = this.yaw + shortest(ballYaw - this.yaw) * MathUtils.smoothstep(planarDistance, .65, 2.2);
    let desiredYaw = carYaw + shortest(stableBallYaw - carYaw) * this.mode;
    const baseDistance = this.settings.distance + speed * .025;
    const probe = (yaw: number) => pos.clone().add(new Vector3(Math.sin(yaw) * baseDistance, this.settings.height, Math.cos(yaw) * baseDistance));
    const directClearance = clear(pos, probe(desiredYaw));
    if (directClearance < baseDistance * .95) {
      // Only solid ground can obstruct the lens. Arena walls and ramps allow
      // the intended orbit to continue outside their transparent back faces.
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
      const [yaw, velocity] = spring(this.yaw, this.yawVelocity, this.yaw + shortest(desiredYaw - this.yaw), 11 * response, dt);
      this.yaw += MathUtils.clamp(yaw - this.yaw, -4 * response * dt, 4 * response * dt);
      this.yawVelocity = MathUtils.clamp(velocity, -4 * response, 4 * response);
    }
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const height = this.settings.height;
    const carFocus = pos.clone().addScaledVector(UP, .2);
    // Mode switches change the orbit and aim, never the lens or its distance.
    // Speed response is shared too, including while the focus is transitioning.
    const baseFov = this.settings.fov + (camera.aspect < 1.3 ? 9 : 0) + Math.max(0, speed - 14) * .6;
    camera.fov = reset ? baseFov : MathUtils.damp(camera.fov, baseFov, 5, dt);
    const vertical = MathUtils.degToRad(camera.fov), horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
    if (reset) this.distance = baseDistance;
    else [this.distance, this.distanceVelocity] = spring(this.distance, this.distanceVelocity, baseDistance, 10, dt);
    let desired = pos.clone().addScaledVector(this.forward, -this.distance).addScaledVector(UP, height);
    desired.y = MathUtils.clamp(desired.y, .7, FIELD.height - .4);
    const offset = desired.clone().sub(pos), length = offset.length(), limit = Math.min(1, clear(pos, desired) / length);
    if (reset || limit < this.clearance) this.clearance = limit;
    else this.clearance = MathUtils.damp(this.clearance, limit, 6, dt);
    desired = pos.clone().addScaledVector(offset, this.clearance);
    // Keep the normal boom above the floor in both modes. A high ball can
    // take the grounded car out of view; never swing underneath the field
    // just to fit both subjects.
    desired.y = MathUtils.clamp(desired.y, .7, FIELD.height - .4);
    const halfFov = Math.min(vertical, horizontal) * .43;
    camera.position.copy(desired);
    const carDirection = carFocus.clone().sub(desired).normalize(), ballDirection = ball.clone().sub(desired).normalize();
    // Honor the selected pitch where it fits, but aim toward the car when a
    // narrow FOV would otherwise crop it out. This never moves the lens.
    const carPitch = Math.asin(MathUtils.clamp(-carDirection.y, -1, 1));
    const pitch = MathUtils.clamp(MathUtils.degToRad(this.settings.angle), carPitch - vertical * .28, carPitch + vertical * .28);
    const chase = this.forward.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(UP, -Math.sin(pitch));
    const pair = framing(desired, carFocus, ball, halfFov);
    // Prefer a shared view, including when the car rises toward the ball.
    // When the lens cannot fit both, the ball's visibility takes priority.
    const aimAngle = Math.max(0, pair.span - pair.ballLimit, Math.min(pair.carLimit, pair.span * (.54 + (10 - this.settings.angle) * .008)));
    const turnToBall = new Quaternion().setFromUnitVectors(carDirection, ballDirection);
    const ballAim = carDirection.clone().applyQuaternion(new Quaternion().slerp(turnToBall, pair.span > 1e-6 ? aimAngle / pair.span : 0));
    const carRotation = new Quaternion().setFromRotationMatrix(this.matrix.lookAt(desired, carFocus, UP));
    const chaseRotation = new Quaternion().setFromRotationMatrix(this.matrix.lookAt(desired, desired.clone().add(chase), UP));
    const ballRotation = new Quaternion().setFromRotationMatrix(this.matrix.lookAt(desired, desired.clone().add(ballAim), UP));
    const focusDistance = carFocus.distanceTo(desired);
    frameCar(chaseRotation, carRotation, carDirection, horizontal, vertical, focusDistance);
    const targetRotation = chaseRotation.slerp(ballRotation, this.mode);
    if (reset) this.aim.copy(targetRotation);
    else {
      const angle = this.aim.angleTo(targetRotation);
      this.aim.slerp(targetRotation, Math.min(1 - Math.exp(-15 * response * dt), 6 * response * dt / Math.max(.001, angle)));
    }
    // A moving car, changing lens or orbit can invalidate last frame's aim.
    // Enforce the limit after smoothing as well, and retain that corrected aim.
    if (this.mode < .001) frameCar(this.aim, carRotation, carDirection, horizontal, vertical, focusDistance);
    // Smoothing must not leave a fast rising ball outside the lens. Constrain
    // the rendered aim as well as the destination, before manual look is added.
    if (ballCam && this.switchTime === 0) frameBall(this.aim, ballRotation, carDirection, ballDirection, pair.carLimit, pair.ballLimit, pair.fits);
    camera.quaternion.copy(this.aim);
    // Keep the normal lens height, distance and FOV. Only its horizontal orbit
    // and aim change; a held stick makes that orbit relative to the car.
    if (this.lookWeight > .000001) {
      const orbitYaw = this.lookYaw + shortest(carYaw - this.yaw) * this.lookWeight;
      const orbit = new Quaternion().setFromAxisAngle(UP, orbitYaw);
      camera.position.sub(pos).applyQuaternion(orbit).add(pos);
      camera.quaternion.premultiply(orbit);
      this.forward.applyQuaternion(orbit);
    }
    this.look.copy(camera.position).add(new Vector3(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(8));
    camera.updateProjectionMatrix();
  }
}
