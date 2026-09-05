import * as T from 'three';
import { BOOST_OUTLET, EXHAUST_OUTLET } from './octane-outlets';

/** Recessed engine cores sit behind the Octane's existing metal ribs and capsule frames. */
export class OctaneLighting {
  readonly color = new T.Color();
  readonly exhaustOutlet: typeof EXHAUST_OUTLET;
  private tail: T.MeshStandardMaterial;
  private time = 0;
  private heat = 0;
  private load = 0;
  private exhaustHeat = 0;
  private exhaustInterior = new T.MeshStandardMaterial({ color: 0x030405, roughness: 1, metalness: 0, envMapIntensity: 0, emissive: 0xff0801, emissiveIntensity: 0 });
  private exhaustRim = new T.MeshStandardMaterial({ color: 0x292421, roughness: .65, metalness: .35, envMapIntensity: .3, emissive: 0xff1002, emissiveIntensity: 0 });
  private uniforms = { engineColor: { value: this.color }, engineTime: { value: 0 }, engineHeat: { value: 0 }, engineLoad: { value: 0 } };

  constructor(root: T.Group, color: T.ColorRepresentation, fallback = false, tailMaterial?: T.MeshStandardMaterial) {
    this.color.set(color);
    this.exhaustOutlet = fallback ? { x: .255, y: .03, z: .8, width: .12, height: .12 } : EXHAUST_OUTLET;
    for (const [material, rim] of [[this.exhaustInterior, false], [this.exhaustRim, true]] as const) {
      material.onBeforeCompile = shader => {
        shader.vertexShader = 'varying vec2 exhaustUv;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nexhaustUv=uv;');
        shader.fragmentShader = 'varying vec2 exhaustUv;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float radius=length(exhaustUv-.5)*2.;
          ${rim ? `float angle=atan(exhaustUv.y-.5,exhaustUv.x-.5);
            float hotEdge=smoothstep(.76,.84,radius)*(1.-smoothstep(.88,1.06,radius));
            totalEmissiveRadiance*=(.18+.82*hotEdge)*(.82+.1*sin(angle*7.+radius*21.)+.06*sin(angle*19.));`
          : 'totalEmissiveRadiance*=pow(smoothstep(.2,.97,radius),2.)*.6;'}
        `);
      };
      material.customProgramCacheKey = () => rim ? 'octane-hot-exhaust-rim' : 'octane-hot-exhaust-interior';
    }
    const material = new T.MeshStandardMaterial({ color: 0x131820, roughness: .24, metalness: .2 });
    material.name = 'Octane_Engine_Core';
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = 'varying vec2 coreUv;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ncoreUv=uv;');
      shader.fragmentShader = 'varying vec2 coreUv;uniform vec3 engineColor;uniform float engineTime,engineHeat,engineLoad;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float column=1.-smoothstep(.16,.5,abs(coreUv.x-.5));
        float flow=sin(coreUv.y*24.-engineTime*5.+sin(coreUv.y*13.+engineTime*2.3));
        float shimmer=.92+.05*flow+.03*sin(engineTime*11.+coreUv.y*43.);
        float cell=smoothstep(.035,.12,fract(coreUv.y*5.));
        vec3 hot=mix(engineColor,vec3(1.),column*(.18+engineHeat*.12));
        totalEmissiveRadiance+=hot*(.06+engineLoad*1.75+engineHeat*2.6)*shimmer*(.65+column*.55)*mix(.5,1.,cell);
      `);
    };
    const { width, height } = BOOST_OUTLET, radius = width / 2, shape = new T.Shape();
    shape.moveTo(-radius, -height / 2 + radius);
    shape.lineTo(-radius, height / 2 - radius);
    shape.absarc(0, height / 2 - radius, radius, Math.PI, 0, true);
    shape.lineTo(radius, -height / 2 + radius);
    shape.absarc(0, -height / 2 + radius, radius, 0, -Math.PI, true);
    const geometry = new T.ShapeGeometry(shape, 12), uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / width + .5, uv.getY(i) / height + .5);
    const assembly = new T.Group(); assembly.name = 'octane-rear-lighting'; root.add(assembly);
    for (const side of [-1, 1]) {
      const core = new T.Mesh(geometry, material); core.name = 'octane-engine-core';
      core.position.set(side * BOOST_OUTLET.x, BOOST_OUTLET.y, BOOST_OUTLET.z); assembly.add(core);
    }
    for (const side of [-1, 1]) {
      const outlet = this.exhaustOutlet;
      const pipe = new T.Mesh(new T.CircleGeometry(1, 32), this.exhaustInterior); pipe.name = 'octane-exhaust-opening';
      pipe.scale.set(outlet.width * .44, outlet.height * .44, 1);
      pipe.position.set(side * outlet.x, outlet.y, outlet.z); assembly.add(pipe);
      // The metal lip gets hottest; the recessed center stays darker so it reads as a pipe.
      const rim = new T.Mesh(new T.RingGeometry(.78, 1.06, 40), this.exhaustRim); rim.name = 'octane-exhaust-hot-rim'; rim.position.z = .0003; pipe.add(rim);
    }
    // Illuminate the actual round lenses, keeping the surrounding housings visible.
    const tail = this.tail = tailMaterial ?? new T.MeshStandardMaterial({ color: 0x57030c, emissive: 0xff1006, roughness: .22 });
    tail.emissiveIntensity = .08;
    tail.name = 'Octane_Taillight_Lens';
    for (const side of [-1, 1]) for (const small of [false, true]) {
      const lens = new T.Mesh(new T.CircleGeometry(small ? .0105 : .0205, 24), tail);
      lens.name = 'octane-tail-lens'; lens.position.set(side * (small ? .337 : .283), small ? .13 : .14, small ? .7095 : .7155); assembly.add(lens);
    }
    if (fallback) assembly.scale.setScalar(2);
    this.setColor(color);
  }

  setColor(color: T.ColorRepresentation) { this.color.set(color); }
  update(dt: number, boosting: boolean, braking = false, throttle = 0, enabled = true) {
    const load = enabled ? boosting ? 1 : Math.min(1, Math.abs(throttle)) : 0;
    if (!enabled) this.heat = this.load = this.exhaustHeat = 0;
    this.time += dt; this.heat = T.MathUtils.damp(this.heat, boosting && enabled ? 1 : 0, 7, dt);
    this.load = T.MathUtils.damp(this.load, load, load > this.load ? 2.2 : 1.4, dt);
    this.exhaustHeat = T.MathUtils.damp(this.exhaustHeat, load, load > this.exhaustHeat ? 1.65 : .85, dt);
    this.exhaustInterior.emissiveIntensity = .65 * this.exhaustHeat ** 2;
    this.exhaustRim.emissiveIntensity = 3.4 * this.exhaustHeat ** 1.7;
    this.uniforms.engineTime.value = this.time; this.uniforms.engineHeat.value = this.heat;
    this.uniforms.engineLoad.value = this.load;
    this.tail.emissiveIntensity = braking ? 2.8 : .08;
  }
}
