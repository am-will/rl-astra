import * as T from 'three';
import { FIELD } from './config';

// A single surface definition feeds both Rapier and Three. No overlapping ramp
// boxes: floor fillets, rounded corner seams and goal returns share their edges.
export type SurfaceKind = 'ramp' | 'wall' | 'ceiling' | 'goal-ramp' | 'goal-net' | 'goal-side';
export interface ArenaSurface { geometry: T.BufferGeometry; kind: SurfaceKind; team: number; }
export interface BoundaryPoint { x: number; z: number; nx: number; nz: number; distance: number; }
type P = [number, number];
const smooth = (x: number) => { const t = T.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); };

function path(points: P[], rounding: number, cornerFraction = .4): BoundaryPoint[] {
  const samples: P[] = [];
  const line = (a: P, b: P) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(length / .7));
    const stops = Array.from({ length: n }, (_, i) => i / n);
    // Extra samples only around the compact returns at the two goalposts.
    for (let distance = .1; distance < Math.min(1.6, length); distance += .1) {
      if (a === points[0]) stops.push(distance / length);
      if (b === points.at(-1)) stops.push(1 - distance / length);
    }
    for (const t of [...new Set(stops)].sort((x, y) => x - y)) samples.push([T.MathUtils.lerp(a[0], b[0], t), T.MathUtils.lerp(a[1], b[1], t)]);
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

export const GOAL_MOUTH_RADIUS = 1.35;
// Estimated from the side reference: the upper arm slopes down about 16 degrees
// into the goal, while the sill rises only about 2.5 degrees. The side panels
// remain planar; this asymmetric profile is extruded across the full width.
export const GOAL_PROFILE = { lowerEnd: new T.Vector2(5.7, .25), back: new T.Vector2(FIELD.goalDepth, 2.4), upperEnd: new T.Vector2(5.9, 4.72) };
export function goalSideProfile(inset = 0): T.Vector2[] {
  const { lowerEnd: lower, back, upperEnd: upper } = GOAL_PROFILE;
  const points: T.Vector2[] = [];
  for (let i = 0; i <= 20; i++) points.push(lower.clone().multiplyScalar(i / 20));
  const lowerCurve = new T.CubicBezierCurve(lower, lower.clone().add(new T.Vector2(1.8, 1.8 * lower.y / lower.x)), back.clone().add(new T.Vector2(0, -1.45)), back);
  const upperSlope = (FIELD.goalHeight - upper.y) / upper.x;
  const upperCurve = new T.CubicBezierCurve(back, back.clone().add(new T.Vector2(0, 1.4)), upper.clone().add(new T.Vector2(1.75, -1.75 * upperSlope)), upper);
  for (let i = 1; i <= 36; i++) points.push(lowerCurve.getPoint(i / 36));
  for (let i = 1; i <= 36; i++) points.push(upperCurve.getPoint(i / 36));
  for (let i = 1; i <= 20; i++) points.push(upper.clone().lerp(new T.Vector2(0, FIELD.goalHeight), i / 20));
  if (!inset) return points;
  return points.map((p, i) => {
    const tangent = points[Math.min(points.length - 1, i + 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
    const result = p.clone().addScaledVector(new T.Vector2(-tangent.y, tangent.x), inset);
    if (i === 0 || i === points.length - 1) result.x = 0;
    return result;
  });
}
export function goalArchHeight(x: number) {
  const radius = GOAL_MOUTH_RADIUS, delta = Math.max(0, Math.abs(x) - FIELD.goalWidth + radius);
  return FIELD.goalHeight - radius + Math.sqrt(Math.max(0, radius * radius - delta * delta));
}
export function arenaSurfaces(): ArenaSurface[] {
  const surfaces: ArenaSurface[] = [];
  const { length: l, height: h, rampRadius: r, goalWidth: g, goalDepth: d } = FIELD;
  const add = (geometry: T.BufferGeometry, kind: SurfaceKind, team = 0) => surfaces.push({ geometry, kind, team });
  // Hold the full quarter-round up to the post, then tuck its last short
  // return into the mouth instead of flattening several metres early.
  const bottomRadius = (p: BoundaryPoint) => r * smooth((Math.abs(p.x) - g) / 1.5);
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
    const profile = goalSideProfile();
    const distances = new Map<T.Vector2, number>(); let distance = 0;
    profile.forEach((p, i) => { if (i) distance += p.distanceTo(profile[i - 1]); distances.set(p, distance); });
    const wrap = (points: T.Vector2[]) => {
      const geometry = grid(points.length - 1, 32, (u, v) => {
        const p = points[Math.round(u * (points.length - 1))];
        return { p: [(v * 2 - 1) * g, p.y, s * (l + p.x)], uv: [(v * 2 - 1) * g, distances.get(p)!] };
      });
      return s > 0 ? reverse(geometry) : geometry;
    };
    add(wrap(profile.filter(p => p.y <= GOAL_PROFILE.back.y + 1e-6)), 'goal-ramp', s);
    add(wrap(profile.filter(p => p.y >= GOAL_PROFILE.back.y - 1e-6)), 'goal-net', s);
    for (const side of [-1, 1]) {
      const geometry = new T.ShapeGeometry(new T.Shape(profile));
      const positions = geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) { const depth = positions.getX(i), y = positions.getY(i); positions.setXYZ(i, side * g, y, s * (l + depth)); }
      if (side * s < 0) reverse(geometry); else geometry.computeVertexNormals();
      add(geometry, 'goal-side', s);
    }
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

export function honeycombMaterial(opacity = .22, team = 0, backOpacity = opacity) {
  return new T.ShaderMaterial({
    transparent: true, depthWrite: false, side: T.DoubleSide,
    uniforms: { opacity: { value: opacity }, backOpacity: { value: backOpacity }, team: { value: team }, visibility: { value: 1 } },
    vertexShader: `varying vec2 vUv; varying vec3 vWorld; varying float vDistance;
      void main(){vUv=uv;vec4 w=modelMatrix*vec4(position,1.);vWorld=w.xyz;vec4 mv=viewMatrix*w;vDistance=length(mv.xyz);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `varying vec2 vUv; varying vec3 vWorld; varying float vDistance; uniform float opacity;uniform float backOpacity;uniform float team;uniform float visibility;
      void main(){vec2 p=vUv*(team!=0.?1.45:.85);vec2 tile=vec2(1.,1.7320508);vec2 a=mod(p,tile)-tile*.5;vec2 b=mod(p-tile*.5,tile)-tile*.5;vec2 q=dot(a,a)<dot(b,b)?a:b;
      float edge=.5-max(abs(q.x),dot(abs(q),vec2(.5,.8660254)));float aa=max(fwidth(edge),.002);
      float line=1.-smoothstep(.009,.009+aa,edge);float nearFade=smoothstep(1.5,4.,vDistance);
      vec3 blue=vec3(.13,.55,1.);vec3 orange=vec3(1.,.47,.13);vec3 tint=mix(orange,blue,smoothstep(-9.,9.,vWorld.z));
      tint=mix(vec3(.42,.58,.72),tint,.35);if(team!=0.)tint=team>0.?blue:orange;
      // Outside views keep the same faint grid as ramp backs; only inner faces
      // receive the wall-proximity fade. The lens-distance fade still applies.
      float faceOpacity=gl_FrontFacing?opacity:backOpacity;
      float faceVisibility=gl_FrontFacing?visibility:1.;
      float alpha=(line*faceOpacity+.004)*nearFade*faceVisibility;gl_FragColor=vec4(tint*1.5,alpha);}`,
  });
}
