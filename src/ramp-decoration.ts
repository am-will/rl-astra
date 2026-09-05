import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FIELD } from './config';

const WIDTH = 1536, HEIGHT = 1024, REPEAT = 12;
const ARC = FIELD.rampRadius * Math.PI / 2;
const BANNER_WIDTH = 8, BANNER_HEIGHT = 1.85;

/** Three broad pressed-metal panels per repeat, measured along the driving surface. */
function panelTexture(orange: boolean, relief = false) {
  const canvas = document.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
  const c = canvas.getContext('2d')!;
  const blue = orange ? '#99623c' : '#1c526f', dark = orange ? '#463c32' : '#284854';
  c.fillStyle = relief ? '#b6b6b6' : '#6b818c'; c.fillRect(0, 0, WIDTH, HEIGHT);
  for (let panel = 0; panel < 3; panel++) {
    const x = panel * 512;
    const shade = c.createLinearGradient(x, 0, x + 512, 0);
    shade.addColorStop(0, relief ? '#b6b6b6' : '#607681');
    shade.addColorStop(.45, relief ? '#b6b6b6' : '#788d94');
    shade.addColorStop(1, relief ? '#b6b6b6' : '#6b8189');
    c.fillStyle = shade; c.fillRect(x, 0, 512, HEIGHT);
    // Shallow stamped shoulder below the upper blue rail.
    c.beginPath(); c.moveTo(x + 8, 60); c.lineTo(x + 58, 265); c.lineTo(x + 454, 265); c.lineTo(x + 505, 60);
    c.strokeStyle = relief ? '#9d9d9d' : '#596f78'; c.lineWidth = 3; c.stroke();
    c.translate(0, 3); c.strokeStyle = relief ? '#bebebe' : '#a0b2b6'; c.lineWidth = 1.5; c.stroke(); c.translate(0, -3);
  }
  // Subtle anti-slip stippling, small enough to disappear naturally in mipmaps.
  for (let y = 68; y < HEIGHT - 96; y += 8) for (let x = (y % 16 ? 4 : 0); x < WIDTH; x += 8) {
    c.fillStyle = relief ? '#b0b0b0' : 'rgba(46,69,78,.075)'; c.fillRect(x, y, 3, 2);
    c.fillStyle = relief ? '#bababa' : 'rgba(226,233,224,.12)'; c.fillRect(x, y + 2, 3, 1);
  }
  // The painted lane stripe makes a gentle angular step across the panel run.
  c.beginPath();
  [[0, 565], [115, 565], [240, 520], [690, 520], [825, 565], [1110, 565], [1230, 520], [1400, 520], [1536, 565]]
    .forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.lineJoin = 'bevel'; c.strokeStyle = relief ? '#b9b9b9' : '#e7e9d8'; c.lineWidth = 32; c.stroke();
  // Recessed panel joints cut through the paint; a thin bright edge catches light.
  for (let x = 0; x <= WIDTH; x += 512) {
    c.fillStyle = relief ? '#707070' : '#536b77'; c.fillRect(x - 3, 47, 6, HEIGHT - 47);
    c.fillStyle = relief ? '#cacaca' : '#d0d8d3'; c.fillRect(x + 3, 47, 2, HEIGHT - 47);
    c.fillStyle = relief ? '#939393' : '#829aa5'; c.fillRect(x - 6, 47, 2, HEIGHT - 47);
  }
  // Painted sill and perforated blue drainage strip at the grass edge.
  for (const [y, height] of [[0, 54], [HEIGHT - 94, 94]]) {
    c.fillStyle = relief ? '#a0a0a0' : blue; c.fillRect(0, y, WIDTH, height);
    c.fillStyle = relief ? '#646464' : dark; c.fillRect(0, y + 4, WIDTH, 5); c.fillRect(0, y + height - 6, WIDTH, 5);
    c.fillStyle = relief ? '#bebebe' : '#8eabb5'; c.fillRect(0, y + 11, WIDTH, 2);
  }
  for (let x = 0; x < WIDTH; x += 24) {
    for (let row = 0; row < 3; row++) {
      const y = HEIGHT - 72 + row * 18, offset = row % 2 * 12;
      c.fillStyle = relief ? '#696969' : '#294b5b'; c.fillRect(x + offset, y, 14, 6);
      c.fillStyle = relief ? '#bdbdbd' : '#92b0b8'; c.fillRect(x + offset, y + 6, 14, 2);
    }
  }
  for (let x = 16; x < WIDTH; x += 128) for (const y of [30, HEIGHT - 12]) {
    c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.fillStyle = relief ? '#cccccc' : '#bdc9c8'; c.fill();
    c.fillStyle = relief ? '#8b8b8b' : '#506572'; c.fillRect(x - 2, y, 4, 1);
  }
  let seed = 731;
  for (let i = 0; i < 41000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const x = seed % WIDTH;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const y = seed % HEIGHT;
    c.fillStyle = i % 2 ? 'rgba(245,245,231,.05)' : 'rgba(22,39,40,.05)'; c.fillRect(x, y, 1 + i % 3, 1);
  }
  const texture = new T.CanvasTexture(canvas);
  texture.wrapS = T.RepeatWrapping; texture.wrapT = T.ClampToEdgeWrapping;
  texture.repeat.set(1 / REPEAT, 1 / ARC); texture.anisotropy = 16;
  if (!relief) texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

/** Reuse the locally supplied shield and stacked wordmark at its original aspect ratio. */
function bannerTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 512;
  const c = canvas.getContext('2d')!;
  const background = c.createLinearGradient(0, 0, 0, 512);
  background.addColorStop(0, '#151c1b'); background.addColorStop(.5, '#202723'); background.addColorStop(1, '#101818');
  c.fillStyle = background; c.fillRect(0, 0, 2048, 512);
  for (let y = 0; y < 512; y += 3) { c.fillStyle = 'rgba(255,255,240,.018)'; c.fillRect(0, y, 2048, 1); }
  // Uprights are part of the continuous print repeat, so corners cannot leave gaps.
  for (const x of [0, 2033]) {
    c.fillStyle = '#19313b'; c.fillRect(x, 0, 15, 512);
    c.fillStyle = '#487685'; c.fillRect(x + 4, 0, 7, 512);
    c.fillStyle = '#92a7a4'; c.fillRect(x + 7, 0, 2, 512);
  }
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
  texture.wrapS = T.RepeatWrapping; texture.anisotropy = 16;
  texture.repeat.x = 1 / BANNER_WIDTH;
  const logo = new Image();
  logo.onload = () => {
    const height = 418, width = height * (150.2 / 54.4) * ((2048 / 512) / (BANNER_WIDTH / BANNER_HEIGHT));
    c.drawImage(logo, (2048 - width) / 2, (512 - height) / 2, width, height);
    texture.needsUpdate = true;
  };
  logo.src = '/branding/rocket-league-logo.svg';
  return texture;
}

