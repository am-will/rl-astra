import * as T from 'three';

const CAPACITY = 28, RATE = 30, NEAR = 1.2, FAR = 30;
interface Speck { position: T.Vector3; width: number; exposure: number; age: number; life: number; gain: number; cycle: number; }
const random = (seed: number) => T.MathUtils.euclideanModulo(Math.sin(seed * 127.1 + 311.7) * 43758.5453, 1);

/** Sparse dust crossed by the moving camera. Camera translation and rotation
 * produce expansion, lateral flow or convergence, including in ball cam. */
export class SupersonicStreaks {
  readonly mesh: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
  private specks: Speck[] = Array.from({ length: CAPACITY }, (_, i) => ({
    position: new T.Vector3(0, 0, -FAR), width: 2.1 + random(i + 2) * 2.4,
    exposure: .07 + random(i + 3) * .13, age: 0, life: 0, gain: 0, cycle: 0,
  }));
  private positions = new T.BufferAttribute(new Float32Array(CAPACITY * 4 * 3), 3).setUsage(T.DynamicDrawUsage);
  private alphas = new T.BufferAttribute(new Float32Array(CAPACITY * 4), 1).setUsage(T.DynamicDrawUsage);
  private shapes = new T.BufferAttribute(new Float32Array(CAPACITY * 4 * 2), 2).setUsage(T.DynamicDrawUsage);
  private strength = 0;
  private initialized = false;
  private previous = new T.Vector3();
  private previousCamera = new T.Vector3();
  private previousRotation = new T.Quaternion();
  private inverse = new T.Quaternion();
  private turn = new T.Quaternion();
  private displacement = new T.Vector3();
  private motion = new T.Vector3();
  private angular = new T.Vector3();
  private credit = 0;
  private cursor = 0;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(scene: T.Scene) {
    const geometry = new T.BufferGeometry(), indices: number[] = [];
    const uvs = new Float32Array(CAPACITY * 4 * 2);
    for (let i = 0; i < CAPACITY; i++) {
      for (let corner = 0; corner < 4; corner++) {
        const vertex = i * 4 + corner;
        uvs[vertex * 2] = corner % 2; uvs[vertex * 2 + 1] = Math.floor(corner / 2);
        this.positions.setXYZ(vertex, 0, 0, -FAR);
      }
      const v = i * 4; indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
    geometry.setIndex(indices); geometry.setAttribute('position', this.positions);
    geometry.setAttribute('uv', new T.BufferAttribute(uvs, 2)); geometry.setAttribute('shape', this.shapes);
    geometry.setAttribute('alpha', this.alphas);
    const material = new T.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending,
      uniforms: { velocity: { value: this.motion }, angularVelocity: { value: this.angular }, strength: { value: 0 }, resolution: { value: new T.Vector2(1, 1) } },
      vertexShader: `attribute vec2 shape;attribute float alpha;uniform vec3 velocity,angularVelocity;uniform vec2 resolution;
        varying vec2 vUv,vScreen;varying float vAlpha;
        void main(){
          vUv=uv;vAlpha=alpha;vScreen=vec2(2.);
          if(alpha<=0.){gl_Position=vec4(2.,2.,0.,1.);return;}
          vec4 head=projectionMatrix*vec4(position,1.);
          // Optical motion includes the camera's orbit, not just car heading.
          vec3 end=position+(velocity+cross(angularVelocity,position))*shape.y;
          end.z=min(end.z,-.5);
          vec4 tail=projectionMatrix*vec4(end,1.);
          vec2 a=head.xy/head.w,b=tail.xy/tail.w;
          vec2 pixels=(b-a)*resolution*.5;float distance=length(pixels);
          vec2 direction=distance>.001?pixels/distance:vec2(0.,1.);
          float pixelScale=resolution.y/1080.;
          b=a+direction*clamp(distance,3.*pixelScale,430.*pixelScale)*2./resolution;
          vec2 normal=vec2(-direction.y,direction.x);
          // Both width and opacity taper, without an opaque laser core.
          float width=shape.x*pixelScale*mix(1.,.2,uv.y);
          vec2 p=mix(a,b,uv.y)+normal*(uv.x-.5)*width*2./resolution;
          gl_Position=vec4(p,0.,1.);vScreen=p;
        }`,
      fragmentShader: `uniform float strength;varying vec2 vUv,vScreen;varying float vAlpha;
        void main(){
          float edge=abs(vUv.x*2.-1.);float across=exp(-edge*edge*2.3)*(1.-edge*edge);
          float along=smoothstep(0.,.08,vUv.y)*pow(1.-vUv.y,.7);
          float peripheral=smoothstep(.16,.55,length(vScreen*vec2(.85,1.)));
          float border=smoothstep(0.,.055,min(1.-abs(vScreen.x),1.-abs(vScreen.y)));
          gl_FragColor=vec4(vec3(.48,.51,.55),across*along*peripheral*border*vAlpha*strength*.16);
        }`,
    });
    this.mesh = new T.Mesh(geometry, material); this.mesh.name = 'supersonic-camera-streaks';
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 100; this.mesh.visible = false; scene.add(this.mesh);
  }

  resize(width: number, height: number) { this.mesh.material.uniforms.resolution.value.set(width, height); }

  reset() {
    this.initialized = false; this.strength = 0; this.credit = 0; this.cursor = 0; this.mesh.visible = false;
    this.mesh.material.uniforms.strength.value = 0;
    for (const speck of this.specks) speck.life = 0;
  }

  private spawn(speck: Speck, index: number, camera: T.PerspectiveCamera, initial = false) {
    const seed = index * 7 + speck.cycle++ * 631;
    const depth = 5 + random(seed + 1) * 19;
    const halfHeight = depth * Math.tan(T.MathUtils.degToRad(camera.fov * .5));
    const x = random(seed + 2) * 2.1 - 1.05;
    let y = random(seed + 3) * 2.1 - 1.05;
    if (Math.hypot(x * .85, y) < .26) y += y < 0 ? -.35 : .35;
    speck.position.set(x * halfHeight * camera.aspect, y * halfHeight, -depth);
    speck.life = .38 + random(seed + 4) * .30;
    speck.age = initial ? random(seed + 5) * speck.life : 0;
    speck.gain = .55 + random(seed + 6) * .65;
  }

  update(camera: T.PerspectiveCamera, position: T.Vector3, velocity: T.Vector3, supersonic: boolean, enabled: boolean, dt: number) {
    const teleported = this.initialized && (this.previous.distanceToSquared(position) > 16 || this.previousCamera.distanceToSquared(camera.position) > 64);
    if (!enabled || velocity.lengthSq() < 1 || teleported) this.reset();
    this.previous.copy(position);
    if (!enabled || velocity.lengthSq() < 1 || dt <= 0) return;
    if (!this.initialized && !supersonic) return;
    this.inverse.copy(camera.quaternion).invert();
    this.displacement.set(0, 0, 0); this.turn.identity(); this.angular.set(0, 0, 0);
    if (!this.initialized) {
      for (const speck of this.specks) speck.cycle = 0;
      // Stagger the initial field instead of flashing a synchronized burst.
      for (let i = 0; i < 12; i++) this.spawn(this.specks[this.cursor++], i, camera, true);
      this.motion.copy(velocity).applyQuaternion(this.inverse);
      this.initialized = true;
    } else {
      this.displacement.subVectors(camera.position, this.previousCamera).applyQuaternion(this.inverse);
      this.motion.copy(this.displacement).divideScalar(dt);
      this.turn.multiplyQuaternions(this.inverse, this.previousRotation);
      if (this.turn.w < 0) this.turn.set(-this.turn.x, -this.turn.y, -this.turn.z, -this.turn.w);
      const sine = Math.hypot(this.turn.x, this.turn.y, this.turn.z);
      if (sine > .00001) {
        const angle = 2 * Math.atan2(sine, this.turn.w);
        this.angular.set(this.turn.x, this.turn.y, this.turn.z).multiplyScalar(-Math.min(angle / dt, 4) / sine);
      }
    }
    this.previousCamera.copy(camera.position); this.previousRotation.copy(camera.quaternion);
    this.strength = T.MathUtils.damp(this.strength, supersonic ? 1 : 0, supersonic ? 9 : 16, dt);
    this.mesh.material.uniforms.strength.value = this.strength * (this.reducedMotion.matches ? .25 : 1);
    this.mesh.visible = this.strength > .003;
    if (!this.mesh.visible) { this.reset(); return; }
    const tangent = Math.tan(T.MathUtils.degToRad(camera.fov * .5));
    for (const speck of this.specks) {
      if (!speck.life) continue;
      speck.position.applyQuaternion(this.turn).sub(this.displacement); speck.age += dt;
      const p = speck.position, depth = -p.z, halfHeight = depth * tangent;
      if (speck.age >= speck.life || depth < NEAR || depth > FAR || Math.abs(p.x) > halfHeight * camera.aspect * 1.4 || Math.abs(p.y) > halfHeight * 1.4) speck.life = 0;
    }
    if (supersonic) this.credit += RATE * dt;
    while (this.credit >= 1) {
      this.credit--; const index = this.cursor++ % CAPACITY;
      this.spawn(this.specks[index], index, camera);
      this.specks[index].age = this.credit / RATE;
    }
    for (let i = 0; i < CAPACITY; i++) {
      const speck = this.specks[i], p = speck.position;
      const alpha = speck.life ? speck.gain * T.MathUtils.smoothstep(speck.age, 0, .045) * (1 - T.MathUtils.smoothstep(speck.age / speck.life, .55, 1)) * T.MathUtils.smoothstep(-p.z, NEAR, 3) : 0;
      const exposure = speck.exposure * T.MathUtils.smoothstep(speck.age, 0, .06);
      for (let corner = 0; corner < 4; corner++) {
        this.positions.setXYZ(i * 4 + corner, p.x, p.y, p.z); this.alphas.setX(i * 4 + corner, alpha);
        this.shapes.setXY(i * 4 + corner, speck.width, exposure);
      }
    }
    this.positions.needsUpdate = this.alphas.needsUpdate = this.shapes.needsUpdate = true;
  }
}
