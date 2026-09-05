import type { Controls } from './controls';
import type { ActionId } from './bindings';
import { BoostGauge } from './boost-gauge';
import { scoreNumerals } from './score-numerals';
const icons = {
  pause: '<path d="M8 5v14M16 5v14"/>',
  sound: '<path d="M11 5 6 9H3v6h3l5 4zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.5 2.5 0 1 1 3 3.5l-.5 2M12 17h.01"/>',
  arrow: '<path d="m8 5 7 7-7 7"/>',
};
const icon = (name: keyof typeof icons) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const shield = '<svg viewBox="0 0 50 57" fill="none" aria-hidden="true"><path d="M3 3h44v28L25 53 3 31z" fill="#107dde" stroke="#b2dfff" stroke-width="2"/><path d="m10 32 5-12h22l5 12v8h-7v-5H18v5h-8zm8-8-3 8h22l-3-8z" fill="white"/><circle cx="32" cy="13" r="6" fill="white"/></svg>';
export class HUD {
  root: HTMLElement;
  onAction: (action: string) => void = () => {};
  messageUntil = 0;
  private boostGauge: BoostGauge;
  private scoreAnimations = new Map<string, Animation[]>();
  constructor() {
    this.root = document.createElement('main'); this.root.id = 'hud'; document.querySelector('#app')!.append(this.root);
    this.root.innerHTML = `
      <div class="vignette"></div>
      <header class="identity">${shield}<div class="wordmark">ROCKET<br>LEAGUE</div><span class="identity-divider"></span><div class="venue"><span class="eyebrow">THE HOME OF CHAMPIONS</span><strong>CHAMPIONS FIELD</strong><span class="venue-sub"><i></i> <span id="lighting-label">NIGHT</span> <span>·</span> LOCAL MATCH</span></div></header>
      <div class="scoreboard" aria-label="Match scoreboard"><div class="scoreboard-main"><div class="team team-blue"><strong id="blue-score">${scoreNumerals('0')}</strong><span class="team-label">YOU</span><i class="score-sheen"></i></div><div class="clock"><span id="match-type">EXHIBITION · 1V1</span><strong id="timer">${scoreNumerals('5:00')}</strong><b class="practice-label">FREE PLAY</b></div><div class="team team-orange"><strong id="orange-score">${scoreNumerals('0')}</strong><span class="team-label">MAVERICK</span><i class="score-sheen"></i></div></div><i id="overtime">OVERTIME</i></div>
      <nav class="top-actions" aria-label="Game settings"><span class="live-label"><i></i> LOCAL PLAY</span><button data-action="sound" aria-label="Toggle sound" title="Toggle sound (M)">${icon('sound')}</button><button data-action="fullscreen" aria-label="Fullscreen" title="Fullscreen (F)">${icon('expand')}</button><button data-action="pause" aria-label="Pause game" title="Pause (Esc)">${icon('pause')}</button></nav>
      <div id="center-message" class="center-message ready"><span id="message-kicker">THE STAGE IS YOURS</span><h1 id="message-title" data-text="MAKE YOUR PLAY."><span class="comic-face">MAKE YOUR PLAY.</span></h1><p id="message-sub"><kbd>W</kbd> DRIVE TO KICK OFF</p></div>
      <div id="event-toast" class="event-toast" aria-live="polite"></div>
      <div id="goal-flash"></div>
      <div id="bot-name" class="player-label orange">MAVERICK <span>▾</span></div>
      <div class="bottom-left"><div class="player-card"><span class="player-avatar">01</span><div><strong>YOU<span class="team-tag">BLUE</span></strong><span id="player-status">OCTANE · READY TO PLAY</span></div></div><button class="camera-button" data-action="camera"><span class="camera-indicator" id="camera-indicator"></span><strong>BALL CAM</strong><span id="camera-status">OFF</span><kbd data-hint="camera">C</kbd></button><button class="ball-cam-corner" data-action="camera" aria-label="Toggle ball camera" hidden><span class="ball-cam-title"><i></i>BALL CAM</span><small>PRESS <kbd id="ball-cam-key" data-hint="camera">C</kbd> TO TOGGLE</small></button><span class="camera-hint">KEEP YOUR EYES ON THE PLAY</span></div>
      <div class="controls-strip"><div><kbd data-hint="forward">W</kbd><span>DRIVE</span></div><div><kbd data-hint="jump">SPACE</kbd><span>JUMP / FLIP</span></div><div><kbd data-hint="boost">SHIFT</kbd><span>BOOST</span></div><div><kbd data-hint="unlimited">B</kbd><span id="infinite-label">UNLIMITED</span></div><button data-action="help" aria-label="Show all controls">${icon('help')}</button></div>
      <div class="boost-hud"></div>
      <div class="session-footer"><span>CHAMPIONS FIELD</span><span>EXHIBITION</span><span id="fps">60 FPS</span></div>
      <div id="pause-panel" class="overlay" hidden><section class="menu"><span class="eyebrow">CHAMPIONS FIELD / LOCAL PLAY</span><h2 id="pause-title">TIME OUT.</h2><p id="pause-description">Take a breath. The field will be here.</p><button class="primary-button" data-action="resume">BACK TO THE FIELD ${icon('arrow')}</button><div class="menu-options"><button data-action="bindings">CONTROLS & BINDINGS <span>KEYBOARD / CONTROLLER</span></button><button data-action="visuals">CAMERA & VISUALS <span>YOUR PERSPECTIVE</span></button><button data-action="restart">RESTART MATCH <span>↻</span></button><button data-action="mode">GAME MODE <span id="mode-value">1V1 · MAVERICK</span></button><button data-action="unlimited">UNLIMITED BOOST <span id="unlimited-value">OFF</span></button><button data-action="quality">VISUAL QUALITY <span id="quality-value">PERFORMANCE</span></button><button data-action="sound">SOUND <span id="sound-value">ON</span></button></div><button class="text-button" data-action="help">VIEW CONTROLS <kbd>H</kbd></button><div class="menu-footnote">BUILT FOR THE LOVE OF THE GAME.</div></section></div>
      <div id="help-panel" class="overlay" hidden><section class="menu help-menu"><span class="eyebrow">A LITTLE CONTROL GOES A LONG WAY</span><h2>OWN THE FIELD.</h2><div class="control-list"><div><span>Drive / steer</span><kbd>W A S D / ↑ ← ↓ →</kbd></div><div><span>Jump · hold for height</span><kbd>SPACE</kbd></div><div><span>Double jump / directional flip</span><kbd>SPACE × 2</kbd></div><div><span>Rocket boost</span><kbd>SHIFT</kbd></div><div><span>Air pitch / yaw</span><kbd>W S / A D</kbd></div><div><span>Air roll left / right</span><kbd>Q / E</kbd></div><div><span>E-brake / powerslide</span><kbd>CTRL / PGDN</kbd></div><div><span>Ball camera</span><kbd>C</kbd></div><div><span>Unlimited boost</span><kbd>B</kbd></div><div><span>Reset car</span><kbd>R</kbd></div><div><span>Pause / sound / fullscreen</span><kbd>ESC / M / F</kbd></div></div><p class="tip">Land your wheels on the ball to recover your flip. Pick up small pads for 12 boost, or gold orbs for a full tank.</p><button class="text-button" data-action="bindings">CUSTOMIZE KEYBOARD & CONTROLLER →</button><br><button class="primary-button" data-action="close-help">LET'S PLAY ${icon('arrow')}</button></section></div>
      <div id="loading"><div class="loading-mark">${shield}</div><strong>LIGHTING UP THE FIELD</strong><span>Starting the physics engine…</span><div class="loading-line"></div></div>
    `;
    this.boostGauge = new BoostGauge(this.root.querySelector('.boost-hud')!);
    this.root.addEventListener('click', e => { const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]'); if (button) { button.blur(); this.onAction(button.dataset.action!); } });
  }
  bindings(controls: Controls) {
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>('[data-hint]'))) el.textContent = controls.label(el.dataset.hint as ActionId).split(' / ')[0];
    const cameraKey = this.el('ball-cam-key'), triangle = cameraKey.textContent === 'Triangle';
    cameraKey.classList.toggle('is-playstation', triangle); if (triangle) cameraKey.textContent = '△';
    for (const id of ['pause', 'sound', 'fullscreen'] as const) this.root.querySelector<HTMLElement>(`.top-actions [data-action="${id}"]`)!.title = `${id.toUpperCase()} (${controls.label(id)})`;
    const rows: [string, ActionId[]][] = [
      ['Drive / steer', ['forward', 'reverse', 'left', 'right']], ['Jump · hold for height / recover', ['jump']],
      ['Rocket boost', ['boost']], ['Air pitch / yaw', ['pitchDown', 'pitchUp', 'yawLeft', 'yawRight']],
      ['Air roll left / right', ['rollLeft', 'rollRight']], ['Air roll modifier', ['airRoll']],
      ['E-brake / powerslide', ['drift']], ['Ball camera', ['camera']], ['Unlimited boost', ['unlimited']], ['Reset car', ['reset']], ['Restart match', ['restart']], ['Toggle practice', ['mode']], ['Pause / sound / fullscreen', ['pause', 'sound', 'fullscreen']],
    ];
    const list = this.root.querySelector('.control-list')!; list.replaceChildren();
    for (const [name, ids] of rows) {
      const row = document.createElement('div'), label = document.createElement('span'), key = document.createElement('kbd');
      label.textContent = name; key.textContent = ids.map(id => controls.label(id)).join(' · '); row.append(label, key); list.append(row);
    }
    if (this.el('center-message').classList.contains('ready')) {
      const sub = this.el('message-sub'), key = document.createElement('kbd'); key.textContent = controls.label('forward').split(' / ')[0]; sub.replaceChildren(key, document.createTextNode(' DRIVE TO KICK OFF'));
    }
  }
  el(id: string) { return document.getElementById(id)!; }
  set(id: string, value: string | number) {
    const el = this.el(id), text = String(value);
    if (id === 'message-title' || id === 'event-toast') {
      let face = el.querySelector<HTMLElement>('.comic-face');
      if (!face) { face = document.createElement('span'); face.className = 'comic-face'; el.replaceChildren(face); }
      if (face.textContent !== text) face.textContent = text;
      el.dataset.text = text;
    } else if (el.textContent !== text) {
      const scored = (id === 'blue-score' || id === 'orange-score') && Number(text) > Number(el.textContent);
      if (id === 'blue-score' || id === 'orange-score' || id === 'timer') el.innerHTML = scoreNumerals(text);
      else el.textContent = text;
      if (scored && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.scoreAnimations.get(id)?.forEach(a => a.cancel());
        this.scoreAnimations.set(id, [
          el.animate([{ transform: 'translateY(6px) scale(.75)', opacity: .35 }, { transform: 'translateY(-2px) scale(1.13)', opacity: 1, offset: .45 }, { transform: 'none', opacity: 1 }], { duration: 440, easing: 'cubic-bezier(.16,1,.3,1)' }),
          el.parentElement!.querySelector('.score-sheen')!.animate([{ transform: 'translateX(-65%)', opacity: 0 }, { opacity: .65, offset: .2 }, { transform: 'translateX(65%)', opacity: 0 }], { duration: 650, easing: 'ease-out' }),
        ]);
      }
    }
  }
  ready() { this.el('loading').remove(); }
  message(title: string, kicker = '', sub = '', style = '') {
    const el = this.el('center-message'); el.className = `center-message ${style}`; el.hidden = !title;
    this.set('message-title', title); this.set('message-kicker', kicker); this.el('message-sub').innerHTML = sub;
    if (title && !matchMedia('(prefers-reduced-motion: reduce)').matches) this.el('message-title').animate([
      { transform: 'rotate(-3deg) scale(.65)', opacity: 0 },
      { transform: 'rotate(-3deg) scale(1.09)', opacity: 1, offset: .65 },
      { transform: 'rotate(-3deg) scale(1)', opacity: 1 },
    ], { duration: 330, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
  toast(text: string) { this.set('event-toast', text); this.el('event-toast').classList.add('visible'); this.messageUntil = performance.now() + 2200; }
  boostPickup(big: boolean) { this.boostGauge.pickup(big); }
  update(data: { blue: number; orange: number; time: number; boost: number; boosting: boolean; speed: number; supersonic: boolean; unlimited: boolean; grounded: boolean; fps: number; overtime: boolean; practice?: boolean; }, dt = 1 / 60) {
    this.set('blue-score', data.blue); this.set('orange-score', data.orange);
    const t = Math.ceil(Math.abs(data.time)); this.set('timer', `${data.overtime ? '+' : ''}${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    this.el('overtime').style.display = data.overtime && !data.practice ? 'block' : 'none';
    const scoreboard = this.root.querySelector('.scoreboard')!;
    scoreboard.classList.toggle('is-overtime', data.overtime && !data.practice);
    scoreboard.classList.toggle('is-urgent', data.time <= 30 && !data.overtime && !data.practice);
    scoreboard.classList.toggle('is-final-seconds', data.time <= 10 && !data.overtime && !data.practice);
    this.boostGauge.update(data.boost, data.unlimited, data.boosting, data.supersonic, dt);
    this.set('speed', Math.round(data.speed * 3.6)); this.set('drive-state', data.grounded ? 'GROUNDED' : 'AIRBORNE');
    this.set('player-status', data.supersonic ? 'SUPERSONIC' : data.grounded ? 'OCTANE · BLUE TEAM' : 'OCTANE · AIRBORNE');
    this.set('fps', `${Math.round(data.fps)} FPS`);
    this.el('infinite-label').classList.toggle('active', data.unlimited);
    if (performance.now() > this.messageUntil) this.el('event-toast').classList.remove('visible');
  }
  camera(active: boolean) {
    this.set('camera-status', active ? 'ON' : 'OFF'); this.el('camera-indicator').classList.toggle('active', active);
    this.root.querySelector<HTMLElement>('.ball-cam-corner')!.hidden = !active;
    this.root.querySelector('.bottom-left')!.classList.toggle('ball-cam-active', active);
  }
  mode(bot: boolean) {
    this.root.querySelector('.scoreboard')!.classList.toggle('is-practice', !bot);
    this.el('timer').hidden = !bot;
    this.root.querySelector('.team-orange>span')!.textContent = bot ? 'MAVERICK' : 'ORANGE';
    this.root.querySelector('.session-footer>span:nth-child(2)')!.textContent = bot ? 'EXHIBITION' : 'SOLO PRACTICE';
  }
  pause(show: boolean, ended = false, won = false) { this.el('pause-panel').hidden = !show; this.set('pause-title', ended ? won ? 'VICTORY.' : 'GOOD GAME.' : 'TIME OUT.'); this.set('pause-description', ended ? 'One more? There is always another play.' : 'Take a breath. The field will be here.'); }
}
