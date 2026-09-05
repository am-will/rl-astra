import * as T from 'three';

/** A small solid pointer that orbits the car toward the ball in car camera. */
export class BallDirection {
  root = new T.Group();
  private direction = new T.Vector3();
  private forward = new T.Vector3(0, 0, -1);

  constructor(scene: T.Scene) {
    this.root.name = 'ball-direction-pointer'; this.root.visible = false;
    const face = new T.MeshStandardMaterial({ color: 0xc9d1d2, metalness: .3, roughness: .44, envMapIntensity: .3, emissive: 0x9aafb6, emissiveIntensity: .08 });
    // About 40% of the previous marker's length, with a round shaft and tip.
    const shaft = new T.Mesh(new T.CylinderGeometry(.0125, .0125, .095, 10), face);
    shaft.rotation.x = -Math.PI / 2; shaft.position.z = .018; shaft.name = 'ball-arrow-shaft';
    const tip = new T.Mesh(new T.ConeGeometry(.03, .051, 10), face);
    tip.rotation.x = -Math.PI / 2; tip.position.z = -.051; tip.name = 'ball-arrow-tip';
    this.root.add(shaft, tip); scene.add(this.root);
  }

  update(car: T.Vector3, ball: T.Vector3, enabled: boolean) {
    this.direction.subVectors(ball, car);
    const distance = this.direction.length();
    this.root.visible = enabled && distance > 1.4;
    if (!this.root.visible) return;
    this.direction.divideScalar(distance);
    // Lift the anchor clear of the turf, then aim from that exact anchor.
    this.root.position.copy(car).addScaledVector(this.direction, Math.min(1.5, distance * .4));
    this.root.position.y += .22;
    this.direction.subVectors(ball, this.root.position).normalize();
    this.root.quaternion.setFromUnitVectors(this.forward, this.direction);
  }
}
