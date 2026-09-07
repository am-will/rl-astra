import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const { Authority } = await vite.ssrLoadModule('/src/network/authority.ts');
const { canonicalInput } = await vite.ssrLoadModule('/src/network/protocol.ts');
const { emptyInput } = await vite.ssrLoadModule('/src/config.ts');
const a = new Authority(); await a.init(); a.ready = [true, true];
const baseline = a.sim.checkpoint(), frames = [];
// Original server world continues uninterrupted. Chrome restores at independent
// times, including the contact-parent regression formerly failing on tick 742.
for (let tick = 1; tick <= 21600; tick++) {
  for (const slot of [0, 1]) a.receive(slot, [{ tick, input: canonicalInput({ ...emptyInput(), throttle: 1, steer: tick % 440 < 220 ? .2 : -.18, boost: tick % 380 < 160, jump: tick % 240 === 100 || tick % 240 === 122, jumpHeld: tick % 240 >= 100 && tick % 240 < 112, dodgeForward: 1 }) }]);
  const frame = a.step(); if (tick < 800) frame.hash = a.sim.digest(); frames.push(frame);
}
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage(); await page.goto('http://127.0.0.1:5179/tests/netcode.html');
  const result = await page.evaluate(async ({ saved, frames }) => {
    const { Simulation } = await import('/src/simulation.ts');
    const sim = new Simulation(); await sim.initPhysics();
    saved.physics.world = Uint8Array.from(atob(saved.physics.world), c => c.charCodeAt(0)); sim.restore(saved);
    const failures = [], times = [], restoreTimes = [];
    for (const f of frames) {
      const start = performance.now(); sim.step(f.inputs, f.start); times.push(performance.now() - start);
      if (f.hash && f.hash !== sim.digest()) { failures.push({ tick: f.tick, expected: f.hash, actual: sim.digest() }); break; }
      if (f.tick % 911 === 0) { const start = performance.now(); sim.restore(sim.checkpoint()); restoreTimes.push(performance.now()-start); }
    }
    const hash = sim.digest(); sim.physics.world.free(); times.sort((a,b)=>a-b); restoreTimes.sort((a,b)=>a-b);
    return { failures, hash, ticks: frames.length, tickP95Ms: times[Math.floor(times.length * .95)], maxMs: times.at(-1), checkpointP95Ms: restoreTimes[Math.floor(restoreTimes.length * .95)], chrome: navigator.userAgent };
  }, { saved: { ...baseline, physics: { ...baseline.physics, world: Buffer.from(baseline.physics.world).toString('base64') } }, frames });
  console.log(result); assert.deepEqual(result.failures, []); assert.equal(result.hash, a.sim.digest());
  await mkdir('test-results', { recursive: true }); await writeFile('test-results/cross-runtime.json', JSON.stringify(result, null, 2));
  console.log('PASS 21,600 ticks: Node and Chrome match through collisions and independent solver restoration');
} finally { a.sim.physics.world.free(); await browser.close(); await vite.close(); }
