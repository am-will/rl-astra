const START = 92, SWEEP = 258, CENTER = 110;
const point = (radius: number, angle: number) => {
  const a = angle * Math.PI / 180;
  return `${(CENTER + Math.cos(a) * radius).toFixed(3)} ${(CENTER + Math.sin(a) * radius).toFixed(3)}`;
};
const arc = (radius: number) => `M ${point(radius, START)} A ${radius} ${radius} 0 1 1 ${point(radius, START + SWEEP)}`;
const segments = Array.from({ length: 52 }, (_, i) => {
  const start = START + i * SWEEP / 52, end = start + SWEEP / 52 - 1.5;
  const outer = 82 + i / 51 * 16;
  return `<path d="M ${point(74, start)} L ${point(outer, start)} A ${outer} ${outer} 0 0 1 ${point(outer, end)} L ${point(74, end)} A 74 74 0 0 0 ${point(74, start)} Z"/>`;
}).join('');

/** SVG instrument: only the two fill masks and the fuel tip change each frame. */
export class BoostGauge {
  private value: HTMLElement;
  private fill: SVGElement;
  private lag: SVGElement;
  private tip: SVGElement;
  private motion = matchMedia('(prefers-reduced-motion: reduce)');
  private displayed = 100;
  private trailing = 100;
  private unlimited = false;
  private initialized = false;
  private animations: Animation[] = [];

  constructor(private root: HTMLElement) {
    root.innerHTML = `<div class="boost-ring" role="meter" aria-label="Boost" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
      <div class="boost-well"></div><div class="boost-heat"></div>
      <svg class="boost-dial" viewBox="0 0 220 220" aria-hidden="true">
        <defs>
          <linearGradient id="boost-gold" x1="15%" y1="100%" x2="85%" y2="0%"><stop stop-color="#e66e12"/><stop offset=".42" stop-color="#ffa82c"/><stop offset=".78" stop-color="#ffd263"/><stop offset="1" stop-color="#fff3be"/></linearGradient>
          <mask id="boost-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="220" height="220"><path id="boost-arc" d="${arc(86)}" fill="none" stroke="white" stroke-width="34" pathLength="100" stroke-dasharray="100" stroke-dashoffset="0"/></mask>
          <mask id="boost-lag-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="220" height="220"><path id="boost-lag-arc" d="${arc(86)}" fill="none" stroke="white" stroke-width="34" pathLength="100" stroke-dasharray="100" stroke-dashoffset="0"/></mask>
        </defs>
        <path class="boost-rail" d="${arc(69)}"/>
        <path class="boost-rail outer" d="${arc(102)}"/>
        <g class="boost-segments track">${segments}</g>
        <g class="boost-segments lag" mask="url(#boost-lag-mask)">${segments}</g>
        <g class="boost-segments fuel" mask="url(#boost-mask)">${segments}</g>
        <g mask="url(#boost-mask)"><path class="boost-flow" d="${arc(77)}" pathLength="100"/><path class="boost-hot-rail" d="${arc(71)}"/></g>
        <g class="boost-tip" transform="rotate(${START + SWEEP} 110 110)"><path d="M 179 110 L 190 106 L 190 114 Z"/><path class="tip-flare" d="M 174 110 H 204"/><circle cx="186" cy="110" r="2.3"/></g>
        <path class="boost-sonic-ring" d="${arc(64)}" pathLength="100"/>
        <path class="boost-recharge-ring" d="${arc(102)}"/>
      </svg>
      <div class="boost-value"><strong id="boost">100</strong><span>BOOST</span></div>
      <div class="boost-pickup" aria-hidden="true"></div>
      <div class="boost-sonic" aria-hidden="true"><i></i><i></i><i></i></div>
    </div><div class="speed"><span id="speed">0</span><span class="speed-unit">KM/H</span><i></i><span id="drive-state">GROUNDED</span></div>`;
    this.value = root.querySelector('#boost')!;
    this.fill = root.querySelector('#boost-arc')!; this.lag = root.querySelector('#boost-lag-arc')!; this.tip = root.querySelector('.boost-tip')!;
  }

  pickup(big: boolean) {
    this.animations.forEach(a => a.cancel()); this.animations = [];
    if (this.motion.matches) return;
    const label = this.root.querySelector<HTMLElement>('.boost-pickup')!;
    label.textContent = big ? 'FULL' : '+12';
    this.animations.push(
      this.value.animate([{ transform: 'scale(1)' }, { transform: `scale(${big ? 1.15 : 1.08})`, offset: .22 }, { transform: 'scale(1)' }], { duration: big ? 450 : 300, easing: 'cubic-bezier(.16,1,.3,1)' }),
      label.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)', offset: .15 }, { opacity: 1, transform: 'translateY(-2px)', offset: .5 }, { opacity: 0, transform: 'translateY(-12px)' }], { duration: 750, easing: 'ease-out' }),
      this.root.querySelector('.boost-recharge-ring')!.animate([{ opacity: .95, transform: 'scale(.94)' }, { opacity: 0, transform: `scale(${big ? 1.14 : 1.06})` }], { duration: big ? 550 : 350, easing: 'ease-out' }),
      this.root.querySelector('.boost-heat')!.animate([{ opacity: .65 }, { opacity: 0 }], { duration: 500, easing: 'ease-out' }),
    );
  }

  update(boost: number, unlimited: boolean, boosting: boolean, supersonic: boolean, dt: number) {
    const amount = Math.max(0, Math.min(100, boost)), target = unlimited ? 100 : amount;
    if (!this.initialized || this.unlimited !== unlimited || this.motion.matches) this.displayed = this.trailing = target;
    this.initialized = true; this.unlimited = unlimited;
    const elapsed = Math.max(0, Math.min(.05, dt));
    this.displayed += (target - this.displayed) * (1 - Math.exp(-elapsed * (target > this.displayed ? 17 : 28)));
    this.trailing += (this.displayed - this.trailing) * (1 - Math.exp(-elapsed * 9));
    if (Math.abs(target - this.displayed) < .03) this.displayed = target;
    if (Math.abs(this.displayed - this.trailing) < .03) this.trailing = this.displayed;
    const text = unlimited ? '∞' : String(Math.ceil(amount));
    if (this.value.textContent !== text) this.value.textContent = text;
    this.fill.style.strokeDashoffset = (100 - this.displayed).toFixed(3);
    this.lag.style.strokeDashoffset = (100 - Math.max(this.displayed, this.trailing)).toFixed(3);
    this.tip.setAttribute('transform', `rotate(${START + SWEEP * this.displayed / 100} 110 110)`);
    this.tip.style.opacity = this.displayed > .15 ? '1' : '0';
    this.root.classList.toggle('is-boosting', boosting && target > 0);
    this.root.classList.toggle('is-low', amount < 20 && !unlimited);
    this.root.classList.toggle('is-empty', amount < .01 && !unlimited);
    this.root.classList.toggle('is-supersonic', supersonic);
    this.root.classList.toggle('is-unlimited', unlimited);
    this.root.classList.toggle('is-paused', dt === 0);
    const meter = this.root.querySelector('.boost-ring')!;
    meter.setAttribute('aria-valuenow', String(Math.ceil(target)));
    meter.setAttribute('aria-valuetext', unlimited ? 'Unlimited boost' : `${Math.ceil(amount)} boost`);
  }
}
