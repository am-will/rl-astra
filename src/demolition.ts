import * as T from 'three';

const noise = `
float hash(vec3 p){p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){return noise3(p)*.57+noise3(p*2.03)*.28+noise3(p*4.07)*.15;}
`;
const smooth = (min: number, max: number, value: number) => T.MathUtils.smoothstep(value, min, max);
interface Fragment { mesh: T.Mesh; velocity: T.Vector3; spin: T.Vector3; size: T.Vector3; }

/** Two reusable bursts cover simultaneous demolitions without allocating during play. */
export class Demolitions {
  bursts: DemolitionBurst[];
  constructor(scene: T.Scene) { this.bursts = [new DemolitionBurst(scene), new DemolitionBurst(scene)]; }
  trigger(position: T.Vector3, velocity: T.Vector3, rotation: T.Quaternion, color: T.ColorRepresentation) {
    const burst = this.bursts.find(b => !b.root.visible) ?? this.bursts.reduce((a, b) => a.age > b.age ? a : b);
    burst.trigger(position, velocity, rotation, color);
  }
  update(dt: number) { for (const burst of this.bursts) burst.update(dt); }
  updateCamera(position: T.Vector3) {
    for (const burst of this.bursts) if (burst.root.visible) {
      const distance = burst.word.getWorldPosition(new T.Vector3()).distanceTo(position);
      burst.word.material.opacity *= smooth(3, 8, distance);
    }
  }
  reset() { for (const burst of this.bursts) burst.reset(); }
}

