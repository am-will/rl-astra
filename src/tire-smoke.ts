import * as T from 'three';

const CAPACITY = 96;
interface Puff { position: T.Vector3; velocity: T.Vector3; age: number; life: number; seed: number; }

/** A brief, low plume at sliding tire contacts, lifted clear of the grass blades. */
export class TireSmoke {
  mesh: T.InstancedMesh;
  private particles: Puff[] = [];
  private credit = 0;
  private wheel = 0;
  private matrix = new T.Matrix4();
  private data = new T.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);

  constructor(scene: T.Scene) {
    const geometry = new T.PlaneGeometry(1, 1); geometry.setAttribute('puffData', this.data);
    const material = new T.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: true,
      vertexShader: `attribute vec3 puffData;varying vec2 vUv;varying vec3 vData;
        void main(){vUv=uv;vData=puffData;vec4 center=viewMatrix*vec4(instanceMatrix[3].xyz,1.);
          float size=(.34+puffData.x*.85)*(.85+puffData.y*.3);
          center.xy+=position.xy*vec2(1.2,.8)*size;
          gl_Position=projectionMatrix*center;}`,
      fragmentShader: `varying vec2 vUv;varying vec3 vData;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        void main(){float age=vData.x;vec2 p=vUv-.5;float angle=vData.y*6.283+age*.5;
          p=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*p;
          float cloud=noise(p*7.+vData.y*23.+age)*.7+noise(p*15.-age)*.3;
          float edge=1.-smoothstep(.1,.5,length(p)+(cloud-.5)*.25);
          float alpha=edge*(.18+cloud*.15)*smoothstep(0.,.08,age)*(1.-smoothstep(.3,1.,age))*vData.z;
          if(alpha<.004)discard;
          gl_FragColor=vec4(mix(vec3(.25,.27,.23),vec3(.5,.52,.46),cloud),alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new T.InstancedMesh(geometry, material, CAPACITY);
    this.mesh.name = 'ebrake-tire-smoke'; this.mesh.count = 0; this.mesh.visible = false; this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3; this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); this.data.setUsage(T.DynamicDrawUsage); scene.add(this.mesh);
  }

  reset() { this.particles.length = 0; this.credit = 0; this.mesh.count = 0; this.mesh.visible = false; }

  update(contacts: T.Vector3[], velocity: T.Vector3, strength: number, dt: number) {
    if (dt <= 0) return;
    for (const puff of this.particles) {
      puff.age += dt; puff.position.addScaledVector(puff.velocity, dt);
      puff.velocity.x *= Math.exp(-dt * 3); puff.velocity.z *= Math.exp(-dt * 3);
    }
    this.particles = this.particles.filter(p => p.age < p.life);
    const rate = contacts.length ? strength * 100 : 0;
    this.credit = rate ? this.credit + dt * rate : 0;
    while (this.credit >= 1) {
      this.credit--;
      if (this.particles.length >= CAPACITY) this.particles.shift();
      const age = this.credit / rate, position = contacts[this.wheel++ % contacts.length].clone().addScaledVector(velocity, -age);
      // Ultra grass reaches about .104 m. Start the visible core above it,
      // then lift as the puff expands; retain depth testing against car/arena.
      position.y = Math.max(position.y, .18);
      const drift = velocity.clone().multiplyScalar(.08);
      drift.x += (Math.random() - .5) * .45; drift.z += (Math.random() - .5) * .45; drift.y = .34 + Math.random() * .18;
      position.addScaledVector(drift, age);
      this.particles.push({ position, velocity: drift, age, life: .48 + Math.random() * .18, seed: Math.random() });
    }
    this.particles.forEach((p, i) => {
      this.matrix.makeTranslation(p.position.x, p.position.y, p.position.z); this.mesh.setMatrixAt(i, this.matrix);
      this.data.setXYZ(i, p.age / p.life, p.seed, .8 + p.seed * .2);
    });
    this.mesh.count = this.particles.length; this.mesh.visible = this.mesh.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true; this.data.needsUpdate = true;
  }
}
