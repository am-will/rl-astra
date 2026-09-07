import { Authority } from '../src/network/authority';
import { canonicalInput } from '../src/network/protocol';
import { emptyInput } from '../src/config';
import os from 'node:os';
const a = new Authority(); await a.init(); a.ready = [true, true];
const times: number[] = [], rebases: number[] = [];
for (let tick = 1; tick <= 14400; tick++) {
  for (const slot of [0, 1] as const) a.receive(slot, [{ tick, input: canonicalInput({ ...emptyInput(), throttle: 1, steer: tick % 600 < 300 ? .15 : -.2, boost: tick % 400 < 220, jump: tick % 250 === 90, jumpHeld: tick % 250 > 90 && tick % 250 < 110 }) }]);
  const start = performance.now(); a.step(); if (tick % 1200 === 0) a.sim.checkpoint(); const ms = performance.now() - start;
  if (tick % 1200 === 0) rebases.push(ms); else if (tick > 120) times.push(ms);
}
const summary = (v: number[]) => { v.sort((a,b)=>a-b); return { median: v[Math.floor(v.length*.5)], p95: v[Math.floor(v.length*.95)], p99: v[Math.floor(v.length*.99)], max: v.at(-1) }; };
console.log(JSON.stringify({ node: process.version, cpu: os.cpus()[0]?.model, threads: os.cpus().length, tickBudgetMs: 1000/120, tickMs: summary(times), checkpointMs: summary(rebases), memory: process.memoryUsage(), tick: a.sim.tickNumber, hash: a.sim.digest() }, null, 2));
a.sim.physics.world.free();
