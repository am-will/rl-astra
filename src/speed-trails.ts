import * as T from 'three';
import type { CarModel } from './assets';

const SAMPLES = 48, SAMPLE_STEP = 1 / 120;
const FAINT_LIFETIME = .12, SONIC_LIFETIME = .32;
interface TrailSample { position: T.Vector3; right: T.Vector3; up: T.Vector3; time: number; power: number; }
const sample = (): TrailSample => ({ position: new T.Vector3(), right: new T.Vector3(), up: new T.Vector3(), time: 0, power: 0 });

/** Lightspeed-inspired ribbons, attached to the rear tires and left in
 * world space so they trace grounded supersonic turns instead of swinging like rods. */
export class SpeedTrails {
  readonly mesh: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
  private history = Array.from({ length: SAMPLES }, sample);
  private head = -1;
  private count = 0;
  private time = 0;
  private remainder = 0;
  private strength = 0;
  private sonic = 0;
  private flash = 0;
  private wasSupersonic = false;
  private previous = new T.Vector3();
  private previousRotation = new T.Quaternion();
  private rotation = new T.Quaternion();
  private current = sample();
  private point = new T.Vector3();
  private side = new T.Vector3();
  private wheelX = [-.455, .455];
  private wheelWidth = [.075, .075];
  private origin = new T.Vector3(0, -.105, .60);
  private positions = new T.BufferAttribute(new Float32Array((SAMPLES + 1) * 4 * 2 * 3), 3).setUsage(T.DynamicDrawUsage);
  private uvs = new T.BufferAttribute(new Float32Array((SAMPLES + 1) * 4 * 2 * 2), 2);
  private birth = new T.BufferAttribute(new Float32Array((SAMPLES + 1) * 4 * 2), 1).setUsage(T.DynamicDrawUsage);
  private powers = new T.BufferAttribute(new Float32Array((SAMPLES + 1) * 4 * 2), 1).setUsage(T.DynamicDrawUsage);

