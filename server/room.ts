import { parentPort, workerData } from 'node:worker_threads';
import { Authority } from '../src/network/authority';
import { encodeFrames, decodeCommands, HISTORY, SERVER_HISTORY, type Frame } from '../src/network/protocol';
const port = parentPort!;
const authority = new Authority();
await authority.init();
let next = performance.now(), steps = 0, busy = 0, maxStep = 0;
let replay: Frame[] = [];
let baselineRequests: string[] = [];
port.on('message', message => {
  if (message.type === 'input') {
    const commands = decodeCommands(message.bytes, workerData.epoch);
    if (commands) authority.receive(message.slot, commands);
  }
  if (message.type === 'ready') authority.ready[message.slot] = true;
  if (message.type === 'disconnect') authority.disconnect(message.slot);
  if (message.type === 'rematch') authority.rematches[message.slot] = true;
  if (message.type === 'baseline') baselineRequests.push(message.request);
  if (message.type === 'recover') {
    const from = message.from;
    if (!Number.isInteger(from) || from < authority.sim.tickNumber - SERVER_HISTORY + 1 || from > authority.sim.tickNumber) return;
    const frames = [...authority.frames.values()].filter(f => f.tick >= from).slice(0, HISTORY);
    for (let i = 0; i < frames.length; i += 24) port.postMessage({ type: 'recover', slot: message.slot, bytes: encodeFrames(workerData.epoch, frames.slice(i, i + 24)) });
  }
});
port.postMessage({ type: 'initialized' });
setInterval(() => {
  const now = performance.now();
  if (now - next > 2000) { port.postMessage({ type: 'fatal', reason: 'Server could not maintain match timing' }); process.exitCode = 1; process.exit(); }
  let count = 0;
  while (now >= next && count++ < 8) {
    const started = performance.now(), frame = authority.step();
    const duration = performance.now() - started;
    busy += duration; maxStep = Math.max(maxStep, duration); steps++;
    replay.push(frame);
    if (baselineRequests.length) {
      const saved = authority.sim.checkpoint();
      port.postMessage({ type: 'baseline', requests: baselineRequests, saved }, [saved.physics.world.buffer as ArrayBuffer]);
      baselineRequests = [];
    }
    if (frame.tick % 2 === 0) port.postMessage({ type: 'frames', tick: frame.tick, bytes: encodeFrames(workerData.epoch, [...authority.frames.values()].slice(-12)) });
    if (frame.tick % 120 === 0) {
      port.postMessage({ type: 'stats', tick: frame.tick, meanStepMs: busy / steps, maxStepMs: maxStep, behindMs: Math.max(0, now - next), ...authority.stats });
      port.postMessage({ type: 'replay', frames: replay }); replay = []; busy = steps = maxStep = 0;
    }
    next += 1000 / 120;
  }
}, 2);
