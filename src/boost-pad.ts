import * as T from 'three';
import { mergeStatic } from './assets';

// Animate the available -> collected edge on the render clock. A pad that is
// already empty when loaded stays empty; replenishing or resetting cancels it.
function collectionProgress(duration: number) {
  let available = false, collectedAt = -Infinity;
  return (cooldown: number, time: number) => {
    if (available && cooldown > 0) collectedAt = time;
    available = cooldown <= 0;
    return available ? 0 : T.MathUtils.clamp((time - collectedAt) / duration, 0, 1);
  };
}

/** Low, three-lobed metal housing with a recessed emitter and amber edge inserts. */
export function createLargeBoostPad(glow: T.Texture) {
  const root = new T.Group(), housing = new T.Group(), pickup = new T.Group(), emitters = new T.Group();
  root.name = 'large-boost-pad'; housing.name = 'boost-pad-housing'; pickup.name = 'boost-pad-pickup';
  root.add(housing, pickup); pickup.add(emitters);
  const dark = new T.MeshStandardMaterial({ color: 0x17212b, metalness: .55, roughness: .52 });
  const silver = new T.MeshStandardMaterial({ color: 0xc1ccd6, metalness: .62, roughness: .36 });
  const panel = new T.MeshStandardMaterial({ color: 0x485363, metalness: .55, roughness: .45 });
  const amber = new T.MeshStandardMaterial({ color: 0xffb532, emissive: 0xff9b16, emissiveIntensity: 1.65, transparent: true, depthWrite: false });

  const outline = (radius: number) => {
    const shape = new T.Shape();
    for (let i = 0; i <= 96; i++) {
      const a = i / 96 * Math.PI * 2, r = radius + .15 * Math.cos(a * 3);
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i) shape.lineTo(x, y); else shape.moveTo(x, y);
    }
    shape.closePath(); return shape;
  };
  const plate = (shape: T.Shape, depth: number, bevel: number, y: number, material: T.Material, parent = housing) => {
    const geometry = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, steps: 1, curveSegments: 24 });
    geometry.rotateX(-Math.PI / 2);
    const mesh = new T.Mesh(geometry, material); mesh.position.y = y; parent.add(mesh); return mesh;
  };
  const sector = (inner: number, outer: number, angle: number, halfWidth: number) => {
    const shape = new T.Shape(), a = angle - halfWidth, b = angle + halfWidth;
    shape.moveTo(Math.cos(a) * outer, Math.sin(a) * outer);
    shape.absarc(0, 0, outer, a, b, false);
    shape.lineTo(Math.cos(b) * inner, Math.sin(b) * inner);
    shape.absarc(0, 0, inner, b, a, true); shape.closePath(); return shape;
  };
  plate(outline(1.28), .04, .018, -.025, dark);
  plate(outline(1.25), .022, .014, .022, silver);

  const socket = new T.Mesh(new T.LatheGeometry([
    new T.Vector2(.96, .061), new T.Vector2(.88, .13),
    new T.Vector2(.66, .13), new T.Vector2(.59, .078),
  ], 64), dark); housing.add(socket);
  const rim = new T.Mesh(new T.RingGeometry(.76, .875, 64), silver);
  rim.rotation.x = -Math.PI / 2; rim.position.y = .132; housing.add(rim);
  const well = new T.Mesh(new T.CylinderGeometry(.60, .60, .02, 48), panel);
  well.position.y = .07; housing.add(well);
  const core = new T.Mesh(new T.CylinderGeometry(.42, .47, .012, 48), amber);
  core.position.y = .087; emitters.add(core);
  const coreRing = new T.Mesh(new T.TorusGeometry(.49, .014, 6, 64), amber);
  coreRing.rotation.x = -Math.PI / 2; coreRing.position.y = .087; emitters.add(coreRing);

  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3;
    plate(sector(.94, 1.30, angle, .31), .027, .012, .06, dark);
    plate(sector(1.07, 1.26, angle, .235), .008, .009, .097, amber, emitters);
    // Inset dark panels leave a clean silver ring and three broad metal spokes.
    plate(sector(.96, 1.15, angle + Math.PI / 3, .36), .004, .003, .061, panel);
    for (const side of [-1, 1]) {
      const a = angle + side * .41;
      const fastener = new T.Mesh(new T.CylinderGeometry(.031, .035, .012, 6), dark);
      fastener.position.set(Math.cos(a) * 1.19, .074, -Math.sin(a) * 1.19); housing.add(fastener);
    }
  }
  mergeStatic(housing); mergeStatic(emitters);
  housing.traverse(o => { if (o instanceof T.Mesh) o.castShadow = false; });
  emitters.traverse(o => { if (o instanceof T.Mesh) { o.castShadow = false; o.receiveShadow = false; } });

  const orbMaterial = amber.clone(); orbMaterial.transparent = false; orbMaterial.depthWrite = true;
  const orb = new T.Mesh(new T.SphereGeometry(.32, 24, 16), orbMaterial); orb.position.y = .8; pickup.add(orb);
  const halo = new T.Mesh(new T.PlaneGeometry(3.2, 3.2), new T.MeshBasicMaterial({ map: glow, color: 0xffb82b, transparent: true, opacity: .18, depthWrite: false, blending: T.AdditiveBlending }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = -.018; pickup.add(halo);
  const energy = new T.Mesh(new T.CylinderGeometry(.06, .16, .5, 10, 1, true), new T.MeshBasicMaterial({ color: 0xffbb3d, transparent: true, opacity: .22, depthWrite: false, blending: T.AdditiveBlending }));
  energy.position.y = .4; pickup.add(energy);
  const progress = collectionProgress(.18);
  let hoverHeight = .8;
  const update = (cooldown: number, time: number) => {
    const p = progress(cooldown, time), remaining = 1 - p, sink = p * p;
    pickup.visible = p < 1;
    if (cooldown <= 0) hoverHeight = .8 + Math.sin(time * 3) * .12;
    // Pin the start to its current hover height, stretch downward, then draw
    // the last of the orb into the well. The metal housing never moves.
    orb.rotation.y = time * 1.5;
    orb.position.y = T.MathUtils.lerp(hoverHeight, .075, sink);
    const width = Math.max(.001, Math.pow(remaining, .8));
    orb.scale.set(width, Math.max(.001, (1 + Math.sin(p * Math.PI) * .55) * (1 - p * p * p)), width);
    amber.opacity = remaining * remaining;
    amber.emissiveIntensity = 1.65 * remaining;
    halo.scale.setScalar(1 - sink * .88); halo.material.opacity = .18 * remaining * remaining;
    energy.position.y = T.MathUtils.lerp(.4, .075, sink);
    energy.scale.set(width, Math.max(.001, remaining), width); energy.material.opacity = .22 * remaining;
  };
  return { root, pickup, orb, update };
}

export function createSmallBoostPad() {
  const root = new T.Group(); root.name = 'small-boost-pad';
  const base = new T.Mesh(new T.CylinderGeometry(.65, .8, .07, 12), new T.MeshStandardMaterial({ color: 0x253232, metalness: .8, roughness: .4 })); root.add(base);
  const ring = new T.Mesh(new T.TorusGeometry(.49, .055, 6, 24), new T.MeshStandardMaterial({ color: 0xc39a42, metalness: .65, roughness: .35 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = .055; root.add(ring);
  const glow = new T.MeshStandardMaterial({ color: 0xffa132, emissive: 0xff901b, emissiveIntensity: 1.7, transparent: true, depthWrite: false });
  const light = new T.Mesh(new T.CylinderGeometry(.32, .4, .06, 8), glow); light.name = 'boost-pad-pickup'; light.position.y = .1; root.add(light);
  const progress = collectionProgress(.12);
  const update = (cooldown: number, time: number) => {
    const p = progress(cooldown, time), fade = 1 - T.MathUtils.smoothstep(p, 0, 1);
    light.visible = p < 1;
    light.scale.set(1 - p * .3, 1 - p * .65, 1 - p * .3);
    light.position.y = .1 - p * .045;
    glow.opacity = fade; glow.emissiveIntensity = 1.7 * fade;
  };
  return { root, update };
}
