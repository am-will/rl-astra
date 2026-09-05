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
