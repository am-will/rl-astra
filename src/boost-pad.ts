import * as T from 'three';
import { mergeStatic } from './assets';

/** Low, three-lobed metal housing with a recessed emitter and amber edge inserts. */
export function createLargeBoostPad(glow: T.Texture) {
  const root = new T.Group(), housing = new T.Group(), pickup = new T.Group(), emitters = new T.Group();
  root.name = 'large-boost-pad'; housing.name = 'boost-pad-housing'; pickup.name = 'boost-pad-pickup';
  root.add(housing, pickup); pickup.add(emitters);
  const dark = new T.MeshStandardMaterial({ color: 0x17212b, metalness: .55, roughness: .52 });
  const silver = new T.MeshStandardMaterial({ color: 0xc1ccd6, metalness: .62, roughness: .36 });
  const panel = new T.MeshStandardMaterial({ color: 0x485363, metalness: .55, roughness: .45 });
  const amber = new T.MeshStandardMaterial({ color: 0xffb532, emissive: 0xff9b16, emissiveIntensity: 1.65 });

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

  const orb = new T.Mesh(new T.SphereGeometry(.32, 24, 16), amber); orb.position.y = .8; pickup.add(orb);
  const halo = new T.Mesh(new T.PlaneGeometry(3.2, 3.2), new T.MeshBasicMaterial({ map: glow, color: 0xffb82b, transparent: true, opacity: .18, depthWrite: false, blending: T.AdditiveBlending }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = -.018; pickup.add(halo);
  const energy = new T.Mesh(new T.CylinderGeometry(.06, .16, .5, 10, 1, true), new T.MeshBasicMaterial({ color: 0xffbb3d, transparent: true, opacity: .22, depthWrite: false, blending: T.AdditiveBlending }));
  energy.position.y = .4; pickup.add(energy);
  return { root, pickup, orb };
}
