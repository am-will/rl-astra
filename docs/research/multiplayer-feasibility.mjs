// Research probe only: does not implement networking or change game sources.
// Run from any directory: node /path/to/rl-astra/docs/research/multiplayer-feasibility.mjs
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const server = await createServer({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom',
});
const worlds = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const gameplay = p => ({
  cars: [p.player, p.bot].map(c => Object.fromEntries(Object.entries(c)
    .filter(([key]) => !['body', 'collider'].includes(key))
    .map(([key, value]) => [key, value?.clone ? value.clone() : value]))),
  pads: structuredClone(p.pads), unlimited: p.unlimited, botEnabled: p.botEnabled,
});
const bodies = p => [p.player.body, p.bot.body, p.ball].map(b => ({
  position: b.translation(), rotation: b.rotation(), velocity: b.linvel(), angularVelocity: b.angvel(),
  enabled: b.isEnabled(), sleeping: b.isSleeping(),
}));
const observable = p => JSON.stringify({ gameplay: gameplay(p), bodies: bodies(p) });
const capture = p => ({
  bytes: p.world.takeSnapshot(), gameplay: gameplay(p),
  ball: p.ball.handle, ballCollider: p.ballCollider.handle,
  handles: [p.player, p.bot].map(c => [c.body.handle, c.collider.handle]),
});
function restore(p, saved) {
  const start = performance.now();
  const world = p.world.constructor.restoreSnapshot(saved.bytes);
  const milliseconds = performance.now() - start;
  p.world.free(); p.world = world;
  p.ball = world.getRigidBody(saved.ball); p.ballCollider = world.getCollider(saved.ballCollider);
  for (const [i, car] of [p.player, p.bot].entries()) {
    Object.assign(car, saved.gameplay.cars[i]);
    car.body = world.getRigidBody(saved.handles[i][0]);
    car.collider = world.getCollider(saved.handles[i][1]);
  }
  p.pads = saved.gameplay.pads; p.unlimited = saved.gameplay.unlimited; p.botEnabled = saved.gameplay.botEnabled;
  // Per-step scratch velocities and previous ball poses are overwritten by step().
  // Camera handles are unchanged; no rendering, match lifecycle, or callbacks are restored.
  return milliseconds;
}
function distribution(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { count: sorted.length, median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], max: sorted.at(-1) };
}

