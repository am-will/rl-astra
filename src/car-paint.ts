import * as T from 'three';
import type { CarModel } from './assets';

export const PAINT_JOBS = [
  { id: 'classic', name: 'Classic', description: 'The original blue finish with copper accents.', color: '#078cbd', accent: '#e4762e', trim: '#d86f2b', rim: '#8b969b', metalness: .45, roughness: .36 },
  { id: 'ultraviolet', name: 'Ultraviolet', description: 'Deep purple with flowing violet pinstripes. Animated.', color: '#270063', accent: '#7900ef', trim: '#1b0439', rim: '#101019', metalness: .48, roughness: .3 },
  { id: 'crimson', name: 'Crimson Circuit', description: 'Candy red, pearl-white trim and angular racing graphics.', color: '#b5091c', accent: '#f3f4ef', trim: '#e8eeee', rim: '#f0f5f3', metalness: .42, roughness: .23 },
  { id: 'rally', name: 'Blue Rally', description: 'Electric blue with clean twin ice-white stripes.', color: '#006de8', accent: '#d8f4ff', trim: '#b6dbea', rim: '#1e3434', metalness: .4, roughness: .27 },
  { id: 'midnight', name: 'Midnight Camo', description: 'Inky navy camouflage with sharp white pinstriping.', color: '#040638', accent: '#edf3ff', trim: '#e3ebf1', rim: '#0b0e15', metalness: .28, roughness: .38 },
  { id: 'glacier', name: 'Glacier Crest', description: 'Icy metallic blue with black sweeps and twin crests.', color: '#2a9bd5', accent: '#060b15', trim: '#090e17', rim: '#0b1018', metalness: .58, roughness: .25 },
] as const;
export type PaintJob = typeof PAINT_JOBS[number]['id'];
export const validPaintJob = (value: string | null): value is PaintJob => PAINT_JOBS.some(job => job.id === value);

let crestTexture: T.CanvasTexture | undefined;
function crestMask() {
  if (crestTexture) return crestTexture;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#000'; c.fillRect(0, 0, 512, 512);
  c.strokeStyle = '#fff'; c.lineWidth = 15;
  c.beginPath(); c.arc(256, 256, 225, 0, Math.PI * 2); c.stroke();
  c.lineWidth = 5; c.beginPath(); c.arc(256, 256, 198, -.1, Math.PI * 1.63); c.stroke();
  // A locally drawn heraldic lion: swept mane, crown, hooked muzzle and eye.
  c.fillStyle = '#fff';
  c.fill(new Path2D('M176 375 C113 329 104 230 157 164 L128 148 L188 133 L189 103 L234 125 L264 89 L284 134 L322 139 L330 175 L355 194 L337 222 L383 252 L374 283 L339 287 L352 311 L314 322 L295 361 L320 400 L272 384 L250 353 C234 380 194 395 156 389 L183 354 C139 334 132 291 140 265 C150 300 171 314 196 315 C174 278 171 248 186 219 C182 266 207 291 228 300 C207 249 218 201 257 175 C230 222 242 259 272 278 L288 317 L306 290 L329 275 L317 254 L293 241 L293 213 L315 199 L299 178 L270 163 C192 177 159 258 176 375 Z'));
  c.fillStyle = '#000'; c.fill(new Path2D('M300 211 L326 216 L311 227 Z M340 253 L369 258 L350 268 Z'));
  crestTexture = new T.CanvasTexture(canvas); crestTexture.anisotropy = 8;
  return crestTexture;
}

const declarations = `
varying vec3 paintPosition,paintNormal;
uniform int paintJob;uniform float paintTime,paintScale;uniform vec3 paintAccent;uniform sampler2D paintCrestMap;
float paintLine(float d,float w){float aa=max(fwidth(d)*1.2,.0008);return 1.-smoothstep(w-aa,w+aa,abs(d));}
float paintHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float paintNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(mix(paintHash(i),paintHash(i+vec3(1,0,0)),f.x),mix(paintHash(i+vec3(0,1,0)),paintHash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(paintHash(i+vec3(0,0,1)),paintHash(i+vec3(1,0,1)),f.x),mix(paintHash(i+vec3(0,1,1)),paintHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float paintCrest(vec2 p){vec2 uv=p/.24+.5;return texture2D(paintCrestMap,clamp(uv,0.,1.)).r*step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);}
`;

