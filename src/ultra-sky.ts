import * as T from 'three';

/** HDR sunset with layered clouds and warm scattering along the horizon. */
export function createUltraSky() {
  const material = new T.ShaderMaterial({ side: T.BackSide, depthWrite: false,
    uniforms: { skyTime: { value: 0 } },
    vertexShader: 'varying vec3 skyDirection;void main(){skyDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 skyDirection;uniform float skyTime;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
      float clouds(vec2 p){float n=0.,a=.53;for(int i=0;i<5;i++){n+=noise(p)*a;p=mat2(.8,.6,-.6,.8)*p*2.04+17.3;a*=.48;}return n;}
      void main(){
        vec3 d=normalize(skyDirection),sunDirection=normalize(vec3(-50.,42.,-35.));
        float h=max(d.y,0.),alignment=max(dot(d,sunDirection),0.);
        vec3 sky=mix(vec3(.48,.26,.13),vec3(.035,.13,.3),smoothstep(0.,.6,h));
        sky+=vec3(1.,.48,.15)*pow(alignment,8.)*.23;
        sky+=vec3(5.,3.8,2.3)*smoothstep(.9992,.9997,alignment);
        vec2 p=d.xz/(h+.28)*2.6+vec2(skyTime*.004,skyTime*.0015);
        float density=clouds(p),coverage=smoothstep(.43,.65,density)*smoothstep(.015,.16,h);
        float rim=clamp((density-clouds(p+sunDirection.xz*.13))*8.+.5,0.,1.);
        vec3 cloudColor=mix(vec3(.11,.16,.23),vec3(.72,.55,.39),rim);
        cloudColor+=vec3(.8,.36,.1)*pow(alignment,5.)*rim;
        sky=mix(sky,cloudColor,coverage*.82);
        gl_FragColor=vec4(sky,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new T.Mesh(new T.SphereGeometry(240, 48, 32), material);
  sky.name = 'ultra-sunset-sky'; sky.renderOrder = -5;
  return sky;
}
