import { CAMERA_DEFAULTS, CAMERA_RANGES, type CameraSettings } from './camera-settings';
import { navigateMenu } from './controls-menu';
import type { MenuInput } from './controls';
import type { GameRenderer, QualityLevel, BoostStyle } from './render';
import './visual-settings.css';

export class VisualSettings {
  root = document.createElement('div');
  visible = false;
  onClose = () => {};
  onChange = () => {};
  constructor(private view: GameRenderer, parent: HTMLElement) {
    this.root.id = 'visual-settings'; this.root.className = 'visual-overlay'; this.root.hidden = true;
    const labels = { fov: ['Field of view', 'Narrow', 'Wide'], height: ['Camera height', 'Low', 'High'], distance: ['Camera distance', 'Close', 'Far'], angle: ['Downward angle', 'Level', 'Overhead'] };
    this.root.innerHTML = `<section class="visual-menu" role="dialog" aria-modal="true" aria-labelledby="visual-title">
      <header><span class="eyebrow">OPTIONS / YOUR PERSPECTIVE</span><h2 id="visual-title">MAKE IT YOURS.</h2><p>Adjust your view. See each change on the field.</p></header>
      <div class="visual-scroll"><div class="visual-section-title"><h3>CAMERA</h3><button id="preview-camera">PREVIEW CAR CAM</button></div>
      ${(Object.keys(CAMERA_DEFAULTS) as (keyof CameraSettings)[]).map(key => { const [min, max, step] = CAMERA_RANGES[key], [label, low, high] = labels[key]; return `<label class="camera-setting"><span>${label}<output id="camera-${key}-value"></output></span><input id="camera-${key}" aria-label="${label}" data-camera="${key}" type="range" min="${min}" max="${max}" step="${step}"><small><span>${low}</span><span>${high}</span></small></label>`; }).join('')}
      <p class="visual-description">Ball cam adjusts your angle to keep the ball in view.</p><button class="visual-reset" id="reset-camera">Reset camera defaults</button>
      <div class="visual-section-title"><h3>LOOK & FEEL</h3></div>
      <label class="visual-select">Visual quality<select id="visual-quality"><option value="performance">Performance</option><option value="high">High</option><option value="ultra">Ultra</option></select></label><p class="visual-description" id="quality-description"></p>
      <label class="visual-select">Boost style<select id="boost-style"><option value="classic">Classic · orange afterburner</option><option value="inferno">Inferno · colored smoke</option></select></label><p class="visual-description">Classic's focused jet or Inferno's multicolored smoke plume.</p></div>
      <footer><span id="visual-save" role="status">SAVED ON THIS BROWSER</span><button id="close-visuals">DONE <span>↗</span></button></footer>
    </section>`;
    parent.append(this.root);
    this.root.querySelector('#close-visuals')!.addEventListener('click', () => this.onClose());
    this.root.querySelector('#reset-camera')!.addEventListener('click', () => { Object.assign(view.followCamera.settings, CAMERA_DEFAULTS); this.saveCamera(); this.render(); });
    this.root.querySelector('#preview-camera')!.addEventListener('click', () => { view.ballCam = !view.ballCam; view.cameraReady = false; this.render(); this.onChange(); });
    this.root.addEventListener('input', event => {
      const input = event.target as HTMLInputElement, key = input.dataset.camera as keyof CameraSettings;
      if (!key) return;
      view.followCamera.settings[key] = Number(input.value); this.saveCamera(); this.render();
    });
    this.root.querySelector('#visual-quality')!.addEventListener('change', event => {
      view.setQuality((event.target as HTMLSelectElement).value as QualityLevel); this.render(); this.onChange();
    });
    this.root.querySelector('#boost-style')!.addEventListener('change', event => {
      view.setBoostStyle((event.target as HTMLSelectElement).value as BoostStyle); this.render();
    });
    this.root.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const items = this.focusable(), index = items.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && (index < 0 || index === items.length - 1)) { event.preventDefault(); items[0]?.focus(); }
    });
  }
  private saveCamera() {
    this.view.cameraReady = false;
    try { localStorage.setItem('champions-field.camera', JSON.stringify(this.view.followCamera.settings)); }
    catch { this.root.querySelector('#visual-save')!.textContent = 'APPLIED FOR THIS SESSION'; }
  }
  render() {
    for (const key of Object.keys(CAMERA_DEFAULTS) as (keyof CameraSettings)[]) {
      const value = this.view.followCamera.settings[key];
      this.root.querySelector<HTMLInputElement>(`#camera-${key}`)!.value = String(value);
      this.root.querySelector(`#camera-${key}-value`)!.textContent = key === 'fov' || key === 'angle' ? `${value}°` : value.toFixed(2);
    }
    this.root.querySelector<HTMLSelectElement>('#visual-quality')!.value = this.view.qualityLevel;
    this.root.querySelector<HTMLSelectElement>('#boost-style')!.value = this.view.boostStyle;
    this.root.querySelector('#preview-camera')!.textContent = this.view.ballCam ? 'PREVIEW CAR CAM' : 'PREVIEW BALL CAM';
    this.root.querySelector('#quality-description')!.textContent = {
      performance: 'Clean lighting and textured turf. Built for a fast, responsive game.',
      high: 'Sharper rendering with soft bloom around stadium lights and boost.',
      ultra: 'Dense grass blades, golden-hour light, richer reflections and sharper shadows. Best on a capable GPU.',
    }[this.view.qualityLevel];
  }
  open() { this.visible = true; this.root.hidden = false; this.render(); this.root.querySelector<HTMLInputElement>('#camera-fov')!.focus(); }
  close() { this.visible = false; this.root.hidden = true; }
  private focusable() { return Array.from(this.root.querySelectorAll<HTMLElement>('button,input,select')).filter(el => el.getClientRects().length); }
  navigate(input: MenuInput) { navigateMenu(this.focusable(), input); }
}
