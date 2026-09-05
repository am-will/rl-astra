import { Vector3, Quaternion } from 'three';
import { Controls } from './controls';
import { Physics } from './physics';
import { GameRenderer } from './render';
import { HUD } from './hud';
import { ControlsMenu, navigateMenu } from './controls-menu';
import { emptyInput, MATCH_LENGTH, STEP, FIELD, BLUE, ORANGE, CAR, type Input } from './config';

type Phase = 'ready' | 'countdown' | 'playing' | 'goal' | 'ended';
export class Game {
  physics = new Physics(); controls = new Controls(); hud = new HUD();
  view!: GameRenderer;
  controlsMenu!: ControlsMenu;
  phase: Phase = 'ready'; paused = false; help = false;
  blue = 0; orange = 0; remaining = MATCH_LENGTH; overtime = false;
  phaseTime = 0; elapsed = 0; accumulator = 0; previous = 0; fps = 60;
  celebration = new Vector3(); lastCountdown = 0; goalCount = 0; hits = 0; padCount = 0;
  testing = false;
  private goalBlastPending = false;
  async init() {
    await this.physics.init();
    this.view = new GameRenderer(document.querySelector('#app')!, this.physics);
    this.hud.set('quality-value', this.view.quality ? 'HIGH' : 'PERFORMANCE');
    this.hud.camera(this.view.ballCam);
    try { await this.view.loadAssets(); } catch (error) { console.warn('Detailed assets unavailable; using the procedural car and ball.', error); }
    this.hud.onAction = action => this.action(action);
    this.controlsMenu = new ControlsMenu(this.controls, this.hud.root);
    this.controlsMenu.onClose = () => this.action('close-bindings');
    this.controls.onAction = action => this.action(action);
    this.controls.onActivity = () => {
      this.view.audio.init();
      if (this.phase === 'ready' && !this.paused && !this.help && !this.controlsMenu.visible) this.kickoff();
    };
    this.controls.onChange = () => { this.controlsMenu.render(); this.hud.bindings(this.controls); };
    this.controls.onDisconnect = () => {
      this.paused = true; this.hud.pause(true); this.syncMenu();
      this.hud.toast('CONTROLLER DISCONNECTED · RECONNECT OR USE KEYBOARD');
    };
    this.controls.onMenu = input => {
      if (input === 'back') { this.action('pause'); return; }
      if (this.controlsMenu.visible) this.controlsMenu.navigate(input);
      else {
        const panel = this.hud.el(this.help ? 'help-panel' : 'pause-panel');
        navigateMenu(Array.from(panel.querySelectorAll<HTMLElement>('button')).filter(e => e.getClientRects().length > 0), input);
      }
    };
    this.hud.bindings(this.controls);
    this.physics.onHit = (position, speed, player) => {
      this.hits++; this.view.effects.burst(position, player ? 0xa6dfff : 0xffc080, 18 + Math.floor(speed), 6);
      this.view.audio.hit(speed); this.view.shake = Math.min(.65, speed / 50);
      if (player && speed > 18) this.hud.toast('POWER HIT  +20');
    };
    this.physics.onPad = big => { this.padCount++; this.view.audio.tone(big ? 880 : 620, .17, .1, 1250); if (big) this.hud.toast('BOOST RECHARGED'); };
    this.physics.onFlipReset = () => { this.hud.toast('FLIP RESET  +50'); this.view.audio.tone(1200, .3, .15, 1800); };
    this.physics.onDemo = car => {
      const pos = new Vector3().copy(car.body.translation());
      const distance = pos.distanceTo(new Vector3().copy(this.physics.player.body.translation()));
      this.view.effects.demolitions.trigger(pos, new Vector3().copy(car.body.linvel()), new Quaternion().copy(car.body.rotation()), car === this.physics.player ? BLUE : ORANGE);
      this.view.audio.demolition(distance); this.view.shake = Math.max(this.view.shake, 1.1 / (1 + distance * .08));
      this.hud.toast(car === this.physics.bot ? 'DEMOLITION  +50' : 'DEMOLISHED · RESPAWNING');
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.phase !== 'ready' && !this.testing) { this.paused = true; this.hud.pause(true); this.controls.clear(); this.syncMenu(); } });
    this.hud.ready();
    // Only local development exposes deterministic controls used by the browser tests.
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = this;
    requestAnimationFrame(t => this.frame(t));
  }
  kickoff() { this.view.effects.explosion.reset(); this.view.effects.demolitions.reset(); this.goalBlastPending = false; this.phase = 'countdown'; this.phaseTime = 3; this.lastCountdown = 0; this.hud.message('3', 'GET READY', 'CHAMPIONS FIELD', 'countdown'); }
  action(action: string) {
    this.view.audio.init();
    if (action === 'camera') { this.view.ballCam = !this.view.ballCam; this.hud.camera(this.view.ballCam); }
    if (action === 'unlimited') { this.physics.unlimited = !this.physics.unlimited; if (this.physics.unlimited) this.physics.player.boost = 100; this.hud.set('unlimited-value', this.physics.unlimited ? 'ON' : 'OFF'); this.hud.toast(this.physics.unlimited ? 'UNLIMITED BOOST · ON' : 'UNLIMITED BOOST · OFF'); }
    if (action === 'sound') { this.view.audio.toggle(); this.hud.set('sound-value', this.view.audio.muted ? 'OFF' : 'ON'); this.hud.toast(this.view.audio.muted ? 'SOUND OFF' : 'SOUND ON'); }
    if (action === 'fullscreen') { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => this.hud.toast('FULLSCREEN IS NOT AVAILABLE')); }
    if (action === 'pause') {
      if (this.controls.capture) this.controls.cancelCapture();
      else if (this.controlsMenu.visible) this.action('close-bindings');
      else if (this.help) { this.help = false; this.hud.el('help-panel').hidden = true; }
      else { this.paused = !this.paused; this.hud.pause(this.paused, this.phase === 'ended', this.blue > this.orange); }
      this.controls.clear();
    }
    if (action === 'resume') { if (this.phase === 'ended') this.restart(); this.paused = false; this.hud.pause(false); this.controls.clear(); }
    if (action === 'restart') this.restart();
    if (action === 'reset' && !this.paused && !this.help && !this.controlsMenu.visible) { this.physics.resetCar(this.physics.player); this.view.cameraReady = false; this.hud.toast('CAR RESET'); }
    if (action === 'mode') { this.physics.botEnabled = !this.physics.botEnabled; this.hud.set('mode-value', this.physics.botEnabled ? '1V1 · MAVERICK' : 'SOLO PRACTICE'); this.hud.set('match-type', this.physics.botEnabled ? 'EXHIBITION · 1V1' : 'SOLO PRACTICE'); this.hud.mode(this.physics.botEnabled); this.restart(); }
    if (action === 'quality') { this.view.toggleQuality(); this.hud.set('quality-value', this.view.quality ? 'HIGH' : 'PERFORMANCE'); }
    if (action === 'help') { this.help = !this.help; this.hud.el('help-panel').hidden = !this.help; this.controls.clear(); }
    if (action === 'close-help') { this.help = false; this.hud.el('help-panel').hidden = true; this.controls.clear(); }
    if (action === 'bindings') { this.paused = true; this.help = false; this.hud.el('help-panel').hidden = true; this.hud.pause(false); this.controlsMenu.open(); }
    if (action === 'close-bindings') { this.controlsMenu.close(); this.hud.pause(true); this.hud.root.querySelector<HTMLButtonElement>('[data-action="bindings"]')!.focus(); }
    this.syncMenu();
  }
  syncMenu() {
    this.controls.setMenuMode(this.paused || this.help || this.controlsMenu.visible || this.phase === 'ended');
    // Only the topmost menu participates in keyboard focus or pointer input.
    this.hud.el('pause-panel').inert = this.help || this.controlsMenu.visible;
    for (const selector of ['.top-actions', '.bottom-left', '.controls-strip']) (this.hud.root.querySelector(selector) as HTMLElement).inert = this.paused || this.help || this.controlsMenu.visible;
  }
  restart() {
    this.view.effects.explosion.reset();
    this.view.effects.demolitions.reset(); this.goalBlastPending = false;
    this.blue = this.orange = 0; this.remaining = MATCH_LENGTH; this.overtime = false; this.phase = 'ready'; this.paused = false;
    this.physics.reset(); this.view.ballCam = true; this.hud.camera(true); this.view.cameraReady = false; this.hud.pause(false); this.hud.message('MAKE YOUR PLAY.', 'THE STAGE IS YOURS', '', 'ready'); this.hud.bindings(this.controls);
  }
  botInput(): Input {
    const car = this.physics.bot, pos = new Vector3().copy(car.body.translation()), ball = new Vector3().copy(this.physics.ball.translation());
    const ballVelocity = new Vector3().copy(this.physics.ball.linvel());
    const target = ball.clone().addScaledVector(ballVelocity, .15); target.z -= 2.2;
    const distance = pos.distanceTo(ball);
    if (distance < 4 && pos.z < ball.z + .8) target.copy(ball).add(new Vector3(0, 0, 1));
    if (ball.z < -38 && pos.z > ball.z) target.x += pos.x > 0 ? 5 : -5;
    target.x += Math.sin(this.elapsed * .6) * Math.min(1.7, distance * .035);
    const forward = new Vector3(0, 0, -1).applyQuaternion(car.body.rotation());
    const direction = target.sub(pos); direction.y = 0;
    let angle = Math.atan2(-direction.x, -direction.z) - Math.atan2(-forward.x, -forward.z);
    angle = Math.atan2(Math.sin(angle), Math.cos(angle));
    return { ...emptyInput(), throttle: Math.abs(angle) > 2.3 && distance < 4 ? -.6 : car.speed > 14 && distance < 7 ? .2 : 1, steer: Math.max(-1, Math.min(1, angle * 1.6)), boost: Math.abs(angle) < .18 && distance > 12 && car.speed < 20 && Math.sin(this.elapsed * .35) > -.2, jump: car.grounded && distance < 2.7 && ball.y > 1.5 && ball.y < 3.6, jumpHeld: distance < 3 && ball.y > 1.5, drift: Math.abs(angle) > 1.5 && car.speed > 8 };
  }
  tick(input: Input) {
    this.elapsed += STEP;
    if (this.phase === 'ready' || this.phase === 'countdown') {
      this.physics.step(emptyInput(), emptyInput());
      if (this.phase === 'countdown') {
        this.phaseTime -= STEP; const number = Math.ceil(this.phaseTime);
        if (number !== this.lastCountdown && number > 0) { this.hud.message(String(number), 'GET READY', 'CHAMPIONS FIELD', 'countdown'); this.view.audio.tone(520, .2, .18); this.lastCountdown = number; }
        if (this.phaseTime <= 0) { this.phase = 'playing'; this.hud.message('GO!', '', '', 'countdown'); this.phaseTime = .85; this.view.audio.tone(1040, .4, .2); }
      }
    } else if (this.phase === 'playing') {
      if (this.phaseTime > 0) { this.phaseTime -= STEP; if (this.phaseTime <= 0) this.hud.message(''); }
      this.physics.step(input, this.botInput());
      if (this.physics.botEnabled) this.remaining += this.overtime ? STEP : -STEP;
      const goal = this.physics.goal();
      if (goal) this.score(goal);
      else if (this.remaining <= 0 && !this.overtime && this.physics.ball.translation().y <= FIELD.ballRadius + .12) {
        if (this.blue === this.orange) { this.overtime = true; this.remaining = 0; this.physics.reset(); this.kickoff(); this.hud.toast('OVERTIME · NEXT GOAL WINS'); }
        else this.end();
      }
    } else if (this.phase === 'goal') {
      this.phaseTime -= STEP;
      if (this.goalBlastPending && this.phaseTime <= 4.38) {
        this.goalBlastPending = false;
        this.physics.goalBlast(this.view.effects.explosion.root.position);
      }
      // The clock and score are settled, but cars, air control and boost stay live.
      this.physics.step(input, emptyInput());
      if (this.phaseTime <= 0) {
        if (this.overtime || (this.remaining <= 0 && this.blue !== this.orange)) this.end();
        else { this.physics.reset(); this.view.cameraReady = false; this.kickoff(); }
      }
    }
  }
  score(team: 'blue' | 'orange') {
    if (this.phase !== 'playing') return;
    if (team === 'blue') this.blue++; else this.orange++;
    this.goalCount++; this.phase = 'goal'; this.phaseTime = 4.6;
    this.goalBlastPending = true;
    this.celebration.copy(this.physics.ball.translation());
    this.physics.ball.setEnabled(false);
    this.hud.message(team === 'blue' ? 'YOU SCORED!' : `${this.physics.botEnabled ? 'MAVERICK' : 'ORANGE'} SCORED!`, 'GOOOOOAL!', `${this.blue} <span style="opacity:.5">—</span> ${this.orange}`, 'goal');
    this.view.effects.goal(this.celebration, team === 'blue' ? BLUE : ORANGE); this.view.audio.goal(); this.view.shake = 1.8;
    const flash = this.hud.el('goal-flash'); flash.classList.remove('flash'); void flash.offsetWidth; flash.classList.add('flash');
  }
  end() { this.view.effects.explosion.reset(); this.phase = 'ended'; this.paused = true; this.hud.message(''); this.hud.pause(true, true, this.blue > this.orange); }
  frame(now: number) {
    requestAnimationFrame(t => this.frame(t));
    const dt = Math.min(.05, (now - (this.previous || now)) / 1000); this.previous = now;
    this.fps = this.fps * .97 + (dt > 0 ? 1 / dt : 60) * .03;
    this.syncMenu(); this.controls.poll(now); this.controlsMenu.update();
    const frozen = this.controlsMenu.visible || this.paused || this.help || this.phase === 'ended' || this.testing;
    if (!frozen) {
      this.accumulator += dt;
      const input = this.controls.read();
      // Keep jump edges until a simulation step actually consumes them.
      if (input.jump && this.accumulator < STEP) this.controls.restoreJump();
      while (this.accumulator >= STEP) { this.tick(input); input.jump = false; this.accumulator -= STEP; }
    } else this.accumulator = 0;
    this.view.update(frozen ? 0 : dt, this.phase, this.celebration, frozen ? 1 : this.accumulator / STEP);
    this.view.draw();
    const car = this.physics.player;
    this.hud.update({ blue: this.blue, orange: this.orange, time: Math.max(0, this.remaining), boost: car.boost, speed: car.speed, supersonic: car.supersonic, unlimited: this.physics.unlimited, grounded: car.grounded, fps: this.fps, overtime: this.overtime });
    this.positionLabels();
  }
  positionLabels() {
    const label = this.hud.el('bot-name'), projected = this.view.bot.root.position.clone().add(new Vector3(0, 2, 0)).project(this.view.camera);
    label.style.display = this.physics.botEnabled && this.physics.bot.demolished <= 0 && Math.abs(projected.x) < .95 && Math.abs(projected.y) < .85 && projected.z < 1 ? 'block' : 'none';
    label.style.left = `${(projected.x * .5 + .5) * innerWidth}px`; label.style.top = `${(-projected.y * .5 + .5) * innerHeight}px`;
    const ball = this.view.ball.position.clone().project(this.view.camera), arrow = this.hud.el('ball-arrow');
    arrow.style.display = (Math.abs(ball.x) > .96 || Math.abs(ball.y) > .9 || ball.z > 1) && this.phase === 'playing' ? 'block' : 'none';
    arrow.style.left = ball.x < 0 ? '24px' : 'auto'; arrow.style.right = ball.x < 0 ? 'auto' : '24px';
  }
  snapshot() {
    const car = this.physics.player;
    return { phase: this.phase, paused: this.paused, blue: this.blue, orange: this.orange, remaining: this.remaining, overtime: this.overtime, boost: car.boost, unlimited: this.physics.unlimited, grounded: car.grounded, jumps: car.jumpCount, wheels: car.wheels, car: { ...car.body.translation() }, rotation: { ...car.body.rotation() }, velocity: { ...car.body.linvel() }, ball: { ...this.physics.ball.translation() }, ballVelocity: { ...this.physics.ball.linvel() }, hits: this.hits, pads: this.padCount, goals: this.goalCount, camera: this.view.camera.position.toArray(), fps: this.fps, drawCalls: this.view.renderer.info.render.calls };
  }
  advance(seconds: number, input: Partial<Input> = {}) {
    for (let i = 0; i < seconds / STEP; i++) this.tick({ ...emptyInput(), ...input, jump: i === 0 && !!input.jump });
    this.view.update(1 / 60, this.phase, this.celebration); return this.snapshot();
  }
  scenario(name: string) {
    this.view.effects.demolitions.reset(); this.goalBlastPending = false;
    this.view.effects.explosion.reset(); this.testing = true; this.paused = false; this.physics.botEnabled = false; this.phase = 'playing'; this.phaseTime = 0; this.remaining = 300; this.overtime = false; this.physics.reset(); this.hud.message('');
    if (name === 'goal-blue') { this.physics.ball.setTranslation({ x: 0, y: 2.1, z: -44 }, true); this.physics.ball.setLinvel({ x: 0, y: 0, z: -22 }, true); }
    if (name === 'goal-orange') { this.physics.ball.setTranslation({ x: 0, y: 2.1, z: 44 }, true); this.physics.ball.setLinvel({ x: 0, y: 0, z: 22 }, true); }
    if (name === 'pad') { this.physics.resetCar(this.physics.player, -19, 20); this.physics.player.boost = 15; }
    if (name === 'big-pad') { this.physics.resetCar(this.physics.player, -31, 3); this.physics.player.boost = 15; }
    if (name === 'collision') this.physics.resetCar(this.physics.player, 0, 4.5);
    if (name === 'wall') { this.physics.ball.setTranslation({ x: 33, y: 6, z: 0 }, true); this.physics.ball.setLinvel({ x: 25, y: 0, z: 0 }, true); }
    if (name === 'wall-drive') this.physics.resetCar(this.physics.player, 28, 10, -Math.PI / 2);
    if (name === 'flip-reset') {
      this.physics.player.body.setTranslation({ x: 0, y: 2.1, z: 0 }, true);
      this.physics.player.jumpCount = 2; this.physics.player.airTime = 2;
      this.physics.ball.setTranslation({ x: 0, y: .98, z: 0 }, true);
    }
    if (name === 'air') { this.physics.player.body.setTranslation({ x: 0, y: 9, z: 12 }, true); this.physics.player.jumpCount = 1; this.physics.player.airTime = .2; }
    if (name === 'rollover') { this.physics.player.body.setTranslation({ x: 0, y: .4, z: 20 }, true); this.physics.player.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI), true); }
    return this.snapshot();
  }
}
