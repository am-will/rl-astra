import * as T from 'three';
import { FIELD } from './config';

/** A single soft ribbon behind a fast ball, without emitted particles. */
export class BallSpeedTrail {
  readonly mesh: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;
  private strength = 0;
  private length = 0;
  private direction = new T.Vector3(0, 0, 1);

  constructor(scene: T.Scene) {
    const material = new T.ShaderMaterial({
      transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending,
      uniforms: { head: { value: new T.Vector3() }, tail: { value: new T.Vector3() }, strength: { value: 0 }, halfWidth: { value: .24 } },
      vertexShader: `uniform vec3 head,tail;uniform float halfWidth;varying vec2 vUv;varying float vDepth;
        void main(){vUv=uv;
          vec3 axis=normalize(tail-head),look=normalize(cameraPosition-(head+tail)*.5);
          vec3 across=cross(axis,look);
          if(dot(across,across)<.0001)across=cross(axis,vec3(0.,1.,0.));
          if(dot(across,across)<.0001)across=cross(axis,vec3(1.,0.,0.));
          vec3 point=mix(head,tail,uv.y)+normalize(across)*(uv.x*2.-1.)*halfWidth*mix(1.,.22,uv.y);
          vec4 mv=viewMatrix*vec4(point,1.);vDepth=-mv.z;gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform float strength;varying vec2 vUv;varying float vDepth;
        void main(){float edge=abs(vUv.x*2.-1.);
          float core=exp(-edge*edge*55.),glow=exp(-edge*edge*5.)*(1.-smoothstep(.65,1.,edge));
          float fade=pow(1.-vUv.y,1.35)*smoothstep(0.,.035,vUv.y);
          vec3 color=mix(vec3(1.8,.48,.065),vec3(2.,1.45,.72),core);
          float alpha=(core*.75+glow*.32)*fade*strength*smoothstep(.15,.5,vDepth);
          gl_FragColor=vec4(color,alpha);}`,
    });
    this.mesh = new T.Mesh(new T.PlaneGeometry(1, 1), material);
    this.mesh.name = 'ball-speed-streak'; this.mesh.frustumCulled = false; this.mesh.visible = false;
    scene.add(this.mesh);
  }

  reset() {
    this.strength = this.length = 0;
    this.mesh.material.uniforms.strength.value = 0; this.mesh.visible = false;
  }

  update(position: T.Vector3, velocity: T.Vector3, dt: number, visible: boolean) {
    if (!visible) { this.reset(); return; }
    const speed = velocity.length();
    // Bring the streak in on moderate hits and reach full strength on firm shots.
    const target = T.MathUtils.smoothstep(speed, 12, 24);
    this.strength = T.MathUtils.damp(this.strength, target, target > this.strength ? 24 : 16, dt);
    this.length = T.MathUtils.damp(this.length, T.MathUtils.lerp(6, 18, target), 20, dt);
    this.mesh.visible = this.strength > .002 && this.length > .01;
    if (!this.mesh.visible) return;
    if (speed > .1) this.direction.copy(velocity).divideScalar(speed);
    const uniforms = this.mesh.material.uniforms;
    uniforms.head.value.copy(position).addScaledVector(this.direction, -FIELD.ballRadius * .8);
    uniforms.tail.value.copy(uniforms.head.value).addScaledVector(this.direction, -this.length);
    uniforms.strength.value = this.strength;
  }
}