try {
  const { Physics } = await server.ssrLoadModule('/src/physics.ts');
  const { emptyInput } = await server.ssrLoadModule('/src/config.ts');
  const { arenaSurfaces } = await server.ssrLoadModule('/src/arena.ts');
  const p = new Physics(), q = new Physics();
  await p.init(); worlds.push(p); await q.init(); worlds.push(q);
  const inputs = i => [
    { ...emptyInput(), throttle: 1, boost: i % 300 < 150, steer: i % 400 < 200 ? .13 : -.2,
      jump: i % 240 === 90 || i % 240 === 112, jumpHeld: i % 240 >= 90 && i % 240 < 104, dodgeForward: 1 },
    { ...emptyInput(), throttle: 1, boost: i % 280 < 120, steer: i % 360 < 180 ? -.15 : .22,
      jump: i % 300 === 110, jumpHeld: i % 300 >= 110 && i % 300 < 124 },
  ];
  const stepTimes = [], checkpoints = [];
  for (let i = 0; i < 1200; i++) {
    const input = inputs(i), start = performance.now();
    p.step(...input); stepTimes.push(performance.now() - start); q.step(...input);
    if ((i + 1) % 120 === 0) checkpoints.push({ tick: i + 1,
      worldBytesEqual: hash(p.world.takeSnapshot()) === hash(q.world.takeSnapshot()),
      observableStateEqual: observable(p) === observable(q) });
  }
  const saved = capture(p);
  for (let i = 1200; i < 1320; i++) p.step(...inputs(i));
  const expectedWorld = hash(p.world.takeSnapshot()), expectedState = observable(p);
  const firstRestoreMs = restore(p, saved), replayStart = performance.now();
  for (let i = 1200; i < 1320; i++) p.step(...inputs(i));
  const replay120Ms = performance.now() - replayStart;
  const replay = { worldBytesEqual: expectedWorld === hash(p.world.takeSnapshot()),
    observableStateEqual: expectedState === observable(p), firstRestoreMs, replay120Ms };
  const snapshotTimes = [], restoreTimes = [];
  for (let i = 0; i < 12; i++) {
    let start = performance.now(); const bytes = p.world.takeSnapshot(); snapshotTimes.push(performance.now() - start);
    start = performance.now(); const world = p.world.constructor.restoreSnapshot(bytes);
    restoreTimes.push(performance.now() - start); world.free();
  }

  const cases = [];
  for (const scenario of ['ball-strike', 'head-on-cars', 'wall-drive']) {
    p.botEnabled = scenario === 'head-on-cars'; p.reset();
    if (scenario === 'ball-strike') {
      p.resetCar(p.player, 0, 4.5); p.player.body.setLinvel({ x: 0, y: 0, z: -20 }, true);
    } else if (scenario === 'head-on-cars') {
      p.resetCar(p.player, 0, 3); p.resetCar(p.bot, 0, -3, Math.PI);
      p.player.body.setLinvel({ x: 0, y: 0, z: -23 }, true);
      p.bot.body.setLinvel({ x: 0, y: 0, z: 15 }, true);
      p.ball.setTranslation({ x: 20, y: 2, z: 20 }, true);
    } else p.resetCar(p.player, 28, 10, -Math.PI / 2);
    const input = { ...emptyInput(), throttle: 1, boost: true };
    for (let i = 0; i < 5; i++) p.step(input, input);
    const checkpoint = capture(p), history = [], events = [];
    p.onHit = () => events.push('hit'); p.onDemo = () => events.push('demo'); p.onLand = () => events.push('land');
    for (let i = 0; i < 240; i++) { p.step(input, input); history.push(observable(p)); }
    const expectedHash = hash(p.world.takeSnapshot()), expectedEvents = [...events]; events.length = 0;
    restore(p, checkpoint);
    const initialWorldBytesEqual = hash(checkpoint.bytes) === hash(p.world.takeSnapshot());
    let firstObservableMismatch = null;
    for (let i = 0; i < 240; i++) {
      p.step(input, input);
      if (firstObservableMismatch === null && history[i] !== observable(p)) firstObservableMismatch = i + 1;
    }
    cases.push({ scenario, initialWorldBytesEqual, finalWorldBytesEqual: expectedHash === hash(p.world.takeSnapshot()),
      firstObservableMismatch, eventsEqual: JSON.stringify(expectedEvents) === JSON.stringify(events), events: expectedEvents });
  }

  // Exercise a fresh world's first wall drive too: reset/contact history matters.
  const fresh = new Physics(); await fresh.init(); worlds.push(fresh);
  fresh.botEnabled = false; fresh.bot.body.setEnabled(false);
  fresh.resetCar(fresh.player, 28, 10, -Math.PI / 2);
  const wallInput = { ...emptyInput(), throttle: 1, boost: true };
  for (let i = 0; i < 5; i++) fresh.step(wallInput, wallInput);
  const freshCheckpoint = capture(fresh), freshHistory = [];
  for (let i = 0; i < 240; i++) { fresh.step(wallInput, wallInput); freshHistory.push(observable(fresh)); }
  const freshExpectedHash = hash(fresh.world.takeSnapshot());
  restore(fresh, freshCheckpoint);
  const freshInitialEqual = hash(freshCheckpoint.bytes) === hash(fresh.world.takeSnapshot());
  let freshFirstMismatch = null;
  for (let i = 0; i < 240; i++) {
    fresh.step(wallInput, wallInput);
    if (freshFirstMismatch === null && freshHistory[i] !== observable(fresh)) freshFirstMismatch = i + 1;
  }
  cases.push({ scenario: 'fresh-world-wall-drive', initialWorldBytesEqual: freshInitialEqual,
    finalWorldBytesEqual: freshExpectedHash === hash(fresh.world.takeSnapshot()), firstObservableMismatch: freshFirstMismatch });

  let vertices = 0, triangles = 0;
  for (const { geometry } of arenaSurfaces()) {
    vertices += geometry.getAttribute('position').count; triangles += geometry.index.count / 3; geometry.dispose();
  }
  // This is an arena-dominated snapshot comparison, not a dynamic-state serializer.
  const bytesBeforeRemovingBodies = p.world.takeSnapshot().length;
  for (const body of [p.player.body, p.bot.body, p.ball]) p.world.removeRigidBody(body);
  const bytesAfterRemovingBodies = p.world.takeSnapshot().length;
  console.log(JSON.stringify({
    date: new Date().toISOString(), runtime: process.version, cpu: os.cpus()[0].model,
    platform: process.platform, arch: process.arch, rapier: '0.19.3',
    scope: 'Same Node process; two cars and one ball; real Rapier and game physics; no networking, browser rendering, or Game lifecycle.',
    stepMs: distribution(stepTimes.slice(240)), snapshotBytes: saved.bytes.length,
    snapshotMs: distribution(snapshotTimes), restoreMs: distribution(restoreTimes), checkpoints, replay, cases,
    arena: { vertices, triangles, bytesBeforeRemovingBodies, bytesAfterRemovingBodies },
  }, null, 2));
} finally {
  for (const physics of worlds) physics.world.free();
  await server.close();
}
