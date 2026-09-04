import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FIELD } from './config';

const noise = `
float hash(vec3 p){p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){return noise3(p)*.55+noise3(p*2.03)*.28+noise3(p*4.07)*.14;}
`;
const fade = (a: number, b: number, t: number) => T.MathUtils.smoothstep(t, a, b);

/** Reusable, GPU-animated effect: collapse → corona → plasma jets → ember rain.
 * Geometry and materials are allocated once, then reset for every goal. */
export class GoalExplosion {
  root = new T.Group();
  age = 10;
  duration = 4.6;
  uniforms = { time: { value: 10 }, color: { value: new T.Color(0x39b7ff) }, screenHeight: { value: innerHeight * Math.min(devicePixelRatio, 1.5) } };
  core: T.Mesh;
  corona: T.Mesh;
  singularity: T.Mesh;
  accretion: T.Mesh;
  halo: T.Sprite;
  shockwave: T.Mesh;
  tendrils: T.Mesh;
  lightning: T.LineSegments;
  light = new T.PointLight(0x39b7ff, 0, 65, 2);
  impact = 0;
  constructor(scene: T.Scene) {
    this.root.name = 'stellar-goal-explosion'; this.root.visible = false; scene.add(this.root);
    const plasma = new T.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
      vertexShader: `${noise} uniform float time;varying vec3 vPosition;varying vec3 vNormal;varying vec3 vEye;
        void main(){float t=max(0.,time-.22);vec3 p=position;float n=fbm(p*2.1-vec3(0,t*2.8,0));p*=.75+n*.6;vPosition=p;vNormal=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(p,1.);vEye=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `${noise} uniform float time;uniform vec3 color;varying vec3 vPosition;varying vec3 vNormal;varying vec3 vEye;
        void main(){float t=max(0.,time-.22);vec3 p=vPosition*3.5;float n=fbm(p-vec3(0,t*2.8,0));float veins=pow(1.-abs(sin(n*16.+p.y*1.5-t*5.)),3.);
        float rim=pow(1.-abs(dot(vNormal,vEye)),1.5);float heat=(veins*.9+rim*.65+pow(n,3.)*1.2);
        float life=smoothstep(.18,.3,time)*(1.-smoothstep(.65,2.,time));
        vec3 ink=mix(color*2.5,vec3(3.2,3.7,4.),pow(clamp(heat,0.,1.),6.)*.12*exp(-t*3.));
        gl_FragColor=vec4(ink,(.045+heat*.6)*life);}`,
    });
    this.corona = new T.Mesh(new T.SphereGeometry(1, 64, 40), plasma); this.root.add(this.corona);
    const coreMat = new T.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      vertexShader: `varying vec3 n;varying vec3 e;void main(){n=normalize(normalMatrix*normal);vec4 p=modelViewMatrix*vec4(position,1.);e=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
      fragmentShader: `uniform vec3 color;uniform float time;varying vec3 n;varying vec3 e;void main(){float f=pow(max(0.,dot(n,e)),.6);float life=(1.-smoothstep(.4,1.15,time));gl_FragColor=vec4(mix(color*3.,vec3(5.),f*f*(1.-smoothstep(.3,.8,time))),f*life);}`,
    });
    this.core = new T.Mesh(new T.SphereGeometry(1, 40, 24), coreMat); this.root.add(this.core);
    this.singularity = new T.Mesh(new T.SphereGeometry(1, 48, 32), new T.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `varying vec3 n;varying vec3 eye;void main(){n=normalize(normalMatrix*normal);vec4 p=modelViewMatrix*vec4(position,1.);eye=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
      fragmentShader: `uniform vec3 color;varying vec3 n;varying vec3 eye;void main(){float rim=pow(1.-max(0.,dot(n,eye)),5.);gl_FragColor=vec4(vec3(.001,.003,.009)+color*rim*5.,1.);}`,
    })); this.root.add(this.singularity);
    this.accretion = new T.Mesh(new T.RingGeometry(1.55, 6.8, 144, 18), new T.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending,
      vertexShader: `varying vec3 p;uniform float time;void main(){p=position;vec3 v=position;v.z=sin(length(position)*2.-time*5.)*.16;gl_Position=projectionMatrix*modelViewMatrix*vec4(v,1.);}`,
      fragmentShader: `${noise} varying vec3 p;uniform float time;uniform vec3 color;void main(){float radius=length(p.xy);float angle=atan(p.y,p.x);float spiral=angle*3.+log(radius)*11.-time*9.;
      float turbulent=fbm(vec3(cos(spiral)*2.,sin(spiral)*2.,radius*1.5-time*2.));float bands=pow(.5+.5*sin(radius*28.+turbulent*9.-time*12.),3.);
      float edge=smoothstep(1.55,1.8,radius)*(1.-smoothstep(4.,6.8,radius));float life=smoothstep(.38,.7,time)*(1.-smoothstep(1.55,2.4,time));
      vec3 ink=mix(color*1.5,color*4.+vec3(.6),bands*bands);gl_FragColor=vec4(ink,edge*life*(.2+bands*.8)*(.5+turbulent));}`,
    })); this.accretion.rotation.set(1.07,.25,.1); this.root.add(this.accretion);
    const haloTexture = new T.DataTexture(new Uint8Array(128 * 128 * 4), 128, 128);
    const data = haloTexture.image.data!;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { const d = Math.hypot(x - 63.5, y - 63.5) / 64, i = (y * 128 + x) * 4; data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(Math.max(0, Math.exp(-d * d * 6) - .0025) * 255); }
    haloTexture.needsUpdate = true;
    this.halo = new T.Sprite(new T.SpriteMaterial({ map: haloTexture, color: 0x48caff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false })); this.root.add(this.halo);
    this.shockwave = new T.Mesh(new T.PlaneGeometry(100, 100), new T.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `${noise} varying vec2 vUv;uniform vec3 color;uniform float time;void main(){vec2 p=(vUv-.5)*100.;float r=length(p);float t=max(0.,time-.22);float radius=42.*(1.-exp(-t*1.05));float wave=exp(-pow((r-radius)/(.18+t*.24),2.));float echo=exp(-pow((r-radius*.89)/.12,2.))*.4;
        float n=fbm(vec3(p*.3,t));float wake=smoothstep(radius-5.,radius,r)*(1.-smoothstep(radius,radius+.3,r));float life=smoothstep(.22,.26,time)*(1.-smoothstep(1.2,3.2,time));
        gl_FragColor=vec4(mix(color*2.7,vec3(3.),wave*.55),(wave+echo+wake*n*.22)*life);}`,
    }));
    this.shockwave.rotation.x = -Math.PI / 2; this.shockwave.renderOrder = 3; this.root.add(this.shockwave);
    this.tendrils = this.createTendrils(); this.root.add(this.tendrils);
    this.lightning = this.createLightning(); this.root.add(this.lightning);
    this.root.add(this.createSparks(), this.createDust(), this.light);
    window.addEventListener('resize', () => { this.uniforms.screenHeight.value = innerHeight * Math.min(devicePixelRatio, 1.5); });
  }
  createTendrils() {
    const geometries: T.BufferGeometry[] = [];
    for (let i = 0; i < 34; i++) {
      const angle = i / 34 * Math.PI * 2 + Math.random() * .12, length = 9 + Math.random() * 12;
      const direction = new T.Vector3(Math.cos(angle), .18 + Math.random() * .55, .3 + Math.sin(angle) * .8).normalize();
      const points: T.Vector3[] = [];
      for (let j = 0; j <= 12; j++) {
        const t = j / 12, twist = angle + t * (1.4 + i % 3 * .6);
        points.push(direction.clone().multiplyScalar(length * t).add(new T.Vector3(Math.cos(twist) * t * 2, Math.sin(t * Math.PI) * (2 + i % 4), Math.sin(twist) * t * 2)));
      }
      const geometry = new T.TubeGeometry(new T.CatmullRomCurve3(points), 64, .06 + Math.random() * .09, 5, false);
      geometry.setAttribute('seed', new T.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count).fill(Math.random()), 1)); geometries.push(geometry);
    }
    const geometry = mergeGeometries(geometries)!; geometries.forEach(g => g.dispose());
    return new T.Mesh(geometry, new T.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      vertexShader: `uniform float time;attribute float seed;varying vec2 vUv;varying float vSeed;void main(){vUv=uv;vSeed=seed;float t=max(0.,time-.22);vec3 p=position*(1.-exp(-t*6.));p.x+=sin(p.y*1.3-time*4.+seed*40.)*uv.x*t*.22;p.y-=t*t*.8*uv.x;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
      fragmentShader: `uniform float time;uniform vec3 color;varying vec2 vUv;varying float vSeed;void main(){float t=max(0.,time-.22);float head=t*1.7-vSeed*.2;float front=1.-smoothstep(head-.08,head,vUv.x);float tail=smoothstep(head-1.3,head-.6,vUv.x);float streak=pow(.5+.5*sin(vUv.x*45.-time*13.+vSeed*20.),3.);float life=smoothstep(.22,.28,time)*(1.-smoothstep(1.2,2.6,time));
        gl_FragColor=vec4(mix(color*2.,color*3.+vec3(.25),streak),front*tail*life*(.45+streak*.55));}`,
    }));
  }
  createLightning() {
    const positions: number[] = [], seeds: number[] = [];
    for (let i = 0; i < 26; i++) {
      const a = i / 26 * Math.PI * 2, end = new T.Vector3(Math.cos(a) * (11 + Math.random() * 11), 3 + Math.random() * 11, 4 + Math.random() * 13);
      let previous = new T.Vector3();
      for (let k = 1; k <= 16; k++) {
        const t = k / 16, p = end.clone().multiplyScalar(t).add(new T.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(1.3));
        positions.push(...previous.toArray(), ...p.toArray()); seeds.push(i / 26, i / 26);
        if (k % 4 === 0) { const branch = p.clone().add(new T.Vector3((Math.random() - .5) * 4, 1.5, 2)); positions.push(...p.toArray(), ...branch.toArray()); seeds.push(i / 26, i / 26); }
        previous = p;
      }
    }
    const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(positions, 3)).setAttribute('seed', new T.Float32BufferAttribute(seeds, 1));
    return new T.LineSegments(geometry, new T.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      vertexShader: `uniform float time;attribute float seed;varying float vSeed;void main(){vSeed=seed;float t=max(0.,time-.22);vec3 p=position*(1.-exp(-t*8.));gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
      fragmentShader: `uniform float time;uniform vec3 color;varying float vSeed;void main(){float pulse=pow(.5+.5*sin(time*17.+vSeed*81.),6.);float life=smoothstep(.24,.3,time)*(1.-smoothstep(1.,2.1,time));gl_FragColor=vec4(mix(color*2.,vec3(2.),.3),pulse*life);}`,
    }));
  }
  createSparks() {
    const n = 15000, position = new Float32Array(n * 3), velocities = new Float32Array(n * 3), seeds = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const direction = new T.Vector3(Math.random() - .5, Math.random() * .9 - .08, Math.random() * 1.15 - .22).normalize();
      direction.multiplyScalar(7 + Math.random() ** .6 * 34).toArray(velocities, i * 3);
      seeds.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    }
    const geometry = new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(position, 3)).setAttribute('velocity', new T.BufferAttribute(velocities, 3)).setAttribute('seed', new T.BufferAttribute(seeds, 4));
    const points = new T.Points(geometry, new T.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      vertexShader: `uniform float time;uniform float screenHeight;attribute vec3 velocity;attribute vec4 seed;varying float alpha;varying float heat;
        void main(){float t=max(0.,time-.22-seed.x*.14);float travel=(1.-exp(-t*1.15))/1.15;vec3 p=velocity*travel;p.y-=t*t*2.;p.y=max(p.y,-2.8+abs(sin(t*4.+seed.z*9.))*.08);p.x+=sin(t*4.+seed.z*20.)*t*.28;
        if(time<.22){p=normalize(velocity)*(1.-time/.22)*(3.+seed.z*7.);}
        vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
        gl_PointSize=clamp((.025+seed.y*seed.y*.16)*screenHeight/max(1.,-mv.z),1.,35.);
        alpha=(1.-smoothstep(1.1+seed.w*1.6,2.+seed.w*2.4,t))*smoothstep(0.,.07,time);heat=seed.y;}`,
      fragmentShader: `uniform vec3 color;varying float alpha;varying float heat;void main(){vec2 p=gl_PointCoord*2.-1.;float r=dot(p,p);if(r>1.)discard;float glow=exp(-r*5.)*(1.-smoothstep(.7,1.,r));vec3 c=mix(color*2.7,vec3(3.),step(.975,heat)*.85);gl_FragColor=vec4(c,glow*alpha*.65);}`,
    })); points.frustumCulled = false; return points;
  }
  createDust() {
    // Large soft billboards give the blast volume and a smoky afterimage.
    const n = 110, position = new Float32Array(n * 3), seeds = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      new T.Vector3((Math.random() - .5) * 15, Math.random() * 9, Math.random() * 10).toArray(position, i * 3);
      seeds.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    }
    const geometry = new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(position, 3)).setAttribute('seed', new T.BufferAttribute(seeds, 4));
    const points = new T.Points(geometry, new T.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: `uniform float time;uniform float screenHeight;attribute vec4 seed;varying float alpha;varying float vSeed;varying float age;void main(){float t=max(0.,time-.22);vec3 p=position*(1.-exp(-t*2.));p.y+=t*1.1;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((2.+seed.x*3.+t)*screenHeight/max(1.,-mv.z),1.,400.);alpha=smoothstep(.25,.65,time)*(1.-smoothstep(1.3,4.6,time))*.12;vSeed=seed.y;age=t;}`,
      fragmentShader: `${noise} uniform vec3 color;varying float alpha;varying float vSeed;varying float age;void main(){vec2 p=gl_PointCoord*2.-1.;float d=dot(p,p);if(d>1.)discard;float n=fbm(vec3(p*3.+vSeed*50.,age*.5));float a=pow(1.-d,2.)*smoothstep(.25,.65,n);vec3 c=mix(color*.4,vec3(.11,.14,.2),smoothstep(.3,2.,age));gl_FragColor=vec4(c,a*alpha);}`,
    })); points.frustumCulled = false; return points;
  }
  trigger(position: T.Vector3, color: T.ColorRepresentation) {
    this.age = 0; this.uniforms.time.value = 0; this.uniforms.color.value.set(color);
    const side = Math.sign(position.z) || 1;
    this.root.position.set(T.MathUtils.clamp(position.x, -4, 4), 3, side * (FIELD.length - .65));
    this.root.rotation.y = side > 0 ? Math.PI : 0; this.root.visible = true;
    this.shockwave.position.y = -2.945;
    this.light.color.set(color); (this.halo.material as T.SpriteMaterial).color.set(color);
  }
  reset() { this.age = 10; this.root.visible = false; this.light.intensity = 0; this.impact = 0; }
  update(dt: number) {
    if (!this.root.visible) return;
    this.age += dt; this.uniforms.time.value = this.age;
    const t = Math.max(0, this.age - .22);
    this.impact = Math.exp(-t * 4) * fade(.2, .25, this.age);
    this.core.scale.setScalar(this.age < .22 ? .9 * (1 - this.age / .27) : .3 + 3.2 * (1 - Math.exp(-t * 13)));
    this.corona.scale.setScalar(.3 + 8.5 * (1 - Math.exp(-t * 2.1)));
    this.corona.rotation.set(t * .15, t * .3, t * .12);
    const hole = fade(.35, .75, this.age) * (1 - fade(1.65, 2.35, this.age));
    this.singularity.visible = hole > .001; this.singularity.scale.setScalar(Math.max(.001, hole * 1.75));
    this.accretion.scale.setScalar(.6 + hole * .5); this.accretion.rotation.z = t * .4;
    this.halo.scale.setScalar(9 + 25 * (1 - Math.exp(-t * 5)));
    (this.halo.material as T.SpriteMaterial).opacity = this.impact * .42 + (1 - fade(.5, 2., this.age)) * .08;
    this.light.intensity = this.impact * 700 + (1 - fade(.6, 2.3, this.age)) * 75;
    if (this.age > this.duration) this.reset();
  }
}
