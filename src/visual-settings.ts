import { CAMERA_DEFAULTS, CAMERA_RANGES, type CameraSettings } from './camera-settings';
import { navigateMenu } from './controls-menu';
import type { MenuInput } from './controls';
import type { GameRenderer, QualityLevel, BoostStyle } from './render';
import type { HUD, TextStyle } from './hud';
import { PAINT_JOBS, type PaintJob } from './car-paint';
import './visual-settings.css';

export class VisualSettings {
  root = document.createElement('div');
  visible = false;
  onClose = () => {};
  onChange = () => {};
  constructor(private view: GameRenderer, private hud: HUD) {
    this.root.id = 'visual-settings'; this.root.className = 'visual-overlay'; this.root.hidden = true;
    const labels = { fov: ['Field of view', 'Narrow', 'Wide'], height: ['Camera height', 'Low', 'High'], distance: ['Camera distance', 'Close', 'Far'], angle: ['Downward angle', 'Level', 'Overhead'] };
    this.root.innerHTML = `<section class="visual-menu" role="dialog" aria-modal="true" aria-labelledby="visual-title">
      <header><span class="eyebrow">OPTIONS / YOUR PERSPECTIVE</span><h2 id="visual-title">MAKE IT YOURS.</h2><p>Adjust your view. See each change on the field.</p></header>
      <div class="visual-scroll">
      <div class="visual-section-title paint-title"><h3>CAR PAINT</h3><button id="preview-paint">PREVIEW PAINT</button></div>
      <label class="visual-select">Paint design<select id="paint-job">${PAINT_JOBS.map(job => `<option value="${job.id}">${job.name}${job.id === 'ultraviolet' ? ' · animated' : ''}</option>`).join('')}</select></label>
      <div class="paint-swatches" role="group" aria-label="Paint designs">${PAINT_JOBS.map(job => `<button class="paint-swatch paint-${job.id}" data-paint="${job.id}" aria-label="${job.name}" title="${job.name}" style="--paint:${job.color};--accent:${job.accent}"><span></span></button>`).join('')}</div><p class="visual-description" id="paint-description"></p><div class="paint-angles" role="group" aria-label="Paint preview angle" hidden>${(['front', 'side', 'rear'] as const).map(angle => `<button data-paint-angle="${angle}">${angle.toUpperCase()}</button>`).join('')}</div>
      <div class="visual-section-title"><h3>CAMERA</h3><button id="preview-camera">PREVIEW CAR CAM</button></div>
      ${(Object.keys(CAMERA_DEFAULTS) as (keyof CameraSettings)[]).map(key => { const [min, max, step] = CAMERA_RANGES[key], [label, low, high] = labels[key]; return `<label class="camera-setting"><span>${label}<output id="camera-${key}-value"></output></span><input id="camera-${key}" aria-label="${label}" data-camera="${key}" type="range" min="${min}" max="${max}" step="${step}"><small><span>${low}</span><span>${high}</span></small></label>`; }).join('')}
      <p class="visual-description">Ball cam adjusts your angle to keep the ball in view.</p><button class="visual-reset" id="reset-camera">Reset camera defaults</button>
      <div class="visual-section-title"><h3>LOOK & FEEL</h3></div>
      <label class="visual-select">On-screen text<select id="text-style"><option value="original">Original</option><option value="cartoon">Cartoon</option></select></label><p class="visual-description">Original's thin gold lettering and goal award, or Cartoon's bold comic announcements.</p>
      <label class="visual-select">Visual quality<select id="visual-quality"><option value="performance">Performance</option><option value="high">High</option><option value="ultra">Ultra</option></select></label><p class="visual-description" id="quality-description"></p>
      <label class="visual-select">Motion blur<select id="motion-blur"><option value="on">Cinematic</option><option value="off">Off</option></select></label><p class="visual-description">Smooth camera motion with a sharper car and ball. Active in High and Ultra; pauses with the game.</p>
      <label class="visual-select">Boost style<select id="boost-style"><option value="classic">Classic · orange afterburner</option><option value="inferno">Inferno · colored smoke</option></select></label><p class="visual-description">Classic's focused jet or Inferno's multicolored smoke plume.</p></div>
      <footer><span id="visual-save" role="status">SAVED ON THIS BROWSER</span><button id="close-visuals">DONE <span>↗</span></button></footer>
    </section>`;
    hud.root.append(this.root);
    this.root.querySelector('#close-visuals')!.addEventListener('click', () => this.onClose());
    this.root.querySelector('#reset-camera')!.addEventListener('click', () => { view.paintPreview = false; Object.assign(view.followCamera.settings, CAMERA_DEFAULTS); this.saveCamera(); this.render(); });
    this.root.querySelector('#preview-camera')!.addEventListener('click', () => { view.paintPreview = false; view.ballCam = !view.ballCam; view.cameraReady = false; this.render(); this.onChange(); });
    this.root.querySelector('#preview-paint')!.addEventListener('click', () => { view.paintPreview = !view.paintPreview; view.cameraReady = false; this.render(); });
    this.root.querySelectorAll<HTMLButtonElement>('[data-paint-angle]').forEach(button => button.addEventListener('click', () => { view.paintPreviewAngle = button.dataset.paintAngle as typeof view.paintPreviewAngle; this.render(); }));
    this.root.querySelector('#paint-job')!.addEventListener('change', event => this.selectPaint((event.target as HTMLSelectElement).value as PaintJob));
    this.root.querySelectorAll<HTMLButtonElement>('[data-paint]').forEach(button => button.addEventListener('click', () => this.selectPaint(button.dataset.paint as PaintJob)));
    this.root.addEventListener('input', event => {
      const input = event.target as HTMLInputElement, key = input.dataset.camera as keyof CameraSettings;
      if (!key) return;
      view.paintPreview = false;
      view.followCamera.settings[key] = Number(input.value); this.saveCamera(); this.render();
    });
    this.root.querySelector('#visual-quality')!.addEventListener('change', event => {
      view.setQuality((event.target as HTMLSelectElement).value as QualityLevel); this.render(); this.onChange();
    });
    this.root.querySelector('#boost-style')!.addEventListener('change', event => {
      view.setBoostStyle((event.target as HTMLSelectElement).value as BoostStyle); this.render();
    });
    this.root.querySelector('#motion-blur')!.addEventListener('change', event => {
      view.setMotionBlur((event.target as HTMLSelectElement).value === 'on'); this.render();
    });
    this.root.querySelector('#text-style')!.addEventListener('change', event => {
      const saved = hud.setTextStyle((event.target as HTMLSelectElement).value as TextStyle);
      this.root.querySelector('#visual-save')!.textContent = saved ? 'SAVED ON THIS BROWSER' : 'APPLIED FOR THIS SESSION';
      this.render();
    });
    this.root.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const items = this.focusable(), index = items.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && (index < 0 || index === items.length - 1)) { event.preventDefault(); items[0]?.focus(); }
    });
  }
  private selectPaint(paint: PaintJob) {
    const saved = this.view.setPaintJob(paint); this.view.paintPreview = true; this.view.cameraReady = false;
    this.root.querySelector('#visual-save')!.textContent = saved ? 'SAVED ON THIS BROWSER' : 'APPLIED FOR THIS SESSION';
    this.render();
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
    this.root.querySelector<HTMLSelectElement>('#motion-blur')!.value = this.view.motionBlur ? 'on' : 'off';
    this.root.querySelector<HTMLSelectElement>('#boost-style')!.value = this.view.boostStyle;
    this.root.querySelector<HTMLSelectElement>('#text-style')!.value = this.hud.textStyle;
    this.root.querySelector<HTMLSelectElement>('#paint-job')!.value = this.view.paintJob;
    this.root.querySelector('#paint-description')!.textContent = PAINT_JOBS.find(job => job.id === this.view.paintJob)!.description;
    this.root.dataset.paintPreview = String(this.view.paintPreview);
    this.root.querySelector<HTMLElement>('.paint-angles')!.hidden = !this.view.paintPreview;
    this.root.querySelectorAll<HTMLButtonElement>('[data-paint-angle]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.paintAngle === this.view.paintPreviewAngle)));
    this.root.querySelector('#preview-paint')!.textContent = this.view.paintPreview ? 'BACK TO GAME VIEW' : 'PREVIEW PAINT';
    this.root.querySelectorAll<HTMLButtonElement>('[data-paint]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.paint === this.view.paintJob)));
    this.root.querySelector('#preview-camera')!.textContent = this.view.ballCam ? 'PREVIEW CAR CAM' : 'PREVIEW BALL CAM';
    this.root.querySelector('#quality-description')!.textContent = {
      performance: 'Rich night lighting, cinematic color and textured turf. Built for a fast, responsive game.',
      high: 'Cinematic night lighting, smooth motion and soft bloom around stadium lights and boost.',
      ultra: 'Deep dusk skies, wind-swept grass, contact shading, detailed shadows and cinematic motion. Stadium lights and glowing engine cores stand out against the darker field.',
    }[this.view.qualityLevel];
  }
  open() { this.visible = true; this.root.hidden = false; this.render(); this.root.querySelector<HTMLSelectElement>('#paint-job')!.focus(); }
  close() { this.visible = false; this.root.hidden = true; this.view.paintPreview = false; this.view.cameraReady = false; }
  private focusable() { return Array.from(this.root.querySelectorAll<HTMLElement>('button,input,select')).filter(el => el.getClientRects().length); }
  navigate(input: MenuInput) { navigateMenu(this.focusable(), input); }
}
