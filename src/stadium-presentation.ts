import * as T from 'three';
import { BLUE, ORANGE } from './config';
import { labelTexture } from './assets';

/** Shared render clock drives the arena's displays, cloth, spectators and light choreography. */
export class StadiumPresentation {
  readonly time = { value: 0 };
  readonly celebration = { value: 0 };
  readonly celebrationColor = { value: new T.Color(BLUE) };
  readonly atmosphere = new T.Group();
  private scoreboard = document.createElement('canvas');
  private scoreboardTexture: T.CanvasTexture;
  private matchKey = '';
  private lastBlue = 0;
  private lastOrange = 0;
  private goalAt = -100;
  private beams: { mesh: T.Mesh; side: number; z: number; phase: number }[] = [];
  private beamDirection = new T.Vector3();
  private beamUp = new T.Vector3(0, 1, 0);

  constructor(scene: T.Scene) {
    this.scoreboard.width = 1536; this.scoreboard.height = 640;
    this.scoreboardTexture = new T.CanvasTexture(this.scoreboard);
    this.scoreboardTexture.colorSpace = T.SRGBColorSpace;
    this.scoreboardTexture.anisotropy = 8;
    this.atmosphere.name = 'stadium-atmosphere'; this.atmosphere.visible = false; scene.add(this.atmosphere);
    this.makeSearchlights();
    this.setMatch(0, 0, 300, false, false, 'ready');
  }

  /** Keep text crisp and update only when the displayed second/score/status changes. */
  setMatch(blue: number, orange: number, seconds: number, practice: boolean, overtime: boolean, phase: string) {
    const whole = Math.max(0, Math.ceil(seconds)), key = [blue, orange, whole, practice, overtime, phase].join(':');
    if (key === this.matchKey) return;
    if (phase === 'goal' && (blue > this.lastBlue || orange > this.lastOrange)) {
      this.goalAt = this.time.value; this.celebrationColor.value.setHex(blue > this.lastBlue ? BLUE : ORANGE);
    } else if (phase !== 'goal') this.goalAt = -100;
    this.lastBlue = blue; this.lastOrange = orange; this.matchKey = key;
    const c = this.scoreboard.getContext('2d')!;
    c.clearRect(0, 0, 1536, 640); c.textAlign = 'center';
    c.fillStyle = '#e4f3ff'; c.font = 'italic 900 74px "Barlow Condensed", Arial'; c.fillText('CHAMPIONS FIELD', 768, 97);
    c.fillStyle = '#5bbfff'; c.font = '600 35px "Barlow Condensed", Arial'; c.fillText('BLUE', 375, 213);
    c.fillStyle = '#ffb35e'; c.fillText('ORANGE', 1161, 213);
    c.font = '600 246px "Barlow Condensed", Arial';
    c.fillStyle = '#e5f5ff'; c.fillText(String(blue), 375, 462); c.fillStyle = '#fff0df'; c.fillText(String(orange), 1161, 462);
    c.font = '500 89px "Barlow Condensed", Arial'; c.fillStyle = '#e9f2f9';
    c.fillText(practice ? '∞' : `${overtime ? '+' : ''}${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`, 768, 365);
    c.font = '600 29px "Barlow Condensed", Arial'; c.fillStyle = '#90a8be';
    c.fillText(practice ? 'FREE PLAY' : overtime ? 'SUDDEN DEATH' : 'EXHIBITION • LIVE', 768, 417);
    c.fillStyle = '#f2f7fc'; c.font = 'italic 800 40px "Barlow Condensed", Arial';
    c.fillText(phase === 'goal' ? 'G O A L !' : 'ROCKET LEAGUE', 768, 569);
    this.scoreboardTexture.needsUpdate = true;
  }

