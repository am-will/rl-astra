export const CAMERA_DEFAULTS = { fov: 69, height: 2.05, distance: 4.9, angle: 10 };
export type CameraSettings = typeof CAMERA_DEFAULTS;
export const CAMERA_RANGES = { fov: [50, 110, 1], height: [.45, 4.5, .05], distance: [2.8, 10, .1], angle: [0, 30, 1] } as const;
export function loadCameraSettings(): CameraSettings {
  const result = { ...CAMERA_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem('champions-field.camera') || '{}');
    for (const key of Object.keys(result) as (keyof CameraSettings)[]) {
      const value = saved?.[key], [min, max] = CAMERA_RANGES[key];
      if (typeof value === 'number' && Number.isFinite(value)) result[key] = Math.max(min, Math.min(max, value));
    }
  } catch { /* Fall back to the camera preset. */ }
  return result;
}
