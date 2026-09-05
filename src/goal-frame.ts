import * as T from 'three';
import { FIELD, BLUE, ORANGE } from './config';
import { goalRadii, goalBoundary } from './arena';
import { box, material, mergeStatic } from './assets';

// Cross-sections follow the same floor and roof radii as the collision shell.
// The recessed collar is flush with that shell, leaving the back net clear.
const leftBoundary = goalBoundary(1).filter(p => p.x < 0);
function sidePoint(depth: number) {
  const index = Math.max(1, leftBoundary.findIndex(p => p.z - FIELD.length >= depth));
  const a = leftBoundary[index - 1], b = leftBoundary[index], t = T.MathUtils.clamp((FIELD.length + depth - a.z) / (b.z - a.z), 0, 1);
  return { x: T.MathUtils.lerp(a.x, b.x, t), nx: T.MathUtils.lerp(a.nx, b.nx, t), nz: T.MathUtils.lerp(a.nz, b.nz, t) };
}
function section(depth: number, outset = 0) {
  const { bottom, top } = goalRadii(depth), p = sidePoint(depth), w = -p.x + outset, h = FIELD.goalHeight + outset;
  const b = Math.max(.001, bottom), r = top + outset, left: T.Vector3[] = [];
  for (let i = 0; i <= 20; i++) { const a = i / 20 * Math.PI / 2; left.push(new T.Vector3(-w + b - b * Math.sin(a), b * (1 - Math.cos(a)), depth)); }
  for (let i = 1; i <= 12; i++) left.push(new T.Vector3(-w, T.MathUtils.lerp(b, h - r, i / 12), depth));
  for (let i = 1; i <= 24; i++) { const a = i / 24 * Math.PI / 2; left.push(new T.Vector3(-w + r - r * Math.cos(a), h - r + r * Math.sin(a), depth)); }
  // Follow the tapered side's normal, including the depth offset in the fillets.
  for (const point of left) {
    const offset = -w - point.x;
    point.x = p.x + p.nx * (offset + outset); point.z += p.nz * (offset + outset);
  }
  const points = [...left];
  const shoulder = left.at(-1)!;
  for (let i = 1; i < 48; i++) points.push(new T.Vector3(T.MathUtils.lerp(shoulder.x, -shoulder.x, i / 48), h, shoulder.z));
  points.push(...[...left].reverse().map(p => new T.Vector3(-p.x, p.y, p.z)));
  return points;
}

function strip(a: T.Vector3[], b: T.Vector3[]) {
  const positions: number[] = [];
  for (let i = 0; i < a.length - 1; i++) for (const p of [a[i], b[i], a[i + 1], a[i + 1], b[i], b[i + 1]]) positions.push(p.x, p.y, p.z);
  const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(positions.length / 3 * 2), 2));
  geometry.computeVertexNormals(); return geometry;
}

function shieldTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const c = canvas.getContext('2d')!;
  const outline = () => { c.beginPath(); c.moveTo(256, 51); c.bezierCurveTo(187, 95, 119, 91, 74, 93); c.lineTo(86, 250); c.bezierCurveTo(97, 351, 186, 415, 256, 463); c.bezierCurveTo(326, 415, 415, 351, 426, 250); c.lineTo(438, 93); c.bezierCurveTo(366, 95, 313, 84, 256, 51); c.closePath(); };
  const fill = c.createLinearGradient(0, 40, 0, 480); fill.addColorStop(0, 'rgba(213,235,255,.42)'); fill.addColorStop(.65, 'rgba(191,220,255,.13)'); fill.addColorStop(1, 'rgba(218,239,255,.36)');
  outline(); c.fillStyle = fill; c.fill(); c.strokeStyle = 'rgba(225,242,255,.8)'; c.lineWidth = 8; c.stroke();
  c.save(); c.translate(256, 257); c.scale(.85, .85); c.translate(-256, -257); outline(); c.lineWidth = 2.5; c.strokeStyle = 'rgba(223,240,255,.55)'; c.stroke(); c.restore();
  // A simple defense crest: three rising bars and a chevron, drawn locally.
  c.fillStyle = 'rgba(224,241,255,.6)';
  for (let i = -1; i <= 1; i++) c.fillRect(238 + i * 52, 194 + Math.abs(i) * 22, 36, 90 - Math.abs(i) * 22);
  c.beginPath(); c.moveTo(158, 294); c.lineTo(256, 339); c.lineTo(354, 294); c.lineTo(342, 327); c.lineTo(256, 372); c.lineTo(170, 327); c.closePath(); c.fill();
  // Fine scanlines keep this a projected marking rather than a solid decal.
  c.globalCompositeOperation = 'destination-out'; c.fillStyle = 'rgba(0,0,0,.32)';
  for (let y = 0; y < 512; y += 4) c.fillRect(0, y, 512, 1);
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; return texture;
}

