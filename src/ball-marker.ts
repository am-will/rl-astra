import * as T from 'three';

export function createBallMarker() {
  const material = new T.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 vUv;void main(){
      vec2 p=vUv*2.-1.;float d=length(p);float aa=max(fwidth(d),.002);
      float ring=1.-smoothstep(.021,.021+aa,abs(d-.73));
      float outline=1.-smoothstep(.052,.052+aa,abs(d-.73));
      float crosshair=(1.-smoothstep(.018,.018+aa,min(abs(p.x),abs(p.y))))*smoothstep(.83,.85,d)*(1.-smoothstep(.96,.98,d));
      float dot=1.-smoothstep(.03,.03+aa,d);
      float ink=max(ring,max(crosshair,dot));float shadow=max(outline,ink);
      vec3 color=mix(vec3(.015,.035,.04),vec3(.94,1.,.88)*1.15,ink);
      gl_FragColor=vec4(color,max(shadow*.72,ink*.96));
    }`,
  });
  const mesh = new T.Mesh(new T.PlaneGeometry(2, 2), material); mesh.rotation.x = -Math.PI / 2; mesh.renderOrder = 2; mesh.name = 'ball-height-marker'; return mesh;
}
