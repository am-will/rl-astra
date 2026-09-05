import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLUE, ORANGE, FIELD } from './config';

export const material = (color: T.ColorRepresentation, metalness = .2, roughness = .6) => new T.MeshStandardMaterial({ color, metalness, roughness });
export function box(parent: T.Object3D, size: number[], position: number[], mat: T.Material, rotation?: number[]) {
  const mesh = new T.Mesh(new T.BoxGeometry(...size as [number, number, number]), mat);
  mesh.position.set(...position as [number, number, number]);
  if (rotation) mesh.rotation.set(...rotation as [number, number, number]);
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
export function cylinderBetween(parent: T.Object3D, a: T.Vector3, b: T.Vector3, radius: number, mat: T.Material, segments = 8) {
  const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, a.distanceTo(b), segments), mat);
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  parent.add(mesh); return mesh;
}
export function mergeStatic(group: T.Group) {
  const batches = new Map<T.Material, T.BufferGeometry[]>();
  group.updateMatrixWorld(true);
  for (const child of [...group.children]) {
    if (!(child instanceof T.Mesh) || Array.isArray(child.material)) continue;
    const geometry = child.geometry.clone().applyMatrix4(child.matrix);
    if (!batches.has(child.material)) batches.set(child.material, []);
    batches.get(child.material)!.push(geometry); group.remove(child);
  }
  for (const [mat, geometries] of batches) {
    const geometry = mergeGeometries(geometries.map(g => g.index ? g.toNonIndexed() : g));
    const mesh = new T.Mesh(geometry, mat); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    geometries.forEach(g => g.dispose());
  }
}
function profile(parent: T.Object3D, points: number[][], width: number, mat: T.Material) {
  const shape = new T.Shape(); points.forEach(([z, y], i) => i ? shape.lineTo(z, y) : shape.moveTo(z, y)); shape.closePath();
  const geometry = new T.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .055, bevelThickness: .045 });
  geometry.rotateY(-Math.PI / 2); geometry.translate(width / 2, 0, 0);
  const mesh = new T.Mesh(geometry, mat); mesh.castShadow = true; parent.add(mesh); return mesh;
}
export interface CarModel { root: T.Group; wheels: T.Group[]; }
export function createCarModel(team: 'blue' | 'orange'): CarModel {
  const root = new T.Group(), body = new T.Group(); root.add(body);
  const color = team === 'blue' ? BLUE : ORANGE;
  const paint = new T.MeshPhysicalMaterial({ color, metalness: .6, roughness: .26, clearcoat: 1, clearcoatRoughness: .15 });
  paint.name = 'Car_Body';
  const dark = material(0x111821, .65, .4), rubber = material(0x101216, .05, .86), metal = material(0x78848c, .87, .25), stripe = material(0xe8f5ff, .35, .26);
  const glass = new T.MeshPhysicalMaterial({ color: 0x173c51, metalness: .68, roughness: .1, clearcoat: 1 });
  const headlight = new T.MeshStandardMaterial({ color: 0xe4faff, emissive: 0xb5e6ff, emissiveIntensity: 3 });
  const tail = new T.MeshStandardMaterial({ color: 0xff4524, emissive: 0xff2309, emissiveIntensity: 3 });
  profile(body, [[-1.5, -.09], [-1.44, .2], [-.95, .31], [.7, .26], [1.4, .05], [1.42, -.23], [-1.23, -.27]], 1.36, paint);
  box(body, [1.48, .17, 2.38], [0, -.25, .02], dark);
  profile(body, [[-.63, .3], [-.24, .76], [.4, .79], [.82, .38]], 1.06, glass);
  box(body, [1.12, .09, .68], [0, .81, .15], paint);
  for (const x of [-.23, .23]) {
    box(body, [.15, .018, .97], [x, .325, -.94], stripe, [-.025, 0, 0]);
    box(body, [.15, .018, .68], [x, .866, .15], stripe);
  }
  for (const x of [-.58, .58]) {
    cylinderBetween(body, new T.Vector3(x, .3, -.68), new T.Vector3(x * .87, .81, -.2), .045, paint);
    cylinderBetween(body, new T.Vector3(x * .87, .81, .45), new T.Vector3(x, .3, .88), .06, paint);
    cylinderBetween(body, new T.Vector3(x, .32, -.66), new T.Vector3(x, .34, .87), .045, paint);
    cylinderBetween(body, new T.Vector3(x * .93, .8, .42), new T.Vector3(x, .31, -.5), .025, dark);
  }
  box(body, [1.4, .13, .17], [0, -.1, -1.56], dark);
  for (const x of [-.54, .54]) { box(body, [.3, .12, .035], [x, .13, -1.51], headlight); box(body, [.29, .08, .04], [x, .15, 1.4], tail); }
  for (const x of [-.29, -.145, 0, .145, .29]) box(body, [.065, .12, .06], [x, .06, -1.54], metal);
  for (const x of [-.57, .57]) {
    box(body, [.08, .43, .1], [x, .46, 1.19], dark, [.18, 0, 0]);
    box(body, [.10, .32, .53], [x * 1.62, .72, 1.14], paint);
  }
  box(body, [1.98, .13, .48], [0, .71, 1.16], paint, [-.1, 0, 0]);
  box(body, [1.6, .04, .1], [0, .80, 1.37], stripe);
  box(body, [.66, .23, .51], [0, .31, .89], dark);
  for (let i = 0; i < 6; i++) box(body, [.69, .028, .035], [0, .435, .68 + i * .072], metal);
  for (const x of [-.51, .51]) {
    cylinderBetween(body, new T.Vector3(x, .08, .9), new T.Vector3(x, .06, 1.57), .17, metal, 16);
    cylinderBetween(body, new T.Vector3(x, .06, 1.57), new T.Vector3(x, .06, 1.6), .125, dark, 16);
  }
  for (const x of [-.77, .77]) for (const z of [-.94, .93]) {
    const fender = new T.Mesh(new T.TorusGeometry(.51, .075, 6, 18, Math.PI), paint);
    fender.rotation.set(0, Math.PI / 2, 0); fender.position.set(x, -.02, z); body.add(fender);
    cylinderBetween(body, new T.Vector3(x * .7, -.2, z - .25), new T.Vector3(x * 1.2, -.18, z), .045, metal);
  }
  mergeStatic(body);
  const wheels: T.Group[] = [];
  for (const x of [-.91, .91]) for (const z of [-.96, .94]) {
    const wheel = new T.Group(); wheel.position.set(x, -.18, z); root.add(wheel); wheels.push(wheel);
    const tire = new T.Mesh(new T.CylinderGeometry(.48, .48, .36, 24), rubber); tire.rotation.z = Math.PI / 2; wheel.add(tire);
    for (const side of [-1, 1]) {
      const rim = new T.Mesh(new T.TorusGeometry(.3, .035, 6, 24), metal); rim.rotation.y = Math.PI / 2; rim.position.x = side * .19; wheel.add(rim);
      const inner = new T.Mesh(new T.CylinderGeometry(.25, .25, .016, 16), dark); inner.rotation.z = Math.PI / 2; inner.position.x = side * .2; wheel.add(inner);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        cylinderBetween(wheel, new T.Vector3(side * .217, 0, 0), new T.Vector3(side * .217, Math.cos(a) * .27, Math.sin(a) * .27), .027, stripe, 5);
      }
      const hub = new T.Mesh(new T.SphereGeometry(.083, 8, 6), paint); hub.position.x = side * .228; hub.scale.x = .3; wheel.add(hub);
    }
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      box(wheel, [.37, .025, .07], [0, Math.cos(a) * .476, Math.sin(a) * .476], dark, [a, 0, .15]);
    }
    mergeStatic(wheel);
  }
  return { root, wheels };
}
export function createBall() {
  const group = new T.Group(), radius = FIELD.ballRadius;
  const ico = new T.IcosahedronGeometry(1, 0), attr = ico.getAttribute('position');
  const vertices: T.Vector3[] = [], faces: number[][] = [];
  for (let i = 0; i < attr.count; i += 3) {
    const face: number[] = [];
    for (let j = 0; j < 3; j++) {
      const p = new T.Vector3().fromBufferAttribute(attr, i + j); let index = vertices.findIndex(v => v.distanceTo(p) < .001);
      if (index < 0) { index = vertices.length; vertices.push(p); } face.push(index);
    } faces.push(face);
  }
  const whites: number[] = [], darks: number[] = [], borders: number[] = [];
  const panel = (points: T.Vector3[], target: number[]) => {
    const center = points.reduce((v, p) => v.add(p), new T.Vector3()).divideScalar(points.length).normalize().multiplyScalar(radius * 1.004);
    const pts = points.map(v => v.clone().normalize().multiplyScalar(radius).lerp(center, .035));
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      target.push(...center.toArray(), ...a.toArray(), ...b.toArray()); borders.push(...a.toArray(), ...b.toArray());
    }
  };
  for (const face of faces) {
    const pts: T.Vector3[] = [];
    for (let i = 0; i < 3; i++) { const a = vertices[face[i]], b = vertices[face[(i + 1) % 3]]; pts.push(a.clone().lerp(b, 1 / 3), a.clone().lerp(b, 2 / 3)); }
    panel(pts, whites);
  }
  vertices.forEach((vertex, index) => {
    const neighbors = new Set<number>(); faces.filter(f => f.includes(index)).forEach(f => f.filter(i => i !== index).forEach(i => neighbors.add(i)));
    const points = [...neighbors].map(i => vertex.clone().lerp(vertices[i], 1 / 3));
    const n = vertex.clone().normalize(), tangent = points[0].clone().sub(vertex).projectOnPlane(n).normalize(), bitangent = n.clone().cross(tangent);
    points.sort((a, b) => Math.atan2(a.dot(bitangent), a.dot(tangent)) - Math.atan2(b.dot(bitangent), b.dot(tangent)));
    panel(points, darks);
  });
  for (const [positions, color] of [[whites, 0xc4c8bb], [darks, 0x48525c]] as [number[], number][]) {
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals();
    const mesh = new T.Mesh(geometry, new T.MeshStandardMaterial({ color, metalness: .48, roughness: .43, side: T.DoubleSide })); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  }
  const edges = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(borders, 3));
  group.add(new T.LineSegments(edges, new T.LineBasicMaterial({ color: 0x172632 })));
  const coreMat = new T.MeshStandardMaterial({ color: 0xe4f7ff, emissive: 0x9cdbff, emissiveIntensity: 2.3 });
  for (const p of vertices) {
    const dot = new T.Mesh(new T.SphereGeometry(.087, 8, 6), coreMat); dot.position.copy(p).normalize().multiplyScalar(radius * 1.012); group.add(dot);
  }
  return group;
}
export function labelTexture(text: string, foreground = '#e4f1ff', background = '#10253c', width = 1024, height = 128) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = foreground; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `italic 800 ${height * .48}px Arial`; ctx.fillText(text, width / 2, height / 2, width * .92);
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; return texture;
}
