import { Vector2 } from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export function createBloomPass(resolution: Vector2) {
  const pass = new UnrealBloomPass(resolution, .32, .45, 1.2);
  // A single invalid HDR sample otherwise poisons every bloom mip, turning
  // the entire composed frame black. Contain it before filtering begins.
  pass.materialHighPassFilter.fragmentShader = pass.materialHighPassFilter.fragmentShader.replace(
    'vec4 texel = texture2D( tDiffuse, vUv );',
    `vec4 texel = texture2D( tDiffuse, vUv );
     if (isnan(texel.r) || isinf(texel.r)) texel.r = 0.;
     if (isnan(texel.g) || isinf(texel.g)) texel.g = 0.;
     if (isnan(texel.b) || isinf(texel.b)) texel.b = 0.;
     if (isnan(texel.a) || isinf(texel.a)) texel.a = 0.;
     // Leave headroom for the weighted mip sum in the half-float targets.
     texel = clamp(texel, vec4(0.), vec4(64., 64., 64., 1.));`,
  );
  return pass;
}
