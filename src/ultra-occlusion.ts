import * as T from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

/** Use the already rendered depth, including animated blades, instead of redrawing a million instances. */
export class UltraOcclusion extends GTAOPass {
  constructor(scene: T.Scene, camera: T.Camera) {
    super(scene, camera);
    this.blendIntensity = .65;
    this.updateGtaoMaterial({ radius: .48, thickness: .7, distanceFallOff: 1., samples: 16, scale: 1. });
    this.updatePdMaterial({ radius: 5, samples: 16, depthPhi: 2., normalPhi: 4. });
    // Reconstructed screen-space horizons lose the hidden grass behind a foreground car,
    // making its silhouette look surrounded by light. Turf already shades its own roots;
    // apply AO above the canopy only, after denoising so the filter cannot bleed onto it.
    Object.assign(this.blendMaterial.uniforms, {
      sceneDepth: { value: null },
      inverseProjection: { value: new T.Matrix4() },
      cameraWorld: { value: new T.Matrix4() },
    });
    this.blendMaterial.fragmentShader = `uniform sampler2D sceneDepth;uniform mat4 inverseProjection,cameraWorld;\n` + this.blendMaterial.fragmentShader;
    this.blendMaterial.fragmentShader = this.blendMaterial.fragmentShader.replace('gl_FragColor = vec4(mix(vec3(1.), texel.rgb, intensity), texel.a);', `
      float depth=texture2D(sceneDepth,vUv).r;
      vec4 view=inverseProjection*vec4(vUv*2.-1.,depth*2.-1.,1.);
      float height=(cameraWorld*vec4(view.xyz/view.w,1.)).y;
      float surface=smoothstep(.20,.30,height);
      gl_FragColor=vec4(mix(vec3(1.),texel.rgb,intensity*surface),texel.a);
    `);
  }
  override render(renderer: T.WebGLRenderer, writeBuffer: T.WebGLRenderTarget, readBuffer: T.WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
    this.setGBuffer(readBuffer.depthTexture!);
    this.blendMaterial.uniforms.sceneDepth.value = readBuffer.depthTexture;
    this.blendMaterial.uniforms.inverseProjection.value.copy(this.camera.projectionMatrixInverse);
    this.blendMaterial.uniforms.cameraWorld.value.copy(this.camera.matrixWorld);
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}