  constructor(scene: T.Scene, orange = false) {
    const geometry = new T.BufferGeometry(), indices: number[] = [];
    geometry.setAttribute('position', this.positions); geometry.setAttribute('uv', this.uvs);
    geometry.setAttribute('born', this.birth); geometry.setAttribute('power', this.powers);
    for (let strip = 0; strip < 4; strip++) for (let i = 0; i <= SAMPLES; i++) {
      const v = (strip * (SAMPLES + 1) + i) * 2;
      this.uvs.setXY(v, 0, i / SAMPLES); this.uvs.setXY(v + 1, 1, i / SAMPLES);
      if (i < SAMPLES) indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
    geometry.setIndex(indices);
    const material = new T.ShaderMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending,
      uniforms: { time: { value: 0 }, sonic: { value: 0 }, flash: { value: 0 }, lifetime: { value: FAINT_LIFETIME },
        hot: { value: new T.Color(orange ? '#ffad32' : '#c646ff') }, tail: { value: new T.Color(orange ? '#f64b22' : '#4764ff') } },
      vertexShader: `attribute float born,power;uniform float time,lifetime;varying float vAge,vBorn,vPower,vDepth;varying vec2 vUv;
        void main(){vUv=uv;vAge=clamp((time-born)/lifetime,0.,1.);vBorn=born;vPower=power;
          vec4 p=modelViewMatrix*vec4(position,1.);vDepth=-p.z;gl_Position=projectionMatrix*p;}`,
      fragmentShader: `uniform float time,sonic,flash;uniform vec3 hot,tail;varying float vAge,vBorn,vPower,vDepth;varying vec2 vUv;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        void main(){float edge=abs(vUv.x*2.-1.);float core=exp(-edge*edge*48.);
          float filament=exp(-pow(edge-.58-.035*sin(vBorn*93.),2.)*650.);
          float grain=hash(floor(vec2(vUv.x*15.,vBorn*620.)));
          float flecks=smoothstep(.79,.98,grain)*(1.-edge*edge);
          filament*=.4+.6*smoothstep(.2,.8,grain);
          float glow=pow(max(0.,1.-edge),1.4);float fade=pow(1.-vAge,.9)*smoothstep(0.,.022,vAge);
          vec3 tint=mix(hot,tail,smoothstep(.2,.95,vAge));
          tint=mix(vec3(.95,.85,1.),tint,smoothstep(.015,.24,vAge));
          tint=mix(vec3(.7,.82,.95),tint,.35+.65*sonic);
          vec3 color=tint*(2.1+filament*.7)+vec3(.85,.8,1.)*(core*.7+flecks*.7*(1.-vAge));
          float alpha=(glow*.48+core*.58+filament*.48+flecks*.42)*fade*vPower*(.72+.28*grain)*(1.+flash*.18)*smoothstep(.2,.7,vDepth);
          gl_FragColor=vec4(color,alpha);}`,
    });
    this.mesh = new T.Mesh(geometry, material); this.mesh.name = 'wheel-speed-trails'; this.mesh.frustumCulled = false; this.mesh.visible = false; scene.add(this.mesh);
  }

  /** Capture unanimated tire geometry once for each loaded car model. */
  configureWheels(model: CarModel) {
    model.root.updateMatrixWorld(true);
    const inverse = model.root.matrixWorld.clone().invert();
    const bounds = model.wheels.map(wheel => {
      const box = new T.Box3();
      wheel.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        object.geometry.computeBoundingBox();
        box.union(object.geometry.boundingBox!.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(inverse, object.matrixWorld)));
      });
      box.min.multiply(model.root.scale); box.max.multiply(model.root.scale);
      return box;
    }).sort((a, b) => b.getCenter(new T.Vector3()).z - a.getCenter(new T.Vector3()).z).slice(0, 2)
      .sort((a, b) => a.min.x - b.min.x);
    if (bounds.length !== 2 || bounds.some(b => b.isEmpty())) return;
    const centers = bounds.map(b => b.getCenter(new T.Vector3()));
    this.wheelX = centers.map(c => c.x);
    this.wheelWidth = bounds.map(b => (b.max.x - b.min.x) * .38);
    // Emerge from the rear tread just above axle height. The entire ribbon
    // starts clear of the grass; old samples never rise away from the tire.
    this.origin.set(0, (centers[0].y + centers[1].y) / 2 + .05, (bounds[0].max.z + bounds[1].max.z) / 2 - .04);
    this.reset();
  }

  reset() {
    this.head = -1; this.count = 0; this.remainder = this.strength = this.sonic = this.flash = 0;
    this.wasSupersonic = false; this.mesh.visible = false;
  }

  private pose(target: TrailSample, position: T.Vector3, rotation: T.Quaternion, time: number) {
    target.position.copy(position); target.right.set(1, 0, 0).applyQuaternion(rotation); target.up.set(0, 1, 0).applyQuaternion(rotation);
    // Every sample uses the same tire-mounted origin, with no age-based lift.
    this.point.copy(this.origin).applyQuaternion(rotation); target.position.add(this.point);
    target.time = time; target.power = this.strength;
  }

  update(position: T.Vector3, rotation: T.Quaternion, speed: number, supersonic: boolean, grounded: boolean, visible: boolean, dt: number) {
    const active = visible && grounded && supersonic && speed >= .5;
    if (!active || (this.count > 0 && this.previous.distanceToSquared(position) > 16)) this.reset();
    if (!active) { this.previous.copy(position); this.previousRotation.copy(rotation); return; }
    if (this.count === 0) { this.previous.copy(position); this.previousRotation.copy(rotation); }
    this.time += dt;
    this.strength = T.MathUtils.damp(this.strength, 1, 28, dt);
    this.sonic = T.MathUtils.damp(this.sonic, 1, 28, dt);
    if (supersonic && !this.wasSupersonic) this.flash = 1;
    this.wasSupersonic = supersonic; this.flash *= Math.exp(-dt * 16);
    // Fixed sampling gives the same trail length and smoothness at 30 or 144 Hz.
    this.remainder += dt;
    while (this.remainder >= SAMPLE_STEP) {
      this.remainder -= SAMPLE_STEP; this.head = (this.head + 1) % SAMPLES; this.count = Math.min(SAMPLES, this.count + 1);
      const t = dt > 0 ? T.MathUtils.clamp(1 - this.remainder / dt, 0, 1) : 1;
      this.side.lerpVectors(this.previous, position, t); this.rotation.slerpQuaternions(this.previousRotation, rotation, t);
      this.pose(this.history[this.head], this.side, this.rotation, this.time - this.remainder);
    }
    this.pose(this.current, position, rotation, this.time);
    this.previous.copy(position); this.previousRotation.copy(rotation);
    const uniforms = this.mesh.material.uniforms;
    uniforms.time.value = this.time; uniforms.sonic.value = this.sonic; uniforms.flash.value = this.flash;
    const lifetime = T.MathUtils.lerp(FAINT_LIFETIME, SONIC_LIFETIME, this.sonic);
    uniforms.lifetime.value = lifetime;
    this.mesh.visible = this.strength > .002 && this.count > 0;
    if (!this.mesh.visible) return;
    for (let strip = 0; strip < 4; strip++) for (let i = 0; i <= SAMPLES; i++) {
      const s = i === 0 ? this.current : this.history[(this.head - Math.min(i, this.count) + 1 + SAMPLES) % SAMPLES];
      const age = T.MathUtils.clamp((this.time - s.time) / lifetime, 0, 1);
      const wheel = strip < 2 ? 0 : 1;
      const width = (strip % 2 ? .035 : this.wheelWidth[wheel]) * (1 - age * .88) * (.65 + this.sonic * .35);
      this.point.copy(s.position).addScaledVector(s.right, this.wheelX[wheel]);
      const across = strip % 2 ? s.up : s.right, v = (strip * (SAMPLES + 1) + i) * 2;
      for (let edge = 0; edge < 2; edge++) {
        this.side.copy(this.point).addScaledVector(across, width * (edge ? 1 : -1));
        this.positions.setXYZ(v + edge, this.side.x, this.side.y, this.side.z);
        this.birth.setX(v + edge, s.time); this.powers.setX(v + edge, s.power);
      }
    }
    this.positions.needsUpdate = this.birth.needsUpdate = this.powers.needsUpdate = true;
  }
}
