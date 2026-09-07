import { Vector3 } from 'three';

// RocketSim c2baacb8: RLConst.h, Ball::_OnHit and btRigidBody::applyDamping.
// Distances and linear velocities are Rocket League units / 100; Y is up.
export const BALL = {
  mass: 30, drag: .03, worldFriction: .35, worldRestitution: .6,
  carFriction: 2, carRestitution: 0, maxSpeed: 60, maxSpin: 6,
};
const hitFactors = [[0, .65], [5, .65], [23, .55], [46, .30]];

export function ballHitVelocity(relativePosition: Vector3, relativeVelocity: Vector3, carForward: Vector3) {
  const speed = Math.min(relativeVelocity.length(), 46);
  const direction = relativePosition.clone();
  direction.y *= .35;
  direction.normalize();
  direction.addScaledVector(carForward, -direction.dot(carForward) * .35).normalize();
  let factor = .30;
  for (let i = 1; i < hitFactors.length; i++) {
    const [end, b] = hitFactors[i], [start, a] = hitFactors[i - 1];
    if (speed <= end) { factor = a + (b - a) * (speed - start) / (end - start); break; }
  }
  return direction.multiplyScalar(speed * factor);
}
