import { Simulation, type Checkpoint, type MatchEvent, type Slot } from '../simulation';
import { emptyInput, type Input } from '../config';
import { HISTORY, canonicalInput, heldInput, type Frame, type Command } from './protocol';

export interface CorrectionSample { tick: number; transition: boolean; confirmedTick: number; replayTicks: number; milliseconds: number; bodies: { distance: number; radians: number; offset: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number } }[]; }
const poses = (sim: Simulation) => [sim.physics.player.body, sim.physics.bot.body, sim.physics.ball].map(body => ({ p: body.translation(), q: body.rotation() }));

// A confirmed world consumes only inputs actually applied by the server. Predictions
// never contaminate it. Corrections clone the complete engine, not just body poses.
export class Prediction {
  confirmed = new Simulation();
  pending = new Map<number, Frame>();
  commands = new Map<number, Input>();
  hashes = new Map<number, string>();
  applied = new Map<number, string>();
  remote = canonicalInput(emptyInput());
  remoteTick = 0;
  stats = { corrections: 0, desyncs: 0, replayTicks: 0, lastCorrectionMs: 0, maxCorrectionMs: 0 };
  lastDesync: { tick: number; expected: string; actual: string } | null = null;
  lastCorrection: CorrectionSample | null = null;
  onEvent: (e: MatchEvent) => void = () => {};
  onConfirmed: (frame: Frame) => void = () => {};
  onCorrection: (sample: CorrectionSample) => void = () => {};
  constructor(public predicted: Simulation, public slot: Slot) {}
  async init() { await this.confirmed.initPhysics(); }
  baseline(saved: Checkpoint) {
    this.confirmed.restore(saved); this.predicted.restore(saved);
    this.pending.clear(); this.commands.clear(); this.hashes.clear(); this.applied.clear();
    this.remote = canonicalInput(emptyInput()); this.remoteTick = saved.match.tickNumber;
  }
  predict(input: Input): Command {
    const tick = this.predicted.tickNumber + 1, normalized = canonicalInput(input);
    this.commands.set(tick, normalized);
    const pair: [Input, Input] = [canonicalInput(emptyInput()), canonicalInput(emptyInput())];
    // The authority already releases missing commands after 100 ms. A healthy
    // opponent keeps sending held controls; don't invent a release merely because
    // our prediction horizon is longer than that timeout on a higher-latency link.
    pair[this.slot] = normalized; pair[1 - this.slot] = heldInput(this.remote);
    this.applied.set(tick, JSON.stringify(pair));
    this.predicted.step(pair);
    if (tick % 8 === 0) this.hashes.set(tick, this.predicted.digest());
    this.trim();
    return { tick, input: normalized };
  }
  receive(frames: Frame[]) {
    for (const frame of frames) if (frame.tick > this.confirmed.tickNumber && frame.tick <= this.confirmed.tickNumber + HISTORY) this.pending.set(frame.tick, frame);
  }
  reconcile(): boolean {
    let frame: Frame | undefined, different = false;
    const events: MatchEvent[] = [];
    this.confirmed.onEvent = e => events.push(e);
    // Keep work bounded; missing frames are explicitly recovered by the transport.
    let count = 0;
    while (count++ < 64 && (frame = this.pending.get(this.confirmed.tickNumber + 1))) {
      this.pending.delete(frame.tick);
      this.confirmed.step(frame.inputs, frame.start);
      // React to an unexpected jump, steer, or boost as soon as its applied
      // frame arrives; don't wait up to eight extra ticks for the next checksum.
      const predictedInputs = this.applied.get(frame.tick);
      if (predictedInputs !== undefined && predictedInputs !== JSON.stringify(frame.inputs)) different = true;
      this.remote = frame.inputs[1 - this.slot]; this.remoteTick = frame.tick;
      if (frame.hash) {
        const digest = this.confirmed.digest();
        if (digest !== frame.hash) { this.stats.desyncs++; this.lastDesync = { tick: frame.tick, expected: frame.hash, actual: digest }; console.warn('Simulation drift', this.lastDesync); return false; }
        if (this.hashes.get(frame.tick) !== digest) different = true;
      }
      if (frame.start) different = true;
      this.onConfirmed(frame);
    }
    if (different || this.predicted.tickNumber < this.confirmed.tickNumber) {
      const start = performance.now(), end = this.predicted.tickNumber;
      const before = poses(this.predicted);
      const saved = this.confirmed.checkpoint();
      this.predicted.restore(saved);
      for (const tick of this.hashes.keys()) if (tick >= saved.match.tickNumber) this.hashes.delete(tick);
      for (const tick of this.applied.keys()) if (tick >= saved.match.tickNumber) this.applied.delete(tick);
      for (let tick = saved.match.tickNumber + 1; tick <= end && tick <= saved.match.tickNumber + 64; tick++) {
        this.predict(this.commands.get(tick) ?? canonicalInput(emptyInput())); this.stats.replayTicks++;
      }
      this.stats.corrections++; this.stats.lastCorrectionMs = performance.now() - start;
      this.stats.maxCorrectionMs = Math.max(this.stats.maxCorrectionMs, this.stats.lastCorrectionMs);
      // Compare the old and corrected prediction at the SAME tick. Comparing a
      // rendered previous frame to a newer physics tick counts ordinary motion as error.
      if (end === this.predicted.tickNumber) { this.lastCorrection = { tick: end, transition: events.some(e => e.kind === 'kickoff'), confirmedTick: saved.match.tickNumber,
        replayTicks: Math.max(0, end - saved.match.tickNumber), milliseconds: this.stats.lastCorrectionMs,
        bodies: poses(this.predicted).map(({ p, q }, i) => ({
          distance: Math.hypot(p.x - before[i].p.x, p.y - before[i].p.y, p.z - before[i].p.z),
          radians: 2 * Math.acos(Math.min(1, Math.abs(q.x * before[i].q.x + q.y * before[i].q.y + q.z * before[i].q.z + q.w * before[i].q.w) / (Math.hypot(q.x,q.y,q.z,q.w) * Math.hypot(before[i].q.x,before[i].q.y,before[i].q.z,before[i].q.w)))),
          offset: { x: before[i].p.x - p.x, y: before[i].p.y - p.y, z: before[i].p.z - p.z },
          rotation: { x: -before[i].q.w*q.x+before[i].q.x*q.w-before[i].q.y*q.z+before[i].q.z*q.y,
            y: -before[i].q.w*q.y+before[i].q.x*q.z+before[i].q.y*q.w-before[i].q.z*q.x,
            z: -before[i].q.w*q.z-before[i].q.x*q.y+before[i].q.y*q.x+before[i].q.z*q.w,
            w: before[i].q.w*q.w+before[i].q.x*q.x+before[i].q.y*q.y+before[i].q.z*q.z },
        })) }; this.onCorrection(this.lastCorrection); }
    }
    for (const e of events) this.onEvent(e);
    this.trim();
    return true;
  }
  trim() {
    for (const tick of this.commands.keys()) if (tick <= this.confirmed.tickNumber || tick < this.predicted.tickNumber - HISTORY) this.commands.delete(tick);
    for (const tick of this.hashes.keys()) if (tick < this.confirmed.tickNumber - 8) this.hashes.delete(tick);
    for (const tick of this.applied.keys()) if (tick <= this.confirmed.tickNumber || tick < this.predicted.tickNumber - HISTORY) this.applied.delete(tick);
  }
  dispose() { this.confirmed.physics.world.free(); }
}
