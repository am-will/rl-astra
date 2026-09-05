export type PadBinding = { type: 'button'; index: number } | { type: 'axis'; index: number; direction: 1 | -1; rest: number };
export type Device = 'keyboard' | 'gamepad';
export type Category = 'driving' | 'aerial' | 'match';
const button = (index: number): PadBinding => ({ type: 'button', index });
const axis = (index: number, direction: 1 | -1): PadBinding => ({ type: 'axis', index, direction, rest: 0 });
export const ACTIONS = [
  { id: 'forward', label: 'Accelerate', category: 'driving', keys: ['KeyW', 'ArrowUp'], pad: [button(7)] },
  { id: 'reverse', label: 'Brake / reverse', category: 'driving', keys: ['KeyS', 'ArrowDown'], pad: [button(6)] },
  { id: 'left', label: 'Steer left', category: 'driving', keys: ['KeyA', 'ArrowLeft'], pad: [axis(0, -1)] },
  { id: 'right', label: 'Steer right', category: 'driving', keys: ['KeyD', 'ArrowRight'], pad: [axis(0, 1)] },
  { id: 'jump', label: 'Jump / dodge', category: 'driving', keys: ['Space'], pad: [button(0)] },
  { id: 'boost', label: 'Rocket boost', category: 'driving', keys: ['ShiftLeft', 'ShiftRight'], pad: [button(1)] },
  { id: 'drift', label: 'E-brake / powerslide', category: 'driving', keys: ['ControlLeft', 'ControlRight', 'PageDown'], pad: [button(2)] },
  { id: 'pitchUp', label: 'Pitch nose up', category: 'aerial', keys: ['KeyS', 'ArrowDown'], pad: [axis(1, 1)] },
  { id: 'pitchDown', label: 'Pitch nose down', category: 'aerial', keys: ['KeyW', 'ArrowUp'], pad: [axis(1, -1)] },
  { id: 'yawLeft', label: 'Air steer left', category: 'aerial', keys: ['KeyA', 'ArrowLeft'], pad: [axis(0, -1)] },
  { id: 'yawRight', label: 'Air steer right', category: 'aerial', keys: ['KeyD', 'ArrowRight'], pad: [axis(0, 1)] },
  { id: 'rollLeft', label: 'Air roll left', category: 'aerial', keys: ['KeyQ'], pad: [button(4)] },
  { id: 'rollRight', label: 'Air roll right', category: 'aerial', keys: ['KeyE'], pad: [button(5)] },
  { id: 'airRoll', label: 'Air roll modifier', category: 'aerial', keys: [], pad: [button(2)] },
  { id: 'camera', label: 'Toggle ball camera', category: 'match', keys: ['KeyC'], pad: [button(3)] },
  { id: 'pause', label: 'Pause / options', category: 'match', keys: ['Escape'], pad: [button(9)] },
  { id: 'mode', label: 'Toggle practice mode', category: 'match', keys: ['KeyP'], pad: [] },
  { id: 'reset', label: 'Reset car', category: 'match', keys: ['KeyR'], pad: [button(12)] },
  { id: 'restart', label: 'Restart match', category: 'match', keys: ['Digit5', 'Numpad5'], pad: [] },
  { id: 'unlimited', label: 'Unlimited boost', category: 'match', keys: ['KeyB'], pad: [button(13)] },
  { id: 'help', label: 'Controls guide', category: 'match', keys: ['KeyH'], pad: [button(8)] },
  { id: 'sound', label: 'Mute / unmute', category: 'match', keys: ['KeyM'], pad: [] },
  { id: 'fullscreen', label: 'Fullscreen', category: 'match', keys: ['KeyF'], pad: [] },
] as const;
export type ActionId = typeof ACTIONS[number]['id'];
export interface ControlSettings {
  version: 1;
  keyboard: Record<ActionId, string[]>;
  gamepad: Record<ActionId, PadBinding[]>;
  deadzone: number;
  dodgeDeadzone: number;
  steeringSensitivity: number;
  aerialSensitivity: number;
}
export const STORAGE_KEY = 'champions-field.controls.v1';
export function defaults(): ControlSettings {
  return {
    version: 1,
    keyboard: Object.fromEntries(ACTIONS.map(a => [a.id, [...a.keys]])) as ControlSettings['keyboard'],
    gamepad: Object.fromEntries(ACTIONS.map(a => [a.id, a.pad.map(p => ({ ...p }))])) as ControlSettings['gamepad'],
    deadzone: .12, dodgeDeadzone: .45, steeringSensitivity: 1, aerialSensitivity: 1,
  };
}
export const validKey = (key: unknown): key is string => typeof key === 'string' && /^[A-Za-z][A-Za-z0-9]{0,30}$/.test(key);
export function validPad(value: unknown): value is PadBinding {
  if (!value || typeof value !== 'object') return false;
  const p = value as PadBinding;
  return Number.isInteger(p.index) && p.index >= 0 && (p.type === 'button' ? p.index < 64 : p.type === 'axis' && p.index < 32 && [1, -1].includes(p.direction) && Number.isFinite(p.rest) && Math.abs(p.rest) <= 1);
}
export function loadSettings(): ControlSettings {
  const result = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (raw?.version !== 1) return result;
    for (const action of ACTIONS) {
      if (Array.isArray(raw.keyboard?.[action.id]) && raw.keyboard[action.id].every(validKey)) result.keyboard[action.id] = raw.keyboard[action.id].slice(0, 4);
      if (Array.isArray(raw.gamepad?.[action.id]) && raw.gamepad[action.id].every(validPad)) result.gamepad[action.id] = raw.gamepad[action.id].slice(0, 4);
    }
    // Migrate the old P-to-pause default when adding the practice toggle.
    if (!raw.keyboard?.mode) result.keyboard.pause = result.keyboard.pause.filter(key => key !== 'KeyP');
    for (const [key, min, max] of [['deadzone', .03, .4], ['dodgeDeadzone', .1, .95], ['steeringSensitivity', .5, 2], ['aerialSensitivity', .5, 2]] as const) {
      if (Number.isFinite(raw[key])) result[key] = Math.max(min, Math.min(max, raw[key]));
    }
  } catch { /* Unavailable or invalid storage uses the complete default layout. */ }
  return result;
}
export function keyLabel(code: string) {
  const names: Record<string, string> = { Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt', PageDown: 'PgDn', PageUp: 'PgUp', Escape: 'Esc', Backspace: 'Backspace', MetaLeft: 'L Cmd', MetaRight: 'R Cmd' };
  return names[code] || code.replace(/^Key|^Digit/, '').replace('Numpad', 'Num ');
}
export function padLabel(binding: PadBinding, id = '', standard = true) {
  if (binding.type === 'axis') {
    if (standard && binding.rest === 0 && binding.index < 4) return `${binding.index < 2 ? 'LS' : 'RS'} ${binding.index % 2 === 0 ? binding.direction < 0 ? '←' : '→' : binding.direction < 0 ? '↑' : '↓'}`;
    return `Axis ${binding.index} ${binding.direction > 0 ? '+' : '−'}`;
  }
  const ps = /054c|sony|dualshock|dualsense|playstation|wireless controller/i.test(id) && !/xbox/i.test(id);
  const xbox = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS click', 'RS click', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Guide'];
  const playstation = ['Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'PS'];
  return standard ? (ps ? playstation : xbox)[binding.index] || `Button ${binding.index}` : `Button ${binding.index}`;
}
