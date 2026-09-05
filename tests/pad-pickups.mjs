import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const results = [], errors = [];
const check = (name, pass, detail) => { assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); results.push({ name, detail }); console.log(`PASS ${name}`); };
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5179');
  await page.waitForFunction(() => window.__game && !document.querySelector('#loading'));
  const cases = await page.evaluate(() => {
    const g = window.__game, physics = g.physics, car = physics.player, rows = [];
    physics.botEnabled = false; g.practice = true;
    for (const big of [false, true]) for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
      // Positions are relative to a single front/rear tire, beyond the old
      // center-only radius. Both signs cover every side of a rotated car.
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        g.scenario('drive');
        const pad = physics.pads.find(p => p.big === big), reach = big ? 1.45 : .97;
        const x = sx * (.5 + reach / Math.SQRT2 + .08), z = sz * (.64 + reach / Math.SQRT2 + .08);
        physics.resetCar(car, pad.x + x * Math.cos(yaw) + z * Math.sin(yaw), pad.z - x * Math.sin(yaw) + z * Math.cos(yaw), yaw);
        car.boost = 15;
        const before = g.padCount; g.advance(1 / 60);
        rows.push({ big, yaw, sx, sz, boost: car.boost, cues: g.padCount - before, cooldown: pad.cooldown });
      }
    }
    return rows;
  });
  check('One tire grazing either pad collects at every tested heading', cases.every(c => c.boost === (c.big ? 100 : 27) && c.cues === 1 && c.cooldown > 0), cases);

  const guards = await page.evaluate(() => {
    const g = window.__game, p = g.physics, car = p.player, rows = [];
    for (const big of [false, true]) for (const mode of ['miss', 'air', 'full', 'cooldown', 'demolished']) {
      g.scenario('drive');
      const pad = p.pads.find(pad => pad.big === big);
      p.resetCar(car, pad.x + (mode === 'miss' ? (big ? 2.7 : 2.2) : 0), pad.z);
      car.boost = mode === 'full' ? 100 : 15;
      if (mode === 'air') car.body.setTranslation({ x: pad.x, y: 2, z: pad.z }, true);
      if (mode === 'cooldown') pad.cooldown = 3;
      if (mode === 'demolished') p.demolish(car);
      const before = g.padCount; g.advance(1 / 60);
      rows.push({ big, mode, boost: car.boost, cues: g.padCount - before, cooldown: pad.cooldown });
    }
    return rows;
  });
  check('Clear misses, airborne cars, full tanks and unavailable pads do not collect', guards.every(c => c.cues === 0 && c.boost === (c.mode === 'full' ? 100 : 15) && (c.mode === 'cooldown' || c.cooldown === 0)), guards);

  const repeat = await page.evaluate(() => {
    const g = window.__game, p = g.physics, car = p.player;
    g.scenario('drive'); const pad = p.pads.find(pad => !pad.big);
    p.resetCar(car, pad.x, pad.z); car.boost = 15;
    const before = g.padCount; g.advance(.3);
    const first = { boost: car.boost, cues: g.padCount - before, cooldown: pad.cooldown };
    g.advance(4.1);
    return { first, after: { boost: car.boost, cues: g.padCount - before } };
  });
  check('Overlapping for many frames plays once; the pad becomes collectible after respawn', repeat.first.boost === 27 && repeat.first.cues === 1 && repeat.after.boost === 39 && repeat.after.cues === 2, repeat);

  const drive = await page.evaluate(() => {
    const g = window.__game, p = g.physics, rows = [];
    for (const big of [false, true]) {
      g.scenario('drive'); const pad = p.pads.find(pad => pad.big === big);
      // Drive alongside the pad. The chassis center never crosses it.
      p.resetCar(p.player, pad.x + (big ? 2.03 : 1.55), pad.z + 3);
      p.player.boost = 15; const before = g.padCount; g.advance(1.2, { throttle: 1 });
      rows.push({ big, boost: p.player.boost, cues: g.padCount - before, z: p.player.body.translation().z - pad.z });
    }
    return rows;
  });
  check('Driving along the outside edge collects small and large pads', drive.every(c => c.boost === (c.big ? 100 : 27) && c.cues === 1 && c.z < -1), drive);
  check('No browser errors', errors.length === 0, errors);
  await mkdir('test-results/pad-pickups', { recursive: true });
  await writeFile('test-results/pad-pickups/checks.json', JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); }
