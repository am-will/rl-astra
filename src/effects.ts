import * as T from 'three';
import { glowTexture } from './stadium';
import { GoalExplosion } from './goal-explosion';
import { Demolitions } from './demolition';
import { BallSpeedTrail } from './ball-speed-trail';
interface Particle { pos: T.Vector3; velocity: T.Vector3; color: T.Color; life: number; maxLife: number; }
export class Effects {
  particles: Particle[] = [];
  max = 1300;
  points: T.Points;
  explosion: GoalExplosion;
  demolitions: Demolitions;
  ballStreak: BallSpeedTrail;
  constructor(public scene: T.Scene) {
    this.explosion = new GoalExplosion(scene);
    this.demolitions = new Demolitions(scene);
    this.ballStreak = new BallSpeedTrail(scene);
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(this.max * 3), 3)); geometry.setAttribute('color', new T.BufferAttribute(new Float32Array(this.max * 3), 3));
    geometry.setDrawRange(0, 0);
    this.points = new T.Points(geometry, new T.PointsMaterial({ size: .085, map: glowTexture(), vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    this.points.frustumCulled = false; scene.add(this.points);
  }
  emit(pos: T.Vector3, velocity: T.Vector3, color: T.ColorRepresentation, life = .6, spread = .5) {
    if (this.particles.length >= this.max) return;
    this.particles.push({ pos: pos.clone().add(new T.Vector3((Math.random() - .5) * spread, (Math.random() - .5) * spread, (Math.random() - .5) * spread)), velocity: velocity.clone(), color: new T.Color(color), life, maxLife: life });
  }
  goal(pos: T.Vector3, color: T.ColorRepresentation) {
    this.explosion.trigger(pos, color);
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
  }
}
