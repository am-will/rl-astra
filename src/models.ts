import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FIELD } from './config';
import type { CarModel } from './assets';
import { OctaneLighting } from './octane-lighting';

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
    // Baking mirrored wheels removes the mesh transform that normally reverses
    // face culling. Reverse their triangles so the tire sidewalls face outward.
    if (obj.matrixWorld.determinant() < 0) {
      const index = geometry.getIndex();
      const indices = Array.from({ length: index?.count ?? geometry.getAttribute('position').count }, (_, i) => index ? index.getX(i) : i);
      for (let i = 0; i < indices.length; i += 3) [indices[i], indices[i + 2]] = [indices[i + 2], indices[i]];
      geometry.setIndex(indices);
    }
    const original = obj.material as T.MeshStandardMaterial;
    const mat = new T.MeshPhysicalMaterial({ name: original.name, color: original.color, map: original.map, normalMap: original.normalMap,
      metalnessMap: original.metalnessMap, roughnessMap: original.roughnessMap, metalness: original.metalness, roughness: original.roughness });
    // Soften both reflection layers: a sharp clear coat can still flash white over rough paint.
    if (mat.name === 'Octane_Body') { mat.color.setHex(team === 'blue' ? 0x078cbd : 0xe87512); mat.metalness = .38; mat.roughness = .44; mat.clearcoat = .25; mat.clearcoatRoughness = .45; mat.specularIntensity = .45; mat.bumpMap = paintGrain(); mat.bumpScale = .0008; racingLivery(mat, team); }
    if (mat.name === 'Paint') { mat.color.setHex(team === 'blue' ? 0xd86f2b : 0x26343a); mat.metalness = .3; mat.roughness = .42; mat.bumpMap = weaveDetail(); mat.bumpScale = .002; mat.clearcoat = .25; mat.clearcoatRoughness = .45; mat.specularIntensity = .45; }
    if (mat.name === 'Window') { mat.color.setHex(0x071820); mat.metalness = .4; mat.roughness = .26; mat.clearcoat = .15; mat.clearcoatRoughness = .4; mat.envMapIntensity = .4; mat.specularIntensity = .4; }
    if (mat.name === 'Dieci_Rim') { mat.color.setHex(0x8b969b); mat.metalness = .75; mat.roughness = .34; mat.clearcoat = .2; mat.clearcoatRoughness = .42; mat.specularIntensity = .5; }
    if (mat.name === 'Dieci_Tread') { mat.color.setHex(0x17191a); mat.metalness = .05; mat.roughness = .88; mat.bumpMap = treadDetail(); mat.bumpScale = .012; }
    if (mat.name === 'Octane_Chassis') { mat.roughness = .65; mat.metalness = .65; }
    if (mat.map) mat.map.anisotropy = 16;
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
    const tire = meshes.find(mesh => (mesh.material as T.Material).name === 'Dieci_Tread');
    if (tire) {
      tire.geometry.computeBoundingBox();
      const size = tire.geometry.boundingBox!.getSize(new T.Vector3()), radius = Math.max(size.y, size.z) * .5;
      const tread = new T.InstancedMesh(new RoundedBoxGeometry(size.x * .27, .005, radius * .095, 2, .0015), new T.MeshStandardMaterial({ color: 0x15191b, roughness: .94, metalness: .02 }), 144);
      tread.name = 'octane-sculpted-tread'; tread.castShadow = true; tread.receiveShadow = true;
      const block = new T.Object3D();
      for (let row = 0; row < 48; row++) for (let lane = 0; lane < 3; lane++) {
        const angle = (row + (lane === 1 ? .42 : 0)) / 48 * Math.PI * 2;
        block.position.set((lane - 1) * size.x * .3, Math.cos(angle) * (radius - .002), Math.sin(angle) * (radius - .002));
        block.rotation.set(angle, (lane - 1) * .32, 0); block.updateMatrix(); tread.setMatrixAt(row * 3 + lane, block.matrix);
      }
      group.add(tread);
    }
    group.position.copy(center); group.rotation.order = 'YXZ'; group.userData.front = key.startsWith('F'); root.add(group); wheels.push(group);
  }
  root.name = `${team}-octane`;
  return { root, wheels, lighting: new OctaneLighting(root, team === 'blue' ? 0xff941f : 0xff6b12) };
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

