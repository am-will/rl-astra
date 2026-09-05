import * as T from 'three';
import { FIELD } from './config';
import type { Pad } from './physics';

/** A camera-centred carpet of actual blades; one draw and no per-frame instance uploads. */
export class UltraGrass {
  mesh: T.InstancedMesh;
  private uniforms = { grassCenter: { value: new T.Vector2() }, grassTime: { value: 0 }, grassCar: { value: new T.Vector2() } };
  constructor(scene: T.Scene, turf: T.Texture, pads: Pad[]) {
    // Keep the metal boost housings clear of blades without per-blade pad loops.
    const mask = document.createElement('canvas'); mask.width = 1024; mask.height = 1280;
    const cut = mask.getContext('2d')!; cut.fillStyle = 'white'; cut.fillRect(0, 0, mask.width, mask.height);
    cut.fillStyle = 'black';
    for (const pad of pads) { cut.beginPath(); const radius = pad.big ? 1.12 : .54; cut.ellipse((pad.x / (FIELD.width * 2) + .5) * mask.width, (pad.z / (FIELD.length * 2) + .5) * mask.height, radius / (FIELD.width * 2) * mask.width, radius / (FIELD.length * 2) * mask.height, 0, 0, Math.PI * 2); cut.fill(); }
    const cutTexture = new T.CanvasTexture(mask);
    const positions: number[] = [], normals: number[] = [], uv: number[] = [], indices: number[] = [];
    for (let side = 0; side < 2; side++) {
      const offset = positions.length / 3;
      for (const [x, y, bend] of [[-.5, 0, 0], [.5, 0, 0], [-.3, .55, .12], [.3, .55, .12], [0, 1, .4]]) {
        positions.push(side ? bend : x, y, side ? x : bend); normals.push(side ? 1 : 0, .25, side ? 0 : 1); uv.push(x + .5, y);
      }
      indices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2, offset + 2, offset + 3, offset + 4);
    }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(normals, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geo.setIndex(indices);
    const material = new T.MeshStandardMaterial({ map: turf, color: 0xffffff, roughness: .95, side: T.DoubleSide });
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms, { grassCut: { value: cutTexture } });
      shader.vertexShader = `uniform sampler2D grassCut;uniform vec2 grassCenter,grassCar;uniform float grassTime;varying float bladeHeight,bladeShade;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal=normalize(vec3(normal.x*.3,.9,normal.z*.3));');
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        vec2 origin=instanceMatrix[3].xz;
        vec2 world=mod(origin-grassCenter+15.,30.)-15.+grassCenter;
        float seed=fract(sin(dot(origin,vec2(12.9898,78.233)))*43758.5453);
        float taper=1.-smoothstep(9.,15.,distance(world,grassCenter));
        float boundary=min(${FIELD.width - FIELD.rampRadius - .15}-abs(world.x),${FIELD.length - FIELD.rampRadius - .15}-abs(world.y));
        boundary=min(boundary,(${FIELD.width + FIELD.length - FIELD.cornerCut - FIELD.rampRadius * 1.414}-abs(world.x)-abs(world.y))*.707);
        taper*=smoothstep(0.,.35,boundary);
        taper*=texture2D(grassCut,vec2(world.x/${FIELD.width * 2}+.5,.5-world.y/${FIELD.length * 2})).r;
        float flatten=mix(.22,1.,smoothstep(.45,1.1,distance(world,grassCar)));
        float height=(.04+seed*.055)*taper*flatten;
        float angle=seed*6.28318;mat2 turn=mat2(cos(angle),-sin(angle),sin(angle),cos(angle));
        vec3 transformed=position*vec3(.033+seed*.02,height,.033+seed*.02);
        transformed.xz=turn*transformed.xz;
        transformed.xz+=vec2(sin(world.x*.7+grassTime*1.5),cos(world.y*.6+grassTime*1.1))*position.y*position.y*.008*taper;
        transformed.xz+=world-origin;
        transformed.y+=.009;
        bladeHeight=position.y;bladeShade=.84+seed*.32;
        #ifdef USE_MAP
          vMapUv=vec2(world.x/${FIELD.width * 2}+.5,.5-world.y/${FIELD.length * 2});
        #endif
      `);
      shader.fragmentShader = 'varying float bladeHeight,bladeShade;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal=normalize(vNormal);');
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb*=mix(.62,1.12,bladeHeight)*bladeShade;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=diffuseColor.rgb*.04*bladeHeight;');
    };
    this.mesh = new T.InstancedMesh(geo, material, 500000); this.mesh.name = 'ultra-grass-blades'; this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.visible = false;
    let seed = 49201; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const matrix = new T.Matrix4();
    for (let i = 0; i < this.mesh.count; i++) { matrix.makeTranslation(random() * 30 - 15, 0, random() * 30 - 15); this.mesh.setMatrixAt(i, matrix); }
    this.mesh.instanceMatrix.needsUpdate = true; scene.add(this.mesh);
  }
  update(camera: T.Vector3, car: T.Vector3, time: number) { this.uniforms.grassCenter.value.set(camera.x, camera.z); this.uniforms.grassCar.value.set(car.x, car.z); this.uniforms.grassTime.value = time; }
}
