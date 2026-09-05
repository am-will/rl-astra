import * as T from 'three';

/** Recessed engine cores sit behind the Octane's existing metal ribs and capsule frames. */
export class OctaneLighting {
  readonly color = new T.Color();
  private tail: T.MeshStandardMaterial;
  private time = 0;
  private heat = 0;
  private uniforms = { engineColor: { value: this.color }, engineTime: { value: 0 }, engineHeat: { value: 0 } };

  constructor(root: T.Group, color: T.ColorRepresentation, fallback = false, tailMaterial?: T.MeshStandardMaterial) {
    this.color.set(color);
    const material = new T.MeshStandardMaterial({ color: 0x131820, roughness: .24, metalness: .2 });
    material.name = 'Octane_Engine_Core';
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = 'varying vec2 coreUv;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ncoreUv=uv;');
      shader.fragmentShader = 'varying vec2 coreUv;uniform vec3 engineColor;uniform float engineTime,engineHeat;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float column=1.-smoothstep(.16,.5,abs(coreUv.x-.5));
        float flow=sin(coreUv.y*24.-engineTime*5.+sin(coreUv.y*13.+engineTime*2.3));
        float shimmer=.92+.05*flow+.03*sin(engineTime*11.+coreUv.y*43.);
        float cell=smoothstep(.035,.12,fract(coreUv.y*5.));
        vec3 hot=mix(engineColor,vec3(1.),column*(.18+engineHeat*.12));
        totalEmissiveRadiance+=hot*(2.4+engineHeat*2.)*shimmer*(.65+column*.55)*mix(.5,1.,cell);
      `);
    };
    const width = .049, height = .272, radius = width / 2, shape = new T.Shape();
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
      core.position.set(side * .106, .012, .6695); assembly.add(core);
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
  update(dt: number, boosting: boolean, braking = false) {
    this.time += dt; this.heat = T.MathUtils.damp(this.heat, boosting ? 1 : 0, 7, dt);
    this.uniforms.engineTime.value = this.time; this.uniforms.engineHeat.value = this.heat;
    this.tail.emissiveIntensity = braking ? 2.8 : .08;
  }
}
