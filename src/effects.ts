import * as T from 'three';
import { glowTexture } from './stadium';
import { GoalExplosion } from './goal-explosion';
import { Demolitions } from './demolition';
interface Particle { pos: T.Vector3; velocity: T.Vector3; color: T.Color; life: number; maxLife: number; size: number; }
export class Effects {
  particles: Particle[] = [];
  smoke: Particle[] = [];
  max = 1300;
  points: T.Points;
  smokePoints: T.Points;
  explosion: GoalExplosion;
  demolitions: Demolitions;
  private ballEmission = 0;
  constructor(public scene: T.Scene) {
    this.explosion = new GoalExplosion(scene);
    this.demolitions = new Demolitions(scene);
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(this.max * 3), 3)); geometry.setAttribute('color', new T.BufferAttribute(new Float32Array(this.max * 3), 3));
    geometry.setDrawRange(0, 0);
    this.points = new T.Points(geometry, new T.PointsMaterial({ size: .085, map: glowTexture(), vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    this.points.frustumCulled = false; scene.add(this.points);
    const smokeGeo = new T.BufferGeometry();
    smokeGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(450 * 3), 3)); smokeGeo.setAttribute('alpha', new T.BufferAttribute(new Float32Array(450), 1)); smokeGeo.setAttribute('size', new T.BufferAttribute(new Float32Array(450), 1)); smokeGeo.setDrawRange(0, 0);
    const smokeMat = new T.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { map: { value: glowTexture() }, screenHeight: { value: innerHeight } }, vertexShader: `attribute float alpha; attribute float size; varying float vAlpha; uniform float screenHeight; void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vAlpha=alpha*step(.2,-mv.z);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(size*screenHeight/max(.2,-mv.z),1.,96.);}`, fragmentShader: `uniform sampler2D map; varying float vAlpha; void main(){float a=texture2D(map,gl_PointCoord).a;gl_FragColor=vec4(.65,.73,.79,a*vAlpha);}` });
    this.smokePoints = new T.Points(smokeGeo, smokeMat); this.smokePoints.frustumCulled = false; scene.add(this.smokePoints);
    window.addEventListener('resize', () => { smokeMat.uniforms.screenHeight.value = innerHeight; });
  }
  puff(pos: T.Vector3, velocity: T.Vector3, size = 1, lifetime = .75) {
    if (this.smoke.length >= 450) return;
    this.smoke.push({ pos: pos.clone(), velocity: velocity.clone().add(new T.Vector3((Math.random() - .5) * .8, .4, (Math.random() - .5) * .8)), color: new T.Color(), life: lifetime, maxLife: lifetime, size });
  }
  emit(pos: T.Vector3, velocity: T.Vector3, color: T.ColorRepresentation, life = .6, spread = .5) {
    if (this.particles.length >= this.max) return;
    this.particles.push({ pos: pos.clone().add(new T.Vector3((Math.random() - .5) * spread, (Math.random() - .5) * spread, (Math.random() - .5) * spread)), velocity: velocity.clone(), color: new T.Color(color), life, maxLife: life, size: 1 });
  }
  burst(pos: T.Vector3, color: T.ColorRepresentation, amount = 75, power = 12) {
    for (let i = 0; i < amount; i++) this.emit(pos, new T.Vector3(Math.random() - .5, Math.random() - .2, Math.random() - .5).normalize().multiplyScalar(power * (.2 + Math.random())), color, .5 + Math.random() * 1.4, .5);
  }
  goal(pos: T.Vector3, color: T.ColorRepresentation) {
    this.explosion.trigger(pos, color);
  }
  ballTrail(pos: T.Vector3, velocity: T.Vector3, dt: number, visible: boolean) {
    const speed = velocity.length();
    if (!visible || speed < 12) { this.ballEmission = 0; return; }
    // A short, sparse sparkle wake, with the same density at every refresh rate.
    const rate = T.MathUtils.lerp(28, 80, T.MathUtils.smoothstep(speed, 12, 40));
    this.ballEmission += dt * rate;
    const behind = velocity.clone().normalize().multiplyScalar(-.8);
    while (this.ballEmission >= 1) {
      this.ballEmission--;
      const source = pos.clone().add(behind).addScaledVector(velocity, -this.ballEmission / rate);
      this.emit(source, velocity.clone().multiplyScalar(.04), speed > 27 ? 0xffc696 : 0xc3e3f5, .14 + Math.random() * .08, .24);
    }
  }

  update(dt: number) {
    this.explosion.update(dt);
    this.demolitions.update(dt);
    const positions = this.points.geometry.getAttribute('position') as T.BufferAttribute, colors = this.points.geometry.getAttribute('color') as T.BufferAttribute;
    this.particles = this.particles.filter(p => p.life > 0);
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]; p.life -= dt; p.velocity.y -= dt * 2; p.pos.addScaledVector(p.velocity, dt);
      const fade = Math.max(0, p.life / p.maxLife); positions.setXYZ(i, p.pos.x, p.pos.y, p.pos.z); colors.setXYZ(i, p.color.r * fade * 2, p.color.g * fade * 2, p.color.b * fade * 2);
    }
    positions.needsUpdate = true; colors.needsUpdate = true; this.points.geometry.setDrawRange(0, this.particles.length);
    this.smoke = this.smoke.filter(p => p.life > 0);
    const smokePos = this.smokePoints.geometry.getAttribute('position') as T.BufferAttribute, alpha = this.smokePoints.geometry.getAttribute('alpha') as T.BufferAttribute, size = this.smokePoints.geometry.getAttribute('size') as T.BufferAttribute;
    for (let i = 0; i < this.smoke.length; i++) { const p = this.smoke[i]; p.life -= dt; p.pos.addScaledVector(p.velocity, dt); const age = 1 - Math.max(0, p.life) / p.maxLife; smokePos.setXYZ(i, p.pos.x, p.pos.y, p.pos.z); alpha.setX(i, (1 - age) * .34); size.setX(i, p.size * (.55 + age * 1.7)); }
    smokePos.needsUpdate = alpha.needsUpdate = size.needsUpdate = true; this.smokePoints.geometry.setDrawRange(0, this.smoke.length);

  }
}
export class GameAudio {
  ctx?: AudioContext;
  engine?: OscillatorNode;
  engineGain?: GainNode;
  noiseGain?: GainNode;
  master?: GainNode;
  muted = false;
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    this.ctx = new AudioContext(); this.master = this.ctx.createGain(); this.master.gain.value = .32; this.master.connect(this.ctx.destination);
    this.engine = this.ctx.createOscillator(); this.engine.type = 'sawtooth'; this.engine.frequency.value = 40;
    const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 260;
    this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0; this.engine.connect(filter); filter.connect(this.engineGain); this.engineGain.connect(this.master); this.engine.start();
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate); const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource(); noise.buffer = buffer; noise.loop = true;
    const nf = this.ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 900;
    this.noiseGain = this.ctx.createGain(); this.noiseGain.gain.value = 0; noise.connect(nf); nf.connect(this.noiseGain); this.noiseGain.connect(this.master); noise.start();
  }
  toggle() { this.muted = !this.muted; if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : .32, this.ctx.currentTime, .05); }
  update(speed: number, boost: boolean, active: boolean) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.engine!.frequency.setTargetAtTime(38 + speed * 4.5, t, .08);
    this.engineGain!.gain.setTargetAtTime(active ? .045 + speed * .0017 : 0, t, .15);
    this.noiseGain!.gain.setTargetAtTime(active ? (boost ? .22 : .009) : 0, t, .08);
  }
  tone(frequency: number, duration = .15, volume = .15, end = frequency) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator(), gain = this.ctx.createGain(), t = this.ctx.currentTime;
    osc.type = 'sine'; osc.frequency.setValueAtTime(frequency, t); osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + duration);
    gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    osc.connect(gain); gain.connect(this.master!); osc.start(); osc.stop(t + duration);
  }
  hit(speed: number) { this.tone(90 + speed * 3, .17, .2, 32); }
  demolition(distance: number) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, now = ctx.currentTime, volume = Math.max(.12, 1 / (1 + distance * .045));
    this.tone(135, .75, .6 * volume, 25); this.tone(64, 1.2, .36 * volume, 22);
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 1.6), ctx.sampleRate), data = buffer.getChannelData(0);
    let low = 0;
    for (let i = 0; i < data.length; i++) { const white = Math.random() * 2 - 1; low = low * .9 + white * .1; data[i] = low * 2 + white * .3; }
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain(); source.buffer = buffer;
    filter.type = 'lowpass'; filter.frequency.setValueAtTime(9000, now); filter.frequency.exponentialRampToValueAtTime(230, now + 1.6);
    gain.gain.setValueAtTime(.7 * volume, now); gain.gain.exponentialRampToValueAtTime(.001, now + 1.6);
    source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start();
    for (let i = 0; i < 5; i++) {
      const ping = ctx.createOscillator(), envelope = ctx.createGain(), start = now + .04 + i * .08;
      ping.type = 'triangle'; ping.frequency.setValueAtTime(1800 - i * 240, start); ping.frequency.exponentialRampToValueAtTime(300, start + .12);
      envelope.gain.setValueAtTime(.055 * volume, start); envelope.gain.exponentialRampToValueAtTime(.001, start + .16);
      ping.connect(envelope); envelope.connect(this.master); ping.start(start); ping.stop(start + .16);
    }
  }
  goal() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const boom = (frequency: number, end: number, start: number, duration: number, volume: number, type: OscillatorType = 'sine') => {
      const osc = ctx.createOscillator(), gain = ctx.createGain(); osc.type = type;
      osc.frequency.setValueAtTime(frequency, now + start); osc.frequency.exponentialRampToValueAtTime(end, now + start + duration);
      gain.gain.setValueAtTime(.001, now + start); gain.gain.linearRampToValueAtTime(volume, now + start + .018); gain.gain.exponentialRampToValueAtTime(.001, now + start + duration);
      osc.connect(gain); gain.connect(this.master!); osc.start(now + start); osc.stop(now + start + duration);
    };
    boom(110, 680, 0, .22, .12, 'triangle');
    boom(105, 23, .22, 2.1, .8); boom(57, 28, .23, 2.8, .45);
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 3.4, ctx.sampleRate), data = buffer.getChannelData(0);
    let last = 0; for (let i = 0; i < data.length; i++) { last = (last + (Math.random() * 2 - 1) * .08) / 1.02; data[i] = last * 3.5; }
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain(); source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.setValueAtTime(6000, now + .22); filter.frequency.exponentialRampToValueAtTime(180, now + 3.4);
    gain.gain.setValueAtTime(.001, now); gain.gain.linearRampToValueAtTime(.7, now + .24); gain.gain.exponentialRampToValueAtTime(.001, now + 3.4);
    source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start(now + .2); source.stop(now + 3.4);
    [261.6, 392, 523.2].forEach((f, i) => boom(f, f * .997, .5 + i * .13, 2.5, .07));
  }
}
