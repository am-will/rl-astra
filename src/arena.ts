import * as T from 'three';
import { FIELD } from './config';

// A single surface definition feeds both Rapier and Three. No overlapping ramp
// boxes: floor fillets, rounded corner seams and goal returns share their edges.
export type SurfaceKind = 'ramp' | 'wall' | 'ceiling' | 'goal-ramp' | 'goal-net';
export interface ArenaSurface { geometry: T.BufferGeometry; kind: SurfaceKind; team: number; }
export interface BoundaryPoint { x: number; z: number; nx: number; nz: number; distance: number; }
type P = [number, number];
const smooth = (x: number) => { const t = T.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); };

function path(points: P[], rounding: number, cornerFraction = .4): BoundaryPoint[] {
  const samples: P[] = [];
  const line = (a: P, b: P) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / .7));
    for (let i = 0; i < n; i++) samples.push([T.MathUtils.lerp(a[0], b[0], i / n), T.MathUtils.lerp(a[1], b[1], i / n)]);
  };
  let last = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const a = new T.Vector2(...points[i - 1]), b = new T.Vector2(...points[i]), c = new T.Vector2(...points[i + 1]);
    const radius = Math.min(rounding, a.distanceTo(b) * cornerFraction, b.distanceTo(c) * cornerFraction);
    const from = b.clone().addScaledVector(a.sub(b).normalize(), radius), to = b.clone().addScaledVector(c.sub(b).normalize(), radius);
    line(last, from.toArray() as P);
    for (let k = 0; k < 20; k++) {
      const t = k / 20, p = from.clone().multiplyScalar((1 - t) ** 2).addScaledVector(b, 2 * t * (1 - t)).addScaledVector(to, t * t);
      samples.push(p.toArray() as P);
    }
    last = to.toArray() as P;
  }
  line(last, points.at(-1)!); samples.push(points.at(-1)!);
  let distance = 0;
  return samples.map((p, i) => {
    const prev = samples[Math.max(0, i - 1)], next = samples[Math.min(samples.length - 1, i + 1)];
    const dx = next[0] - prev[0], dz = next[1] - prev[1], length = Math.hypot(dx, dz);
    if (i) distance += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    return { x: p[0], z: p[1], nx: -dz / length, nz: dx / length, distance };
  });
}

export function sideBoundary(side: number): BoundaryPoint[] {
  const { width: w, length: l, cornerCut: c, goalWidth: g } = FIELD;
  return path([[g, l], [w - c, l], [w, l - c], [w, -l + c], [w - c, -l], [g, -l]], 3.3)
    .map(p => ({ ...p, x: p.x * side, nx: p.nx * side }));
}

function grid(rows: number, columns: number, point: (u: number, v: number) => { p: number[]; uv: number[] }): T.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let i = 0; i <= rows; i++) for (let j = 0; j <= columns; j++) {
    const value = point(i / rows, j / columns); positions.push(...value.p); uvs.push(...value.uv);
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < columns; j++) {
    const a = i * (columns + 1) + j, b = a + columns + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}
function sweep(boundary: BoundaryPoint[], segments: number, section: (p: BoundaryPoint, v: number) => [number, number]) {
  const geometry = grid(boundary.length - 1, segments, (u, v) => {
    const p = boundary[Math.round(u * (boundary.length - 1))], [offset, height] = section(p, v);
    return { p: [p.x + p.nx * offset, height, p.z + p.nz * offset], uv: [p.distance, height] };
  });
  const a = boundary[0], b = boundary[1];
  if ((b.x - a.x) * a.nz - (b.z - a.z) * a.nx < 0) reverse(geometry);
  return geometry;
}
function reverse(geometry: T.BufferGeometry) {
  const index = geometry.index!;
  for (let i = 0; i < index.count; i += 3) { const a = index.getX(i); index.setX(i, index.getX(i + 1)); index.setX(i + 1, a); }
  geometry.computeVertexNormals(); return geometry;
}