function teamFinish(mat: T.MeshStandardMaterial, blue: T.ColorRepresentation, orange: T.ColorRepresentation) {
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { blueFinish: { value: new T.Color(blue) }, orangeFinish: { value: new T.Color(orange) } });
    shader.vertexShader = 'varying float rampWorldZ;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nrampWorldZ=(modelMatrix*vec4(position,1.)).z;');
    shader.fragmentShader = 'varying float rampWorldZ;uniform vec3 blueFinish,orangeFinish;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb*=mix(orangeFinish,blueFinish,smoothstep(-2.,2.,rampWorldZ));');
  };
  mat.customProgramCacheKey = () => 'ramp-painted-team-trim-v1';
  return mat;
}

export function createRampMaterials() {
  const blue = panelTexture(false), orange = panelTexture(true);
  const surface = new T.MeshStandardMaterial({ name: 'pressed-metal-ramp-panels', map: blue, bumpMap: panelTexture(false, true), bumpScale: .012, metalness: .24, roughness: .72, envMapIntensity: .3, side: T.FrontSide });
  surface.onBeforeCompile = shader => {
    shader.uniforms.orangePanels = { value: orange };
    shader.vertexShader = 'varying float rampWorldZ;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nrampWorldZ=(modelMatrix*vec4(position,1.)).z;');
    shader.fragmentShader = 'varying float rampWorldZ;uniform sampler2D orangePanels;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      vec4 panel=mix(texture2D(orangePanels,vMapUv),texture2D(map,vMapUv),smoothstep(-2.,2.,rampWorldZ));
      diffuseColor*=panel;
    `);
  };
  surface.customProgramCacheKey = () => 'pressed-metal-ramps-v1';
  return {
    surface,
    trim: teamFinish(new T.MeshStandardMaterial({ name: 'ramp-painted-metal-trim', metalness: .38, roughness: .55, envMapIntensity: .35, side: T.FrontSide }), '#154465', '#80502e'),
    silver: new T.MeshStandardMaterial({ color: 0x859a9c, metalness: .65, roughness: .5, side: T.FrontSide }),
    housing: new T.MeshStandardMaterial({ color: 0x283d46, metalness: .5, roughness: .65, side: T.FrontSide }),
    lamp: new T.MeshStandardMaterial({ name: 'ramp-inset-white-lamps', color: 0xe6ebd6, emissive: 0xdce6cf, emissiveIntensity: .65, roughness: .4, side: T.FrontSide }),
    banner: new T.MeshStandardMaterial({ name: 'stadium-static-advertising', map: bannerTexture(), roughness: .92, metalness: 0, envMapIntensity: .12, side: T.FrontSide }),
  };
}

type RampMaterials = ReturnType<typeof createRampMaterials>;
type Section = { distance: number; points: T.Vector3[]; inward: T.Vector3 };

/** All trim follows the existing collision mesh, including the compact goal returns. */
export function decorateRamp(scene: T.Scene, geometry: T.BufferGeometry, materials: RampMaterials) {
  const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  const sections: Section[] = [];
  let distance = 0;
  for (let i = 0; i < uv.count; i++) {
    if (i === 0 || uv.getX(i) !== uv.getX(i - 1)) {
      distance = 0; sections.push({ distance: uv.getX(i), points: [], inward: new T.Vector3() });
    } else distance += Math.hypot(positions.getX(i) - positions.getX(i - 1), positions.getY(i) - positions.getY(i - 1), positions.getZ(i) - positions.getZ(i - 1));
    sections.at(-1)!.points.push(new T.Vector3().fromBufferAttribute(positions, i));
    uv.setY(i, distance);
  }
  uv.needsUpdate = true;
  sections.forEach((section, i) => {
    // The path tangent remains defined even where the radius tapers to zero.
    const previous = sections[Math.max(0, i - 1)].points.at(-1)!, next = sections[Math.min(sections.length - 1, i + 1)].points.at(-1)!;
    section.inward.set(next.z - previous.z, 0, previous.x - next.x).normalize();
    if (section.inward.dot(section.points.at(-1)!) > 0) section.inward.negate();
  });
  const root = new T.Group(); root.name = 'ramp-reference-details'; scene.add(root);
  const batches = new Map<T.Material, T.BufferGeometry[]>();
  const add = (geo: T.BufferGeometry, material: T.Material) => {
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material)!.push(geo);
  };
  const band = (name: string, point: (section: Section, upper: boolean) => T.Vector3, mat: T.Material) => {
    const p: number[] = [], tex: number[] = [], indices: number[] = [];
    for (const section of sections) for (const upper of [false, true]) { p.push(...point(section, upper).toArray()); tex.push(section.distance * (section.points.at(-1)!.x > 0 ? -1 : 1), upper ? 1 : 0); }
    for (let i = 0; i < sections.length - 1; i++) {
      const a = i * 2, order = sections[i].points.at(-1)!.x > 0 ? [a, a + 1, a + 2, a + 2, a + 1, a + 3] : [a, a + 2, a + 1, a + 2, a + 3, a + 1];
      indices.push(...order);
    }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(p, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(tex, 2)); geo.setIndex(indices); geo.computeVertexNormals();
    const mesh = new T.Mesh(geo, mat); mesh.name = name; mesh.receiveShadow = true; root.add(mesh);
  };
  const lipPoint = (section: Section, height: number, offset: number) => section.points.at(-1)!.clone().addScaledVector(section.inward, offset).add(new T.Vector3(0, height, 0));
  const taper = (section: Section) => T.MathUtils.smoothstep(section.points.at(-1)!.y / FIELD.rampRadius, 0, 1);
  band('ramp-blue-kickplate', (s, upper) => lipPoint(s, upper ? .20 : -.06, .028), materials.trim);
  band('stadium-static-ad', (s, upper) => lipPoint(s, .20 + (upper ? BANNER_HEIGHT * taper(s) : 0), .014), materials.banner);
  band('ramp-banner-top-rail', (s, upper) => lipPoint(s, .20 + BANNER_HEIGHT * taper(s) + (upper ? .065 : -.015), upper ? .025 : .08), materials.trim);
  band('ramp-banner-top-highlight', (s, upper) => lipPoint(s, .20 + BANNER_HEIGHT * taper(s) + (upper ? .077 : .06), upper ? -.015 : .025), materials.silver);
  // Low-profile luminaires lie on the curved sheet, rather than floating in front of it.
  const lampFrame = new T.Shape();
  lampFrame.moveTo(-.79, -.07); lampFrame.lineTo(-.69, -.13); lampFrame.lineTo(.69, -.13); lampFrame.lineTo(.79, -.07);
  lampFrame.lineTo(.79, .07); lampFrame.lineTo(.69, .13); lampFrame.lineTo(-.69, .13); lampFrame.lineTo(-.79, .07); lampFrame.closePath();
  const frameGeometry = new T.ShapeGeometry(lampFrame).scale(1.45, .83, 1);
  const housingGeometry = frameGeometry.clone().scale(.94, .78, 1);
  const lampGeometry = frameGeometry.clone().scale(.84, .44, 1);
  const atDistance = (distance: number): Section => {
    const i = Math.max(1, sections.findIndex(s => s.distance >= distance));
    const a = sections[i - 1], b = sections[i], t = (distance - a.distance) / (b.distance - a.distance);
    return { distance, points: a.points.map((p, j) => p.clone().lerp(b.points[j], t)), inward: a.inward.clone().lerp(b.inward, t).normalize() };
  };
  // Slightly bowed steel mullions stand proud of the black printed boards.
  for (let distance = 8; distance < sections.at(-1)!.distance; distance += BANNER_WIDTH) {
    const s = atDistance(distance), height = BANNER_HEIGHT * taper(s);
    const geo = new T.PlaneGeometry(.095, height, 1, 12), p = geo.getAttribute('position');
    const tangent = new T.Vector3(s.inward.z, 0, -s.inward.x);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i) + height / 2;
      const point = lipPoint(s, .20 + y, .04 + Math.sin(y / Math.max(.001, height) * Math.PI) * .045).addScaledVector(tangent, x);
      p.setXYZ(i, point.x, point.y, point.z);
    }
    geo.computeVertexNormals(); add(geo, materials.trim);
  }
  for (let distance = 4; distance < sections.at(-1)!.distance; distance += 8) {
    const s = atDistance(distance);
    if (s.points.at(-1)!.y < FIELD.rampRadius - .05) continue;
    const index = s.points.length - 2, center = s.points[index].clone();
    const up = s.points[index + 1].clone().sub(s.points[index - 1]).normalize();
    const normal = new T.Vector3(s.inward.x * up.y, Math.hypot(up.x, up.z), s.inward.z * up.y).normalize();
    const tangent = new T.Vector3().crossVectors(up, normal).normalize();
    const matrix = new T.Matrix4().makeBasis(tangent, up, normal);
    matrix.setPosition(center.clone().addScaledVector(normal, .035)); add(frameGeometry.clone().applyMatrix4(matrix), materials.trim);
    matrix.setPosition(center.clone().addScaledVector(normal, .042)); add(housingGeometry.clone().applyMatrix4(matrix), materials.housing);
    matrix.setPosition(center.clone().addScaledVector(normal, .049)); add(lampGeometry.clone().applyMatrix4(matrix), materials.lamp);
  }
  frameGeometry.dispose(); housingGeometry.dispose(); lampGeometry.dispose();
  for (const [mat, geometries] of batches) {
    const mesh = new T.Mesh(mergeGeometries(geometries), mat); mesh.name = mat === materials.lamp ? 'ramp-inset-lights' : mat === materials.trim ? 'ramp-painted-hardware' : 'ramp-light-housings'; root.add(mesh);
    geometries.forEach(g => g.dispose());
  }
}
