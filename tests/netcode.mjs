import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const allocated = [];
try {
  const { Authority } = await vite.ssrLoadModule('/src/network/authority.ts');
  const { Prediction } = await vite.ssrLoadModule('/src/network/prediction.ts');
  const { Simulation } = await vite.ssrLoadModule('/src/simulation.ts');
  const { emptyInput } = await vite.ssrLoadModule('/src/config.ts');
  const P = await vite.ssrLoadModule('/src/network/protocol.ts');
  const input = (t, slot = 0) => P.canonicalInput({ ...emptyInput(), throttle: 1, steer: t % 480 < 240 ? slot ? -.17 : .13 : slot ? .23 : -.21, boost: t % 320 < 190, jump: t % 250 === 90 || t % 250 === 114, jumpHeld: t % 250 >= 90 && t % 250 < 108, drift: t % 620 > 580, dodgeForward: 1 });
  const commands = Array.from({ length: 12 }, (_, i) => ({ tick: i + 1, input: input(i) }));
  assert.deepEqual(P.decodeCommands(P.encodeCommands(42, commands), 42), commands);
  const packet = P.encodeCommands(42, commands);
  assert.equal(P.decodeCommands(packet, 43), null);
  assert.equal(P.decodeCommands(packet.subarray(0, 9), 42), null);
  assert.equal(P.decodeCommands(new Uint8Array(5000), 42), null);
  assert.equal(P.canonicalInput({ ...emptyInput(), throttle: NaN, steer: Infinity }).throttle, 0);
  const a = new Authority(); await a.init(); allocated.push(a.sim);
  a.ready = [true, true];
  a.receive(0, [{ tick: 1, input: input(90) }, { tick: 1, input: emptyInput() }, { tick: 50000, input: input(1) }]);
  const first = a.step(); assert.equal(first.inputs[0].jump, true);
  assert.equal(a.step().inputs[0].jump, false);
  assert.equal(a.stats.duplicate, 1); assert.equal(a.stats.rejected, 1);
  for (let i = 0; i < 15; i++) a.step();
  assert.equal(a.lastTick[0], 1); assert.equal(a.step().inputs[0].throttle, 0);
  console.log('PASS protocol boundaries, duplicate/late commands and released fallback input');
  // Fork an active solver after contact, then reproduce thousands of ticks exactly.
  for (let t = 0; t < 600; t++) { const tick = a.sim.tickNumber + 1; a.receive(0, [{ tick, input: input(t) }]); a.receive(1, [{ tick, input: input(t, 1) }]); a.step(); }
  const b = new Simulation(); await b.initPhysics(); allocated.push(b); b.restore(a.sim.checkpoint());
  for (let t = 0; t < 2400; t++) {
    const tick = a.sim.tickNumber + 1;
    for (const slot of [0, 1]) a.receive(slot, [{ tick, input: input(t, slot) }]);
    const f = a.step(); b.step(f.inputs, f.start);
    if (b.digest() !== a.sim.digest()) { const x = a.sim.physics.canonicalState(), y = b.physics.canonicalState(); const diff = (x,y,path='') => { if (JSON.stringify(x)===JSON.stringify(y)) return; if (x && typeof x==='object') for (const k of Object.keys(x)) diff(x[k],y[k],path+'.'+k); else console.log(path,x,y); }; diff(x,y); diff(a.sim.matchState(),b.matchState(),'match'); }
    assert.equal(b.digest(), a.sim.digest(), `restored solver drift at ${tick}`);
  }
  console.log('PASS 2,400 active-contact ticks reproduce from a complete checkpoint');
  // Both clients run ahead while packets arrive delayed, duplicated, reordered and lost.
  const clients = [];
  for (const slot of [0, 1]) { const sim = new Simulation(); await sim.initPhysics(); allocated.push(sim); const p = new Prediction(sim, slot); await p.init(); allocated.push(p.confirmed); p.baseline(a.sim.checkpoint()); clients.push(p); }
  let seed = 0x10203040;
  const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const outgoing = [], incoming = [], recent = [[], []], events = [new Set(), new Set()];
  clients.forEach((p, slot) => p.onEvent = e => { const id = JSON.stringify(e); assert(!events[slot].has(id), 'duplicate confirmed event'); events[slot].add(id); });
  const timings = [];
  for (let now = 0; now < 3600; now++) {
    for (const [slot, p] of clients.entries()) {
      while (p.predicted.tickNumber < a.sim.tickNumber + 18) {
        const c = p.predict(input(p.predicted.tickNumber + 1, slot)); recent[slot].push(c); if (recent[slot].length > 12) recent[slot].shift();
        if (c.tick % 2 === 0 && rand() > .08) outgoing.push({ at: now + 3 + Math.floor(rand() * 8), slot, bytes: P.encodeCommands(42, recent[slot]) });
      }
    }
    outgoing.sort((a, b) => a.at - b.at);
    while (outgoing[0]?.at <= now) { const packet = outgoing.shift(); a.receive(packet.slot, P.decodeCommands(packet.bytes, 42)); }
    a.step();
    if (now % 2 === 0) for (const slot of [0, 1]) if (rand() > .1) incoming.push({ at: now + 3 + Math.floor(rand() * 10), slot, bytes: P.encodeFrames(42, [...a.frames.values()].slice(-12)) });
    incoming.sort((a, b) => a.at - b.at);
    while (incoming[0]?.at <= now) { const packet = incoming.shift(); clients[packet.slot].receive(P.decodeFrames(packet.bytes, 42)); }
    for (const p of clients) {
      // Same bounded reliable history recovery used when a redundancy window is lost.
      if (now % 24 === 0) p.receive([...a.frames.values()].filter(f => f.tick > p.confirmed.tickNumber));
      const before = performance.now(); assert(p.reconcile(), `confirmed divergence at ${now}`); timings.push(performance.now() - before);
    }
  }
  for (const p of clients) {
    p.receive([...a.frames.values()].filter(f => f.tick > p.confirmed.tickNumber));
    while (p.confirmed.tickNumber < a.sim.tickNumber) assert(p.reconcile());
    assert.equal(p.confirmed.digest(), a.sim.digest()); assert(p.stats.corrections > 0); assert.equal(p.stats.desyncs, 0);
  }
  console.log('PASS two predicted clients, 3,600 ticks, 8–10% loss, jitter, reordering, recovery; both match authority');
  // Authoritative goal, kickoff, overtime and rematch reproduce without presentation callbacks.
  a.sim.phase = 'playing'; a.sim.physics.ball.setTranslation({ x: 0, y: 2, z: -44 }, true); a.sim.physics.ball.setLinvel({ x: 0, y: 0, z: -22 }, true);
  b.restore(a.sim.checkpoint());
  for (let t = 0; t < 700; t++) { const f = a.step(); b.step(f.inputs, f.start); assert.equal(b.digest(), a.sim.digest()); }
  assert.equal(a.sim.goalCount, 1); assert.equal(a.sim.blue, 1);
  a.sim.end(); a.rematches = [true, true]; const rematch = a.step(); assert(rematch.start); assert.equal(a.sim.blue, 0); assert.equal(a.sim.phase, 'countdown');
  console.log('PASS goal, blast, kickoff and two-party rematch authority');
  timings.sort((a, b) => a - b);
  const result = { ticks: 3600, clients: clients.map(p => p.stats), reconcileMs: { median: timings[Math.floor(timings.length / 2)], p95: timings[Math.floor(timings.length * .95)], max: timings.at(-1) }, authority: a.stats };
  await mkdir('test-results', { recursive: true }); await writeFile('test-results/netcode.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { for (const sim of allocated) sim.physics.world.free(); await vite.close(); }
