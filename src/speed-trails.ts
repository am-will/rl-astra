import * as T from 'three';

const SAMPLES = 32, SAMPLE_STEP = 1 / 120;
interface TrailSample { position: T.Vector3; right: T.Vector3; up: T.Vector3; time: number; power: number; }
const sample = (): TrailSample => ({ position: new T.Vector3(), right: new T.Vector3(), up: new T.Vector3(), time: 0, power: 0 });

/** Short Lightspeed-inspired ribbons, attached to the rear tires and left in
 * world space so they trace turns and aerials instead of swinging like rods. */
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
      uniforms: { time: { value: 0 }, sonic: { value: 0 }, flash: { value: 0 },
        hot: { value: new T.Color(orange ? '#ffb12c' : '#29ceff') }, tail: { value: new T.Color(orange ? '#f64b22' : '#5455ff') } },
      vertexShader: `attribute float born,power;uniform float time,sonic;varying float vAge,vPower,vDepth;varying vec2 vUv;
        void main(){vUv=uv;vAge=clamp((time-born)/mix(.09,.18,sonic),0.,1.);vPower=power;
          vec4 p=modelViewMatrix*vec4(position,1.);vDepth=-p.z;gl_Position=projectionMatrix*p;}`,
      fragmentShader: `uniform float time,sonic,flash;uniform vec3 hot,tail;varying float vAge,vPower,vDepth;varying vec2 vUv;
        void main(){float edge=abs(vUv.x*2.-1.);float core=exp(-edge*edge*32.);
          float filament=exp(-pow(edge-.62-.025*sin(vAge*36.-time*15.),2.)*650.);
          filament*=.55+.45*smoothstep(-.2,.65,sin(vAge*65.-time*18.));
          float glow=pow(max(0.,1.-edge),1.65);float fade=pow(1.-vAge,1.3);
          float flow=.9+.1*sin(vAge*45.-time*24.);
          vec3 tint=mix(vec3(.7,.82,.95),mix(hot,tail,smoothstep(.15,1.,vAge)),sonic);
          vec3 color=tint*(1.8+filament*.5)+vec3(.65,.85,1.)*core*.55;
          float alpha=(glow*.36+core*.48+filament*.35)*fade*vPower*flow*(1.+flash*.22)*smoothstep(.2,.7,vDepth);
          gl_FragColor=vec4(color,alpha);}`,
    });
    this.mesh = new T.Mesh(geometry, material); this.mesh.name = 'wheel-speed-trails'; this.mesh.frustumCulled = false; this.mesh.visible = false; scene.add(this.mesh);
  }

  reset() {
    this.head = -1; this.count = 0; this.remainder = this.strength = this.sonic = this.flash = 0;
    this.wasSupersonic = false; this.mesh.visible = false;
  }

  private pose(target: TrailSample, position: T.Vector3, rotation: T.Quaternion, time: number) {
    target.position.copy(position); target.right.set(1, 0, 0).applyQuaternion(rotation); target.up.set(0, 1, 0).applyQuaternion(rotation);
    // Wheel origins are just above each rear tire's contact patch.
    this.point.set(0, -.24, .56).applyQuaternion(rotation); target.position.add(this.point);
    target.time = time; target.power = this.strength;
  }

  update(position: T.Vector3, rotation: T.Quaternion, speed: number, supersonic: boolean, visible: boolean, dt: number) {
    if (!visible || speed < .5 || (this.count > 0 && this.previous.distanceToSquared(position) > 16)) this.reset();
    if (!visible || speed < .5) { this.previous.copy(position); this.previousRotation.copy(rotation); return; }
    if (this.count === 0) { this.previous.copy(position); this.previousRotation.copy(rotation); }
    this.time += dt;
    const target = supersonic ? 1 : .2 * T.MathUtils.smoothstep(speed, 16, 21);
    this.strength = T.MathUtils.damp(this.strength, target, 28, dt);
    this.sonic = T.MathUtils.damp(this.sonic, supersonic ? 1 : 0, 28, dt);
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
    this.mesh.visible = this.strength > .002 && this.count > 0;
    if (!this.mesh.visible) return;
    for (let strip = 0; strip < 4; strip++) for (let i = 0; i <= SAMPLES; i++) {
      const s = i === 0 ? this.current : this.history[(this.head - Math.min(i, this.count) + 1 + SAMPLES) % SAMPLES];
      const age = T.MathUtils.clamp((this.time - s.time) / .23, 0, 1);
      const width = (strip % 2 ? .055 : .18) * (1 - age * .8) * (.65 + this.sonic * .35);
      this.point.copy(s.position).addScaledVector(s.right, strip < 2 ? -.43 : .43);
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
