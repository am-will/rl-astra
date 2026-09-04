import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FIELD, BLUE, ORANGE } from './config';
import type { CarModel } from './assets';

export async function loadDetailedModels() {
  const loader = new GLTFLoader();
  const [car, ball] = await Promise.all([loader.loadAsync('/models/octane/scene.gltf'), loader.loadAsync('/models/ball/scene.gltf')]);
  return { car: car.scene, ball: ball.scene };
}
export function detailedCar(source: T.Group, team: 'blue' | 'orange'): CarModel {
  const root = new T.Group(), baked = source.clone(true);
  baked.rotation.y = Math.PI / 2; baked.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(baked), center = bounds.getCenter(new T.Vector3());
  const scale = 1.63 / (bounds.max.z - bounds.min.z);
  const transform = new T.Matrix4().makeTranslation(-center.x * scale, -.32 - bounds.min.y * scale, -center.z * scale).multiply(new T.Matrix4().makeScale(scale, scale, scale));
  const wheels: T.Group[] = [];
  const wheelMeshes = new Map<string, T.Mesh[]>();
  baked.traverse(obj => {
    if (!(obj instanceof T.Mesh)) return;
    const geometry = obj.geometry.clone().applyMatrix4(obj.matrixWorld).applyMatrix4(transform);
    const mat = (obj.material as T.MeshStandardMaterial).clone();
    if (mat.name === 'Octane_Body') { mat.color.setHex(team === 'blue' ? BLUE : ORANGE); mat.metalness = .58; mat.roughness = .28; }
    if (mat.name === 'Paint') { mat.color.setHex(0xe7ecf0); mat.metalness = .55; mat.roughness = .34; }
    if (mat.name === 'Window') { mat.color.setHex(0x0b2030); mat.metalness = .55; mat.roughness = .16; }
    if (mat.name === 'Dieci_Rim') { mat.color.setHex(0x515c64); mat.metalness = .85; mat.roughness = .29; }
    if (mat.name === 'Dieci_Tread') { mat.color.setHex(0x171b1e); mat.roughness = .85; }
    if (mat.map) mat.map.anisotropy = 8;
    const mesh = new T.Mesh(geometry, mat); mesh.castShadow = true; mesh.receiveShadow = true;
    if (obj.name.includes('Dieci')) {
      const key = obj.name.includes('FR') ? 'FR' : obj.name.includes('FL') ? 'FL' : obj.name.includes('BR') ? 'BR' : 'BL';
      if (!wheelMeshes.has(key)) wheelMeshes.set(key, []); wheelMeshes.get(key)!.push(mesh);
    } else root.add(mesh);
  });
  for (const [key, meshes] of wheelMeshes) {
    const group = new T.Group(), wheelBounds = new T.Box3();
    meshes.forEach(mesh => { mesh.geometry.computeBoundingBox(); wheelBounds.union(mesh.geometry.boundingBox!); });
    const center = wheelBounds.getCenter(new T.Vector3());
    meshes.forEach(mesh => { mesh.geometry.translate(-center.x, -center.y, -center.z); group.add(mesh); });
    group.position.copy(center); group.rotation.order = 'YXZ'; group.userData.front = key.startsWith('F'); root.add(group); wheels.push(group);
  }
  // Headlamps and exhaust cores are emissive inserts, independent of the painted body.
  const glow = new T.MeshStandardMaterial({ color: 0xc5efff, emissive: 0x9adfff, emissiveIntensity: 2 });
  for (const x of [-.5, .5]) {
    const lamp = new T.Mesh(new T.SphereGeometry(.0275, 10, 6), glow); lamp.position.set(x * .5, -.06, -.73); lamp.scale.set(1.4, .65, .4); root.add(lamp);
  }
  return { root, wheels };
}
export function detailedBall(source: T.Group) {
  const root = new T.Group(); source.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(source), center = bounds.getCenter(new T.Vector3());
  const scale = FIELD.ballRadius * 2 / Math.max(...bounds.getSize(new T.Vector3()).toArray());
  source.traverse(obj => {
    if (!(obj instanceof T.Mesh)) return;
    const geometry = obj.geometry.clone().applyMatrix4(obj.matrixWorld).translate(-center.x, -center.y, -center.z).scale(scale, scale, scale);
    const mat = (obj.material as T.MeshStandardMaterial).clone();
    if (mat.name === 'Mat.4') { mat.color.setHex(0xb8ebff); mat.emissive.setHex(0x81caff); mat.emissiveIntensity = 2.3; }
    else { mat.metalness = .35; mat.roughness = .6; if (mat.map) mat.map.anisotropy = 8; }
    const mesh = new T.Mesh(geometry, mat); mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh);
  });
  return root;
}
