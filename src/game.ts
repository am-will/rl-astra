import { Vector3, Quaternion } from 'three';
import { Controls } from './controls';
import { Simulation, type MatchEvent } from './simulation';
import { OnlineClient } from './network/client';
import { GameRenderer } from './render';
import { HUD } from './hud';
import { VisualSettings } from './visual-settings';
import { ControlsMenu, navigateMenu } from './controls-menu';
import { emptyInput, MATCH_LENGTH, STEP, FIELD, BLUE, ORANGE, CAR, type Input } from './config';

export class Game extends Simulation {
  controls = new Controls(); hud = new HUD();
  online?: OnlineClient;
  private shownEvents = new Set<string>();
  view!: GameRenderer;
  controlsMenu!: ControlsMenu;
  visualSettings!: VisualSettings;
  paused = false; help = false;
  accumulator = 0; previous = 0; fps = 60;
  hits = 0; padCount = 0; testing = false;
  async init() {
    await this.initPhysics();
    this.onEvent = event => { if (!this.online || event.kind === 'jump' && event.slot === this.physics.localSlot) this.presentEvent(event); };
    this.view = new GameRenderer(document.querySelector('#app')!, this.physics);
    this.hud.set('quality-value', this.view.qualityLevel.toUpperCase()); this.hud.set('lighting-label', this.view.qualityLevel === 'ultra' ? 'DUSK' : 'NIGHT');
    this.hud.camera(this.view.ballCam);
    await Promise.all([
      this.view.loadAssets().catch(error => console.warn('Detailed assets unavailable; using the procedural car and ball.', error)),
      this.view.audio.load(),
    ]);
    await this.view.prepareGraphics();
    this.hud.set('sound-value', this.view.audio.muted ? 'OFF' : 'ON');
    this.hud.onAction = action => this.action(action);
    this.controlsMenu = new ControlsMenu(this.controls, this.hud.root);
    this.controlsMenu.onClose = () => this.action('close-bindings');
    this.visualSettings = new VisualSettings(this.view, this.hud);
    this.visualSettings.onClose = () => this.action('close-visuals');
    this.visualSettings.onChange = () => { this.hud.set('quality-value', this.view.qualityLevel.toUpperCase()); this.hud.set('lighting-label', this.view.qualityLevel === 'ultra' ? 'DUSK' : 'NIGHT'); this.hud.camera(this.view.ballCam); };
    this.controls.onAction = action => this.action(action);
    this.controls.onActivity = () => {
      this.view.audio.init();
      if (!this.online && this.phase === 'ready' && !this.paused && !this.help && !this.controlsMenu.visible) this.kickoff();
    };
    this.controls.onChange = () => { this.controlsMenu.render(); this.hud.bindings(this.controls); };
    this.controls.onDisconnect = () => {
      this.paused = true; this.hud.pause(true); this.syncMenu();
      this.hud.toast('CONTROLLER DISCONNECTED · RECONNECT OR USE KEYBOARD');
    };
    this.controls.onMenu = input => {
      if (input === 'back') { this.action('pause'); return; }
      if (this.visualSettings.visible) this.visualSettings.navigate(input);
      else if (this.controlsMenu.visible) this.controlsMenu.navigate(input);
      else {
        const panel = this.hud.el(this.help ? 'help-panel' : 'pause-panel');
        navigateMenu(Array.from(panel.querySelectorAll<HTMLElement>('button')).filter(e => e.getClientRects().length > 0), input);
      }
    };
    this.hud.bindings(this.controls);
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.phase !== 'ready' && !this.testing) { this.paused = true; this.hud.pause(true); this.controls.clear(); this.syncMenu(); } });
    this.hud.ready();
    this.installOnlineMenu();
    (window as unknown as { multiplayerStatus: () => unknown }).multiplayerStatus = () => {
      const o = this.online;
      return o ? { state: o.state, ready: o.ready, slot: o.slot, rtt: Math.round(o.rtt), tick: o.prediction?.confirmed.tickNumber, predictedTick: this.tickNumber,
        phase: o.prediction?.confirmed.phase, score: [o.prediction?.confirmed.blue, o.prediction?.confirmed.orange],
        position: { ...this.physics.localCar.body.translation() }, speed: this.physics.localCar.speed,
        statistics: { ...o.prediction?.stats }, resyncReason: o.resyncReason } : { state: 'OFFLINE' };
    };
    // Only local development exposes deterministic controls used by the browser tests.
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = this;
    requestAnimationFrame(t => this.frame(t));
  }
  installOnlineMenu() {
    const panel = document.createElement('section'); panel.className = 'online-panel';
    panel.innerHTML = `<button id="online-toggle" type="button">ONLINE 1V1 · ALPHA</button><span id="net-summary" role="status"></span><div id="online-menu" hidden>
      <p id="net-status" role="status">Create a match, or enter a friend’s join code.</p>
      <form id="online-create"><button type="submit">CREATE MATCH</button><p>Create a match to get an 8-character code to share.</p></form>
      <form id="online-join"><label>Join code<input id="join-code" autocomplete="off" placeholder="ABCDEFGH" required maxlength="8" spellcheck="false"></label><button type="submit">JOIN MATCH</button></form>
      <div id="online-session" hidden><p id="room-code"></p><button id="copy-code" type="button" hidden>COPY JOIN CODE</button><p id="net-stats"></p><button id="copy-invite" type="button" hidden>COPY INVITE LINK</button><button id="online-leave" type="button">LEAVE MATCH</button></div>
      <p class="online-note">Chrome · two players · the online match continues while menus are open.</p></div>`;
    this.hud.root.append(panel);
    const menu = this.hud.el('online-menu'), form = this.hud.el('online-create') as HTMLFormElement;
    this.hud.el('online-toggle').onclick = () => { menu.hidden = !menu.hidden; this.controls.clear(); this.controls.setMenuMode(!menu.hidden || this.paused); };
    let invite = '', joinCode = '';
    const clearSeat = () => { for (const key of ['alpha-seat', 'alpha-code', 'alpha-invite']) sessionStorage.removeItem(key); };
    this.hud.el('copy-code').onclick = () => { void navigator.clipboard.writeText(joinCode).then(() => this.hud.toast('JOIN CODE COPIED')).catch(() => this.hud.toast('SELECT AND COPY THE CODE ABOVE')); };
    this.hud.el('copy-invite').onclick = () => { void navigator.clipboard.writeText(invite).then(() => this.hud.toast('INVITE LINK COPIED')).catch(() => { this.hud.el('net-status').textContent = invite; }); };
    this.hud.el('online-leave').onclick = () => { this.online?.dispose(); clearSeat(); history.replaceState(null, '', location.pathname); location.reload(); };
    const join = async (room: string, seat: string) => {
      if (this.online) return;
      form.hidden = true; this.hud.el('online-join').hidden = true; this.hud.el('online-session').hidden = false; menu.hidden = false;
      this.shownEvents.clear(); this.paused = false; this.help = false; this.hud.pause(false); this.hud.message('');
      this.view.audio.init(); this.controls.clear(); this.hud.mode(true);
      this.hud.set('match-type', 'ONLINE · 1V1'); this.hud.root.querySelector('.live-label')!.textContent = 'ONLINE ALPHA';
      sessionStorage.setItem('alpha-seat', JSON.stringify({ room, seat }));
      this.online = new OnlineClient(this, room, seat, text => {
        this.hud.set('net-status', text); this.hud.set('net-summary', text === 'CONNECTED' ? 'LIVE · 1V1' : text);
        const slot = this.physics.localSlot;
        this.hud.root.querySelector('.team-blue .team-label')!.textContent = slot === 0 ? 'YOU' : 'OPPONENT';
        this.hud.root.querySelector('.team-orange .team-label')!.textContent = slot === 1 ? 'YOU' : 'OPPONENT';
        this.hud.root.querySelector('.nameplate-name')!.textContent = 'OPPONENT';
        if (text === 'CONNECTED') menu.hidden = true;
      }, text => {
        // Rebuild the offline world and lobby after an expired room or terminal
        // connection error; never keep automatically retrying a stale seat.
        clearSeat(); sessionStorage.setItem('alpha-notice', text);
        this.online?.dispose(); location.reload();
      });
      await this.online.connect();
    };
    form.onsubmit = async event => {
      event.preventDefault(); const button = form.querySelector('button')!; button.disabled = true;
      try {
        const response = await fetch(OnlineClient.endpoint() + '/api/rooms', { method: 'POST' });
        if (!response.ok) throw new Error(await response.text());
        const room = await response.json();
        joinCode = room.code; this.hud.set('room-code', `JOIN CODE: ${joinCode}`); this.hud.el('copy-code').hidden = false; sessionStorage.setItem('alpha-code', joinCode);
        invite = `${location.origin}${location.pathname}#room=${room.id}&seat=${room.inviteToken}`;
        this.hud.el('copy-invite').hidden = false;
        sessionStorage.setItem('alpha-invite', invite);
        await join(room.id, room.hostToken);
      } catch (error) { this.hud.set('net-status', error instanceof Error ? error.message : 'Could not create match'); }
      finally { button.disabled = false; }
    };
    (this.hud.el('online-join') as HTMLFormElement).onsubmit = async event => {
      event.preventDefault(); const button = this.hud.el('online-join').querySelector('button')!; button.disabled = true;
      try {
        const code = (this.hud.el('join-code') as HTMLInputElement).value;
        const response = await fetch(OnlineClient.endpoint() + '/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
        if (!response.ok) throw new Error(await response.text());
        const room = await response.json(); clearSeat(); await join(room.id, room.seatToken);
      } catch (error) { this.hud.set('net-status', error instanceof Error ? error.message : 'Could not join match'); }
      finally { button.disabled = false; }
    };
    const joinInvitation = () => {
      const hash = new URLSearchParams(location.hash.slice(1));
      if (!hash.has('room') || !hash.has('seat')) return false;
      const room = hash.get('room')!, seat = hash.get('seat')!;
      history.replaceState(null, '', location.pathname); clearSeat(); void join(room, seat); return true;
    };
    window.addEventListener('hashchange', joinInvitation);
    if (!joinInvitation()) {
      try {
        const saved = JSON.parse(sessionStorage.getItem('alpha-seat') || 'null');
        if (saved) { joinCode = sessionStorage.getItem('alpha-code') || ''; if (joinCode) { this.hud.set('room-code', `JOIN CODE: ${joinCode}`); this.hud.el('copy-code').hidden = false; } invite = sessionStorage.getItem('alpha-invite') || ''; this.hud.el('copy-invite').hidden = !invite; void join(saved.room, saved.seat); }
      } catch { clearSeat(); }
    }
    const notice = sessionStorage.getItem('alpha-notice');
    if (notice) { sessionStorage.removeItem('alpha-notice'); this.hud.set('net-status', notice); menu.hidden = false; this.controls.setMenuMode(true); }
  }
  action(action: string) {
    this.view.audio.init();
    if (this.online && ['unlimited', 'mode', 'reset', 'restart'].includes(action)) { this.hud.toast('MATCH RULES ARE CONTROLLED BY THE SERVER'); return; }
    if (this.online && action === 'resume' && this.phase === 'ended') { this.online.rematch(); this.hud.toast('REMATCH REQUESTED'); return; }
    if (action === 'camera') this.view.audio.menu();
    if (action === 'camera') { this.view.ballCam = !this.view.ballCam; this.hud.camera(this.view.ballCam); }
    if (action === 'unlimited') { this.physics.unlimited = !this.physics.unlimited; if (this.physics.unlimited) this.physics.player.boost = 100; this.hud.set('unlimited-value', this.physics.unlimited ? 'ON' : 'OFF'); this.hud.toast(this.physics.unlimited ? 'UNLIMITED BOOST · ON' : 'UNLIMITED BOOST · OFF'); }
    if (action === 'sound') { this.view.audio.toggle(); this.hud.set('sound-value', this.view.audio.muted ? 'OFF' : 'ON'); this.hud.toast(this.view.audio.muted ? 'SOUND OFF' : 'SOUND ON'); }
    if (action === 'fullscreen') { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => this.hud.toast('FULLSCREEN IS NOT AVAILABLE')); }
    if (action === 'pause') {
      if (this.controls.capture) this.controls.cancelCapture();
      else if (this.visualSettings.visible) this.action('close-visuals');
      else if (this.controlsMenu.visible) this.action('close-bindings');
      else if (this.help) { this.help = false; this.hud.el('help-panel').hidden = true; }
      else { this.paused = !this.paused; this.hud.pause(this.paused, this.phase === 'ended', this.blue > this.orange); }
      this.controls.clear();
    }
    if (action === 'resume') { if (this.phase === 'ended') this.restart(); this.paused = false; this.hud.pause(false); this.controls.clear(); }
    if (action === 'restart') this.restart();
    if (action === 'reset' && !this.paused && !this.help && !this.controlsMenu.visible) { this.physics.resetCar(this.physics.player); this.view.cameraReady = false; this.hud.toast('CAR RESET'); }
    if (action === 'mode') { this.practice = !this.practice; this.physics.botEnabled = !this.practice; this.hud.set('mode-value', this.practice ? 'SOLO PRACTICE' : '1V1 · MAVERICK'); this.hud.set('match-type', this.practice ? 'SOLO PRACTICE' : 'EXHIBITION · 1V1'); this.hud.mode(!this.practice); this.restart(); }
    if (action === 'quality') { this.view.toggleQuality(); this.hud.set('quality-value', this.view.qualityLevel.toUpperCase()); this.hud.set('lighting-label', this.view.qualityLevel === 'ultra' ? 'DUSK' : 'NIGHT'); }
    if (action === 'help') { this.help = !this.help; this.hud.el('help-panel').hidden = !this.help; this.controls.clear(); }
    if (action === 'close-help') { this.help = false; this.hud.el('help-panel').hidden = true; this.controls.clear(); }
    if (action === 'bindings') { this.paused = true; this.help = false; this.hud.el('help-panel').hidden = true; this.hud.pause(false); this.controlsMenu.open(); }
    if (action === 'close-bindings') { this.controlsMenu.close(); this.hud.pause(true); this.hud.root.querySelector<HTMLButtonElement>('[data-action="bindings"]')!.focus(); }
    if (action === 'visuals') { this.paused = true; this.hud.pause(false); this.visualSettings.open(); this.controls.clear(); }
    if (action === 'close-visuals') { this.visualSettings.close(); this.hud.pause(true); this.hud.root.querySelector<HTMLButtonElement>('[data-action="visuals"]')!.focus(); }
    this.syncMenu();
  }
  syncMenu() {
    this.view.audio.setPaused(this.paused || this.help || this.controlsMenu.visible || this.visualSettings.visible || this.phase === 'ended' || this.testing);
    this.controls.setMenuMode(!!document.querySelector('#online-menu:not([hidden])') || this.paused || this.help || this.controlsMenu.visible || this.visualSettings.visible || this.phase === 'ended');
    // Only the topmost menu participates in keyboard focus or pointer input.
    this.hud.el('pause-panel').inert = this.help || this.controlsMenu.visible || this.visualSettings.visible;
    for (const selector of ['.top-actions', '.bottom-left']) (this.hud.root.querySelector(selector) as HTMLElement).inert = this.paused || this.help || this.controlsMenu.visible || this.visualSettings.visible;
  }
  restart() {
    this.view.audio.reset();
    this.view.effects.explosion.reset();
    this.view.effects.demolitions.reset(); this.goalBlastPending = false;
    this.blue = this.orange = 0; this.remaining = this.practice ? 0 : MATCH_LENGTH; this.overtime = false; this.phase = this.practice ? 'playing' : 'ready'; this.paused = false;
    this.physics.reset(); this.view.ballCam = true; this.hud.camera(true); this.view.cameraReady = false; this.hud.pause(false); this.hud.message(this.practice ? '' : '3', '', '', 'countdown'); this.hud.bindings(this.controls);
  }
  soundPosition(position: Vector3): [number, number] {
    const delta = position.clone().sub(new Vector3().copy(this.physics.localCar.body.translation())), distance = delta.length();
    const right = new Vector3(1, 0, 0).applyQuaternion(this.view.camera.quaternion);
    return [distance, distance > .1 ? delta.dot(right) / distance * .8 : 0];
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
  tick(input: Input) { this.step([input, this.phase === 'goal' ? emptyInput() : this.botInput()]); }
  presentEvent(event: MatchEvent) {
    if (!this.view) return;
    if (this.online) {
      const id = event.kind === 'jump' ? `${event.tick}:jump:${event.slot}` : `${event.tick}:${event.sequence}:${event.kind}`;
      if (this.shownEvents.has(id)) return;
      this.shownEvents.add(id);
      if (this.shownEvents.size > 2048) this.shownEvents.delete(this.shownEvents.values().next().value!);
    }
    const { kind, speed = 0, slot = 0 } = event;
    const local = slot === this.physics.localSlot;
    const position = new Vector3().fromArray(event.position ?? [0, 0, 0]);
    const car = slot === 0 ? this.physics.player : this.physics.bot;
    if (kind === 'hit') { this.hits++; this.view.audio.hit(speed, ...this.soundPosition(position)); this.view.shake = Math.min(.65, speed / 50); if (local && speed > 18) this.hud.toast('POWER HIT  +20'); }
    if (kind === 'pad' && local) { this.padCount++; this.hud.boostPickup(!!event.big); this.view.audio.pickup(); if (event.big) this.hud.toast('BOOST RECHARGED'); }
    if (kind === 'flip-reset' && local) { this.hud.toast('FLIP RESET  +50'); this.view.audio.flipReset(); }
    if (kind === 'jump') this.view.audio.jump(!!event.dodge, ...this.soundPosition(position));
    if (kind === 'land') this.view.audio.land(speed, ...this.soundPosition(position));
    if (kind === 'bounce') this.view.audio.hit(speed, ...this.soundPosition(position));
    if (kind === 'demo') {
      const distance = position.distanceTo(new Vector3().copy(this.physics.localCar.body.translation()));
      this.view.effects.demolitions.trigger(position, new Vector3().copy(car.body.linvel()), new Quaternion().copy(car.body.rotation()), slot === 0 ? BLUE : ORANGE);
      this.view.audio.demolition(distance, this.soundPosition(position)[1]); this.view.shake = Math.max(this.view.shake, 1.1 / (1 + distance * .08));
      this.hud.toast(local ? 'DEMOLISHED · RESPAWNING' : 'DEMOLITION  +50');
    }
    if (kind === 'kickoff') { if (this.online) { this.paused = false; this.hud.pause(false); } this.view.audio.reset(); this.view.effects.explosion.reset(); this.view.effects.demolitions.reset(); this.view.cameraReady = false; this.view.clearNetworkCorrection(); this.hud.message(this.practice ? '' : '3', '', '', 'countdown'); }
    if (kind === 'countdown') { this.hud.message(String(event.number), '', '', 'countdown'); this.view.audio.countdown(false); }
    if (kind === 'go') { this.hud.message('GO!', '', '', 'countdown'); this.view.audio.countdown(true); }
    if (kind === 'clear-message') this.hud.message('');
    if (kind === 'overtime') this.hud.toast('OVERTIME · NEXT GOAL WINS');
    if (kind === 'goal') {
      const ownGoal = (event.team === 'blue' ? 0 : 1) === this.physics.localSlot;
      this.hud.message(ownGoal ? 'YOU SCORED!' : this.online ? 'OPPONENT SCORED!' : `${this.physics.botEnabled ? 'MAVERICK' : 'ORANGE'} SCORED!`, 'GOOOOOAL!', `${this.online?.prediction.confirmed.blue ?? this.blue} <span style="opacity:.5">—</span> ${this.online?.prediction.confirmed.orange ?? this.orange}`, 'goal', ownGoal);
      this.view.effects.goal(position, event.team === 'blue' ? BLUE : ORANGE); this.view.audio.goal(); this.view.shake = 1.8;
      const flash = this.hud.el('goal-flash'); flash.classList.remove('flash'); void flash.offsetWidth; flash.classList.add('flash');
    }
    if (kind === 'end') { this.view.effects.explosion.reset(); this.paused = true; this.hud.message(''); this.hud.pause(true, true, this.physics.localSlot === 0 ? this.blue > this.orange : this.orange > this.blue); }
  }
  frame(now: number) {
    requestAnimationFrame(t => this.frame(t));
    const dt = Math.min(.05, (now - (this.previous || now)) / 1000); this.previous = now;
    this.fps = this.fps * .97 + (dt > 0 ? 1 / dt : 60) * .03;
    this.syncMenu(); this.controls.poll(now); this.controlsMenu.update();
    const frozen = !!document.querySelector('#online-menu:not([hidden])') || this.visualSettings.visible || this.controlsMenu.visible || this.paused || this.help || this.phase === 'ended' || this.testing;
    if (this.online) {
      const input = frozen ? emptyInput() : this.controls.read();
      this.online.update(now, input);
      this.accumulator = 0;
    } else if (!frozen) {
      this.accumulator += dt;
      const input = this.controls.read();
      // Keep jump edges until a simulation step actually consumes them.
      if (input.jump && this.accumulator < STEP) this.controls.restoreJump();
      while (this.accumulator >= STEP) { this.tick(input); input.jump = false; this.accumulator -= STEP; }
    } else this.accumulator = 0;
    this.view.cameraLook = frozen ? 0 : this.controls.cameraLook();
    this.view.update(frozen && !this.online ? 0 : dt, this.phase, this.celebration, this.online ? 1 : frozen ? 1 : this.accumulator / STEP);
    const score = this.online?.prediction?.confirmed ?? this;
    this.view.stadium.presentation.setMatch(score.blue, score.orange, score.remaining, score.practice, score.overtime, score.phase);
    this.view.draw();
    const car = this.physics.localCar;
    this.hud.update({ blue: score.blue, orange: score.orange, time: Math.max(0, score.remaining), boost: car.boost, boosting: car.boosting && !frozen, speed: car.speed, supersonic: car.supersonic, unlimited: this.physics.unlimited, grounded: car.grounded, fps: this.fps, overtime: this.overtime, practice: this.practice }, frozen ? 0 : dt);
    this.positionLabels();
  }
  positionLabels() {
    const label = this.hud.el('bot-name'), bot = this.view.remoteModel.root;
    // Clear the roof or raised nose without floating far above a grounded car.
    const right = new Vector3(1, 0, 0).applyQuaternion(bot.quaternion), up = new Vector3(0, 1, 0).applyQuaternion(bot.quaternion), forward = new Vector3(0, 0, 1).applyQuaternion(bot.quaternion);
    const height = .6 * Math.abs(right.y) + .45 * Math.abs(up.y) + .9 * Math.abs(forward.y) + .3;
    const projected = bot.position.clone().add(new Vector3(0, height, 0)).project(this.view.camera);
    label.hidden = !(this.physics.botEnabled && this.physics.remoteCar.demolished <= 0 && Math.abs(projected.x) < .95 && Math.abs(projected.y) < .85 && projected.z >= -1 && projected.z < 1);
    this.hud.opponentBoost(this.physics.remoteCar.boost);
    label.style.left = `${(projected.x * .5 + .5) * innerWidth}px`; label.style.top = `${(-projected.y * .5 + .5) * innerHeight}px`;
  }
  snapshot() {
    const car = this.physics.localCar;
    return { phase: this.phase, practice: this.practice, paused: this.paused, blue: this.blue, orange: this.orange, remaining: this.remaining, overtime: this.overtime, boost: car.boost, unlimited: this.physics.unlimited, grounded: car.grounded, jumps: car.jumpCount, wheels: car.wheels, car: { ...car.body.translation() }, rotation: { ...car.body.rotation() }, velocity: { ...car.body.linvel() }, ball: { ...this.physics.ball.translation() }, ballVelocity: { ...this.physics.ball.linvel() }, hits: this.hits, pads: this.padCount, goals: this.goalCount, camera: this.view.camera.position.toArray(), fps: this.fps, drawCalls: this.view.renderer.info.render.calls };
  }
  advance(seconds: number, input: Partial<Input> = {}) {
    for (let i = 0; i < seconds / STEP; i++) this.tick({ ...emptyInput(), ...input, jump: i === 0 && !!input.jump });
    this.view.update(1 / 60, this.phase, this.celebration);
    this.view.stadium.presentation.setMatch(this.blue, this.orange, this.remaining, this.practice, this.overtime, this.phase);
    return this.snapshot();
  }
  scenario(name: string) {
    this.view.effects.demolitions.reset(); this.goalBlastPending = false;
    this.view.effects.explosion.reset(); this.practice = false; this.hud.mode(true); this.testing = true; this.paused = false; this.physics.botEnabled = false; this.phase = 'playing'; this.phaseTime = 0; this.remaining = 300; this.overtime = false; this.physics.reset(); this.hud.message('');
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
