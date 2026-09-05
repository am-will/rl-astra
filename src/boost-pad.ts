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

/** Shared three-lobed metal housing and recessed emitter. */
function createBoostPadHousing(triangular = false) {
  const root = new T.Group(), housing = new T.Group(), pickup = new T.Group(), emitters = new T.Group();
  housing.name = 'boost-pad-housing'; pickup.name = 'boost-pad-pickup';
  root.add(housing, pickup); pickup.add(emitters);
  // Diffuse lighting keeps the pads readable without moving specular/environment glints.
  const dark = new T.MeshLambertMaterial({ color: 0x17212b, reflectivity: 0 });
  const silver = new T.MeshLambertMaterial({ color: 0xc1ccd6, reflectivity: 0 });
  const panel = new T.MeshLambertMaterial({ color: 0x485363, reflectivity: 0 });
  const amber = new T.MeshLambertMaterial({ color: 0xffb532, reflectivity: 0, emissive: 0xff9b16, emissiveIntensity: 1.65, transparent: true, depthWrite: false });

  const outline = (radius: number) => {
    const shape = new T.Shape();
    if (triangular) {
      const corners = Array.from({ length: 3 }, (_, i) => new T.Vector2(Math.cos(i * Math.PI * 2 / 3), Math.sin(i * Math.PI * 2 / 3)).multiplyScalar(radius + .38));
      for (let i = 0; i < 3; i++) {
        const corner = corners[i], next = corners[(i + 1) % 3];
        const entry = corner.clone().lerp(corners[(i + 2) % 3], .12), exit = corner.clone().lerp(next, .12);
        if (!i) shape.moveTo(entry.x, entry.y);
        shape.quadraticCurveTo(corner.x, corner.y, exit.x, exit.y);
        const nextEntry = next.clone().lerp(corner, .12), middle = exit.clone().add(nextEntry).normalize().multiplyScalar(radius * 1.04);
        shape.quadraticCurveTo(middle.x, middle.y, nextEntry.x, nextEntry.y);
      }
      shape.closePath(); return shape;
    }
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
    plate(sector(triangular ? .9 : .96, triangular ? 1.035 : 1.15, angle + Math.PI / 3, .36), .004, .003, .061, panel);
    for (const side of [-1, 1]) {
      const a = angle + side * .41;
      const fastener = new T.Mesh(new T.CylinderGeometry(.031, .035, .012, 6), dark);
      fastener.position.set(Math.cos(a) * 1.19, .074, -Math.sin(a) * 1.19); housing.add(fastener);
    }
  }
  mergeStatic(housing); mergeStatic(emitters);
  housing.traverse(o => { if (o instanceof T.Mesh) o.castShadow = false; });
  emitters.traverse(o => { if (o instanceof T.Mesh) { o.castShadow = false; o.receiveShadow = false; } });

  return { root, housing, pickup, emitters, amber };
}

export function createLargeBoostPad(glow: T.Texture) {
  const { root, pickup, amber } = createBoostPadHousing();
  root.name = 'large-boost-pad';
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
  const { root, pickup, amber } = createBoostPadHousing(true);
  root.name = 'small-boost-pad'; root.scale.setScalar(.58);
  amber.color.setHex(0xff961c); amber.emissive.setHex(0xff7008);
  // The small pickup is a flat silver three-spoke plate with a central amber
  // disk and short translucent energy curtains, as in the supplied reference.
  const energyMaterial = new T.ShaderMaterial({
    transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending,
    uniforms: { time: { value: 0 }, fade: { value: 1 } },
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float time,fade;varying vec2 vUv;
      void main(){float edge=smoothstep(0.,.08,vUv.x)*smoothstep(0.,.08,1.-vUv.x);
        float grain=.8+.12*sin(vUv.x*18.+time*2.4)+.08*sin(vUv.x*33.-vUv.y*13.+time*6.);
        float rise=pow(1.-vUv.y,1.7);float rim=exp(-vUv.y*22.);
        vec3 tint=mix(vec3(1.,.39,.025),vec3(1.,.84,.16),rim);
        gl_FragColor=vec4(tint*(1.+rim),edge*(rise*.65*grain+rim*.45)*fade);}`,
  });
  const diskMaterial = new T.ShaderMaterial({
    uniforms: energyMaterial.uniforms,
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float fade;varying vec2 vUv;void main(){
      float r=length(vUv*2.-1.);float center=exp(-r*r*4.5),ring=exp(-pow(r-.73,2.)*1900.);
      vec3 color=vec3(.13,.07,.025)+vec3(1.,.46,.015)*center+vec3(.65,.43,.025)*ring;
      color+=vec3(.1,.3,.055)*exp(-r*r*20.);
      gl_FragColor=vec4(color*fade,1.);}`,
  });
  const disk = new T.Mesh(new T.CircleGeometry(.44, 48), diskMaterial);
  disk.rotation.x = -Math.PI / 2; disk.position.y = .101; pickup.add(disk);
  const curtains = new T.Group(); curtains.name = 'small-pad-energy'; pickup.add(curtains);
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3;
    for (const [radius, height, span, offset] of [[.58, .55, 1.5, Math.PI / 3], [1.18, .42, .48, 0]]) {
      const arc = new T.Mesh(new T.CylinderGeometry(radius, radius, height, 24, 1, true, angle + offset - span / 2, span), energyMaterial);
      arc.rotation.y = Math.PI / 2; arc.position.y = .11 + height / 2; curtains.add(arc);
    }
  }
  mergeStatic(curtains);
  curtains.children.forEach(o => { if (o instanceof T.Mesh) { o.castShadow = false; o.receiveShadow = false; } });
  const progress = collectionProgress(.12);
  const update = (cooldown: number, time: number) => {
    const p = progress(cooldown, time), fade = 1 - T.MathUtils.smoothstep(p, 0, 1);
    pickup.visible = p < 1;
    curtains.scale.y = Math.max(.001, 1 - p * .9);
    energyMaterial.uniforms.time.value = time; energyMaterial.uniforms.fade.value = fade;
    amber.opacity = fade; amber.emissiveIntensity = .85 * fade;
  };
  return { root, update };
}
