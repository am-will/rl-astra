import { emptyInput, type Input } from './config';
import { ACTIONS, defaults, keyLabel, loadSettings, padLabel, STORAGE_KEY, type ActionId, type Device, type PadBinding } from './bindings';

export type MenuInput = 'up' | 'down' | 'left' | 'right' | 'accept' | 'back';
type Capture = { action: ActionId; device: Device; slot: number; axes: number[]; armed: boolean; readyAt: number };
const clamp = (n: number) => Math.max(-1, Math.min(1, n));
export class Controls {
  keys = new Set<string>();
  settings = loadSettings();
  pad: Gamepad | null = null;
  pads: Gamepad[] = [];
  preferredPad: number | null = null;
  lastDevice: Device = 'keyboard';
  error = '';
  saved = true;
  capture: Capture | null = null;
  onAction: (action: ActionId) => void = () => {};
  onActivity = () => {};
  onChange = () => {};
  onDisconnect = () => {};
  onMenu: (input: MenuInput) => void = () => {};
  onCaptured: (message: string) => void = () => {};
  private menu = false;
  private jumpQueued = false;
  private padBlocked = false;
  private previousActions = new Set<ActionId>();
  private previousButtons: number[] = [];
  private direction = '';
  private repeatAt = 0;
  constructor() {
    window.addEventListener('keydown', e => {
      if (this.capture) {
        e.preventDefault(); e.stopPropagation();
        if (e.code === 'Escape') this.cancelCapture();
        else if (!e.repeat && this.capture.device === 'keyboard' && e.code) this.finishCapture(e.code);
        return;
      }
      if (e.code === 'Escape') { e.preventDefault(); if (!e.repeat) this.onAction('pause'); return; }
      if (this.menu) {
        if (this.settings.keyboard.pause.includes(e.code)) { e.preventDefault(); if (!e.repeat) this.onAction('pause'); }
        return; // Preserve native Tab, Enter and range-key navigation in menus.
      }
      const matches = ACTIONS.filter(a => this.settings.keyboard[a.id].includes(e.code));
      if (!matches.length) return;
      e.preventDefault(); this.setDevice('keyboard'); this.keys.add(e.code);
      if (!e.repeat) {
        if (matches.some(a => a.id === 'jump')) this.jumpQueued = true;
        if (matches.some(a => a.category !== 'match')) this.onActivity();
        for (const action of matches) if (action.category === 'match') this.onAction(action.id);
      }
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.clear(); this.cancelCapture(); });
  }
  setMenuMode(menu: boolean) { if (menu !== this.menu) { this.menu = menu; this.clear(); } }
  clear() { this.keys.clear(); this.jumpQueued = false; this.padBlocked = true; }
  restoreJump() { this.jumpQueued = true; }
  private setDevice(device: Device) { if (this.lastDevice !== device) { this.lastDevice = device; this.onChange(); } }
  label(action: ActionId, device = this.lastDevice) {
    return device === 'keyboard' ? this.settings.keyboard[action].map(keyLabel).join(' / ') || 'Unbound' : this.settings.gamepad[action].map(p => padLabel(p, this.pad?.id || 'DualSense', this.pad?.mapping !== '')).join(' / ') || 'Unbound';
  }
  private padValue(binding: PadBinding, deadzone = this.settings.deadzone) {
    if (!this.pad) return 0;
    if (binding.type === 'button') return Math.max(0, Math.min(1, this.pad.buttons[binding.index]?.value || 0));
    const range = 1 - binding.rest * binding.direction;
    const value = ((this.pad.axes[binding.index] ?? binding.rest) - binding.rest) * binding.direction / Math.max(.01, range);
    return Math.max(0, Math.min(1, (value - deadzone) / (1 - deadzone)));
  }
  private value(action: ActionId) {
    const keyboard = this.settings.keyboard[action].some(key => this.keys.has(key)) ? 1 : 0;
    return Math.max(keyboard, this.padBlocked ? 0 : Math.max(0, ...this.settings.gamepad[action].map(p => this.padValue(p))));
  }
  poll(now: number) {
    const prior = this.pad;
    try { this.pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((p): p is Gamepad => !!p && p.connected) : []; this.error = typeof navigator.getGamepads === 'function' ? '' : 'This browser does not support controllers.'; }
    catch { this.pads = []; this.error = 'Controller access is blocked. Open the game directly in Chrome.'; }
    this.pad = this.pads.find(p => p.index === this.preferredPad) || this.pads.find(p => p.index === prior?.index) || this.pads[0] || null;
    if (this.pad?.index !== prior?.index || this.pad?.id !== prior?.id) {
      this.previousActions.clear(); this.previousButtons = []; this.direction = '';
      this.clear(); this.onChange();
      if (prior && !this.pads.some(p => p.index === prior.index)) this.onDisconnect();
    }
    if (document.hidden) { this.jumpQueued = false; return; }
    if (!this.pad) return;
    const buttons = this.pad.buttons.map(b => b.value);
    const down = (index: number) => (buttons[index] || 0) > .5;
    const edge = (index: number) => down(index) && (this.previousButtons[index] || 0) <= .5;
    if (this.capture) {
      this.pollCapture(now);
      this.previousButtons = buttons;
      return;
    }
    const actions = new Set(ACTIONS.filter(a => this.settings.gamepad[a.id].some(p => this.padValue(p) > .5)).map(a => a.id));
    const active = ACTIONS.some(a => this.settings.gamepad[a.id].some(p => this.padValue(p) > .1));
    if (this.padBlocked && !active && !buttons.some(v => v > .1)) this.padBlocked = false;
    if (!this.padBlocked && active) this.setDevice('gamepad');
    if (!this.padBlocked && !this.menu) {
      if (ACTIONS.some(a => a.category !== 'match' && this.settings.gamepad[a.id].some(p => this.padValue(p) > .1))) this.onActivity();
      if (actions.has('jump') && !this.previousActions.has('jump')) this.jumpQueued = true;
      for (const action of ACTIONS) if (action.category === 'match' && actions.has(action.id) && !this.previousActions.has(action.id)) {
        this.onAction(action.id);
        if (this.menu) break;
      }
    } else if (!this.padBlocked && this.menu) {
      if (actions.has('pause') && !this.previousActions.has('pause')) this.onAction('pause');
      else if (edge(0)) this.onMenu('accept');
      else if (edge(1)) this.onMenu('back');
      else {
        const axisX = this.pad.axes[0] || 0, axisY = this.pad.axes[1] || 0;
        const direction = down(12) || axisY < -.6 ? 'up' : down(13) || axisY > .6 ? 'down' : down(14) || axisX < -.6 ? 'left' : down(15) || axisX > .6 ? 'right' : '';
        if (direction && (direction !== this.direction || now >= this.repeatAt)) { this.onMenu(direction); this.repeatAt = now + (direction === this.direction ? 140 : 340); }
        this.direction = direction;
      }
    }
    this.previousActions = actions; this.previousButtons = buttons;
  }
  read(): Input {
    if (this.menu || this.capture) return emptyInput();
    const value = (action: ActionId) => this.value(action);
    const pitch = clamp((value('pitchUp') - value('pitchDown')) * this.settings.aerialSensitivity);
    const yaw = clamp((value('yawLeft') - value('yawRight')) * this.settings.aerialSensitivity);
    const directRoll = value('rollLeft') - value('rollRight'), modifier = value('airRoll') > .5;
    const dodge = Math.abs(pitch) + Math.abs(yaw) + Math.abs(directRoll) >= this.settings.dodgeDeadzone;
    const jump = this.jumpQueued; this.jumpQueued = false;
    return { ...emptyInput(), throttle: value('forward') - value('reverse'), steer: clamp((value('left') - value('right')) * this.settings.steeringSensitivity), pitch, yaw: modifier ? 0 : yaw, roll: clamp(directRoll + (modifier ? yaw : 0)), boost: value('boost') > .5, drift: value('drift') > .5, jump, jumpHeld: value('jump') > .5, dodgeForward: dodge ? -pitch : 0, dodgeSide: dodge ? clamp(yaw + directRoll) : 0 };
  }
  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); this.saved = true; } catch { this.saved = false; }
    this.onChange();
  }
  remove(action: ActionId, device: Device, slot: number) { this.settings[device][action].splice(slot, 1); this.clear(); this.save(); }
  reset(device: Device) {
    const initial = defaults(); if (device === 'keyboard') this.settings.keyboard = initial.keyboard; else this.settings.gamepad = initial.gamepad;
    if (device === 'gamepad') for (const key of ['deadzone', 'dodgeDeadzone', 'steeringSensitivity', 'aerialSensitivity'] as const) this.settings[key] = initial[key];
    this.clear(); this.save();
  }
  startCapture(action: ActionId, device: Device, slot: number) {
    this.clear(); this.capture = { action, device, slot, axes: [...(this.pad?.axes || [])], armed: false, readyAt: performance.now() + 180 };
    this.onChange();
  }
  cancelCapture() { if (this.capture) { this.capture = null; this.clear(); this.onChange(); } }
  private pollCapture(now: number) {
    const capture = this.capture!;
    if (capture.device !== 'gamepad' || !this.pad) return;
    if (!capture.armed) {
      if (this.pad.buttons.some(b => b.value > .1) || (this.pad.mapping === 'standard' && this.pad.axes.slice(0, 4).some(axis => Math.abs(axis) > .2))) { capture.readyAt = now + 180; return; }
      if (now < capture.readyAt) return;
      capture.axes = [...this.pad.axes]; capture.armed = true; this.onChange(); return;
    }
    const index = this.pad.buttons.findIndex(b => b.value > .55);
    if (index >= 0) { this.finishCapture({ type: 'button', index }); return; }
    for (let i = 0; i < this.pad.axes.length; i++) {
      const rest = Math.abs(capture.axes[i] || 0) < .2 ? 0 : capture.axes[i];
      const delta = this.pad.axes[i] - rest;
      if (Math.abs(delta) > .65) { this.finishCapture({ type: 'axis', index: i, direction: delta > 0 ? 1 : -1, rest }); return; }
    }
  }
  private finishCapture(binding: string | PadBinding) {
    const { action, device, slot } = this.capture!;
    const list = this.settings[device][action] as (string | PadBinding)[];
    const token = JSON.stringify(binding);
    if (!list.some((p, i) => i !== slot && JSON.stringify(p) === token)) list.splice(slot, slot < list.length ? 1 : 0, binding);
    const sharing = ACTIONS.filter(a => a.id !== action && this.settings[device][a.id].some(p => JSON.stringify(p) === token)).map(a => a.label);
    this.capture = null; this.clear(); this.save();
    this.onCaptured(sharing.length ? `Also assigned to ${sharing.join(', ').toLowerCase()}. Shared inputs are allowed.` : 'Binding updated.');
  }
}
