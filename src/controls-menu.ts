import { ACTIONS, keyLabel, padLabel, type ActionId, type Category, type Device } from './bindings';
import { Controls, type MenuInput } from './controls';

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export class ControlsMenu {
  root = document.createElement('div');
  visible = false;
  category: Category = 'driving';
  onClose = () => {};
  private lastPadList = '';
  private returnFocus: HTMLElement | null = null;
  constructor(public controls: Controls, parent: HTMLElement) {
    this.root.id = 'bindings-panel'; this.root.className = 'overlay'; this.root.hidden = true;
    this.root.innerHTML = `<section class="bindings-menu" role="dialog" aria-modal="true" aria-labelledby="bindings-title">
      <header class="bindings-header"><div><span class="eyebrow">OPTIONS / YOUR SETUP</span><h2 id="bindings-title">TAKE CONTROL.</h2><p>Make every input your own. Changes save automatically.</p></div><button class="bindings-close" aria-label="Close controls settings">DONE <span>↗</span></button></header>
      <div class="controller-status"><span class="connection-dot"></span><div><strong id="controller-name">Connect your controller</strong><p id="controller-hint">Connect with USB or Bluetooth, then press a button with this tab focused.</p></div><select id="controller-select" aria-label="Active controller" hidden></select><span class="controller-badge">DUALSENSE READY</span></div>
      <nav class="binding-tabs" aria-label="Control categories"><button data-category="driving" aria-pressed="true">01 <span>DRIVING</span></button><button data-category="aerial" aria-pressed="false">02 <span>AERIAL</span></button><button data-category="match" aria-pressed="false">03 <span>MATCH & MENU</span></button></nav>
      <div class="binding-scroll"><div class="binding-columns"><span>ACTION</span><span>KEYBOARD</span><span>CONTROLLER</span></div><div id="binding-rows"></div>
      <div class="controller-tuning"><div class="tuning-title"><h3>FINE TUNE</h3><span>Deadzone ignores small stick movements.</span></div><div class="tuning-grid">
      ${([['deadzone', 'Stick deadzone', .03, .4, .01], ['dodgeDeadzone', 'Dodge deadzone', .1, .95, .01], ['steeringSensitivity', 'Steering sensitivity', .5, 2, .05], ['aerialSensitivity', 'Aerial sensitivity', .5, 2, .05]] as const).map(([key, name, min, max, step]) => `<label><span>${name}<output id="value-${key}"></output></span><input type="range" data-setting="${key}" min="${min}" max="${max}" step="${step}" aria-label="${name}"></label>`).join('')}
      </div></div></div>
      <div class="input-monitor"><span>LIVE INPUT</span><div class="stick-monitor" aria-hidden="true"><i id="stick-dot"></i></div><div id="live-input" role="status">Waiting for a controller</div></div>
      <footer class="bindings-footer"><div><span id="binding-save" role="status">SAVED ON THIS BROWSER</span><p>Click a binding to replace it. + adds one. × removes it. Esc always goes back.</p></div><div class="reset-bindings"><button data-reset="keyboard">Reset keyboard</button><button data-reset="gamepad">Reset controller</button></div></footer>
      <p class="binding-notice" id="binding-notice" aria-live="polite"></p>
      <div class="capture-overlay" hidden><div class="capture-card" role="alertdialog" aria-modal="true" aria-labelledby="capture-title"><span class="eyebrow" id="capture-action"></span><h3 id="capture-title"></h3><p id="capture-description"></p><div class="capture-pulse"><span></span><span></span><span></span></div><button class="primary-button" id="cancel-binding">CANCEL <kbd>Esc</kbd></button></div></div>
    </section>`;
    parent.append(this.root);
    this.root.querySelector('.bindings-close')!.addEventListener('click', () => this.onClose());
    this.root.querySelector('#cancel-binding')!.addEventListener('click', () => controls.cancelCapture());
    this.root.addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!target) return;
      if (target.dataset.category) { this.category = target.dataset.category as Category; this.render(); }
      if (target.dataset.reset) { controls.reset(target.dataset.reset as Device); this.notice('Default layout restored.'); }
      if (target.dataset.bind) { this.returnFocus = target; controls.startCapture(target.dataset.bind as ActionId, target.dataset.device as Device, Number(target.dataset.slot)); }
      if (target.dataset.remove) controls.remove(target.dataset.remove as ActionId, target.dataset.device as Device, Number(target.dataset.slot));
    });
    this.root.addEventListener('input', event => {
      const input = event.target as HTMLInputElement;
      const key = input.dataset.setting as 'deadzone' | 'dodgeDeadzone' | 'steeringSensitivity' | 'aerialSensitivity';
      if (key) { controls.settings[key] = Number(input.value); controls.save(); }
    });
    this.root.querySelector('#controller-select')!.addEventListener('change', event => { controls.preferredPad = Number((event.target as HTMLSelectElement).value); controls.clear(); });
    // Keep keyboard focus inside the active dialog, including the capture prompt.
    this.root.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const elements = this.focusable(), i = elements.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && i <= 0) { event.preventDefault(); elements.at(-1)?.focus(); }
      else if (!event.shiftKey && (i < 0 || i === elements.length - 1)) { event.preventDefault(); elements[0]?.focus(); }
    });
    controls.onCaptured = message => this.notice(message);
  }
  private notice(message: string) { this.root.querySelector('#binding-notice')!.textContent = message; }
  open() { this.visible = true; this.root.hidden = false; this.render(); this.update(); this.root.querySelector<HTMLButtonElement>('[data-category="driving"]')!.focus(); }
  close() { this.controls.cancelCapture(); this.visible = false; this.root.hidden = true; }
  render() {
    if (!this.visible) return;
    const controls = this.controls;
    const focus = document.activeElement as HTMLElement | null;
    const focusData = focus?.dataset;
    this.root.querySelectorAll<HTMLButtonElement>('[data-category]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.category === this.category)));
    this.root.querySelector('#binding-rows')!.innerHTML = ACTIONS.filter(a => a.category === this.category).map(action => `<div class="binding-row"><div class="binding-name">${action.label}</div>${(['keyboard', 'gamepad'] as const).map(device => {
      const list = controls.settings[device][action.id];
      return `<div class="binding-cell" data-device="${device}"><span class="mobile-device">${device === 'keyboard' ? 'KEYBOARD' : 'CONTROLLER'}</span>${list.map((binding, i) => {
        const label = typeof binding === 'string' ? keyLabel(binding) : padLabel(binding, controls.pad?.id || 'DualSense', controls.pad?.mapping !== '');
        return `<span class="binding-chip"><button data-bind="${action.id}" data-device="${device}" data-slot="${i}" aria-label="Change ${device} ${action.label}: ${escape(label)}">${escape(label)}</button><button class="remove-binding" data-remove="${action.id}" data-device="${device}" data-slot="${i}" aria-label="Remove ${escape(label)} from ${device} ${action.label}">×</button></span>`;
      }).join('')}${list.length < 4 ? `<button class="add-binding" data-bind="${action.id}" data-device="${device}" data-slot="${list.length}" aria-label="Add ${device} binding for ${action.label}">${list.length ? '+' : '+ Bind'}</button>` : ''}</div>`;
    }).join('')}</div>`).join('');
    for (const input of Array.from(this.root.querySelectorAll<HTMLInputElement>('[data-setting]'))) {
      const key = input.dataset.setting as 'deadzone'; input.value = String(controls.settings[key]);
      this.root.querySelector(`#value-${key}`)!.textContent = controls.settings[key].toFixed(2);
    }
    this.root.querySelector('#binding-save')!.textContent = controls.saved ? 'SAVED ON THIS BROWSER' : 'ACTIVE · BROWSER STORAGE UNAVAILABLE';
    const overlay = this.root.querySelector<HTMLElement>('.capture-overlay')!;
    const wasCapturing = !overlay.hidden; overlay.hidden = !controls.capture;
    if (controls.capture) {
      const capture = controls.capture;
      this.root.querySelector('#capture-action')!.textContent = `${capture.device === 'keyboard' ? 'KEYBOARD' : 'CONTROLLER'} / ${ACTIONS.find(a => a.id === capture.action)!.label}`;
      this.root.querySelector('#capture-title')!.textContent = capture.device === 'keyboard' ? 'PRESS A KEY.' : !controls.pad ? 'CONNECT YOUR CONTROLLER.' : capture.armed ? 'MAKE YOUR MOVE.' : 'RELEASE THE CONTROLS.';
      this.root.querySelector('#capture-description')!.textContent = capture.device === 'keyboard' ? 'Press the key you want to use for this action.' : !controls.pad ? 'Connect with USB or Bluetooth, focus this tab, and press a controller button.' : capture.armed ? 'Press a button, squeeze a trigger, or move a stick in the direction you want to bind.' : 'Let go of the buttons and center the sticks to begin.';
      if (!wasCapturing) this.root.querySelector<HTMLButtonElement>('#cancel-binding')!.focus();
    } else if (wasCapturing && this.returnFocus) {
      const d = this.returnFocus.dataset;
      this.root.querySelector<HTMLElement>(`[data-bind="${d.bind}"][data-device="${d.device}"][data-slot="${d.slot}"]`)?.focus();
    } else if (focusData?.bind || focusData?.remove) {
      const attr = focusData.bind ? 'bind' : 'remove';
      this.root.querySelector<HTMLElement>(`[data-${attr}="${focusData[attr]}"][data-device="${focusData.device}"][data-slot="${focusData.slot}"]`)?.focus();
    }
  }
  update() {
    if (!this.visible) return;
    const { pad, pads, error } = this.controls;
    this.root.querySelector('.controller-status')!.classList.toggle('connected', !!pad);
    this.root.querySelector('#controller-name')!.textContent = error || pad?.id || 'Connect your controller';
    this.root.querySelector('#controller-hint')!.textContent = pad ? pad.mapping === 'standard' ? 'Connected · standard layout · USB and Bluetooth supported' : 'Connected · custom layout · bind the buttons and axes below' : 'Connect with USB or Bluetooth, then press a button with this tab focused.';
    this.root.querySelector('.controller-badge')!.textContent = pad ? 'CONNECTED' : 'DUALSENSE READY';
    const signature = pads.map(p => `${p.index}:${p.id}`).join('|');
    const select = this.root.querySelector<HTMLSelectElement>('#controller-select')!;
    if (signature !== this.lastPadList) { select.innerHTML = pads.map(p => `<option value="${p.index}">${escape(p.id)}</option>`).join(''); this.lastPadList = signature; }
    select.hidden = pads.length < 2; if (pad) select.value = String(pad.index);
    const buttons = pad?.buttons.flatMap((button, index) => button.value > .05 ? [`${padLabel({ type: 'button', index }, pad.id, pad.mapping === 'standard')} ${Math.round(button.value * 100)}%`] : []) || [];
    const axes = pad?.axes.flatMap((axis, index) => Math.abs(axis) > .08 ? [`Axis ${index}: ${axis.toFixed(2)}`] : []) || [];
    this.root.querySelector('#live-input')!.textContent = pad ? [...buttons, ...axes].join(' · ') || 'Controller connected · move a stick or press a button' : 'Waiting for a controller';
    this.root.querySelector<HTMLElement>('#stick-dot')!.style.transform = `translate(${(pad?.axes[0] || 0) * 11}px, ${(pad?.axes[1] || 0) * 11}px)`;
  }
  private focusable() {
    const scope = this.controls.capture ? this.root.querySelector('.capture-overlay')! : this.root;
    return Array.from(scope.querySelectorAll<HTMLElement>('button, input, select')).filter(e => e.getClientRects().length && !(e as HTMLButtonElement).disabled);
  }
  navigate(input: MenuInput) { navigateMenu(this.focusable(), input); }
}
export function navigateMenu(elements: HTMLElement[], input: MenuInput) {
  const current = document.activeElement as HTMLElement, index = elements.indexOf(current);
  if (input === 'accept') { if (index >= 0) current.click(); else elements[0]?.focus(); return; }
  if ((input === 'left' || input === 'right') && current instanceof HTMLInputElement && current.type === 'range') {
    if (input === 'left') current.stepDown(); else current.stepUp(); current.dispatchEvent(new Event('input', { bubbles: true })); return;
  }
  if ((input === 'left' || input === 'right') && current instanceof HTMLSelectElement) {
    current.selectedIndex = Math.max(0, Math.min(current.options.length - 1, current.selectedIndex + (input === 'left' ? -1 : 1))); current.dispatchEvent(new Event('change', { bubbles: true })); return;
  }
  const next = elements[(index + (input === 'up' || input === 'left' ? -1 : 1) + elements.length) % elements.length];
  next?.focus(); next?.scrollIntoView({ block: 'nearest' });
}
