import { Vector3 } from 'three';
import { Physics, type PhysicsCheckpoint } from './physics';
import { emptyInput, MATCH_LENGTH, STEP, FIELD, type Input } from './config';

export type Slot = 0 | 1;
export type Phase = 'ready' | 'countdown' | 'playing' | 'goal' | 'ended';
export interface MatchEvent { tick: number; sequence: number; kind: string; slot?: Slot; position?: number[]; speed?: number; big?: boolean; dodge?: boolean; team?: 'blue' | 'orange'; number?: number; }
export interface MatchState {
  tickNumber: number; phase: Phase; blue: number; orange: number; remaining: number; overtime: boolean;
  phaseTime: number; elapsed: number; goalCount: number; lastCountdown: number; practice: boolean;
  goalBlastPending: boolean; celebration: number[];
}
export interface Checkpoint { physics: PhysicsCheckpoint; match: MatchState; }

export class Simulation {
  physics = new Physics();
  tickNumber = 0; phase: Phase = 'ready';
  blue = 0; orange = 0; remaining = MATCH_LENGTH; overtime = false;
  phaseTime = 0; elapsed = 0; goalCount = 0; lastCountdown = 0; practice = false;
  goalBlastPending = false; celebration = new Vector3();
  onEvent: (event: MatchEvent) => void = () => {};
  private eventSequence = 0;
  emit(event: Omit<MatchEvent, 'tick' | 'sequence'>) { this.onEvent({ ...event, tick: this.tickNumber, sequence: this.eventSequence++ }); }
  async initPhysics() {
    await this.physics.init();
    const slot = (car: typeof this.physics.player): Slot => car === this.physics.player ? 0 : 1;
    this.physics.onHit = (p, speed, player) => this.emit({ kind: 'hit', position: p.toArray(), speed, slot: player ? 0 : 1 });
    this.physics.onPad = (big, car) => this.emit({ kind: 'pad', big, slot: car ? slot(car) : 0 });
    this.physics.onFlipReset = car => this.emit({ kind: 'flip-reset', slot: car ? slot(car) : 0 });
    this.physics.onDemo = car => this.emit({ kind: 'demo', slot: slot(car), position: new Vector3().copy(car.body.translation()).toArray() });
    this.physics.onJump = (car, dodge) => this.emit({ kind: 'jump', slot: slot(car), dodge, position: new Vector3().copy(car.body.translation()).toArray() });
    this.physics.onLand = (car, speed) => this.emit({ kind: 'land', slot: slot(car), speed, position: new Vector3().copy(car.body.translation()).toArray() });
    this.physics.onBounce = (p, speed) => this.emit({ kind: 'bounce', position: p.toArray(), speed });
  }
  kickoff() {
    this.goalBlastPending = false;
    this.phase = this.practice ? 'playing' : 'countdown'; this.phaseTime = this.practice ? 0 : 3; this.lastCountdown = 0;
    this.emit({ kind: 'kickoff' });
  }
  resetMatch() {
    this.blue = this.orange = this.goalCount = 0; this.remaining = this.practice ? 0 : MATCH_LENGTH;
    this.overtime = false; this.goalBlastPending = false; this.phase = this.practice ? 'playing' : 'ready'; this.phaseTime = 0;
    this.physics.reset();
  }
  step(inputs: [Input, Input], start = false) {
    this.tickNumber++; this.eventSequence = 0; this.elapsed += STEP;
    if (start && (this.phase === 'ready' || this.phase === 'ended')) { this.resetMatch(); this.kickoff(); }
    if (this.phase === 'ready' || this.phase === 'countdown') {
      this.physics.step(emptyInput(), emptyInput());
      if (this.phase === 'countdown') {
        this.physics.player.throttle = inputs[0].boost ? 1 : inputs[0].throttle;
        this.physics.bot.throttle = inputs[1].boost ? 1 : inputs[1].throttle;
        this.phaseTime -= STEP; const number = Math.ceil(this.phaseTime);
        if (number !== this.lastCountdown && number > 0) { this.emit({ kind: 'countdown', number }); this.lastCountdown = number; }
        if (this.phaseTime <= 0) { this.phase = 'playing'; this.phaseTime = .85; this.emit({ kind: 'go' }); }
      }
    } else if (this.phase === 'playing') {
      if (this.phaseTime > 0) { this.phaseTime -= STEP; if (this.phaseTime <= 0) this.emit({ kind: 'clear-message' }); }
      this.physics.step(...inputs);
      if (!this.practice && this.physics.botEnabled) this.remaining += this.overtime ? STEP : -STEP;
      const goal = this.physics.goal();
      if (goal) this.score(goal);
      else if (!this.practice && this.remaining <= 0 && !this.overtime && this.physics.ball.translation().y <= FIELD.ballRadius + .12) {
        if (this.blue === this.orange) { this.overtime = true; this.remaining = 0; this.physics.reset(); this.kickoff(); this.emit({ kind: 'overtime' }); }
        else this.end();
      }
    } else if (this.phase === 'goal') {
      this.phaseTime -= STEP;
      if (this.goalBlastPending && this.phaseTime <= 4.38) { this.goalBlastPending = false; this.physics.goalBlast(this.celebration); }
      this.physics.step(...inputs);
      if (this.phaseTime <= 0) {
        if (!this.practice && (this.overtime || (this.remaining <= 0 && this.blue !== this.orange))) this.end();
        else { this.physics.reset(); this.kickoff(); }
      }
    }
  }
  score(team: 'blue' | 'orange') {
    if (this.phase !== 'playing') return;
    if (team === 'blue') this.blue++; else this.orange++;
    this.goalCount++; this.phase = 'goal'; this.phaseTime = 4.6; this.goalBlastPending = true;
    this.celebration.copy(this.physics.ball.translation()); this.physics.ball.setEnabled(false);
    this.emit({ kind: 'goal', team, position: this.celebration.toArray() });
  }
  end() { this.phase = 'ended'; this.emit({ kind: 'end' }); }
  matchState(): MatchState {
    const { tickNumber, phase, blue, orange, remaining, overtime, phaseTime, elapsed, goalCount, lastCountdown, practice, goalBlastPending } = this;
    return { tickNumber, phase, blue, orange, remaining, overtime, phaseTime, elapsed, goalCount, lastCountdown, practice, goalBlastPending, celebration: this.celebration.toArray() };
  }
  checkpoint(): Checkpoint { return { physics: this.physics.checkpoint(), match: this.matchState() }; }
  restore(saved: Checkpoint) {
    this.physics.restore(saved.physics);
    const { celebration, ...state } = saved.match; Object.assign(this, state); this.celebration.fromArray(celebration);
  }
  digest(): string {
    // Hash gameplay-relevant state, not opaque serializer bookkeeping. Two 32-bit hashes
    // detect drift; authentication comes from the transport, never from this checksum.
    const text = JSON.stringify([this.matchState(), this.physics.canonicalState()]);
    let a = 2166136261, b = 5381;
    for (let i = 0; i < text.length; i++) { const n = text.charCodeAt(i); a = Math.imul(a ^ n, 16777619); b = Math.imul(b, 33) ^ n; }
    return `${a >>> 0}:${b >>> 0}`;
  }
}
