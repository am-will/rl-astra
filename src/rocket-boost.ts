import * as T from 'three';

/** Classic orange afterburner: white-hot core, rippling flame sheath and tapered tips. */
export class RocketBoost {
  root = new T.Group();
  lengthScale = 1;
  luminosity = 1;
  private strength = 0;
  private time = 0;
  private localVelocity = new T.Vector3();
  private inverse = new T.Quaternion();
  private uniforms = {
    time: { value: 0 }, strength: { value: 0 }, length: { value: 1.4025 },
    drift: { value: new T.Vector2() }, core: { value: 0 }, luminosity: { value: 1 },
  };
  constructor(scene: T.Scene) {
    this.root.name = 'standard-orange-boost'; this.root.visible = false; scene.add(this.root);
    const geometry = new T.CylinderGeometry(1, 1, 1, 20, 32, true);
    geometry.rotateX(Math.PI / 2); geometry.translate(0, 0, .5);
    const vertexShader = `uniform float time,strength,length,core;uniform vec2 drift;
      varying vec2 vUv;varying float vT;varying vec3 vEye;varying vec3 vNormal;
      void main(){float t=position.z;vT=t;vUv=uv;
        float pulse=sin(t*28.-time*43.+uv.x*12.566)*.07+sin(t*43.-time*71.)*.025;
        float radius=(.072+.22*sin(t*2.85))*pow(max(.001,1.-t),.65)*(1.+pulse*t);
        radius*=mix(1.,.46,core);
        vec3 p=vec3(position.xy*radius,t*length*mix(1.,.77,core)*strength);
        p.xy+=drift*t*t*.05+vec2(sin(t*8.-time*17.),cos(t*11.-time*21.))*t*t*.032;
        vec4 eye=modelViewMatrix*vec4(p,1.);vEye=-eye.xyz;vNormal=normalMatrix*normal;
        gl_Position=projectionMatrix*eye;
      }`;
    const fragmentShader = `uniform float time,strength,core,luminosity;varying vec2 vUv;varying float vT;varying vec3 vEye;varying vec3 vNormal;
      void main(){float t=vT;float flow=t*29.-time*39.;
        float tongues=sin(flow+sin(vUv.x*18.85+time*8.)*2.2)*.5+.5;
        float striation=sin(vUv.x*50.26+sin(flow)*1.7)*.5+.5;
        float edge=abs(dot(normalize(vNormal),normalize(vEye)));
        float tip=1.-smoothstep(.55+tongues*.25,.99,t);
        float body=tip*(.48+tongues*.36+striation*.16);
        vec3 color=mix(vec3(3.2,2.5,1.05),vec3(2.3,.50,.025),smoothstep(.05,.48,t));
        color=mix(color,vec3(1.2,.08,.003),smoothstep(.45,1.,t));
        vec3 hot=mix(vec3(3.4,3.2,2.5),vec3(3.0,1.4,.25),smoothstep(.15,.95,t));
        color=mix(color,hot,core);
        float alpha=body*mix(.57,.82,core)*smoothstep(.03,.55,edge)*strength*smoothstep(.2,.8,vEye.z);
        gl_FragColor=vec4(color*luminosity,alpha);
      }`;
    for (const x of [-.255, .255]) for (const core of [0, 1]) {
      const uniforms = { ...this.uniforms, core: { value: core } };
      const material = new T.ShaderMaterial({ uniforms, vertexShader, fragmentShader,
        transparent: true, depthWrite: false, side: T.DoubleSide,
        blending: core ? T.AdditiveBlending : T.NormalBlending });
      const flame = new T.Mesh(geometry, material); flame.position.set(x, .025, .65); flame.frustumCulled = false;
      this.root.add(flame);
    }
  }
  update(position: T.Vector3, rotation: T.Quaternion, velocity: T.Vector3, active: boolean, dt: number) {
    // Release contracts the plume smoothly instead of cutting off a rigid cone.
    this.time += dt; this.strength = T.MathUtils.damp(this.strength, active ? 1 : 0, active ? 24 : 32, dt);
    this.root.visible = this.strength > .015;
    this.root.position.copy(position); this.root.quaternion.copy(rotation);
    this.localVelocity.copy(velocity).applyQuaternion(this.inverse.copy(rotation).invert());
    this.uniforms.drift.value.lerp(new T.Vector2(-this.localVelocity.x, -this.localVelocity.y), 1 - Math.exp(-dt * 12));
    this.uniforms.length.value = (1.6 + Math.min(1, velocity.length() / 23) * 1.25 + Math.sin(this.time * 37) * .07) * .75 * .85;
    this.uniforms.length.value *= this.lengthScale; this.uniforms.luminosity.value = this.luminosity;
    this.uniforms.time.value = this.time; this.uniforms.strength.value = this.strength;
  }
}
