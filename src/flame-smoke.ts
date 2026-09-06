import * as T from 'three';
import { BOOST_OUTLET } from './octane-outlets';

const CAPACITY = 160, RATE = 95;
interface Puff { position: T.Vector3; velocity: T.Vector3; up: T.Vector3; rear: T.Vector3; depth: number; age: number; life: number; seed: number; }
/** World-space billows expand from hot orange gas into soft, drifting smoke. */
export class FlameSmoke {
  root: T.InstancedMesh;
  private particles: Puff[] = [];
  private debt = 0;
  private previous = new T.Vector3();
  private data = new T.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  private up = new T.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  private shape = new T.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
  private matrix = new T.Matrix4();
  constructor(scene: T.Scene) {
    const geometry = new T.PlaneGeometry(1, 1); geometry.setAttribute('puffData', this.data); geometry.setAttribute('puffUp', this.up); geometry.setAttribute('puffShape', this.shape);
    const material = new T.ShaderMaterial({ transparent: true, depthWrite: false,
      vertexShader: `attribute vec3 puffData,puffUp;attribute vec4 puffShape;varying vec2 vUv;varying vec3 vData;
        void main(){vUv=uv;vData=puffData;vec3 center=instanceMatrix[3].xyz;
          float size=(.16+puffData.x*.95)*puffData.z;
          float spread=smoothstep(0.,.28,puffData.x);
          vec2 opening=mix(vec2(${BOOST_OUTLET.width},${BOOST_OUTLET.height}),vec2(size),spread);
          float depth=puffShape.w+size*.9;
          // Project a three-dimensional ellipsoid, so a side view sees the
          // billow's length instead of another thin copy of the outlet slot.
          vec3 rear=puffShape.xyz,right=cross(puffUp,rear);
          vec2 r=(viewMatrix*vec4(right*opening.x,0.)).xy;
          vec2 u=(viewMatrix*vec4(puffUp*opening.y,0.)).xy;
          vec2 f=(viewMatrix*vec4(rear*depth,0.)).xy;
          float xx=r.x*r.x+u.x*u.x+f.x*f.x;
          float xy=r.x*r.y+u.x*u.y+f.x*f.y;
          float yy=r.y*r.y+u.y*u.y+f.y*f.y;
          // Factor the projected ellipse; using viewMatrix keeps it aligned
          // with this draw's camera, even after a sudden camera cut.
          float width=sqrt(max(xx,.000001));
          vec2 across=vec2(width,xy/width);
          vec2 rise=vec2(0.,sqrt(max(yy-across.y*across.y,.000001)));
          center+=rear*depth*.38*(1.-spread);
          vec4 p=viewMatrix*vec4(center,1.);
          p.xy+=across*position.x+rise*position.y;
          gl_Position=projectionMatrix*p;}`,
      fragmentShader: `varying vec2 vUv;varying vec3 vData;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        float fbm(vec2 p){return noise(p)*.57+noise(p*2.03)*.28+noise(p*4.1)*.15;}
        void main(){float age=vData.x;vec2 p=vUv-.5;float a=vData.y*6.283+age*.9; p=mat2(cos(a),-sin(a),sin(a),cos(a))*p;
          float cloud=fbm(p*7.+vData.y*20.+vec2(age*1.8,-age));
          float radius=length(p)+(cloud-.5)*.10;
          float edge=exp(-radius*radius*12.)*(1.-smoothstep(.30,.50,radius));
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
    this.root.instanceMatrix.setUsage(T.DynamicDrawUsage); this.data.setUsage(T.DynamicDrawUsage); this.up.setUsage(T.DynamicDrawUsage); this.shape.setUsage(T.DynamicDrawUsage);
  }
  reset() { this.particles.length = 0; this.debt = 0; this.root.count = 0; this.root.visible = false; }
  update(position: T.Vector3, rotation: T.Quaternion, velocity: T.Vector3, active: boolean, dt: number, camera: T.Camera) {
    if (position.distanceToSquared(this.previous) > 64) this.reset();
    this.previous.copy(position);
    if (dt > 0) {
      for (const puff of this.particles) { puff.age += dt; puff.position.addScaledVector(puff.velocity, dt); puff.velocity.multiplyScalar(Math.exp(-dt * 2.2)); puff.velocity.y += dt * 1.7; }
      this.particles = this.particles.filter(p => p.age < p.life);
      if (active) {
        this.debt += dt * RATE;
        while (this.debt >= 1) { this.debt--; for (const side of [-1, 1]) {
          if (this.particles.length >= CAPACITY) this.particles.shift();
          const p = new T.Vector3(side * BOOST_OUTLET.x, BOOST_OUTLET.y, BOOST_OUTLET.z + .006).applyQuaternion(rotation).add(position);
          const speed = new T.Vector3((Math.random() - .5) * .8, (Math.random() - .5) * .5, 6.5 + Math.random() * 2).applyQuaternion(rotation).addScaledVector(velocity, .64);
          const age = this.debt / RATE; p.addScaledVector(velocity, -age).addScaledVector(speed, age);
          // Cover the distance between emissions even at full boost speed.
          const depth = .18 + speed.distanceTo(velocity) * 2.8 / RATE;
          this.particles.push({ position: p, velocity: speed, up: new T.Vector3(0, 1, 0).applyQuaternion(rotation), rear: new T.Vector3(0, 0, 1).applyQuaternion(rotation), depth, age, life: .6 + Math.random() * .22, seed: Math.random() });
        } }
      } else this.debt = 0;
    }
    // Back-to-front blending stays correct as the camera orbits the trail.
    const forward = new T.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    this.particles.sort((a, b) => b.position.dot(forward) - a.position.dot(forward));
    this.particles.forEach((p, i) => { this.matrix.makeTranslation(p.position.x, p.position.y, p.position.z); this.root.setMatrixAt(i, this.matrix); this.data.setXYZ(i, p.age / p.life, p.seed, .82 + p.seed * .48); this.up.setXYZ(i, p.up.x, p.up.y, p.up.z); this.shape.setXYZW(i, p.rear.x, p.rear.y, p.rear.z, p.depth); });
    this.root.count = this.particles.length; this.root.visible = this.root.count > 0; this.root.instanceMatrix.needsUpdate = true; this.data.needsUpdate = this.up.needsUpdate = this.shape.needsUpdate = true;
  }
}
