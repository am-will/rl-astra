import * as T from 'three';
import { FIELD } from './config';
import type { Pad } from './physics';

const NEAR_BLADES = 750000;
const FAR_BLADES = 250000;

/** A camera-centred carpet of actual blades; one draw and no per-frame instance uploads. */
export class UltraGrass {
  mesh: T.InstancedMesh;
  private carAxis = new T.Vector3();
  private uniforms = {
    grassCenter: { value: new T.Vector2() }, grassTime: { value: 0 },
    grassTires: { value: Array.from({ length: 8 }, () => new T.Vector4(1e5, 1e5, 0, 1)) },
  };
  constructor(scene: T.Scene, turf: T.Texture, pads: Pad[]) {
    // Keep the metal boost housings clear of blades without per-blade pad loops.
    const mask = document.createElement('canvas'); mask.width = 1024; mask.height = 1280;
    const cut = mask.getContext('2d')!; cut.fillStyle = 'white'; cut.fillRect(0, 0, mask.width, mask.height);
    cut.fillStyle = 'black';
    for (const pad of pads) { cut.beginPath(); const radius = (pad.big ? 1.12 : .54) + .12; cut.ellipse((pad.x / (FIELD.width * 2) + .5) * mask.width, (pad.z / (FIELD.length * 2) + .5) * mask.height, radius / (FIELD.width * 2) * mask.width, radius / (FIELD.length * 2) * mask.height, 0, 0, Math.PI * 2); cut.fill(); }
    const cutTexture = new T.CanvasTexture(mask);
    const positions: number[] = [], normals: number[] = [], uv: number[] = [], indices: number[] = [];
    // A tapered ribbon with four bending sections, instead of crossed triangular cards.
    // Seven triangles per blade; both distance layers share this geometry and one draw.
    for (const [y, width] of [[0, .72], [.25, 1], [.5, .78], [.75, .42]]) {
      for (const side of [-1, 1]) { positions.push(side * width * .5, y, 0); normals.push(0, 0, 1); uv.push((side + 1) * .5, y); }
    }
    positions.push(0, 1, 0); normals.push(0, 0, 1); uv.push(.5, 1);
    for (let row = 0; row < 3; row++) { const i = row * 2; indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    indices.push(6, 7, 8);
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(normals, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geo.setIndex(indices);
    // Bake independent blade traits once instead of hashing them at every vertex each frame.
    const traits = new T.InstancedBufferAttribute(new Float32Array((NEAR_BLADES + FAR_BLADES) * 4), 4);
    geo.setAttribute('grassTraits', traits);
    const material = new T.MeshStandardMaterial({ map: turf, color: 0xffffff, roughness: .84, side: T.DoubleSide });
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms, { grassCut: { value: cutTexture } });
      shader.vertexShader = `attribute vec4 grassTraits;uniform sampler2D grassCut;uniform vec2 grassCenter;uniform vec4 grassTires[8];uniform float grassTime;varying float bladeHeight,bladeShade;varying vec2 bladeUv;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
        vec2 origin=instanceMatrix[3].xz;
        float distant=grassTraits.w,span=mix(30.,72.,distant);
        vec2 world=mod(origin-grassCenter+span*.5,span)-span*.5+grassCenter;
        vec3 traits=grassTraits.xyz;
        float range=distance(world,grassCenter);
        float nearFade=smoothstep(9.,15.,range);
        // A sparse, wider-bladed outer layer bridges the close grass into the textured pitch.
        // Both layers remain rooted in world space as the camera moves.
        float taper=mix(1.-nearFade,nearFade*(1.-smoothstep(25.,36.,range)),distant);
        float boundary=min(${FIELD.width - FIELD.rampRadius - .15}-abs(world.x),${FIELD.length - FIELD.rampRadius - .15}-abs(world.y));
        boundary=min(boundary,(${FIELD.width + FIELD.length - FIELD.cornerCut - FIELD.rampRadius * 1.414}-abs(world.x)-abs(world.y))*.707);
        taper*=smoothstep(0.,.35,boundary);
        taper*=texture2D(grassCut,vec2(world.x/${FIELD.width * 2}+.5,.5-world.y/${FIELD.length * 2})).r;
        // Separate elliptical contact patches, with undisturbed grass between all four tires.
        float pressed=0.;vec2 tireBend=vec2(0.);
        for(int tire=0;tire<8;tire++) {
          vec2 offset=world-grassTires[tire].xy,rolling=grassTires[tire].zw;
          vec2 local=vec2(dot(offset,vec2(rolling.y,-rolling.x)),dot(offset,rolling));
          float contact=1.-smoothstep(.35,1.,length(local/vec2(.115,.185)));
          if(contact>pressed) { pressed=contact;tireBend=rolling*contact; }
        }
        float height=(.095+traits.x*.07)*taper;
        float angle=traits.y*6.28318+(traits.z-.5)*position.y*1.2;
        vec2 across=vec2(cos(angle),sin(angle)),facing=vec2(-across.y,across.x);
        // Shared waves carry gusts across the pitch; each flexible tip also flutters independently.
        float wave=sin(dot(world,vec2(.55,.34))-grassTime*1.65);
        float gust=smoothstep(-.65,.85,sin(dot(world,vec2(.21,-.37))-grassTime*.85));
        vec2 wind=vec2(.86,.51)*(.22+wave*.24+gust*.42);
        wind+=vec2(-.51,.86)*sin(dot(world,vec2(.8,.65))-grassTime*2.1)*.12;
        vec2 bend=(facing*(.16+traits.z*.26)+wind)*height;
        bend+=tireBend*height*.8;
        vec2 flutter=facing*sin(grassTime*(3.6+traits.z*2.)+traits.y*31.+dot(world,vec2(1.7,2.3)))*height*.065;
        float bladeT=position.y,flex=bladeT*bladeT;
        float upright=1.-pressed*.72;
        float droop=min(.28,dot(bend,bend)/max(height*height,.0001)*.2);
        // Upward-biased leaf normals follow bending, so gusts also ripple through the light.
        vec2 leafNormal=facing*.32-(bend/max(height,.001))*bladeT*.65;
        vec3 objectNormal=normalize(vec3(leafNormal.x,.9,leafNormal.y));
      `);
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        vec3 transformed=vec3(0.,height*(bladeT*upright-droop*flex*upright),0.);
        float width=mix(.01+traits.z*.012,.045+traits.z*.035,distant);
        transformed.xz=across*position.x*width*taper+bend*flex+flutter*flex*bladeT;
        transformed.xz+=world-origin;
        transformed.y+=.009;
        bladeHeight=bladeT;bladeShade=.82+traits.z*.3;bladeUv=uv;
        #ifdef USE_MAP
          vMapUv=vec2(world.x/${FIELD.width * 2}+.5,.5-world.y/${FIELD.length * 2});
        #endif
      `);
      shader.fragmentShader = 'varying float bladeHeight,bladeShade;varying vec2 bladeUv;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        // A soft fold across each leaf catches a narrow highlight along its central vein.
        normal=normalize(vNormal+normalize(dFdx(vViewPosition))*(bladeUv.x-.5)*.14);
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        float rib=1.-smoothstep(.0,.22,abs(bladeUv.x-.5));
        diffuseColor.rgb*=mix(.48,1.18,smoothstep(0.,1.,bladeHeight))*bladeShade*(.94+rib*.12);
        // Keep painted lines/crests intact while varying the natural green pigment.
        float green=clamp((diffuseColor.g-max(diffuseColor.r,diffuseColor.b))*18.,0.,1.);
        diffuseColor.rgb*=mix(vec3(1.),mix(vec3(.78,1.,.72),vec3(.98,1.03,.85),bladeShade-.7),green);
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor-=rib*bladeHeight*.18;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
          float backlit=pow(max(dot(geometryViewDir,-directionalLights[0].direction),0.),3.);
          reflectedLight.directDiffuse+=reflectedLight.directDiffuse*backlit*bladeHeight*.3;
        #endif
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=diffuseColor.rgb*.04*bladeHeight;');
    };
    this.mesh = new T.InstancedMesh(geo, material, NEAR_BLADES + FAR_BLADES); this.mesh.name = 'ultra-grass-blades'; this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.visible = false;
    let seed = 49201; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const matrix = new T.Matrix4();
    for (let i = 0; i < this.mesh.count; i++) {
      const distant = i >= NEAR_BLADES ? 1 : 0, span = distant ? 72 : 30;
      matrix.makeTranslation(random() * span - span / 2, 0, random() * span - span / 2); this.mesh.setMatrixAt(i, matrix);
      traits.setXYZW(i, random(), random(), random(), distant);
    }
    this.mesh.instanceMatrix.needsUpdate = true; scene.add(this.mesh);
  }
  setTireContacts(index: number, contacts: readonly T.Vector3[], rotation: T.Quaternion) {
    this.carAxis.set(0, 0, 1).applyQuaternion(rotation); this.carAxis.y = 0; this.carAxis.normalize();
    if (this.carAxis.lengthSq() < .0001) this.carAxis.set(0, 0, 1);
    for (let i = 0; i < 4; i++) {
      const point = contacts[i];
      this.uniforms.grassTires.value[index * 4 + i].set(point?.x ?? 1e5, point?.z ?? 1e5, this.carAxis.x, this.carAxis.z);
    }
  }
  update(camera: T.Vector3, _car: T.Vector3, time: number) {
    this.uniforms.grassCenter.value.set(camera.x, camera.z); this.uniforms.grassTime.value = time;
  }
}
