import { emptyInput, type Input } from '../config';
export const PROTOCOL = 1;
export const MAX_LEAD = 64;
export const HISTORY = 256;
// Full baselines can take several seconds on a slow connection. Retain a longer
// authoritative journal without enlarging the client's rollback/work window.
export const SERVER_HISTORY = 3600;
export const MAX_PACKET = 1200;
export interface Command { tick: number; input: Input; }
export interface Frame { tick: number; inputs: [Input, Input]; start: boolean; hash: string; }
const axes = ['throttle', 'steer', 'pitch', 'roll', 'yaw', 'dodgeForward', 'dodgeSide'] as const;
export function canonicalInput(input: Input): Input {
  const result = emptyInput();
  for (const key of axes) {
    const value = input[key] ?? (key === 'yaw' ? input.steer : key === 'dodgeForward' ? input.throttle : key === 'dodgeSide' ? input.steer : 0);
    result[key] = Math.round(Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0)) * 32767) / 32767;
  }
  for (const key of ['boost', 'jump', 'jumpHeld', 'drift'] as const) result[key] = !!input[key];
  return result;
}
export const heldInput = (input: Input): Input => ({ ...input, jump: false });
function writeInput(view: DataView, offset: number, input: Input) {
  for (const key of axes) { view.setInt16(offset, Math.round((input[key] ?? 0) * 32767), true); offset += 2; }
  view.setUint8(offset, +input.boost | +input.jump << 1 | +input.jumpHeld << 2 | +input.drift << 3);
  return offset + 1;
}
function readInput(view: DataView, offset: number): Input {
  const input = emptyInput();
  for (const key of axes) { input[key] = Math.max(-1, view.getInt16(offset, true) / 32767); offset += 2; }
  const flags = view.getUint8(offset); input.boost = !!(flags & 1); input.jump = !!(flags & 2); input.jumpHeld = !!(flags & 4); input.drift = !!(flags & 8);
  return input;
}
export function encodeCommands(epoch: number, commands: Command[]): Uint8Array {
  if (commands.length > 16) throw new Error('Too many commands');
  const bytes = new Uint8Array(7 + commands.length * 19), v = new DataView(bytes.buffer);
  v.setUint8(0, PROTOCOL); v.setUint8(1, 1); v.setUint32(2, epoch, true); v.setUint8(6, commands.length);
  let offset = 7;
  for (const command of commands) { v.setUint32(offset, command.tick, true); offset = writeInput(v, offset + 4, command.input); }
  return bytes;
}
export function decodeCommands(bytes: Uint8Array, epoch: number): Command[] | null {
  if (!valid(bytes, epoch, 1, 19, 16)) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), commands: Command[] = [];
  for (let o = 7; o < bytes.length; o += 19) commands.push({ tick: v.getUint32(o, true), input: readInput(v, o + 4) });
  return commands;
}
export function encodeFrames(epoch: number, frames: Frame[]): Uint8Array {
  if (frames.length > 24) throw new Error('Too many frames');
  const bytes = new Uint8Array(7 + frames.length * 43), v = new DataView(bytes.buffer);
  v.setUint8(0, PROTOCOL); v.setUint8(1, 2); v.setUint32(2, epoch, true); v.setUint8(6, frames.length);
  let offset = 7;
  for (const f of frames) {
    v.setUint32(offset, f.tick, true); offset += 4;
    offset = writeInput(v, offset, f.inputs[0]); offset = writeInput(v, offset, f.inputs[1]);
    v.setUint8(offset++, +f.start);
    const [a, b] = f.hash ? f.hash.split(':').map(Number) : [0, 0];
    v.setUint32(offset, a, true); v.setUint32(offset + 4, b, true); offset += 8;
  }
  return bytes;
}
export function decodeFrames(bytes: Uint8Array, epoch: number): Frame[] | null {
  if (!valid(bytes, epoch, 2, 43, 24)) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), frames: Frame[] = [];
  for (let o = 7; o < bytes.length; o += 43) {
    const a = v.getUint32(o + 35, true), b = v.getUint32(o + 39, true);
    frames.push({ tick: v.getUint32(o, true), inputs: [readInput(v, o + 4), readInput(v, o + 19)], start: !!(v.getUint8(o + 34) & 1), hash: a || b ? `${a}:${b}` : '' });
  }
  return frames;
}
function valid(bytes: Uint8Array, epoch: number, kind: number, stride: number, max: number) {
  if (bytes.length < 7 || bytes.length > MAX_PACKET) return false;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), count = v.getUint8(6);
  return v.getUint8(0) === PROTOCOL && v.getUint8(1) === kind && v.getUint32(2, true) === epoch && count <= max && bytes.length === 7 + count * stride;
}