export function goalArchHeight(x: number) {
  const radius = 1.2, delta = Math.max(0, Math.abs(x) - FIELD.goalWidth + radius);
  return FIELD.goalHeight - radius + Math.sqrt(Math.max(0, radius * radius - delta * delta));
}
export function arenaSurfaces(): ArenaSurface[] {
  const surfaces: ArenaSurface[] = [];
  const { width: w, length: l, height: h, rampRadius: r, goalWidth: g, goalHeight: gh, goalDepth: d } = FIELD;
  const add = (geometry: T.BufferGeometry, kind: SurfaceKind, team = 0) => surfaces.push({ geometry, kind, team });
  const bottomRadius = (p: BoundaryPoint) => r * smooth((Math.abs(p.x) - g) / 5.2);
  for (const side of [-1, 1]) {
    const boundary = sideBoundary(side);
    add(sweep(boundary, 24, (p, v) => { const radius = bottomRadius(p), a = v * Math.PI / 2; return [radius * (Math.sin(a) - 1), radius * (1 - Math.cos(a))]; }), 'ramp');
    add(sweep(boundary, 12, (p, v) => [0, T.MathUtils.lerp(bottomRadius(p), h - r, v)]), 'wall');
    add(sweep(boundary, 20, (_, v) => { const a = v * Math.PI / 2; return [r * (Math.cos(a) - 1), h - r + r * Math.sin(a)]; }), 'wall');
  }
  for (const s of [-1, 1]) {
    const start = surfaces.length;
    // Above the rounded goal mouth, continue the end wall into the roof fillet.
    add(grid(64, 12, (u, v) => { const x = (u * 2 - 1) * g; const y = T.MathUtils.lerp(goalArchHeight(x), h - r, v); return { p: [x, y, s * l], uv: [x, y] }; }), 'wall');
    add(grid(32, 20, (u, v) => { const a = v * Math.PI / 2; return { p: [(u * 2 - 1) * g, h - r + r * Math.sin(a), s * (l - r + r * Math.cos(a))], uv: [u * g * 2, h - r + r * a] }; }), 'wall');
    if (s < 0) surfaces.slice(start).forEach(surface => reverse(surface.geometry));
    const goal = path([[-g, l], [-g, l + d], [g, l + d], [g, l]], 4.05, .46).map(p => ({ ...p, z: p.z * s, nz: p.nz * s }));
    // Full field-sized fillets inside the net, tapering flush into the posts.
    // The wider plan-view corners leave room for the inward floor offset.
    const goalRadius = (p: BoundaryPoint) => r * smooth((Math.abs(p.z) - l) / 4.2);
    add(sweep(goal, 26, (p, v) => { const radius = goalRadius(p), a = v * Math.PI / 2; return [radius * (Math.sin(a) - 1), radius * (1 - Math.cos(a))]; }), 'goal-ramp', s);
    add(sweep(goal, 10, (p, v) => [0, T.MathUtils.lerp(goalRadius(p), gh - 1.2, v)]), 'goal-net', s);
    add(sweep(goal, 18, (_, v) => { const a = v * Math.PI / 2; return [1.2 * (Math.cos(a) - 1), gh - 1.2 + 1.2 * Math.sin(a)]; }), 'goal-net', s);
    const contour = goal.map(p => new T.Vector2(p.x - p.nx * 1.2, p.z - p.nz * 1.2));
    add(horizontalPolygon(contour, gh), 'goal-net', s);
  }
  const right = sideBoundary(1), left = sideBoundary(-1).reverse();
  const contour = [...right, ...left].map(p => new T.Vector2(p.x - p.nx * r, p.z - p.nz * r));
  add(horizontalPolygon(contour, h), 'ceiling');
  return surfaces;
}
function horizontalPolygon(contour: T.Vector2[], height: number) {
  const geometry = new T.ShapeGeometry(new T.Shape(contour));
  const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  for (let i = 0; i < positions.count; i++) { const x = positions.getX(i), z = positions.getY(i); positions.setXYZ(i, x, height, z); uv.setXY(i, x, z); }
  geometry.computeVertexNormals(); return geometry;
}

export function honeycombMaterial(opacity = .22, team = 0) {
  return new T.ShaderMaterial({
    transparent: true, depthWrite: false, side: T.DoubleSide,
    uniforms: { opacity: { value: opacity }, team: { value: team }, visibility: { value: 1 } },
    vertexShader: `varying vec2 vUv; varying vec3 vWorld; varying float vDistance;
      void main(){vUv=uv;vec4 w=modelMatrix*vec4(position,1.);vWorld=w.xyz;vec4 mv=viewMatrix*w;vDistance=length(mv.xyz);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `varying vec2 vUv; varying vec3 vWorld; varying float vDistance; uniform float opacity;uniform float team;uniform float visibility;
      void main(){vec2 p=vUv*.85;vec2 tile=vec2(1.,1.7320508);vec2 a=mod(p,tile)-tile*.5;vec2 b=mod(p-tile*.5,tile)-tile*.5;vec2 q=dot(a,a)<dot(b,b)?a:b;
      float edge=.5-max(abs(q.x),dot(abs(q),vec2(.5,.8660254)));float aa=max(fwidth(edge),.002);
      float line=1.-smoothstep(.009,.009+aa,edge);float nearFade=smoothstep(1.5,4.,vDistance);
      vec3 blue=vec3(.13,.55,1.);vec3 orange=vec3(1.,.47,.13);vec3 tint=mix(orange,blue,smoothstep(-9.,9.,vWorld.z));
      tint=mix(vec3(.42,.58,.72),tint,.35);if(team!=0.)tint=team>0.?blue:orange;
      float alpha=(line*opacity+.004)*nearFade*visibility;gl_FragColor=vec4(tint*1.5,alpha);}`,
  });
}
