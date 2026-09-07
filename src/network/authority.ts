import { Simulation } from '../simulation';
import { emptyInput, type Input } from '../config';
import { MAX_LEAD, SERVER_HISTORY, canonicalInput, heldInput, type Command, type Frame } from './protocol';

export class Authority {
  sim = new Simulation();
  queues = [new Map<number, Input>(), new Map<number, Input>()];
  last: [Input, Input] = [emptyInput(), emptyInput()];
  lastTick = [0, 0];
  ready = [false, false];
  rematches = [false, false];
  frames = new Map<number, Frame>();
  stats = { expired: 0, rejected: 0, duplicate: 0, fallback: [0, 0], steps: 0 };
  async init() { await this.sim.initPhysics(); }
  receive(slot: 0 | 1, commands: Command[]) {
    for (const command of commands) {
      if (!Number.isInteger(command.tick) || command.tick > this.sim.tickNumber + MAX_LEAD) { this.stats.rejected++; continue; }
      if (command.tick <= this.sim.tickNumber) { this.stats.expired++; continue; }
      if (this.queues[slot].has(command.tick)) { this.stats.duplicate++; continue; }
      this.queues[slot].set(command.tick, canonicalInput(command.input));
    }
  }
  disconnect(slot: 0 | 1) { this.ready[slot] = false; this.queues[slot].clear(); this.last[slot] = emptyInput(); this.rematches[slot] = false; }
  step(): Frame {
    const tick = this.sim.tickNumber + 1;
    const inputs = [0, 1].map(slot => {
      const input = this.ready[slot] ? this.queues[slot].get(tick) : undefined;
      this.queues[slot].delete(tick);
      if (input) { this.last[slot] = input; this.lastTick[slot] = tick; return input; }
      this.stats.fallback[slot]++;
      return this.ready[slot] && tick - this.lastTick[slot] <= 12 ? heldInput(this.last[slot]) : canonicalInput(emptyInput());
    }) as [Input, Input];
    const start = this.ready.every(Boolean) && (this.sim.phase === 'ready' || this.sim.phase === 'ended' && this.rematches.every(Boolean));
    if (start) this.rematches.fill(false);
    this.sim.step(inputs, start); this.stats.steps++;
    const frame = { tick, inputs, start, hash: tick % 8 === 0 ? this.sim.digest() : '' };
    this.frames.set(tick, frame); this.frames.delete(tick - SERVER_HISTORY);
    return frame;
  }
}