export function createGoalFrame(team: number) {
  const root = new T.Group(); root.name = team > 0 ? 'blue-goal-frame' : 'orange-goal-frame';
  root.position.z = team * FIELD.length; root.scale.z = team;
  const body = new T.Group(); root.add(body);
  const color = team > 0 ? BLUE : ORANGE;
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 444;
  const c = canvas.getContext('2d')!; c.fillStyle = '#222d36'; c.fillRect(0, 0, 768, 444);
  for (let column = -1; column <= 9; column++) for (let row = -1; row <= 4; row++) {
    const x = column * 96, y = row * 111 + (column % 2) * 55.5;
    c.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; const px = x + Math.cos(a) * 61, py = y + Math.sin(a) * 53; k ? c.lineTo(px, py) : c.moveTo(px, py); } c.closePath();
    c.fillStyle = (column + row) % 3 ? '#35404a' : '#3b454c'; c.fill();
    c.strokeStyle = team > 0 ? '#356a91' : '#936138'; c.lineWidth = 2; c.stroke();
  }
  const tiles = new T.CanvasTexture(canvas); tiles.colorSpace = T.SRGBColorSpace; tiles.wrapS = tiles.wrapT = T.RepeatWrapping; tiles.repeat.set(1.8, 1.8); tiles.anisotropy = 8;
  const floor = new T.Mesh(new T.PlaneGeometry(FIELD.goalWidth * 2 + 3, FIELD.goalDepth + 3.8), new T.MeshStandardMaterial({ map: tiles, color: 0x8296a5, metalness: .18, roughness: .74, envMapIntensity: .35 }));
  floor.name = 'goal-hex-floor'; floor.rotation.x = -Math.PI / 2; floor.position.set(0, .018, (FIELD.goalDepth - 3.8) / 2); floor.receiveShadow = true; root.add(floor);
  const graphite = material(0x101923, .72, .37), gunmetal = material(0x354553, .8, .33), alloy = material(0x8c9aa1, .7, .4);
  for (const mat of [graphite, gunmetal, alloy]) mat.side = T.DoubleSide;
  const light = new T.MeshBasicMaterial({ color: team > 0 ? 0x087cff : 0xff790b, side: T.DoubleSide, toneMapped: false });
  const pinstripe = new T.MeshBasicMaterial({ color: team > 0 ? 0x83bdff : 0xffbf77, side: T.DoubleSide, toneMapped: false });
  const ribbon = (a: T.Vector3[], b: T.Vector3[], mat: T.Material) => body.add(new T.Mesh(strip(a, b), mat));
  const rail = (points: T.Vector3[], radius: number, mat: T.Material) => body.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), 192, radius, 6, false), mat));
  const front = (outset: number, z: number) => section(0, outset).map(p => p.setZ(z));
  // Broad beveled surround, with two inset light channels rather than a pipe.
  ribbon(front(.015, -.22), front(.16, -.4), alloy);
  ribbon(front(.16, -.4), front(.65, -.4), graphite);
  ribbon(front(.65, -.4), front(.76, -.24), gunmetal);
  ribbon(front(.76, -.24), front(.76, .42), graphite);
  ribbon(front(.015, -.22), section(.65, .025), gunmetal);
  rail(front(.19, -.414), .032, pinstripe);
  rail(front(.56, -.416), .047, light);
  // Recessed silver shoulder. Its rolling lower corners and broader upper
  // curves reveal the goal's depth while the rest of the shell stays glass.
  for (let i = 0; i < 24; i++) {
    const a = T.MathUtils.lerp(1.1, 3.8, i / 24), b = T.MathUtils.lerp(1.1, 3.8, (i + 1) / 24);
    ribbon(section(a, -.035), section(b, -.035), i < 3 || i > 20 ? graphite : alloy);
  }
  rail(section(1.46, -.055), .024, pinstripe);
  rail(section(3.43, -.055), .034, light);
  for (const depth of [1.82, 2.5, 3.16]) rail(section(depth, -.052), .008, gunmetal);
  // Segmented sill / header lights and the inset sockets in each shoulder.
  for (const side of [-1, 1]) {
    for (const depth of [1.7, 2.38, 3.06]) {
      const p = section(depth, -.085)[44], x = side * Math.abs(p.x);
      const socket = box(body, [.52, .085, .54], [x, p.y, p.z], graphite, [0, 0, -side * Math.PI / 4]);
      const lamp = box(body, [.33, .035, .36], [x - side * .048, p.y - .048, p.z], light, [0, 0, -side * Math.PI / 4]);
      socket.castShadow = lamp.castShadow = false;
    }
    for (const y of [1.5, 3.3]) {
      const points: T.Vector3[] = [];
      for (let i = 0; i <= 24; i++) { const depth = i / 24 * 4.2, { bottom } = goalRadii(depth), p = sidePoint(depth); const inset = y < bottom ? bottom - Math.sqrt(Math.max(0, bottom * bottom - (bottom - y) ** 2)) : 0; points.push(new T.Vector3(side * (-p.x - inset - .035), y, depth - p.nz * inset)); }
      rail(points, .022, gunmetal);
    }
  }
  for (const x of [-6, -3, 0, 3, 6]) {
    box(body, [.065, .53, .07], [x, FIELD.goalHeight + .39, -.43], gunmetal);
    box(body, [.6, .022, .085], [x, .035, .42], light);
  }
  box(body, [FIELD.goalWidth * 2, .022, .075], [0, .025, 0], pinstripe);
  mergeStatic(body);
  body.traverse(o => { if (o instanceof T.Mesh) { o.castShadow = false; o.receiveShadow = true; } });
  if (team > 0) {
    const markings = new T.Group(); markings.name = 'own-goal-shields'; root.add(markings);
    const texture = shieldTexture();
    for (const [x, size, opacity] of [[-4.8, 3.65, .12], [0, 4.6, .16], [4.8, 3.65, .12]]) {
      const mat = new T.MeshBasicMaterial({ map: texture, color: 0xb8d5f6, transparent: true, opacity, depthWrite: false, side: T.BackSide, toneMapped: false });
      const shield = new T.Mesh(new T.PlaneGeometry(size, size), mat); shield.name = 'own-goal-shield'; shield.position.set(x, 3.1, .85); markings.add(shield);
    }
  }
  return root;
}
