import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const results = [], errors = [];
const check = (name, pass, detail) => { assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); results.push({ name, detail }); console.log(`PASS ${name}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5179');
  await page.waitForFunction(() => window.__game?.view && !document.querySelector('#loading'));
  check('Initial boost meter is full and accessible', await page.getByRole('meter', { name: 'Boost' }).getAttribute('aria-valuenow') === '100' && await page.locator('#boost').innerText() === '100', {});
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__game.phase === 'playing');
  await page.keyboard.down('Shift');
  await page.waitForFunction(() => window.__game.physics.player.boost < 62);
  const burning = await page.evaluate(() => {
    const g = window.__game, hud = document.querySelector('.boost-hud');
    return { actual: Math.ceil(g.physics.player.boost), number: Number(document.querySelector('#boost').textContent), active: hud.classList.contains('is-boosting'), fill: Number(document.querySelector('#boost-arc').style.strokeDashoffset), trail: Number(document.querySelector('#boost-lag-arc').style.strokeDashoffset) };
  });
  check('Real boost input drives the meter and keeps the number exact', burning.actual === burning.number && burning.active && burning.fill > 0 && burning.fill < 100, burning);
  check('Fuel drain leaves a brief trailing glow', burning.trail < burning.fill, burning);
  await page.keyboard.up('Shift'); await page.keyboard.up('w');
  await page.keyboard.press('Escape');
  const paused = await page.evaluate(() => ({ fill: document.querySelector('#boost-arc').style.strokeDashoffset, number: document.querySelector('#boost').textContent }));
  await page.waitForTimeout(250);
  check('Pause freezes the fuel sweep and stops boost flow', await page.evaluate(before => document.querySelector('#boost-arc').style.strokeDashoffset === before.fill && document.querySelector('#boost').textContent === before.number && !document.querySelector('.boost-hud').classList.contains('is-boosting'), paused), paused);
  await page.keyboard.press('Escape');

  for (const big of [false, true]) {
    await page.evaluate(big => {
      const g = window.__game; g.scenario(big ? 'big-pad' : 'pad'); g.controls.clear();
      g.physics.unlimited = false; g.view.cameraReady = false; g.testing = false; g.syncMenu(); window.previousPadCount = g.padCount;
    }, big);
    await page.keyboard.down('w');
    await page.waitForFunction(() => window.__game.padCount > window.previousPadCount);
    await page.keyboard.up('w');
    const pickup = await page.evaluate(() => {
      const label = document.querySelector('.boost-pickup'), value = document.querySelector('#boost');
      return { label: label.textContent, labelAnimating: label.getAnimations().some(a => a.playState === 'running'), valueAnimating: value.getAnimations().some(a => a.playState === 'running'), amount: value.textContent };
    });
    check(`${big ? 'Large' : 'Small'} pad pickup triggers the gauge animation`, pickup.label === (big ? 'FULL' : '+12') && pickup.labelAnimating && pickup.valueAnimating, pickup);
  }

  await page.evaluate(() => { const g = window.__game; g.physics.player.boost = 0; g.physics.player.boosting = false; });
  await page.waitForFunction(() => document.querySelector('#boost-arc').style.strokeDashoffset === '100');
  check('An empty tank has no live segments or fuel tip', await page.evaluate(() => document.querySelector('#boost').textContent === '0' && document.querySelector('.boost-tip').style.opacity === '0' && document.querySelector('.boost-hud').classList.contains('is-empty')), {});
  await page.keyboard.press('b');
  await page.waitForFunction(() => document.querySelector('#boost').textContent === '∞');
  check('Unlimited boost fills the arc and displays infinity', await page.evaluate(() => document.querySelector('#boost').textContent === '∞' && document.querySelector('#boost-arc').style.strokeDashoffset === '0' && document.querySelector('[role="meter"]').getAttribute('aria-valuetext') === 'Unlimited boost'), {});
  await page.keyboard.press('b');

  await page.evaluate(() => { const g = window.__game; g.blue = 0; g.orange = 0; g.score('blue'); });
  await page.waitForFunction(() => document.querySelector('#blue-score').textContent === '1');
  check('Scoring updates the tile and animates the score once', await page.evaluate(() => document.querySelector('#blue-score').getAnimations().length === 1 && document.querySelector('.team-blue .score-sheen').getAnimations().length === 1), {});
  await page.waitForTimeout(700);
  check('Score animation finishes without repeating every frame', await page.evaluate(() => document.querySelector('#blue-score').getAnimations().length === 0), {});
  await page.evaluate(() => { const g = window.__game; g.scenario('drive'); g.overtime = true; g.remaining = 17; });
  await page.waitForFunction(() => document.querySelector('#timer').textContent === '+0:17');
  check('Overtime remains visible in the compact scoreboard', await page.locator('#overtime').isVisible() && await page.locator('.scoreboard').evaluate(e => e.classList.contains('is-overtime')), {});

  const layouts = [];
  for (const [width, height] of [[1920,1080],[900,600],[390,844],[320,568],[844,390]]) {
    await page.setViewportSize({ width, height });
    layouts.push(await page.evaluate(() => {
      const rect = s => document.querySelector(s).getBoundingClientRect();
      const a = rect('.scoreboard'), b = rect('.top-actions'), c = rect('.boost-hud'), d = rect('.bottom-left'), e = rect('.controls-strip');
      return { width: innerWidth, height: innerHeight, scoreClear: a.right < b.left, boostInBounds: c.left >= 0 && c.right <= innerWidth && c.bottom <= innerHeight, cameraClear: d.right < e.left || d.bottom < e.top, overflow: document.documentElement.scrollWidth > innerWidth };
    }));
  }
  check('HUD fits desktop, portrait and landscape without overlapping controls', layouts.every(l => l.scoreClear && l.boostInBounds && l.cameraClear && !l.overflow), layouts);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await page.evaluate(() => {
    const g = window.__game; g.hud.boostPickup(true); g.hud.set('blue-score', 2);
    return document.querySelector('#boost').getAnimations().length === 0 && document.querySelector('#blue-score').getAnimations().length === 0 && getComputedStyle(document.querySelector('.boost-flow')).display === 'none';
  });
  check('Reduced motion disables decorative gauge and score animations', reduced, {});
  check('Boost gauge has no controller binding label', await page.locator('.boost-hud [data-hint],.boost-key').count() === 0, {});
  check('No browser errors', errors.length === 0, errors);
  await mkdir('test-results/hud', { recursive: true });
  await writeFile('test-results/hud/behavior.json', JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); }
