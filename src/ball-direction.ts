import * as T from 'three';

/** A small solid pointer that orbits the car toward the ball in car camera. */
export class BallDirection {
  root = new T.Group();
  private direction = new T.Vector3();
  private forward = new T.Vector3(0, 0, -1);

  constructor(scene: T.Scene) {
    this.root.name = 'ball-direction-pointer'; this.root.visible = false;
    const shape = new T.Shape();
    shape.moveTo(0, -.29); shape.lineTo(.18, -.03); shape.lineTo(.075, -.055);
    shape.lineTo(.075, .22); shape.lineTo(-.075, .22); shape.lineTo(-.075, -.055);
    shape.lineTo(-.18, -.03); shape.closePath();
    const geometry = new T.ExtrudeGeometry(shape, { depth: .055, bevelEnabled: true, bevelSize: .014, bevelThickness: .012, bevelSegments: 1, steps: 1, curveSegments: 1 });
    // Map the shape's tip to local -Z, with the bevel raised above the field.
    geometry.rotateX(Math.PI / 2); geometry.translate(0, .055, 0); geometry.scale(.68, .68, .68);
    const face = new T.MeshStandardMaterial({ color: 0xc9d1d2, metalness: .3, roughness: .44, envMapIntensity: .3, emissive: 0x9aafb6, emissiveIntensity: .08 });
    const edge = new T.MeshStandardMaterial({ color: 0x566a73, metalness: .5, roughness: .5, envMapIntensity: .3 });
    const pointer = new T.Mesh(geometry, [face, edge]);
    pointer.name = 'silver-ball-arrow'; this.root.add(pointer); scene.add(this.root);
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