  displayMaterial(ribbon = false, repeats = 5) {
    const brand = ribbon ? labelTexture('CHAMPIONS FIELD   //   ROCKET LEAGUE', '#d5eeff', '#08111e', 1536, 96) : this.scoreboardTexture;
    const material = new T.ShaderMaterial({
      name: ribbon ? 'stadium-led-ribbon' : 'stadium-live-scoreboard',
      uniforms: { arenaTime: this.time, goal: this.celebration, goalColor: this.celebrationColor, lettering: { value: brand } },
      vertexShader: 'varying vec2 screenUv;void main(){screenUv=uv;vec3 transformed=position;\n#include <project_vertex>\n}',
      fragmentShader: `uniform float arenaTime,goal;uniform vec3 goalColor;uniform sampler2D lettering;varying vec2 screenUv;
        void main(){
          vec4 diffuseColor=vec4(1.);
          #include <alphatest_fragment>
          vec2 uv=screenUv;
          vec3 blue=vec3(.015,.24,.75),orange=vec3(1.,.24,.022);
          vec3 team=mix(blue,orange,smoothstep(.40,.60,uv.x));
          ${ribbon ? `
            float chase=pow(max(0.,sin(uv.x*55.-arenaTime*1.8)),18.);
            vec4 text=texture2D(lettering,vec2(fract(uv.x*${repeats.toFixed(1)}+arenaTime*.009),uv.y));
            vec3 color=text.rgb*(.65+chase*.6)+team*(.13+chase*.75);
            color+=team*step(.84,uv.y)*1.2;
          ` : `
            vec2 p=(uv-.5)*vec2(2.4,1.);
            float diagonal=pow(.5+.5*sin((uv.x+uv.y*.32)*42.-arenaTime*.6),14.);
            float sweep=exp(-pow(fract(uv.x*.6+uv.y*.25-arenaTime*.055)-.5,2.)*220.);
            vec3 color=vec3(.004,.011,.023)+team*(.10+diagonal*.09+sweep*.16);
            float divider=exp(-pow(abs(uv.x-.5)-.17,2.)*65000.)*smoothstep(.18,.25,uv.y)*(1.-smoothstep(.67,.75,uv.y));
            color+=team*divider*1.5;
            float border=step(.972,uv.y)+step(uv.y,.025);
            color+=team*border*(1.3+.7*sin(arenaTime*.9+uv.x*7.));
            vec4 text=texture2D(lettering,uv);color=mix(color,text.rgb*1.65,text.a);
            float diode=1.-smoothstep(.012,.017,length((uv-vec2(.92,.875))*vec2(2.4,1.)));
            color+=vec3(.14,.85,.53)*diode*(.6+.4*sin(arenaTime*2.));
          `}
          color=mix(color,color+goalColor*(.25+.25*sin(arenaTime*3.+uv.x*12.)),goal);
          // Resolve the diode grid only close enough to avoid a moire shimmer at driving distance.
          float detail=1.-smoothstep(.002,.006,fwidth(uv.y));
          color*=1.-detail*.12*(.5+.5*sin(uv.y*1800.));
          gl_FragColor=vec4(color,diffuseColor.a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    return material;
  }

  /** A pulse travels along physical light rails; the stadium keeps a constant light count. */
  lightMaterial(color: T.ColorRepresentation, intensity = 2.5) {
    const mat = new T.MeshStandardMaterial({ name: 'stadium-chasing-light', color, emissive: color, emissiveIntensity: intensity, roughness: .28 });
    mat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, { arenaTime: this.time, goal: this.celebration, goalColor: this.celebrationColor });
      shader.vertexShader = 'varying vec3 arenaWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\narenaWorld=(modelMatrix*vec4(position,1.)).xyz;');
      shader.fragmentShader = 'varying vec3 arenaWorld;uniform float arenaTime,goal;uniform vec3 goalColor;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float wave=pow(.5+.5*sin((arenaWorld.x+arenaWorld.z)*.16-arenaTime*1.5+arenaWorld.y*.12),14.);
        totalEmissiveRadiance*=.46+wave*1.7;
        totalEmissiveRadiance+=goalColor*goal*(1.2+wave*1.8);
      `);
    };
    mat.customProgramCacheKey = () => 'stadium-chasing-light-v1';
    return mat;
  }

