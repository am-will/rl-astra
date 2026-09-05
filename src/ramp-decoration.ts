import * as T from 'three';
import { FIELD } from './config';

const TILE = 256, WIDTH = TILE * 4, HEIGHT = TILE * 5;
const ARC = FIELD.rampRadius * Math.PI / 2;

function star(c: CanvasRenderingContext2D, outer: number, inner: number, points = 8) {
  c.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const angle = i * Math.PI / points, radius = i % 2 ? inner : outer;
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  }
  c.closePath();
}

function tileTexture(orange: boolean, relief = false) {
  const canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
  const c = canvas.getContext('2d')!;
  const ink = orange ? '#75492f' : '#194c6b', glaze = orange ? '#ba793f' : '#337b9b', bright = orange ? '#e0b170' : '#7ebac5';
  for (let row = 0; row < 5; row++) for (let col = 0; col < 4; col++) {
    const ornate = (row + col) % 2 === 0;
    c.save(); c.translate(col * TILE, row * TILE);
    c.fillStyle = relief ? '#393939' : '#5a645e'; c.fillRect(0, 0, TILE, TILE);
    c.fillStyle = relief ? '#b8b8b8' : ornate ? ink : '#c8c9b4'; c.fillRect(3, 3, TILE - 6, TILE - 6);
    c.strokeStyle = relief ? '#d0d0d0' : '#e0dac2'; c.lineWidth = 2; c.strokeRect(7, 7, TILE - 14, TILE - 14);
    if (ornate) {
      c.strokeStyle = relief ? '#a6a6a6' : bright; c.lineWidth = 3; c.strokeRect(16, 16, TILE - 32, TILE - 32);
      for (const x of [29, TILE - 29]) for (const y of [29, TILE - 29]) {
        c.save(); c.translate(x, y); star(c, 12, 6, 4); c.fillStyle = relief ? '#adadad' : '#dcd9bf'; c.fill(); c.restore();
      }
      c.translate(TILE / 2, TILE / 2);
      star(c, 98, 70); c.fillStyle = relief ? '#b0b0b0' : '#d5d5bb'; c.fill();
      star(c, 86, 62); c.fillStyle = relief ? '#b8b8b8' : glaze; c.fill();
      star(c, 64, 46); c.strokeStyle = relief ? '#aaaaaa' : '#e1dfc5'; c.lineWidth = 3; c.stroke();
      star(c, 42, 27); c.fillStyle = relief ? '#b0b0b0' : bright; c.fill();
      c.beginPath(); c.arc(0, 0, 9, 0, Math.PI * 2); c.fillStyle = relief ? '#b8b8b8' : ink; c.fill();
    } else {
      c.strokeStyle = relief ? '#b0b0b0' : '#aab5a5'; c.lineWidth = 1.5;
      c.strokeRect(18, 18, TILE - 36, TILE - 36);
      c.translate(TILE / 2, TILE / 2); star(c, 24, 15, 4); c.stroke();
    }
    c.restore();
  }
  // Fine ceramic mottling keeps the tiles from reading as a flat decal.
  let seed = 731;
  for (let i = 0; i < 28000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const x = seed % WIDTH;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const y = seed % HEIGHT;
    c.fillStyle = i % 2 ? 'rgba(255,250,226,.045)' : 'rgba(22,39,40,.045)'; c.fillRect(x, y, 1 + i % 3, 1);
  }
  // Repeating inlaid border follows the foot and lip of the entire ramp.
  for (const y of [0, HEIGHT - 46]) {
    c.fillStyle = relief ? '#bdbdbd' : '#c9c7ae'; c.fillRect(0, y, WIDTH, 46);
    c.fillStyle = relief ? '#787878' : ink; c.fillRect(0, y + 5, WIDTH, 3); c.fillRect(0, y + 38, WIDTH, 3);
    c.strokeStyle = relief ? '#999999' : glaze; c.lineWidth = 3;
    for (let x = 0; x < WIDTH; x += 64) {
      c.beginPath(); c.moveTo(x, y + 30); c.lineTo(x + 12, y + 30); c.lineTo(x + 12, y + 15); c.lineTo(x + 44, y + 15); c.lineTo(x + 44, y + 30); c.lineTo(x + 32, y + 30); c.lineTo(x + 32, y + 23); c.stroke();
    }
  }
  const texture = new T.CanvasTexture(canvas);
  texture.wrapS = T.RepeatWrapping; texture.wrapT = T.ClampToEdgeWrapping;
  texture.repeat.set(1 / (ARC * WIDTH / HEIGHT), 1 / ARC); texture.anisotropy = 16;
  if (!relief) texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

export function rampMaterial() {
  const blue = tileTexture(false), orange = tileTexture(true);
  const mat = new T.MeshStandardMaterial({ name: 'glazed-arena-tiles', map: blue, bumpMap: tileTexture(false, true), bumpScale: .013, metalness: .04, roughness: .64, envMapIntensity: .25, side: T.DoubleSide });
  mat.onBeforeCompile = shader => {
    shader.uniforms.orangeTiles = { value: orange };
    shader.vertexShader = 'varying float rampWorldZ;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nrampWorldZ=(modelMatrix*vec4(position,1.)).z;');
    shader.fragmentShader = 'varying float rampWorldZ;uniform sampler2D orangeTiles;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      vec4 tile=mix(texture2D(orangeTiles,vMapUv),texture2D(map,vMapUv),smoothstep(-2.,2.,rampWorldZ));
      diffuseColor*=tile;
    `);
  };
  mat.customProgramCacheKey = () => 'team-ceramic-ramps-v1';
  return mat;
}

/** Use traveled distance up the curve so the bottom row is not stretched flat. */
export function decorateRamp(scene: T.Scene, geometry: T.BufferGeometry) {
  const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  const foot: T.Vector3[] = [], lip: T.Vector3[] = [];
  let distance = 0;
  for (let i = 0; i < uv.count; i++) {
    const start = i === 0 || uv.getX(i) !== uv.getX(i - 1);
    if (start) { distance = 0; foot.push(new T.Vector3().fromBufferAttribute(positions, i)); }
    else distance += Math.hypot(positions.getX(i) - positions.getX(i - 1), positions.getY(i) - positions.getY(i - 1), positions.getZ(i) - positions.getZ(i - 1));
    uv.setY(i, distance);
    if (i === uv.count - 1 || uv.getX(i) !== uv.getX(i + 1)) lip.push(new T.Vector3().fromBufferAttribute(positions, i));
  }
  uv.needsUpdate = true;
  const trim = new T.MeshStandardMaterial({ color: 0xa5b1ae, metalness: .45, roughness: .56 });
  for (const points of [foot, lip]) {
    points.forEach(p => { p.y += .025; });
    const curve = new T.CurvePath<T.Vector3>();
    for (let i = 1; i < points.length; i++) curve.add(new T.LineCurve3(points[i - 1], points[i]));
    const mesh = new T.Mesh(new T.TubeGeometry(curve, points.length * 2, .024, 5, false), trim);
    mesh.name = 'ramp-inlaid-edge'; scene.add(mesh);
  }
}