export class DemolitionBurst {
  root = new T.Group();
  age = 10;
  duration = 3.1;
  uniforms = { time: { value: 10 }, drift: { value: new T.Vector3() } };
  cloud: T.InstancedMesh;
  ring: T.Mesh;
  flash: T.Sprite;
  word: T.Sprite;
  light = new T.PointLight(0xff9b3c, 0, 24, 2);
  fragments: Fragment[] = [];
  private paint = new T.MeshStandardMaterial({ color: 0xffa33c, metalness: .65, roughness: .36 });
  private dummy = new T.Object3D();
  private lobes = Array.from({ length: 16 }, (_, i) => {
    const angle = i * 2.39996;
    return { direction: new T.Vector3(Math.cos(angle), .25 + (i % 5) * .16, Math.sin(angle)).normalize(), scale: .55 + (i % 7) * .1, seed: i * 3.73 };
  });
  constructor(scene: T.Scene) {
    this.root.name = 'demolition-firestorm'; this.root.visible = false; scene.add(this.root);
    const geometry = new T.SphereGeometry(1, 32, 24);
    geometry.setAttribute('seed', new T.InstancedBufferAttribute(new Float32Array(this.lobes.map(l => l.seed)), 1));
    this.cloud = new T.InstancedMesh(geometry, new T.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: `${noise} uniform float time;attribute float seed;varying vec3 vPos;varying vec3 vNormal;varying vec3 vEye;varying float vSeed;varying float vDistance;
        void main(){vSeed=seed;vPos=position;vec3 p=position*(.86+noise3(position*3.+seed+time)*.28);vec4 mv=modelViewMatrix*instanceMatrix*vec4(p,1.);vDistance=length(mv.xyz);vEye=normalize(-mv.xyz);vNormal=normalize(normalMatrix*mat3(instanceMatrix)*normal);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `${noise} uniform float time;varying vec3 vPos;varying vec3 vNormal;varying vec3 vEye;varying float vSeed;varying float vDistance;
        void main(){float n=fbm(vPos*3.6+vec3(vSeed,-time*2.1,0.));float detail=noise3(vPos*12.+vSeed-time*3.);
        float heat=clamp(1.1-time*1.55+(n-.5)*2.5,0.,1.);float edge=abs(dot(normalize(vNormal),normalize(vEye)));
        float erosion=smoothstep(.55,1.8,time);float alpha=smoothstep(.01,.07,time)*(1.-smoothstep(.65,1.8,time))*smoothstep(.015,.24,edge)*smoothstep(erosion*.7,erosion*.7+.16,n);
        vec3 coal=mix(vec3(.035,.043,.055),vec3(.19,.22,.25),n*.6+edge*.15);
        vec3 fire=mix(vec3(1.1,.045,.001),vec3(2.6,.6,.02),smoothstep(.4,.8,heat));fire=mix(fire,vec3(3.5,2.3,.9),smoothstep(.9,1.,heat)*exp(-time*5.));
        vec3 color=mix(coal,fire,smoothstep(.2,.55,heat));color+=vec3(1.2,.22,.015)*pow(detail,9.)*(1.-smoothstep(.8,1.8,time));
        // Keep the hot opening flash, then leave only thin, short-lived smoke.
        // Fade near the lens so driving through a burst preserves the view.
        float density=mix(.09,.38,smoothstep(.2,.65,heat));
        gl_FragColor=vec4(color,alpha*density*smoothstep(2.,8.,vDistance));}`,
    }), this.lobes.length);
    this.cloud.frustumCulled = false; this.root.add(this.cloud);
    this.ring = new T.Mesh(new T.PlaneGeometry(30, 30), new T.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `${noise} varying vec2 vUv;uniform float time;void main(){vec2 p=(vUv-.5)*30.;float r=length(p);float radius=12.*(1.-exp(-time*2.8));float ring=exp(-pow((r-radius)/(.06+time*.19),2.));float wake=exp(-pow((r-radius*.89)/.4,2.))*noise3(vec3(p*2.,time));float a=(ring+wake*.3)*(1.-smoothstep(.1,1.05,time));gl_FragColor=vec4(3.,1.1,.15,a*.8);}`,
    })); this.ring.rotation.x = -Math.PI / 2; this.root.add(this.ring);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!, gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'white'); gradient.addColorStop(.12, '#fff0bfee'); gradient.addColorStop(.4, '#ffa34566'); gradient.addColorStop(1, '#ff770000'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
    this.flash = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(canvas), color: 0xffda9b, blending: T.AdditiveBlending, depthWrite: false })); this.root.add(this.flash);
    const label = document.createElement('canvas'); label.width = 1024; label.height = 384;
    const c = label.getContext('2d')!; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'italic 900 240px Barlow, Arial Black, sans-serif'; c.lineJoin = 'round';
    c.lineWidth = 36; c.strokeStyle = '#161317'; c.strokeText('BOOM!', 505, 211); c.lineWidth = 14; c.strokeStyle = '#fa913b'; c.strokeText('BOOM!', 501, 191);
    const ink = c.createLinearGradient(0, 85, 0, 290); ink.addColorStop(0, '#fffce8'); ink.addColorStop(.45, '#ffdb80'); ink.addColorStop(1, '#ef7032'); c.fillStyle = ink; c.fillText('BOOM!', 501, 191);
    const texture = new T.CanvasTexture(label); texture.colorSpace = T.SRGBColorSpace;
    this.word = new T.Sprite(new T.SpriteMaterial({ map: texture, depthWrite: false, transparent: true })); this.word.renderOrder = 6; this.root.add(this.word);
    this.root.add(this.makeSparks(), this.light);
    const steel = new T.MeshStandardMaterial({ color: 0x333a40, metalness: .8, roughness: .4 });
    const rubber = new T.MeshStandardMaterial({ color: 0x16191c, roughness: .95 });
    const panel = new T.BoxGeometry(1, 1, 1), tire = new T.TorusGeometry(.19, .075, 7, 16);
    for (let i = 0; i < 24; i++) {
      const wheel = i < 4, mesh = new T.Mesh(wheel ? tire : panel, wheel ? rubber : i % 3 ? this.paint : steel);
      const size = wheel ? new T.Vector3(1, 1, 1) : new T.Vector3(.12 + (i % 4) * .075, .025 + (i % 2) * .03, .14 + (i % 5) * .07);
      if (wheel) { const hub = new T.Mesh(new T.CylinderGeometry(.115, .115, .13, 8), steel); hub.rotation.x = Math.PI / 2; mesh.add(hub); }
      this.fragments.push({ mesh, size, velocity: new T.Vector3(), spin: new T.Vector3() }); this.root.add(mesh);
    }
  }
  private makeSparks() {
    // Instanced streak quads have a bounded size and disappear behind the lens.
    // Unlike unbounded GL points, close particles cannot cover the viewport.
    const count = 1800, base = new T.PlaneGeometry(1, 1);
    const geometry = new T.InstancedBufferGeometry(); geometry.index = base.index; geometry.attributes = base.attributes; geometry.instanceCount = count;
    const velocity = new Float32Array(count * 3), seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2, y = .08 + Math.random() * .85;
      new T.Vector3(Math.cos(angle), y, Math.sin(angle)).normalize().multiplyScalar(4 + Math.random() ** 2 * 26).toArray(velocity, i * 3);
      seeds.set([Math.random(), .45 + Math.random() * 2, .008 + Math.random() * .018], i * 3);
    }
    geometry.setAttribute('velocity', new T.InstancedBufferAttribute(velocity, 3)); geometry.setAttribute('seed', new T.InstancedBufferAttribute(seeds, 3));
    const mesh = new T.Mesh(geometry, new T.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
      vertexShader: `uniform float time;uniform vec3 drift;attribute vec3 velocity;attribute vec3 seed;varying vec2 vUv;varying float alpha;varying float heat;
        void main(){float t=max(0.,time-seed.x*.12);float travel=(1.-exp(-t*1.7))/1.7;vec3 p=(velocity+drift)*travel+vec3(0,-2.7*t*t,0);p.y=max(-.1,p.y);vec3 v=velocity*exp(-t*1.7)+vec3(0,-5.4*t,0);vec4 eye=modelViewMatrix*vec4(p,1.);vec2 dir=(modelViewMatrix*vec4(v,0.)).xy;dir/=max(.001,length(dir));vec2 side=vec2(-dir.y,dir.x);float length=min(1.5,length(v)*.052);eye.xy+=side*position.x*seed.z+dir*position.y*length;gl_Position=projectionMatrix*eye;vUv=uv;heat=seed.x;alpha=step(.01,t)*(1.-smoothstep(seed.y*.5,seed.y,t))*step(.2,-eye.z);}`,
      fragmentShader: `varying vec2 vUv;varying float alpha;varying float heat;void main(){float edge=max(0.,1.-abs(vUv.x*2.-1.));float a=pow(edge,1.5)*max(0.,sin(vUv.y*3.14159))*alpha;gl_FragColor=vec4(mix(vec3(3.5,.6,.035),vec3(5.,3.5,1.5),heat*heat),a);}`,
    })); mesh.frustumCulled = false; return mesh;
  }
  trigger(position: T.Vector3, velocity: T.Vector3, rotation: T.Quaternion, color: T.ColorRepresentation) {
    this.age = 0; this.uniforms.time.value = 0; this.root.position.copy(position); this.root.visible = true;
    this.uniforms.drift.value.copy(velocity).multiplyScalar(.22); this.paint.color.set(color);
    this.ring.position.y = .05 - position.y;
    for (const [i, fragment] of this.fragments.entries()) {
      const angle = i * 2.39996, launch = 3 + (i % 7) * 1.2;
      fragment.mesh.position.set((i % 2 ? 1 : -1) * .4, 0, (i % 4 > 1 ? 1 : -1) * .5).applyQuaternion(rotation);
      fragment.mesh.quaternion.copy(rotation); fragment.mesh.scale.copy(fragment.size);
      fragment.velocity.set(Math.cos(angle) * launch, 3 + (i % 5), Math.sin(angle) * launch).addScaledVector(velocity, .23);
      fragment.spin.set(Math.sin(i * 2.3) * 9, Math.cos(i * 1.2) * 7, Math.sin(i * 3.7) * 11);
    }
    this.update(0);
  }
  reset() { this.root.visible = false; this.light.intensity = 0; this.age = 10; }
  update(dt: number) {
    if (!this.root.visible) return;
    this.age += dt; if (this.age >= this.duration) { this.reset(); return; }
    const t = this.age; this.uniforms.time.value = t;
    for (let i = 0; i < this.lobes.length; i++) {
      const l = this.lobes[i], travel = (1 - Math.exp(-t * 3.7)) * 2.5;
      this.dummy.position.copy(l.direction).multiplyScalar(travel).addScaledVector(this.uniforms.drift.value, (1 - Math.exp(-t * 2)) * .3);
      this.dummy.position.y += t * (1.2 + l.scale * .4);
      this.dummy.rotation.set(l.seed + t * .12, l.seed * .5, t * .2);
      this.dummy.scale.setScalar((.1 + (1 - Math.exp(-t * 13)) * 1.25 + t * .22) * l.scale);
      this.dummy.updateMatrix(); this.cloud.setMatrixAt(i, this.dummy.matrix);
    }
    this.cloud.instanceMatrix.needsUpdate = true;
    this.flash.scale.setScalar(4 + (1 - Math.exp(-t * 24)) * 11);
    this.flash.material.opacity = Math.exp(-t * 22) * .65;
    this.light.intensity = Math.exp(-t * 6) * 430;
    this.word.position.y = 2.4 + t * .7;
    this.word.scale.set(5.8, 2.175, 1).multiplyScalar(.85 + smooth(.04, .23, t) * .15);
    this.word.material.rotation = -.08; this.word.material.opacity = smooth(.06, .17, t) * (1 - smooth(.65, 1.2, t));
    for (const fragment of this.fragments) {
      fragment.velocity.y -= dt * 8;
      fragment.mesh.position.addScaledVector(fragment.velocity, dt);
      const floor = .13 - this.root.position.y;
      if (fragment.mesh.position.y < floor) {
        fragment.mesh.position.y = floor; fragment.velocity.y = Math.abs(fragment.velocity.y) * .38;
        fragment.velocity.x *= Math.exp(-dt * 9); fragment.velocity.z *= Math.exp(-dt * 9); fragment.spin.multiplyScalar(Math.exp(-dt * 4));
      }
      fragment.mesh.rotateX(fragment.spin.x * dt); fragment.mesh.rotateY(fragment.spin.y * dt); fragment.mesh.rotateZ(fragment.spin.z * dt);
      fragment.mesh.scale.copy(fragment.size).multiplyScalar(1 - smooth(2.5, this.duration, t));
    }
  }
}
