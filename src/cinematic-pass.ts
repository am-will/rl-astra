import * as T from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const vertexShader = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';

/** Preserve scene depth before AO and bloom swap/overwrite the composer's targets. */
class SceneDepthPass extends ShaderPass {
  target = new T.WebGLRenderTarget(1, 1, { minFilter: T.NearestFilter, magFilter: T.NearestFilter, depthBuffer: false });
  constructor() {
    super({ uniforms: { sceneDepth: { value: null } }, vertexShader,
      fragmentShader: `#include <packing>
        varying vec2 vUv;uniform sampler2D sceneDepth;
        void main(){gl_FragColor=packDepthToRGBA(texture2D(sceneDepth,vUv).r);}` });
    this.needsSwap = false;
    this.material.depthTest = this.material.depthWrite = false;
  }
  override setSize(width: number, height: number) { this.target.setSize(width, height); }
  override render(renderer: T.WebGLRenderer, _write: T.WebGLRenderTarget, read: T.WebGLRenderTarget) {
    this.uniforms.sceneDepth.value = read.depthTexture;
    super.render(renderer, this.target, read, 0, false);
  }
  override dispose() { this.target.dispose(); super.dispose(); }
}

/** Camera reprojection blur, with depth rejection and protected gameplay subjects.
 * Reconstruction: https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-27-motion-blur-post-processing-effect
 */
export class CinematicMotionPass extends ShaderPass {
  depthPass = new SceneDepthPass();
  private previousViewProjection = new T.Matrix4();
  private currentViewProjection = new T.Matrix4();
  private previousPosition = new T.Vector3();
  private previousRotation = new T.Quaternion();
  private previousFov = 0;
  private ready = false;
  private shutter = 0;
  constructor(private camera: T.PerspectiveCamera) {
    super({ uniforms: {
      tDiffuse: { value: null }, sceneDepth: { value: null }, resolution: { value: new T.Vector2(1, 1) },
      inverseProjection: { value: new T.Matrix4() }, cameraWorld: { value: new T.Matrix4() },
      previousViewProjection: { value: new T.Matrix4() }, shutter: { value: 0 },
      carPosition: { value: new T.Vector3() }, ballPosition: { value: new T.Vector3() },
    }, vertexShader, fragmentShader: `#include <packing>
      varying vec2 vUv;uniform sampler2D tDiffuse,sceneDepth;uniform vec2 resolution;
      uniform mat4 inverseProjection,cameraWorld,previousViewProjection;uniform float shutter;
      uniform vec3 carPosition,ballPosition;
      vec3 viewAt(vec2 uv){
        float d=unpackRGBAToDepth(texture2D(sceneDepth,uv));
        vec4 v=inverseProjection*vec4(uv*2.-1.,d*2.-1.,1.);return v.xyz/v.w;
      }
      float subjectMask(vec3 world){
        return smoothstep(1.05,1.65,distance(world,carPosition))*smoothstep(1.0,1.3,distance(world,ballPosition));
      }
      void main(){
        vec4 original=texture2D(tDiffuse,vUv);
        if(shutter<=0.){gl_FragColor=original;return;}
        vec3 view=viewAt(vUv),world=(cameraWorld*vec4(view,1.)).xyz;
        vec4 previous=previousViewProjection*vec4(world,1.);
        if(previous.w<=0.){gl_FragColor=original;return;}
        vec2 velocity=(vUv-(previous.xy/previous.w*.5+.5))*shutter;
        // Bound the shutter streak even during fast spins and low frame rates.
        float pixels=length(velocity*resolution),limit=24.*resolution.x/1440.;
        velocity*=min(1.,limit/max(pixels,.001))*subjectMask(world);
        if(length(velocity*resolution)<.4){gl_FragColor=original;return;}
        vec3 sum=original.rgb;float total=1.;
        for(int i=0;i<8;i++){
          float t=(float(i)+.5)/8.-.5;
          vec2 uv=clamp(vUv+velocity*t,.5/resolution,1.-.5/resolution);
          vec3 sampleView=viewAt(uv),sampleWorld=(cameraWorld*vec4(sampleView,1.)).xyz;
          float tolerance=.25+abs(view.z)*.035;
          float weight=(1.-smoothstep(tolerance,tolerance*2.,abs(sampleView.z-view.z)))*subjectMask(sampleWorld);
          sum+=texture2D(tDiffuse,uv).rgb*weight;total+=weight;
        }
        gl_FragColor=vec4(sum/total,original.a);
      }` });
    this.material.depthTest = this.material.depthWrite = false;
    this.uniforms.sceneDepth.value = this.depthPass.target.texture;
  }
  reset() { this.ready = false; this.shutter = 0; this.uniforms.shutter.value = 0; }
  update(dt: number, speed: number, active: boolean, cut: boolean, car: T.Vector3, ball: T.Vector3) {
    if (cut || !active || dt <= 0 || dt > .1) this.reset();
    this.shutter = active && dt > 0 && dt <= .1 && !cut
      ? Math.min(1.2, .012 / dt) * (.3 + .7 * T.MathUtils.smoothstep(speed, 7, 23)) : 0;
    this.uniforms.carPosition.value.copy(car);
    this.uniforms.ballPosition.value.copy(ball);
  }
  override setSize(width: number, height: number) { this.uniforms.resolution.value.set(width, height); this.reset(); }
  override render(renderer: T.WebGLRenderer, write: T.WebGLRenderTarget, read: T.WebGLRenderTarget) {
    const camera = this.camera;
    this.currentViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const cut = !this.ready || camera.position.distanceToSquared(this.previousPosition) > 16
      || Math.abs(camera.quaternion.dot(this.previousRotation)) < .94 || Math.abs(camera.fov - this.previousFov) > 2;
    this.uniforms.shutter.value = cut ? 0 : this.shutter;
    this.uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
    this.uniforms.cameraWorld.value.copy(camera.matrixWorld);
    this.uniforms.previousViewProjection.value.copy(this.previousViewProjection);
    super.render(renderer, write, read, 0, false);
    // History tracks rendered frames, never the intermediate physics/update steps.
    this.previousViewProjection.copy(this.currentViewProjection);
    this.previousPosition.copy(camera.position); this.previousRotation.copy(camera.quaternion); this.previousFov = camera.fov;
    this.ready = true;
  }
  override dispose() { this.depthPass.dispose(); super.dispose(); }
}

/** Grade linear HDR before OutputPass applies ACES and the display transfer curve. */
export function createCinematicGrade() {
  return new ShaderPass({ uniforms: { tDiffuse: { value: null } }, vertexShader,
    fragmentShader: `varying vec2 vUv;uniform sampler2D tDiffuse;
      void main(){
        vec4 original=texture2D(tDiffuse,vUv);vec3 c=max(original.rgb,vec3(0.));
        float luma=dot(c,vec3(.2126,.7152,.0722));
        // A gentle toe deepens shadows while preserving the HDR range of lamps and boost.
        c*=mix(.84,1.04,smoothstep(.015,.65,luma));
        vec3 shadows=vec3(.90,.98,1.09),highlights=vec3(1.045,1.,.96);
        c*=mix(shadows,highlights,smoothstep(.06,1.2,luma));
        float gradedLuma=dot(c,vec3(.2126,.7152,.0722));
        c=max(vec3(0.),mix(vec3(gradedLuma),c,1.075));
        float edge=smoothstep(.18,.78,length((vUv-.5)*vec2(1.05,1.)));
        c*=1.-edge*.16;
        gl_FragColor=vec4(c,original.a);
      }` });
}
