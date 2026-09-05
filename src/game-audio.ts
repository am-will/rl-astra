import { AUDIO_CLIPS, type AudioClip } from './audio-clips';
import type { Car } from './physics';

interface Loop { source: AudioBufferSourceNode; gain: GainNode; }
interface Voice { key: AudioClip; source: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode; }
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const LEVEL = .55;

export class GameAudio {
  ctx?: AudioContext;
  master?: GainNode;
  engineGain?: GainNode;
  muted = false;
  readonly buffers = new Map<AudioClip, AudioBuffer>();
  readonly failures: string[] = [];
  private loading?: Promise<void>;
  private mix?: GainNode;
  private loops = new Map<AudioClip, Loop>();
  private voices = new Set<Voice>();
  private lastCue = new Map<string, number>();
  private boosting = false;
  private paused = false;
  private hitIndex = 0;
  private engineLoad = 0;
  private engineRevs = 0;

  constructor() {
    try { this.muted = localStorage.getItem('champions-field.sound') === 'off'; } catch { /* Private browsing. */ }
  }

  load() {
    return this.loading ??= this.loadClips();
  }
  private async loadClips() {
    // Decode offline while the models load, so the first kickoff cue is ready.
    // The audible AudioContext is created only after a keyboard, pointer or pad gesture.
    try {
      const decoder = new OfflineAudioContext(2, 1, 48000);
      const signal = AbortSignal.timeout(12000);
      const jobs = Object.entries(AUDIO_CLIPS) as [AudioClip, string][];
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (jobs.length) {
          const [key, file] = jobs.shift()!;
          try {
            const response = await fetch(`${import.meta.env.BASE_URL}audio/rocket-league/${file}`, { signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            this.buffers.set(key, await decoder.decodeAudioData(await response.arrayBuffer()));
          } catch { this.failures.push(file); }
        }
      }));
    } catch { this.failures.push('Audio decoding unavailable'); }
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const ctx = this.ctx = new AudioContext();
      this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : LEVEL;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -12; compressor.knee.value = 10; compressor.ratio.value = 5;
      compressor.attack.value = .003; compressor.release.value = .18;
      this.mix = ctx.createGain(); this.mix.gain.value = this.paused ? 0 : 1;
      this.mix.connect(compressor); compressor.connect(this.master); this.master.connect(ctx.destination);
      this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0; this.engineGain.connect(this.mix);
      void ctx.resume().catch(() => {});
    } catch { /* The rest of the game remains playable when audio is unavailable. */ }
  }

  toggle() {
    this.muted = !this.muted;
    try { localStorage.setItem('champions-field.sound', this.muted ? 'off' : 'on'); } catch { /* Apply for this session. */ }
    if (this.ctx && this.master) this.ramp(this.master.gain, this.muted ? 0 : LEVEL, .025);
  }

  setPaused(paused: boolean) {
    if (paused === this.paused) return;
    this.paused = paused;
    if (this.mix) this.ramp(this.mix.gain, paused ? 0 : 1, .015);
    if (paused) this.reset();
  }

  reset() {
    this.boosting = false; this.engineLoad = this.engineRevs = 0; this.lastCue.clear();
    for (const voice of [...this.voices]) this.stopVoice(voice);
    for (const loop of this.loops.values()) this.ramp(loop.gain.gain, 0, .015);
    if (this.engineGain) this.ramp(this.engineGain.gain, 0, .015);
  }

  private ramp(param: AudioParam, value: number, seconds = .06) {
    if (!this.ctx) return;
    param.setTargetAtTime(value, this.ctx.currentTime, seconds);
  }

  private loop(key: AudioClip, volume: number, rate = 1, engine = false) {
    if (!this.ctx || !this.mix) return;
    let loop = this.loops.get(key);
    if (!loop) {
      const original = this.buffers.get(key);
      if (!original) return;
      // Overlap the seam instead of clicking once per revolution/boost cycle.
      const fade = Math.min(Math.round(original.sampleRate * .012), Math.floor(original.length / 8));
      const buffer = this.ctx.createBuffer(original.numberOfChannels, original.length - fade, original.sampleRate);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const src = original.getChannelData(channel), dst = buffer.getChannelData(channel);
        dst.set(src.subarray(fade, original.length));
        for (let i = 0; i < fade; i++) {
          const t = i / Math.max(1, fade - 1);
          dst[dst.length - fade + i] = src[original.length - fade + i] * (1 - t) + src[i] * t;
        }
      }
      const source = this.ctx.createBufferSource(), gain = this.ctx.createGain();
      source.buffer = buffer; source.loop = true; gain.gain.value = 0;
      source.connect(gain); gain.connect(engine ? this.engineGain! : this.mix); source.start();
      loop = { source, gain }; this.loops.set(key, loop);
    }
    this.ramp(loop.gain.gain, this.paused ? 0 : volume);
    this.ramp(loop.source.playbackRate, rate, .1);
  }

  update(car: Pick<Car, 'speed' | 'boosting' | 'grounded' | 'drifting' | 'steer' | 'demolished' | 'throttle'>, active: boolean, dt: number) {
    this.setPaused(dt <= 0);
    if (!this.ctx || !this.engineGain) return;
    const running = active && !this.paused && car.demolished <= 0;
    const speed = clamp(car.speed / 23), rolling = clamp(car.speed / 10);
    // RPM follows the accelerator and tire travel, not world velocity alone.
    // Coasting/airborne travel unloads the motor instead of sustaining a redline.
    const load = running ? clamp(Math.abs(car.throttle) + (car.boosting ? 1 : 0)) : 0;
    this.engineLoad += (load - this.engineLoad) * (1 - Math.exp(-dt * (load > this.engineLoad ? 4 : 8)));
    const tireSpeed = clamp(car.speed / 16);
    const targetRevs = running ? this.engineLoad * (car.grounded ? .12 + tireSpeed * .68 : .36) + (1 - this.engineLoad) * tireSpeed * .12 : 0;
    this.engineRevs += (targetRevs - this.engineRevs) * (1 - Math.exp(-dt * 5));
    const revs = this.engineRevs, upper = clamp((revs - .48) / .32);
    const pitchLift = 1 + this.engineLoad * clamp((revs - .16) / .64) * .18;
    this.ramp(this.engineGain.gain, running ? .78 : 0, running ? .06 : .015);
    this.loop('engineIdle', .6 * (1 - clamp(revs * 2.5)), .88 + revs * .3, true);
    this.loop('engineLow', (.16 + this.engineLoad * .18) * Math.sin(clamp(revs / .8) * Math.PI), (.75 + revs * .45) * pitchLift, true);
    this.loop('engineHigh', .13 * upper * this.engineLoad, (.72 + revs * .26) * pitchLift, true);
    const boost = running && car.boosting;
    if (boost && !this.boosting) this.play('boostStart', .36, 1, 0, .08);
    if (!boost && this.boosting && running) this.play('boostStop', .5, 1, 0, .08);
    this.boosting = boost;
    this.loop('boostLoop', boost ? .46 : 0, .95 + speed * .12);
    this.loop('tires', running && car.grounded ? rolling * .2 : 0, .75 + speed * .6);
    const skid = running && car.grounded && car.drifting ? rolling * clamp(Math.abs(car.steer) * 1.5 + .15) : 0;
    this.loop('drift', skid * .11, .85 + speed * .22);
  }

  private stopVoice(voice: Voice) {
    voice.source.onended = null;
    try { voice.source.stop(); } catch { /* It may have already ended. */ }
    voice.source.disconnect(); voice.gain.disconnect(); voice.pan.disconnect(); this.voices.delete(voice);
  }
  private play(key: AudioClip, volume: number, rate = 1, pan = 0, cooldown = 0, group: string = key) {
    const ctx = this.ctx, buffer = this.buffers.get(key);
    if (!ctx || !this.mix || !buffer || this.paused || this.muted || ctx.state !== 'running') return;
    if (ctx.currentTime - (this.lastCue.get(group) ?? -Infinity) < cooldown) return;
    this.lastCue.set(group, ctx.currentTime);
    // Physics can report many simultaneous contacts; the mix stays bounded.
    if (this.voices.size >= 24) this.stopVoice([...this.voices].find(v => v.key !== 'pickup') ?? this.voices.values().next().value!);
    const source = ctx.createBufferSource(), gain = ctx.createGain(), panner = ctx.createStereoPanner();
    source.buffer = buffer; source.playbackRate.value = clamp(rate, .5, 2);
    gain.gain.value = volume; panner.pan.value = clamp(pan, -1, 1);
    source.connect(gain); gain.connect(panner);
    // Keep the pickup's transient and tail intact: world impacts must not
    // pump this UI cue through the shared compressor. Master mute still applies.
    panner.connect(key === 'pickup' ? this.master! : this.mix);
    const voice = { key, source, gain, pan: panner }; this.voices.add(voice);
    source.onended = () => { source.disconnect(); gain.disconnect(); panner.disconnect(); this.voices.delete(voice); };
    source.start();
  }

  hit(speed: number, distance = 0, pan = 0) {
    const key = speed < 8 ? 'hitSoft' : this.hitIndex++ % 2 ? 'hitAlt' : 'hitHard';
    this.play(key, (.25 + clamp(speed / 25) * .65) / (1 + distance * .055), .96 + Math.random() * .08, pan, .055, 'hit');
  }
  pickup() { this.play('pickup', .6, 1, 0, .07); }
  countdown(go: boolean) { this.play(go ? 'go' : 'countdown', go ? .5 : .6, 1, 0, .12); }
  flipReset() { this.play('flipReset', .75, 1, 0, .1); }
  jump(dodge: boolean, distance = 0, pan = 0) {
    this.play(dodge ? 'dodge' : Math.random() < .5 ? 'jump' : 'jumpAlt', .46 / (1 + distance * .08), 1, pan, .06, `jump-${distance < .01 ? 'player' : 'bot'}`);
  }
  land(speed: number, distance = 0, pan = 0) { this.play('land', clamp(speed / 10, .15, .6) / (1 + distance * .07), 1, pan, .13, 'land'); }
  demolition(distance: number, pan = 0) { this.play('demolition', .55 / (1 + distance * .035), 1, pan, .12); }
  goal() { this.play('goal', .56, 1, 0, .3); this.play('cheer', .23, 1, 0, .3); }
  menu() { this.play('menu', .2, 1, 0, .07); }
}
