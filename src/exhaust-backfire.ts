import * as T from 'three';
import { EXHAUST_OUTLET } from './octane-outlets';

/** One small combustion puff per throttle release, separate from sustained rocket boost. */
export class ExhaustBackfire {
  readonly root = new T.Group();
  private previous = new T.Vector3();
  private ready = false;
  private throttle = 0;
  private loaded = 0;
  private age = 1;
  private time = 0;
  private power = 1;
  private uniforms = { time: { value: 0 }, strength: { value: 0 }, opening: { value: new T.Vector2(EXHAUST_OUTLET.width, EXHAUST_OUTLET.height) } };
  constructor(scene: T.Scene) {
    this.root.name = 'octane-exhaust-backfire'; this.root.visible = false; scene.add(this.root);
    const geometry = new T.CylinderGeometry(1, 1, 1, 16, 12, true); geometry.rotateX(Math.PI / 2); geometry.translate(0, 0, .5);
    const material = new T.ShaderMaterial({ uniforms: this.uniforms, transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending,
      vertexShader: `uniform float time,strength;uniform vec2 opening;varying float tail;varying vec2 flameUv;varying vec3 eye,face;
        void main(){tail=position.z;flameUv=uv;float t=tail;
          float ripple=1.+sin(t*23.-time*65.+uv.x*12.57)*t*.16;
          vec2 radius=opening*.44*(1.-t)*ripple;
          vec3 p=vec3(position.xy*radius,t*(.12+strength*.13));
          p.x+=sin(t*12.-time*41.)*t*t*.012;p.y+=t*t*.025;
          vec4 mv=modelViewMatrix*vec4(p,1.);eye=-mv.xyz;face=normalMatrix*normal;gl_Position=projectionMatrix*mv;
        }`,
      fragmentShader: `uniform float time,strength;varying float tail;varying vec2 flameUv;varying vec3 eye,face;
        void main(){float core=pow(max(0.,dot(normalize(face),normalize(eye))),.6);
          float tip=1.-smoothstep(.45+.16*sin(flameUv.x*19.+time*38.),1.,tail);
          vec3 color=mix(vec3(2.2,2.1,1.5),vec3(2.6,.5,.018),smoothstep(0.,.45,tail));
          color=mix(color,vec3(1.3,.07,.002),tail*tail);
          gl_FragColor=vec4(color,(.35+core*.65)*tip*strength*smoothstep(.15,.55,eye.z));
        }`,
    });
    for (const side of [-1, 1]) {
      const flame = new T.Mesh(geometry, material); flame.name = 'exhaust-release-flame'; flame.userData.side = side; flame.frustumCulled = false;
      flame.position.set(side * EXHAUST_OUTLET.x, EXHAUST_OUTLET.y, EXHAUST_OUTLET.z + .002); this.root.add(flame);
    }
  }
  trigger(power = 1) { this.age = 0; this.power = power; this.uniforms.strength.value = power; this.root.visible = true; }
  reset() { this.age = 1; this.loaded = this.throttle = 0; this.ready = false; this.root.visible = false; this.uniforms.strength.value = 0; }
  update(position: T.Vector3, rotation: T.Quaternion, speed: number, throttle: number, boosting: boolean, enabled: boolean, dt: number, outlet = EXHAUST_OUTLET) {
    if (!enabled || (this.ready && this.previous.distanceToSquared(position) > 64)) this.reset();
    if (!enabled) return;
    this.root.position.copy(position); this.root.quaternion.copy(rotation); this.previous.copy(position); this.ready = true;
    this.uniforms.opening.value.set(outlet.width, outlet.height);
    for (const flame of this.root.children) flame.position.set(flame.userData.side * outlet.x, outlet.y, outlet.z + .002);
    if (dt > 0) {
      this.age += dt; this.time += dt;
      const gas = Math.max(0, throttle);
      if (!boosting && this.throttle > .25 && gas < .15 && this.loaded >= .075) this.trigger(.65 + Math.min(speed / 23, 1) * .35);
      this.loaded = !boosting && gas > .25 ? Math.min(.4, this.loaded + dt) : 0;
      this.throttle = gas;
    }
    this.uniforms.time.value = this.time;
    this.uniforms.strength.value = this.power * Math.exp(-this.age * 9) * (1 - T.MathUtils.smoothstep(this.age, .10, .18));
    this.root.visible = this.age < .18;
  }
}