let grain: T.CanvasTexture | undefined;
function paintGrain() {
  if (grain) return grain;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!, data = ctx.createImageData(128, 128);
  let seed = 618;
  for (let i = 0; i < data.data.length; i += 4) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const v = 90 + (seed % 80); data.data[i] = data.data[i + 1] = data.data[i + 2] = v; data.data[i + 3] = 255; }
  ctx.putImageData(data, 0, 0); grain = new T.CanvasTexture(canvas); grain.wrapS = grain.wrapT = T.RepeatWrapping; grain.repeat.set(12, 12); grain.anisotropy = 8; return grain;
}

let weave: T.CanvasTexture | undefined, tread: T.CanvasTexture | undefined;
function weaveDetail() {
  if (weave) return weave;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d')!; c.fillStyle = '#666'; c.fillRect(0, 0, 128, 128);
  for (let x=0;x<128;x+=8) for(let y=0;y<128;y+=8) {
    c.fillStyle = ((x+y)/8)%2 ? '#aaa' : '#444'; c.fillRect(x,y,7,7);
    c.strokeStyle = '#888'; c.lineWidth = 1;
    for(let k=1;k<7;k+=2){c.beginPath(); if(((x+y)/8)%2){c.moveTo(x+k,y);c.lineTo(x+k,y+7);}else{c.moveTo(x,y+k);c.lineTo(x+7,y+k);}c.stroke();}
  }
  weave = new T.CanvasTexture(canvas); weave.wrapS = weave.wrapT = T.RepeatWrapping; weave.repeat.set(5,5); weave.anisotropy = 16; return weave;
}
function treadDetail() {
  if (tread) return tread;
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 512;
  const c = canvas.getContext('2d')!; c.fillStyle='#b0b0b0';c.fillRect(0,0,128,512);
  c.strokeStyle='#353535';c.lineWidth=6;
  for(let y=-20;y<540;y+=24){c.beginPath();c.moveTo(0,y);c.lineTo(64,y+16);c.lineTo(128,y);c.stroke();}
  c.lineWidth=4;for(const x of [29,99]){c.beginPath();c.moveTo(x,0);c.lineTo(x,512);c.stroke();}
  tread = new T.CanvasTexture(canvas); tread.wrapS = tread.wrapT = T.RepeatWrapping; tread.repeat.set(1,2); tread.anisotropy=16;return tread;
}

function racingLivery(material: T.MeshPhysicalMaterial, team: 'blue' | 'orange') {
  const accent = new T.Color(team === 'blue' ? 0xe4762e : 0x183d53);
  material.onBeforeCompile = shader => {
    shader.uniforms.liveryAccent = { value: accent };
    shader.vertexShader = 'varying vec3 liveryPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nliveryPosition=position;');
    shader.fragmentShader = 'varying vec3 liveryPosition;uniform vec3 liveryAccent;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      vec3 p=liveryPosition;
      float hood=(1.-smoothstep(-.25,-.20,p.z))*smoothstep(-.02,.04,p.y);
      float stripe=(1.-smoothstep(.072,.082,abs(p.x)))*hood;
      float pinstripe=(1.-smoothstep(.007,.012,abs(abs(p.x)-.115)))*hood;
      float flank=smoothstep(.34,.42,abs(p.x))*smoothstep(-.06,.03,p.y)*(1.-smoothstep(.10,.18,p.y));
      float chevron=step(.45,fract((p.z+p.y*.8)*21.))*smoothstep(-.02,.01,p.z)*(1.-smoothstep(.22,.25,p.z))*flank;
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.018,.029,.035),stripe*.9);
      diffuseColor.rgb=mix(diffuseColor.rgb,liveryAccent,max(pinstripe,chevron*.82));
    `);
  };
}
