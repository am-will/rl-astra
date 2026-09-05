import * as T from 'three';

const CAPACITY = 160;
interface Puff { position: T.Vector3; velocity: T.Vector3; age: number; life: number; seed: number; }
/** World-space billows expand from hot orange gas into soft, drifting smoke. */
export class FlameSmoke {
  root: T.InstancedMesh;
  private particles: Puff[] = [];
  private debt = 0;
  private previous = new T.Vector3();
  private data = new T.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  private matrix = new T.Matrix4();
  private uniforms = { cameraRight: { value: new T.Vector3(1, 0, 0) }, cameraUp: { value: new T.Vector3(0, 1, 0) } };
  constructor(scene: T.Scene) {
    const geometry = new T.PlaneGeometry(1, 1); geometry.setAttribute('puffData', this.data);
    const material = new T.ShaderMaterial({ uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: `attribute vec3 puffData;uniform vec3 cameraRight,cameraUp;varying vec2 vUv;varying vec3 vData;
        void main(){vUv=uv;vData=puffData;vec3 center=instanceMatrix[3].xyz;
          float size=(.16+puffData.x*.95)*puffData.z;
          vec3 p=center+(cameraRight*position.x+cameraUp*position.y)*size;
          gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}`,
      fragmentShader: `varying vec2 vUv;varying vec3 vData;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        float fbm(vec2 p){return noise(p)*.57+noise(p*2.03)*.28+noise(p*4.1)*.15;}
        void main(){float age=vData.x;vec2 p=vUv-.5;float a=vData.y*6.283+age*.9; p=mat2(cos(a),-sin(a),sin(a),cos(a))*p;
          float cloud=fbm(p*7.+vData.y*20.+vec2(age*1.8,-age));
          float edge=1.-smoothstep(.20,.50,length(p)+(cloud-.5)*.19);
          float hot=1.-smoothstep(.08,.48,age);
          vec3 smoke=mix(vec3(.18,.20,.23),vec3(.59,.60,.59),cloud);
          vec3 fire=mix(vec3(1.8,.13,.009),vec3(3.4,1.45,.17),smoothstep(.2,.75,cloud));
          fire=mix(fire,vec3(4.,3.1,1.5),(1.-smoothstep(0.,.15,age))*cloud);
          float alpha=edge*mix(.42,.84,hot)*(1.-smoothstep(.5,1.,age));
          if(alpha<.005)discard;gl_FragColor=vec4(mix(smoke,fire,hot),alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    this.root = new T.InstancedMesh(geometry, material, CAPACITY); this.root.name = 'inferno-flame-smoke'; this.root.frustumCulled = false; this.root.visible = false; this.root.count = 0; this.root.renderOrder = 3; scene.add(this.root);
    this.root.instanceMatrix.setUsage(T.DynamicDrawUsage); this.data.setUsage(T.DynamicDrawUsage);
  }
  reset() { this.particles.length = 0; this.debt = 0; this.root.count = 0; this.root.visible = false; }
  update(position: T.Vector3, rotation: T.Quaternion, velocity: T.Vector3, active: boolean, dt: number, camera: T.Camera) {
    if (position.distanceToSquared(this.previous) > 64) this.reset();
    this.previous.copy(position);
    this.uniforms.cameraRight.value.setFromMatrixColumn(camera.matrixWorld, 0); this.uniforms.cameraUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
    if (dt > 0) {
      for (const puff of this.particles) { puff.age += dt; puff.position.addScaledVector(puff.velocity, dt); puff.velocity.multiplyScalar(Math.exp(-dt * 2.2)); puff.velocity.y += dt * 1.7; }
      this.particles = this.particles.filter(p => p.age < p.life);
      if (active) {
        this.debt += dt * 95;
        while (this.debt >= 1) { this.debt--; for (const x of [-.255, .255]) {
          if (this.particles.length >= CAPACITY) this.particles.shift();
          const p = new T.Vector3(x, .025, .71).applyQuaternion(rotation).add(position);
          const speed = new T.Vector3((Math.random() - .5) * .8, (Math.random() - .5) * .5, 6.5 + Math.random() * 2).applyQuaternion(rotation).addScaledVector(velocity, .64);
          const age = this.debt / 95; p.addScaledVector(velocity, -age).addScaledVector(speed, age);
          this.particles.push({ position: p, velocity: speed, age, life: .6 + Math.random() * .22, seed: Math.random() });
        } }
      } else this.debt = 0;
    }
    // Back-to-front blending stays correct as the camera orbits the trail.
    const forward = new T.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    this.particles.sort((a, b) => b.position.dot(forward) - a.position.dot(forward));
    this.particles.forEach((p, i) => { this.matrix.makeTranslation(p.position.x, p.position.y, p.position.z); this.root.setMatrixAt(i, this.matrix); this.data.setXYZ(i, p.age / p.life, p.seed, .82 + p.seed * .48); });
    this.root.count = this.particles.length; this.root.visible = this.root.count > 0; this.root.instanceMatrix.needsUpdate = true; this.data.needsUpdate = true;
  }
}
