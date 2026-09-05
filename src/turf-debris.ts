import * as T from 'three';
import type { CarModel } from './assets';
import type { Car, Pad } from './physics';
import { FIELD } from './config';
import { TireSmoke } from './tire-smoke';

const CAPACITY = 192;
interface Clump { life: number; position: T.Vector3; velocity: T.Vector3; rotation: T.Vector3; spin: T.Vector3; scale: T.Vector3; }

function clumpGeometry() {
  const soil = new T.IcosahedronGeometry(1, 0); soil.scale(1, .5, .8);
  const positions = Array.from(soil.getAttribute('position').array), colors: number[] = [];
  const brown = new T.Color(0x42301c), green = new T.Color(0x466027);
  for (let i = 0; i < positions.length; i += 3) colors.push(...(positions[i + 1] > .2 ? green : brown).toArray());
  soil.dispose();
  for (const [x, z, bend] of [[-.35, -.2, .25], [.2, .25, -.4], [.45, -.2, .1]]) {
    positions.push(x - .09, .35, z, x + .09, .35, z, x + bend, 1.65, z + .2);
    for (let i = 0; i < 3; i++) colors.push(...green.toArray());
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
  return geometry;
}

function onGrass(point: T.Vector3, pads: Pad[]) {
  // Match the visible turf's boundary and the cutouts around boost housings.
  if (point.y < -.08 || point.y > .16 || Math.abs(point.x) > FIELD.width - FIELD.rampRadius - .15 || Math.abs(point.z) > FIELD.length - FIELD.rampRadius - .15) return false;
  if (Math.abs(point.x) + Math.abs(point.z) > FIELD.width + FIELD.length - FIELD.cornerCut - FIELD.rampRadius * Math.SQRT2) return false;
  return !pads.some(p => Math.hypot(point.x - p.x, point.z - p.z) < (p.big ? 1.12 : .54));
}

/** Short-lived pieces of turf lifted by tires, with no persistent surface marks. */
export class TurfDebris {
  mesh: T.InstancedMesh;
  smoke: TireSmoke;
  private pool: Clump[] = Array.from({ length: CAPACITY }, () => ({ life: 0, position: new T.Vector3(), velocity: new T.Vector3(), rotation: new T.Vector3(), spin: new T.Vector3(), scale: new T.Vector3() }));
  private wheels: T.Vector3[] = [];
  private previous = new T.Vector3();
  private ready = false;
  private credit = 0;
  private cursor = 0;
  private wheelCursor = 0;
  private dummy = new T.Object3D();

  constructor(scene: T.Scene) {
    this.smoke = new TireSmoke(scene);
    this.mesh = new T.InstancedMesh(clumpGeometry(), new T.MeshStandardMaterial({ vertexColors: true, roughness: .98, side: T.DoubleSide }), CAPACITY);
    this.mesh.name = 'tire-turf-debris'; this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); scene.add(this.mesh);
  }

  configureWheels(model: CarModel) {
    model.root.updateMatrixWorld(true);
    const inverse = model.root.matrixWorld.clone().invert();
    this.wheels = model.wheels.map(wheel => {
      const bounds = new T.Box3();
      wheel.traverse(o => {
        if (!(o instanceof T.Mesh)) return;
        o.geometry.computeBoundingBox(); bounds.union(o.geometry.boundingBox!.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(inverse, o.matrixWorld)));
      });
      const point = bounds.getCenter(new T.Vector3()); point.y = bounds.min.y; return point;
    });
    this.reset();
  }

  reset() { this.smoke.reset(); for (const p of this.pool) p.life = 0; this.mesh.count = 0; this.credit = 0; this.ready = false; }

  update(model: CarModel, car: Car, pads: Pad[], dt: number, enabled: boolean) {
    const position = model.root.position;
    if (!enabled || (this.ready && this.previous.distanceToSquared(position) > 64)) this.reset();
    if (!enabled) return;
    this.previous.copy(position); this.ready = true;
    if (dt <= 0) return;
    const elapsed = Math.min(dt, .05), velocity = new T.Vector3().copy(car.body.linvel());
    const forward = new T.Vector3(0, 0, -1).applyQuaternion(model.root.quaternion), right = new T.Vector3(1, 0, 0).applyQuaternion(model.root.quaternion);
    const slip = Math.min(1, Math.abs(velocity.dot(right)) / 7);
    const disturbance = Math.min(1, Math.abs(car.steer) * .5 + slip * .7 + (car.drifting ? .65 : 0));
    const contacts = car.grounded && car.groundNormal.y > .95 ? this.wheels.map(p => p.clone().multiply(model.root.scale).applyQuaternion(model.root.quaternion).add(position)).filter(p => onGrass(p, pads)) : [];
    this.smoke.update(contacts.filter(p => p.clone().sub(position).dot(forward) < 0), velocity, car.drifting ? T.MathUtils.smoothstep(car.speed, 2, 9) * (.55 + slip * .45) : 0, elapsed);
    const rate = contacts.length ? T.MathUtils.smoothstep(car.speed, 1, 8) * (5 + disturbance * 48) : 0;
    if (!rate) this.credit = 0;
    this.credit += rate * elapsed;
    while (this.credit >= 1) {
      this.credit--;
      const contact = contacts[this.wheelCursor++ % contacts.length].clone().addScaledVector(velocity, -this.credit / rate);
      if (!onGrass(contact, pads)) continue;
      const p = this.pool[this.cursor++ % CAPACITY];
      p.life = .55 + Math.random() * .3; p.position.copy(contact); p.position.y = .055;
      p.velocity.copy(velocity).multiplyScalar(.1).addScaledVector(forward, -(.5 + disturbance * 1.8)).addScaledVector(right, (Math.random() - .5) * (1.2 + disturbance * 2));
      p.velocity.y = 1 + Math.random() * (1 + disturbance * .9);
      p.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      p.spin.set((Math.random() - .5) * 12, (Math.random() - .5) * 12, (Math.random() - .5) * 12);
      const size = .035 + Math.random() * (.025 + disturbance * .035); p.scale.set(size, size * .7, size * 1.2);
    }
    let count = 0;
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= elapsed;
      if (p.life <= 0) continue;
      p.position.addScaledVector(p.velocity, elapsed); p.position.y -= 6 * elapsed * elapsed; p.velocity.y -= 12 * elapsed;
      if (p.position.y < .025) { p.position.y = .025; p.velocity.y = 0; p.velocity.x *= Math.exp(-12 * elapsed); p.velocity.z *= Math.exp(-12 * elapsed); p.life = Math.min(p.life, .18); }
      p.rotation.addScaledVector(p.spin, elapsed);
      this.dummy.position.copy(p.position); this.dummy.rotation.set(p.rotation.x, p.rotation.y, p.rotation.z);
      this.dummy.scale.copy(p.scale).multiplyScalar(T.MathUtils.smoothstep(p.life, 0, .18));
      this.dummy.updateMatrix(); this.mesh.setMatrixAt(count++, this.dummy.matrix);
    }
    this.mesh.count = count; this.mesh.instanceMatrix.needsUpdate = true;
  }
}