const pattern = `
vec3 p=paintPosition*paintScale;
float top=smoothstep(.35,.72,abs(normalize(paintNormal).y));
float hood=(1.-smoothstep(-.20,-.14,p.z))*smoothstep(-.02,.04,p.y);
float flank=smoothstep(.19,.23,abs(p.x));
float ink=0.,paintGlow=0.;
if(paintJob==0&&paintScale>.9){
  hood=(1.-smoothstep(-.25,-.20,p.z))*smoothstep(-.02,.04,p.y);
  float stripe=(1.-smoothstep(.072,.082,abs(p.x)))*hood;
  float pinstripe=(1.-smoothstep(.007,.012,abs(abs(p.x)-.115)))*hood;
  float side=smoothstep(.34,.42,abs(p.x))*smoothstep(-.06,.03,p.y)*(1.-smoothstep(.10,.18,p.y));
  float chevron=step(.45,fract((p.z+p.y*.8)*21.))*smoothstep(-.02,.01,p.z)*(1.-smoothstep(.22,.25,p.z))*side;
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.018,.029,.035),stripe*.9);
  ink=max(pinstripe,chevron*.82);
}else if(paintJob==1){
  float flowTime=paintTime*3.5;
  float flow=(p.y*.62+abs(p.x)*.85+p.z*.025)*410.+sin(p.z*5.-flowTime*.4)*.35-flowTime*.8;
  float lines=smoothstep(.62,.88,sin(flow));
  float region=smoothstep(.12,.3,abs(p.x))*(1.-smoothstep(.24,.36,p.y));
  float sweep=.65+.35*pow(.5+.5*sin(p.z*5.-flowTime*.9),3.);
  ink=lines*region*sweep;paintGlow=ink*.25;
  diffuseColor.rgb*=.8+.2*top;
}else if(paintJob==2){
  float sideSlash=max(paintLine(p.y+.04-p.z*.24,.012),paintLine(p.y+.055+p.z*.36,.007));
  sideSlash*=flank*smoothstep(-.45,-.35,p.z)*(1.-smoothstep(.34,.42,p.z));
  float fender=paintLine(abs(p.x)-(.255+.08*sin((p.z+.45)*7.)),.012)*hood;
  vec2 badge=vec2(p.x,(p.z+.055)*.8);float ring=paintLine(length(badge)-.09,.007);
  float six=paintLine(length(badge-vec2(0.,-.018))-.03,.007)+paintLine(badge.x+.027,.007)*step(-.02,badge.y)*step(badge.y,.054);
  float roof=(1.-smoothstep(.105,.115,length(badge)))*smoothstep(.215,.235,p.y)*top;
  float tooth=abs(fract((p.z+.1)*30.)-.5)*.065;
  float teeth=(1.-smoothstep(.0,.003,p.y+.085+tooth))*smoothstep(-.12,-.115,p.y)*flank*step(-.18,p.z)*step(p.z,.2);
  ink=max(max(sideSlash,fender),max(max(ring,six)*roof,teeth));
}else if(paintJob==3){
  ink=paintLine(abs(p.x)-.072,.022)*top;
}else if(paintJob==4){
  float camo=paintNoise(p*36.)*.65+paintNoise(p*68.+7.)*.35;
  diffuseColor.rgb=mix(diffuseColor.rgb*.12,diffuseColor.rgb*1.5,smoothstep(.45,.48,camo));
  float border=paintLine(abs(p.x)-(.085+(p.z+.75)*.21),.0055)*(1.-smoothstep(-.32,-.28,p.z))*top;
  float slash=max(paintLine(p.y+.025-p.z*.27,.009),paintLine(p.y+.065+p.z*.28,.004))*flank*smoothstep(-.25,-.19,p.z)*(1.-smoothstep(.38,.44,p.z));
  ink=max(border,slash);
}else if(paintJob==5){
  float arc=paintLine(length(vec2((abs(p.x)-.31)*1.05,(p.z+.25)*.62))-.245,.012);
  float side=max(paintLine(length(vec2((p.z-.01)*.72,(p.y-.035)*1.25))-.19,.019),paintLine(p.y+.11-p.z*.3,.011))*flank;
  float shoulder=smoothstep(.17,.28,abs(p.x))*(.5+.5*sin(p.z*7.+abs(p.x)*14.));
  ink=max(max(arc*top,side),smoothstep(.82,.9,shoulder));
  ink=max(ink,paintCrest(vec2(p.x,-(p.z+.54)))*(1.-smoothstep(-.36,-.32,p.z))*top);
  ink=max(ink,paintCrest(vec2(p.x,-(p.z+.06)))*smoothstep(.21,.23,p.y)*top);
}
diffuseColor.rgb=mix(diffuseColor.rgb,paintAccent,clamp(ink,0.,1.));
`;

