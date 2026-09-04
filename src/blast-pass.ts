import { Vector2 } from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export function createBlastPass() {
  return new ShaderPass({
    uniforms: { tDiffuse: { value: null }, center: { value: new Vector2(.5, .5) }, time: { value: 10 }, aspect: { value: innerWidth / innerHeight } },
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform sampler2D tDiffuse;uniform vec2 center;uniform float time;uniform float aspect;varying vec2 vUv;
    void main(){vec2 p=(vUv-center)*vec2(aspect,1.);float d=length(p);float t=max(0.,time-.22);float envelope=smoothstep(.21,.25,time)*(1.-smoothstep(.5,1.6,time));
    float ring=exp(-pow((d-t*.9)/.08,2.))*envelope;vec2 direction=p/max(d,.001)/vec2(aspect,1.);
    vec2 offset=direction*sin((d-t*.9)*55.)*ring*.012;vec2 uv=clamp(vUv+offset,vec2(.001),vec2(.999));
    vec2 split=direction*ring*.0025;vec3 c=vec3(texture2D(tDiffuse,uv+split).r,texture2D(tDiffuse,uv).g,texture2D(tDiffuse,uv-split).b);
    float mood=smoothstep(.02,.25,time)*(1.-smoothstep(1.6,3.3,time));float vignette=smoothstep(.1,.9,length((vUv-.5)*vec2(1.2,1.)));
    c*=1.-mood*(.13+vignette*.22);gl_FragColor=vec4(c,1.);}`,
  });
}
