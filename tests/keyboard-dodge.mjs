import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // A connected physical controller must not steer the automated keyboard run.
  await page.addInitScript(() => Object.defineProperty(navigator, 'getGamepads', { value: () => [] }));
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5179');
  await page.waitForFunction(() => window.__game?.view && !document.querySelector('#loading'));
  await page.evaluate(() => {
    const g = window.__game; g.scenario('drive'); g.physics.resetCar(g.physics.player, 12, 29);
  });
  // Use actual browser keyboard events and the game's input/tick path. Measure
  // simulation time so a slow renderer cannot swallow the second jump or turn
  // a short dodge into several seconds of wall-clock time in this test.
  const advance = frames => page.evaluate(frames => {
    const g = window.__game;
    for (let i = 0; i < frames; i++) g.tick(g.controls.read());
  }, frames);
  await page.keyboard.down('w'); await advance(60);
  await page.keyboard.down('Space'); await advance(11);
  await page.keyboard.up('Space'); await advance(11);
  await page.keyboard.down('Space'); await advance(1);
  assert.ok(await page.evaluate(() => window.__game.physics.player.flipTime > 0), 'Second keyboard jump starts a dodge');
  await page.keyboard.up('Space');
  const trace = await page.evaluate(() => {
    const g = window.__game, trace = [];
    for (let i = 1; i <= 180; i++) {
      g.tick(g.controls.read()); const c = g.physics.player;
      const q = c.body.rotation();
      trace.push({ age: (i + 1) / 120, q: { ...q }, up: 1 - 2 * (q.x * q.x + q.z * q.z), y: c.body.translation().y, flip: c.flipTime, lock: c.pitchLock, grounded: c.grounded, heldForward: g.controls.keys.has('KeyW') });
    }
    g.view.update(0, 'playing'); return trace;
  });
  await page.keyboard.up('w');
  await mkdir('test-results/refinements', { recursive: true });
  await writeFile('test-results/refinements/keyboard-dodge.json', JSON.stringify(trace, null, 2));
  assert.ok(trace.some(f => f.up < -.98), 'Real keyboard dodge passes through an inverted attitude');
  assert.ok(trace.some(f => f.age > .5 && f.age < .65 && f.flip === 0 && f.up > .95), 'Dodge follows through upright within 650 ms with W still held');
  assert.ok(trace.filter(f => f.age > .75 && f.age < .95).every(f => f.up > .97), 'Recovery stays near level instead of continuing nose-down');
  assert.ok(trace.some(f => f.age > .8 && f.age < 1.5 && f.grounded && f.up > .99), 'Held W lands the car on its wheels');
  console.log('PASS Real keyboard dodge follows through and lands on its wheels with W held');
} finally { await browser.close(); }