export class CarPaint {
  private entries: { material: T.MeshPhysicalMaterial; role: 'body' | 'trim' | 'rim'; original: T.MeshPhysicalMaterial; uniforms: Record<string, T.IUniform> }[] = [];
  private time = 0;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(model: CarModel) {
    const seen = new Set<T.Material>();
    model.root.traverse(object => {
      if (!(object instanceof T.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!(material instanceof T.MeshPhysicalMaterial) || seen.has(material)) continue;
        const role = ['Octane_Body', 'Car_Body'].includes(material.name) ? 'body' : material.name === 'Paint' ? 'trim' : material.name === 'Dieci_Rim' ? 'rim' : null;
        if (!role) continue;
        seen.add(material);
        const uniforms = { paintJob: { value: 0 }, paintTime: { value: 0 }, paintScale: { value: material.name === 'Car_Body' ? .5 : 1 }, paintAccent: { value: new T.Color() }, paintCrestMap: { value: crestMask() } };
        this.entries.push({ material, role, original: material.clone(), uniforms });
        if (role === 'body') {
          // One program owns all presets so switching back to a cached program
          // never detaches its live paint uniforms.
          material.onBeforeCompile = shader => {
            Object.assign(shader.uniforms, uniforms);
            shader.vertexShader = 'varying vec3 paintPosition,paintNormal;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\npaintPosition=position;paintNormal=normal;');
            shader.fragmentShader = declarations + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + pattern);
            shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=paintAccent*paintGlow;');
          };
          material.customProgramCacheKey = () => 'car-paint-v3';
          material.needsUpdate = true;
        }
      }
    });
  }

  set(id: PaintJob) {
    const index = PAINT_JOBS.findIndex(job => job.id === id), job = PAINT_JOBS[index];
    for (const entry of this.entries) {
      const { material, original, role, uniforms } = entry;
      material.color.copy(original.color); material.emissive.copy(original.emissive); material.emissiveIntensity = original.emissiveIntensity;
      for (const key of ['metalness', 'roughness', 'clearcoat', 'clearcoatRoughness', 'specularIntensity', 'envMapIntensity'] as const) material[key] = original[key];
      if (index > 0) {
        material.color.set(role === 'body' ? job.color : role === 'trim' ? job.trim : job.rim);
        material.metalness = role === 'body' ? job.metalness : role === 'rim' ? .12 : .38;
        material.roughness = role === 'body' ? job.roughness : role === 'rim' ? .48 : .28;
        material.clearcoat = role === 'rim' ? .25 : .8; material.clearcoatRoughness = .26;
        if (id === 'ultraviolet') { material.specularIntensity = .45; material.clearcoat = .55; }
        if (id === 'midnight') { material.specularIntensity = .35; material.clearcoat = .35; }
        if (role === 'rim') { material.specularIntensity = .12; material.envMapIntensity = .18; material.clearcoat = .04; }
      }
      if (role === 'body') { uniforms.paintJob.value = index; uniforms.paintAccent.value.set(job.accent); }
    }
  }

  update(dt: number) {
    if (!this.reducedMotion.matches) this.time += dt;
    for (const { uniforms } of this.entries) uniforms.paintTime.value = this.reducedMotion.matches ? 0 : this.time;
  }
}
