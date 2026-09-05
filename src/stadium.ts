import * as T from 'three';
import { box, cylinderBetween, labelTexture, material, mergeStatic } from './assets';
import { FIELD, BLUE, ORANGE } from './config';
import type { Pad } from './physics';
import { detailedCar, detailedBall } from './models';
import { arenaSurfaces, sideBoundary, honeycombMaterial } from './arena';
import { createLargeBoostPad, createSmallBoostPad } from './boost-pad';
import { createGoalFrame } from './goal-frame';
import { UltraGrass } from './ultra-grass';
import { rampMaterial, decorateRamp } from './ramp-decoration';
import { StadiumPresentation } from './stadium-presentation';

function turfTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 2048;
  const c = canvas.getContext('2d')!, w = canvas.width, h = canvas.height;
  c.fillStyle = '#1b3519'; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 16; i++) { c.fillStyle = i % 2 ? '#294727' : '#1b3519'; c.fillRect(0, i * h / 16, w, h / 16); }
  let seed = 129;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 290000; i++) { c.fillStyle = rand() > .5 ? 'rgba(155,181,108,.035)' : 'rgba(10,30,19,.035)'; c.fillRect(rand() * w, rand() * h, .6 + rand() * 1.3, 1 + rand() * 4); }
  const px = (x: number) => (x / (FIELD.width * 2) + .5) * w, pz = (z: number) => (z / (FIELD.length * 2) + .5) * h;
  c.strokeStyle = '#c2cbb1'; c.lineWidth = 5;
  const outline = [...sideBoundary(1), ...sideBoundary(-1).reverse()];
  c.beginPath(); outline.forEach((p, i) => { const x = px(p.x - p.nx * (FIELD.rampRadius + .5)), z = pz(p.z - p.nz * (FIELD.rampRadius + .5)); i ? c.lineTo(x, z) : c.moveTo(x, z); }); c.closePath(); c.stroke();
  c.beginPath(); c.moveTo(px(-35), h / 2); c.lineTo(px(35), h / 2); c.stroke();
  c.beginPath(); c.ellipse(w / 2, h / 2, 9.4 * w / (FIELD.width * 2), 9.4 * h / (FIELD.length * 2), 0, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#b9cbb3'; c.beginPath(); c.arc(w / 2, h / 2, 8, 0, Math.PI * 2); c.fill();
  for (const s of [-1, 1]) {
    const z = s * FIELD.length;
    c.fillStyle = s === 1 ? 'rgba(18,119,223,.27)' : 'rgba(221,104,21,.22)';
    c.fillRect(px(-17), pz(s < 0 ? z : z - 10.5), 34 * w / (FIELD.width * 2), 10.5 * h / (FIELD.length * 2));
    c.strokeStyle = s === 1 ? '#52b2e2' : '#dba870'; c.lineWidth = 6;
    c.beginPath(); c.moveTo(px(-17), pz(z)); c.lineTo(px(-17), pz(z - s * 11)); c.lineTo(px(17), pz(z - s * 11)); c.lineTo(px(17), pz(z)); c.stroke();
    c.strokeStyle = 'rgba(186,208,178,.7)'; c.lineWidth = 4;
    c.beginPath(); c.ellipse(px(0), pz(z - s * 8), 8 * w / (FIELD.width * 2), 8 * h / (FIELD.length * 2), 0, s === 1 ? Math.PI : 0, s === 1 ? Math.PI * 2 : Math.PI); c.stroke();
    c.font = 'italic 900 53px Arial'; c.textAlign = 'center'; c.fillStyle = 'rgba(170,205,162,.18)';
    c.save(); c.translate(px(0), pz(s * 22)); if (s > 0) c.rotate(Math.PI); c.fillText('CHAMPIONS', 0, 0); c.font = '600 24px Arial'; c.fillText('F I E L D', 0, 35); c.restore();
    // Team-coloured infield crests, chevrons and an etched outer lane.
    c.save(); c.translate(px(0), pz(s * 31)); if (s > 0) c.rotate(Math.PI);
    c.scale(w / (FIELD.width * 2), h / (FIELD.length * 2));
    c.fillStyle = s > 0 ? 'rgba(36,145,224,.42)' : 'rgba(227,128,44,.42)';
    c.strokeStyle = s > 0 ? 'rgba(121,203,244,.62)' : 'rgba(255,202,128,.62)'; c.lineWidth = .13;
    c.beginPath(); c.moveTo(-4,-3.5); c.lineTo(4,-3.5); c.lineTo(3.7,.9); c.quadraticCurveTo(3,3.5,0,5); c.quadraticCurveTo(-3,3.5,-3.7,.9); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = 'rgba(224,229,204,.5)';
    c.beginPath(); c.moveTo(0,-2.7); c.quadraticCurveTo(1.7,-1.1,1.1,1.4); c.lineTo(-1.1,1.4); c.quadraticCurveTo(-1.7,-1.1,0,-2.7); c.fill();
    c.beginPath(); c.moveTo(-1,0); c.lineTo(-2.3,2); c.lineTo(-1,1.4); c.moveTo(1,0); c.lineTo(2.3,2); c.lineTo(1,1.4); c.fill();
    c.fillRect(-.32,1.7,.64,1.4); c.restore();
    for (const lane of [-1,1]) for (let row=0;row<7;row++) {
      const x=lane*(25+(row%2)*1.5), z=s*(14+row*3.3);
      c.strokeStyle=s>0?'rgba(92,167,194,.21)':'rgba(203,161,78,.21)'; c.lineWidth=2;
      c.beginPath(); for(let k=0;k<6;k++){ const a=Math.PI/3*k; const xx=px(x+Math.cos(a)*1.4), zz=pz(z+Math.sin(a)*1.4); k?c.lineTo(xx,zz):c.moveTo(xx,zz); } c.closePath(); c.stroke();
    }
    c.lineWidth = 9; c.strokeStyle = s === 1 ? 'rgba(79,165,203,.4)' : 'rgba(208,157,77,.4)';
    for (const x of [-30, 30]) { c.beginPath(); c.moveTo(px(x), pz(s * 35)); c.lineTo(px(x + (x > 0 ? -3 : 3)), pz(s * 32)); c.stroke(); }
  }
  const tex = new T.CanvasTexture(canvas); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 8; return tex;
}
function grassDetail() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const c = canvas.getContext('2d')!; c.fillStyle = '#818181'; c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 13000; i++) {
    const shade = Math.floor(60 + Math.random() * 135); c.strokeStyle = `rgb(${shade},${shade},${shade})`; c.lineWidth = .4 + Math.random() * .6;
    const x = Math.random() * 256, y = Math.random() * 256; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (Math.random() - .5) * 3, y - 1 - Math.random() * 6); c.stroke();
  }
  const texture = new T.CanvasTexture(canvas); texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.repeat.set(54, 68); texture.anisotropy = 16; return texture;
}
const cameraFadeMaterials = new WeakMap<T.Material, T.Material>();
function fadeNearCamera(mesh: T.Mesh) {
  if (Array.isArray(mesh.material) || mesh.userData.cameraFadeOverlay) return;
  const solid = mesh.material;
  let blended = cameraFadeMaterials.get(solid);
  if (!blended) {
    blended = solid.clone(); blended.transparent = true; blended.depthWrite = false; blended.forceSinglePass = true;
    const originalCompile = solid.onBeforeCompile, originalKey = solid.customProgramCacheKey();
    for (const [mat, near] of [[solid, false], [blended, true]] as const) {
      // Distant geometry stays in the opaque pass, preserving net, glass and
      // stadium depth ordering. Only the nearby part uses alpha blending.
      mat.customProgramCacheKey = () => `${originalKey}:camera-fade:${near}`;
      mat.onBeforeCompile = function(shader, renderer) {
        originalCompile.call(this, shader, renderer);
        shader.vertexShader = 'varying vec3 vCameraRelativePosition;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvCameraRelativePosition = mvPosition.xyz;');
        shader.fragmentShader = 'varying vec3 vCameraRelativePosition;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', near ? `
          float distanceToCamera = length(vCameraRelativePosition);
          if (distanceToCamera >= 5.5) discard;
          diffuseColor.a *= smoothstep(2.5, 5.5, distanceToCamera);
          if (diffuseColor.a < .001) discard;
          #include <alphatest_fragment>
        ` : `
          if (length(vCameraRelativePosition) < 5.5) discard;
          #include <alphatest_fragment>
        `);
      };
    }
    cameraFadeMaterials.set(solid, blended);
  }
  const overlay = mesh instanceof T.InstancedMesh ? new T.InstancedMesh(mesh.geometry, blended, mesh.count) : new T.Mesh(mesh.geometry, blended);
  if (overlay instanceof T.InstancedMesh && mesh instanceof T.InstancedMesh) {
    overlay.instanceMatrix = mesh.instanceMatrix; overlay.instanceColor = mesh.instanceColor;
  }
  overlay.name = 'camera-fade-overlay'; overlay.userData.cameraFadeOverlay = true;
  overlay.receiveShadow = mesh.receiveShadow; overlay.renderOrder = 2;
  mesh.add(overlay);
}
// Reserve the entire goal shell, including a buffer beyond the roof and net.
// Seating and spectators use the same opening, so neither can enter the goal.
function endStandOpening(row: number) {
  const bottom = 3 + row * .87 - .4, front = 56 + row * 1.5 - 1.2;
  return bottom < FIELD.goalHeight + .8 && front < FIELD.length + FIELD.goalDepth + .8 ? FIELD.goalWidth + 1.3 : 0;
}
export class Stadium {
  padMeshes: T.Group[] = [];
  private padAnimations: ((cooldown: number, time: number) => void)[] = [];
  goalLights: T.PointLight[] = [];
  grass: UltraGrass;
  presentation: StadiumPresentation;
  wallMaterial!: T.ShaderMaterial;
  constructor(public scene: T.Scene, pads: Pad[]) {
    this.presentation = new StadiumPresentation(scene);
    const architecture = new T.Group(); architecture.name = 'stadium-architecture'; scene.add(architecture);
    const endStands = new T.Group(); endStands.name = 'end-stands'; architecture.add(endStands);
    const structural = material(0x253747, .7, .55), concrete = material(0x17232d, .3, .76), seatMat = material(0x132c42, .15, .7);
    const blueGlow = this.presentation.lightMaterial(BLUE, 3.4);
    const orangeGlow = this.presentation.lightMaterial(ORANGE, 3.4);
    const whiteGlow = new T.MeshStandardMaterial({ color: 0xdaf4ff, emissive: 0xc2eaff, emissiveIntensity: 3.2 });
    const screenMat = this.presentation.displayMaterial(), ribbonMat = this.presentation.displayMaterial(true);
    const adMaterials = new Map<string, T.MeshLambertMaterial>();
    const flagMat = this.presentation.flagMaterial(labelTexture('RLCS', '#f1d795', '#163351', 256, 512));
    const fieldMat = new T.MeshStandardMaterial({ map: turfTexture(), bumpMap: grassDetail(), bumpScale: .085, roughness: .94, metalness: 0 });
    fieldMat.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n#ifdef USE_BUMPMAP\ndiffuseColor.rgb *= .50 + texture2D(bumpMap, vBumpMapUv).r * .85;\n#endif');
    };
    const field = new T.Mesh(new T.PlaneGeometry(FIELD.width * 2, FIELD.length * 2), fieldMat);
    field.rotation.x = -Math.PI / 2; field.receiveShadow = true; field.name = 'textured-playing-field'; scene.add(field);
    this.grass = new UltraGrass(scene, fieldMat.map!, pads);
    const apron = box(architecture, [110, 1, 130], [0, -.55, 0], material(0x182936)); apron.receiveShadow = true;
    const glass = honeycombMaterial(.045, 0, .07);
    this.wallMaterial = glass;
    const { goalWidth: g, width: w, length: l, goalDepth: d } = FIELD;
    // Tiles are solid from the field; the reverse face is a faint cage so a
    // camera outside the arena can still frame both the car and the ball.
    const rampMat = rampMaterial();
    const rampBack = honeycombMaterial(.07); rampBack.side = T.BackSide;
    const netMats = [honeycombMaterial(.065, 1), honeycombMaterial(.065, -1)];
    for (const surface of arenaSurfaces()) {
      const goalIndex = surface.team > 0 ? 0 : 1;
      const mat = surface.kind === 'ramp' ? rampMat : surface.kind.startsWith('goal-') ? netMats[goalIndex] : glass;
      const mesh = new T.Mesh(surface.geometry, mat); mesh.name = `arena-${surface.kind}`; mesh.receiveShadow = surface.kind === 'ramp'; scene.add(mesh);
      if (surface.kind === 'ramp') {
        decorateRamp(scene, surface.geometry);
        const back = new T.Mesh(surface.geometry, rampBack); back.name = 'arena-ramp-transparent-back'; scene.add(back);
      }
    }
    // Continuous light rails follow the actual boundary, including corner curves.
    // Leave the ramp lip as metal trim; the animated rails belong higher in the arena.
    for (const side of [-1, 1]) for (const level of [FIELD.height - FIELD.rampRadius]) {
      const boundary = sideBoundary(side);
      for (const half of [-1, 1]) {
        const points = boundary.filter(p => p.z * half >= 0).map(p => new T.Vector3(p.x - p.nx * .045, level, p.z - p.nz * .045));
        const rail = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), points.length, .032, 5, false), half > 0 ? blueGlow : orangeGlow); architecture.add(rail);
      }
    }
    for (const s of [-1, 1]) {
      const teamMat = s === 1 ? blueGlow : orangeGlow, teamColor = s === 1 ? BLUE : ORANGE;
      for (let z = -33; z <= 33; z += 11) {
        box(architecture, [.17, 18, .2], [s * (w + .2), 9, z], structural);
        const label = z % 22 === 0 ? 'ROCKET LEAGUE' : 'CHAMPIONS FIELD', key = `${label}:${z > 0}`;
        let adMat = adMaterials.get(key);
        if (!adMat) {
          const texture = labelTexture(label, '#c6e7f4', z > 0 ? '#123964' : '#684328');
          adMat = new T.MeshLambertMaterial({ name: 'stadium-static-advertising', map: texture, reflectivity: 0 }); adMaterials.set(key, adMat);
        }
        const ad = new T.Mesh(new T.PlaneGeometry(10.65, 1.25), adMat); ad.name = 'stadium-static-ad'; ad.position.set(s * (w - .08), 3.65, z); ad.rotation.y = -s * Math.PI / 2; scene.add(ad); fadeNearCamera(ad);
      }
      for (let row = 0; row < 13; row++) {
        box(architecture, [2.4, .8, 119 + row * .55], [s * (43 + row * 1.45), 3 + row * .87, 0], row % 4 === 0 ? concrete : seatMat);
        const halfWidth = (89 + row * 2.3) / 2, opening = endStandOpening(row);
        const segments = opening ? [-1, 1].map(side => ({ x: side * (halfWidth + opening) / 2, width: halfWidth - opening })) : [{ x: 0, width: halfWidth * 2 }];
        for (const segment of segments) box(endStands, [segment.width, .8, 2.4], [segment.x, 3 + row * .87, s * (56 + row * 1.5)], row % 4 === 0 ? concrete : seatMat);
      }
      box(architecture, [1, 3.4, 143], [s * 65, 16, 0], concrete);
      box(architecture, [132, 3.4, 1], [0, 16, s * 77], concrete);
      for (const end of [false, true]) {
        const ribbon = new T.Mesh(new T.PlaneGeometry(end ? 130 : 142, 1.6), ribbonMat); ribbon.name = 'stadium-panorama-ribbon';
        ribbon.position.set(end ? 0 : s * 64.4, 16.2, end ? s * 76.4 : 0);
        ribbon.rotation.y = end ? (s > 0 ? Math.PI : 0) : -s * Math.PI / 2; scene.add(ribbon); fadeNearCamera(ribbon);
      }
      for (let z = -55; z <= 55; z += 22) {
        box(architecture, [2.2, 15, 2.4], [s * 56, 10, z], concrete);
        box(architecture, [.22, 13, .22], [s * 54.7, 10, z - 1.1], z > 0 ? blueGlow : orangeGlow);
        box(architecture, [7, .5, 22], [s * 58, 17.5, z], structural);
      }
      box(architecture, [.25, .7, 132], [s * 59, 12.5, 0], concrete);
      box(architecture, [.13, .12, 132], [s * 58.8, 12.95, 0], s === 1 ? blueGlow : orangeGlow);
      box(architecture, [.2, .18, 144], [s * 64.4, 17.65, 0], whiteGlow);
      box(architecture, [130, .18, .2], [0, 17.65, s * 76.4], teamMat);
      const goalChannels = this.presentation.lightMaterial(teamColor, 2.8); goalChannels.side = T.DoubleSide;
      const goalFrame = createGoalFrame(s, goalChannels); scene.add(goalFrame);
      goalFrame.traverse(o => { if (o instanceof T.Mesh && o.name !== 'goal-hex-floor' && o.material instanceof T.MeshStandardMaterial) fadeNearCamera(o); });
      // Recessed stadium service tiers sit beyond the transparent goal shell.
      // They provide a dark backdrop without putting seats or walls in the net.
      for (let tier = 0; tier < 5; tier++) {
        box(architecture, [g * 2 + 5, 1.25, .8], [0, .55 + tier * 1.32, s * (l + d + 3 + tier * .65)], concrete);
        box(architecture, [g * 2 + 5, .1, .12], [0, 1.12 + tier * 1.32, s * (l + d + 2.56 + tier * .65)], structural);
      }
      const goalLamp = new T.PointLight(teamColor, 48, 24, 2); goalLamp.position.set(0, 4, s * (l + 2)); scene.add(goalLamp); this.goalLights.push(goalLamp);
      // Floating video boards and continuous light ribbons.
      const screen = new T.Mesh(new T.PlaneGeometry(26, 11), screenMat);
      screen.name = 'stadium-live-screen'; screen.position.set(s * 65.94, 25, 0); screen.rotation.y = -s * Math.PI / 2; scene.add(screen);
      box(architecture, [1, 12, 27], [s * 66.5, 25, 0], concrete);
      box(architecture, [.3, .15, 28], [s * 65.8, 31.2, 0], whiteGlow);
      for (let z = -62; z <= 62; z += 20.6) {
        const a = new T.Vector3(s * 67, 18, z), b = new T.Vector3(s * 56, 37, z), d = new T.Vector3(s * 31, 39, z);
        cylinderBetween(architecture, a, b, .3, structural);
        cylinderBetween(architecture, b, d, .25, structural);
        cylinderBetween(architecture, new T.Vector3(s * 66, 23, z), d, .12, structural);
        cylinderBetween(architecture, new T.Vector3(s * 57, 37, z), new T.Vector3(s * 57, 37, Math.min(z + 20.6, 62)), .2, structural);
        for (let lamp = 0; lamp < 5; lamp++) box(architecture, [2.3, .18, 1.4], [s * (37 + lamp * 2.8), 37.7, z], whiteGlow, [0, 0, s * -.25]);
      }
      for (let x = -48; x <= 48; x += 12) {
        cylinderBetween(architecture, new T.Vector3(x, 17, s * 77), new T.Vector3(x, 35, s * 68), .22, structural);
        cylinderBetween(architecture, new T.Vector3(x, 35, s * 68), new T.Vector3(x, 38, s * 46), .19, structural);
      }
      for (let z = -52; z <= 52; z += 13) {
        if (z === 0) continue; // Keep the live scoreboard clear of the hanging cloth.
        const banner = new T.Mesh(new T.PlaneGeometry(3.2, 6, 10, 20), flagMat);
        banner.name = 'stadium-wind-banner'; banner.position.set(s * 60, 27, z); banner.rotation.y = -s * Math.PI / 2; scene.add(banner); fadeNearCamera(banner);
      }
    }
    this.makeCrowd(scene);
    this.makeSky(scene);
    mergeStatic(endStands); mergeStatic(architecture);
    architecture.traverse(o => { if (o instanceof T.Mesh) { o.castShadow = false; if (!Array.isArray(o.material) && o.material !== apron.material) fadeNearCamera(o); } });
    const padHalo = glowTexture();
    for (const pad of pads) {
      const model = pad.big ? createLargeBoostPad(padHalo) : createSmallBoostPad();
      model.root.position.set(pad.x, .045, pad.z); scene.add(model.root);
      this.padMeshes.push(model.root); this.padAnimations.push(model.update);
    }
  }
  makeCrowd(scene: T.Scene) {
    const count = 10500, geometry = new T.SphereGeometry(.14, 5, 4), mat = material(0xffffff, .05, .9);
    this.presentation.animateCrowd(mat);
    const crowd = new T.InstancedMesh(geometry, mat, count), dummy = new T.Object3D(); crowd.name = 'stadium-crowd';
    const colors = [0x2c6395, 0x265379, 0x828c72, 0xae8537, 0x4e7183, 0x183452, 0x487f9b];
    let seed = 12; const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < count; i++) {
      const side = i % 4, row = Math.floor(rand() * 13);
      let along = (rand() - .5) * (side < 2 ? 120 : 89);
      if (side >= 2) {
        const opening = endStandOpening(row);
        if (opening) along = Math.sign(along || 1) * (opening + .35 + Math.abs(along) / 44.5 * (44.5 - opening - .7));
      }
      dummy.position.set(side < 2 ? (side ? -1 : 1) * (43 + row * 1.45) : along, 3.8 + row * .87, side < 2 ? along : (side === 2 ? 1 : -1) * (56 + row * 1.5));
      dummy.scale.set(.9 + rand(), 1.2 + rand() * .7, .9 + rand()); dummy.updateMatrix(); crowd.setMatrixAt(i, dummy.matrix); crowd.setColorAt(i, new T.Color(colors[Math.floor(rand() * colors.length)]));
    } scene.add(crowd); fadeNearCamera(crowd); this.presentation.addCrowdLights(crowd);
    const stars = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) { stars[i * 3] = (rand() - .5) * 600; stars[i * 3 + 1] = 50 + rand() * 200; stars[i * 3 + 2] = (rand() - .5) * 600; }
    scene.add(new T.Points(new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(stars, 3)), new T.PointsMaterial({ color: 0xb0cef8, size: .22, transparent: true, opacity: .8 })));
  }
  makeSky(scene: T.Scene) {
    const sky = new T.Mesh(new T.SphereGeometry(260, 32, 16), new T.ShaderMaterial({ side: T.BackSide, depthWrite: false, uniforms: {}, vertexShader: 'varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }', fragmentShader: `varying vec3 vPos;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){vec3 n=normalize(vPos);float h=max(0.,n.y);vec2 p=n.xz/(h+.3)*2.;float cloud=noise(p*3.)*.55+noise(p*7.)*.25+noise(p*15.)*.12;vec3 color=mix(vec3(.09,.14,.23),vec3(.018,.03,.07),smoothstep(0.,.8,h)); color+=vec3(.035,.04,.06)*smoothstep(.37,.75,cloud);gl_FragColor=vec4(color,1.);}` })); sky.renderOrder = -10; scene.add(sky);
  }
  addMonument(carSource: T.Group, ballSource: T.Group) {
    const monument = new T.Group(); monument.position.set(57, 1, -33); this.scene.add(monument);
    const silver = material(0x82969e, .82, .34), stone = material(0x69797e, .45, .72);
    box(monument, [13, 2, 13], [0, 0, 0], stone); box(monument, [10, 1.3, 10], [0, 1.5, 0], silver);
    const base = new T.Mesh(new T.CylinderGeometry(2.2, 5.5, 16, 5), stone); base.position.y = 10; monument.add(base);
    const plinth = new T.Mesh(new T.CylinderGeometry(3, 2.1, 1.3, 10), silver); plinth.position.y = 18.5; monument.add(plinth);
    const ball = detailedBall(ballSource); ball.scale.setScalar(3.5); ball.position.set(-1, 22, 0); monument.add(ball);
    const car = detailedCar(carSource, 'blue').root; car.scale.setScalar(6); car.position.set(1, 25.5, 0); car.rotation.set(0, -Math.PI / 2, -.35); monument.add(car);
    car.traverse(o => { if (o instanceof T.Mesh) { o.material = silver; o.castShadow = false; } });
    for (const sign of [-1, 1]) {
      const points = Array.from({ length: 32 }, (_, i) => { const a = i / 31 * Math.PI * 1.6; return new T.Vector3(Math.cos(a) * 5.3, 20 + i / 31 * 9, Math.sin(a) * 4.2 * sign); });
      const ribbon = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), 40, .22, 6, false), silver); monument.add(ribbon);
    }
    const spot = new T.SpotLight(0xc2dfff, 2200, 70, .5, .65, 2); spot.position.set(47, 2, -23); spot.target.position.set(57, 22, -33); this.scene.add(spot, spot.target);

  }
  update(pads: Pad[], time: number) {
    this.presentation.update(time);
    pads.forEach((p, i) => this.padAnimations[i](p.cooldown, time));
  }
  updateCamera(position: T.Vector3) {
    const distance = Math.min(FIELD.width - Math.abs(position.x), FIELD.length - Math.abs(position.z));
    this.wallMaterial.uniforms.visibility.value = T.MathUtils.lerp(.12, 1, T.MathUtils.smoothstep(distance, .2, 2.4));
  }
}
export function glowTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const c = canvas.getContext('2d')!, grad = c.createRadialGradient(32, 32, 0, 32, 32, 32); grad.addColorStop(0, 'white'); grad.addColorStop(.25, 'rgba(255,255,255,.65)'); grad.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = grad; c.fillRect(0, 0, 64, 64); return new T.CanvasTexture(canvas);
}