  flagMaterial(map: T.Texture) {
    const mat = new T.MeshStandardMaterial({ name: 'stadium-woven-banner', map, side: T.DoubleSide, roughness: .88, metalness: 0 });
    mat.onBeforeCompile = shader => {
      shader.uniforms.arenaTime = this.time;
      shader.vertexShader = 'uniform float arenaTime;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float freeEdge=pow(1.-uv.y,1.3),phase=modelMatrix[3].z*.22+modelMatrix[3].x*.07;
        transformed.z+=freeEdge*(sin(position.y*1.65-arenaTime*2.+phase)*.30+sin(position.x*2.4+position.y*3.2-arenaTime*3.1+phase)*.10);
        transformed.x+=freeEdge*sin(arenaTime*1.35+phase+uv.y*3.)*.15;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        vec3 clothNormal=normalize(cross(dFdx(vViewPosition),dFdy(vViewPosition)));
        normal=gl_FrontFacing?clothNormal:-clothNormal;
      `);
    };
    mat.customProgramCacheKey = () => 'stadium-cloth-v1'; return mat;
  }

  animateCrowd(mat: T.MeshStandardMaterial) {
    mat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, { arenaTime: this.time, goal: this.celebration });
      shader.vertexShader = 'uniform float arenaTime,goal;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 seat=instanceMatrix[3].xyz;float phase=dot(seat.xz,vec2(.73,1.17));
        float wave=pow(.5+.5*sin(seat.x*.065+seat.z*.065-arenaTime*.75),12.);
        transformed.y+=(.025+wave*.15+goal*.13)*(.5+.5*sin(arenaTime*4.+phase));
        transformed.x+=sin(arenaTime*1.5+phase)*.035;
      `);
    };
    mat.customProgramCacheKey = () => 'stadium-crowd-wave-v1';
  }

  addCrowdLights(crowd: T.InstancedMesh) {
    const count = 900, positions = new Float32Array(count * 3), seeds = new Float32Array(count), transform = new T.Matrix4(), point = new T.Vector3();
    for (let i = 0; i < count; i++) {
      crowd.getMatrixAt((i * 107) % crowd.count, transform); point.setFromMatrixPosition(transform); point.y += .35;
      point.toArray(positions, i * 3); seeds[i] = (i * .61803398875) % 1;
    }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(positions, 3)); geo.setAttribute('seed', new T.BufferAttribute(seeds, 1));
    const mat = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { arenaTime: this.time, goal: this.celebration, screenHeight: { value: innerHeight } },
      vertexShader: `attribute float seed;uniform float arenaTime,goal,screenHeight;varying float power,team;
        void main(){vec3 p=position;p.y+=.06*sin(arenaTime*2.+seed*35.);vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
          gl_PointSize=clamp(screenHeight*.055/max(1.,-mv.z),1.,5.);
          float wave=pow(.5+.5*sin(seed*80.+arenaTime*.6),28.);
          power=(.08+wave*.8+goal*.35)*smoothstep(3.,9.,length(mv.xyz));team=step(0.,p.z);}`,
      fragmentShader: `varying float power,team;void main(){float d=length(gl_PointCoord-.5)*2.;float glow=exp(-d*d*4.)*(1.-smoothstep(.65,1.,d));gl_FragColor=vec4(mix(vec3(1.,.4,.1),vec3(.15,.65,1.),team)*2.5,glow*power);}`,
    });
    const lights = new T.Points(geo, mat); lights.name = 'stadium-crowd-lights'; this.atmosphere.add(lights);
    window.addEventListener('resize', () => { mat.uniforms.screenHeight.value = innerHeight * Math.min(devicePixelRatio, 2); });
  }

  private makeSearchlights() {
    const geo = new T.CylinderGeometry(4.8, .13, 48, 32, 1, true); geo.translate(0, 24, 0);
    const material = new T.ShaderMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending,
      uniforms: { arenaTime: this.time, tint: { value: new T.Color(0xa5ceff) } },
      vertexShader: `varying vec2 beamUv;varying vec3 beamNormal,beamView;void main(){beamUv=uv;vec4 mv=modelViewMatrix*vec4(position,1.);beamNormal=normalMatrix*normal;beamView=-mv.xyz;gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform float arenaTime;uniform vec3 tint;varying vec2 beamUv;varying vec3 beamNormal,beamView;
        void main(){float side=pow(abs(dot(normalize(beamNormal),normalize(beamView))),2.);
          float tip=smoothstep(0.,.09,beamUv.y)*(1.-smoothstep(.5,1.,beamUv.y));
          float haze=.8+.2*sin(beamUv.y*30.-arenaTime*.25);
          gl_FragColor=vec4(tint*1.4,side*tip*haze*.10);}`,
    });
    const lensGeometry = new T.CylinderGeometry(.21, .27, .35, 12), lensMaterial = new T.MeshBasicMaterial({ color: new T.Color(0xb8d8ff).multiplyScalar(3) });
    for (const side of [-1, 1]) for (const [i, z] of [-44, -15, 15, 44].entries()) {
      const mesh = new T.Mesh(geo, material); mesh.name = 'stadium-searchlight'; mesh.position.set(side * 57, 34, z); mesh.frustumCulled = false;
      const lens = new T.Mesh(lensGeometry, lensMaterial); lens.name = 'stadium-searchlight-lens'; mesh.add(lens);
      this.atmosphere.add(mesh); this.beams.push({ mesh, side, z, phase: i * 1.6 + side });
    }
  }

  update(time: number) {
    this.time.value = time;
    this.celebration.value = (1 - T.MathUtils.smoothstep(time - this.goalAt, 1.5, 4.5)) * Number(time >= this.goalAt);
    for (const { mesh, side, z, phase } of this.beams) {
      // Sweeps stay above the roof and spectator tiers, never over the playing surface.
      this.beamDirection.set(-side * (.25 + .35 * Math.sin(time * .16 + phase)), .85, Math.sin(time * .2 + phase) * .5 + z * .003).normalize();
      mesh.quaternion.setFromUnitVectors(this.beamUp, this.beamDirection);
    }
  }
}
