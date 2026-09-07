import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const check = (name, ok, detail) => { assert.ok(ok, `${name}: ${JSON.stringify(detail)}`); console.log(`PASS ${name}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5179');
  await page.waitForFunction(() => window.__game?.view && !document.querySelector('#loading'));
  await page.keyboard.press('p');
  const practice = await page.evaluate(() => { const g = window.__game; return { practice: g.practice, phase: g.phase, bot: g.physics.botEnabled, paused: g.paused, message: g.hud.el('center-message').textContent }; });
  check('P starts solo practice immediately', practice.practice && practice.phase === 'playing' && !practice.bot && !practice.paused, practice);
  check('Practice shows FREE PLAY with no clock or countdown', await page.locator('.practice-label').isVisible() && !(await page.locator('#timer').isVisible()) && !practice.message.includes('GET READY'), practice);
  await page.keyboard.down('w'); await page.waitForFunction(() => window.__game.physics.player.speed > 3); await page.keyboard.up('w');
  check('Practice accepts driving immediately', true);
  const longevity = await page.evaluate(async () => {
    const g = window.__game, { emptyInput } = await import('/src/config.ts'); g.testing = true; g.physics.ball.setEnabled(false);
    for (let i = 0; i < 120 * 301; i++) g.tick(emptyInput());
    return { remaining: g.remaining, phase: g.phase, overtime: g.overtime };
  });
  check('Practice remains untimed beyond five minutes', longevity.remaining === 0 && longevity.phase === 'playing' && !longevity.overtime, longevity);
  const goal = await page.evaluate(() => { const g = window.__game; g.score('blue'); g.advance(4.7); return { phase: g.phase, phaseTime: g.phaseTime, remaining: g.remaining, message: g.hud.el('center-message').textContent }; });
  check('Practice returns from a goal without a kickoff countdown', goal.phase === 'playing' && goal.phaseTime === 0 && goal.remaining === 0, goal);
  await page.keyboard.press('Escape'); check('Escape still pauses practice', await page.evaluate(() => window.__game.paused)); await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  const match = await page.evaluate(() => { const g = window.__game; return { practice: g.practice, bot: g.physics.botEnabled, phase: g.phase, remaining: g.remaining }; });
  check('P toggles back to a fresh timed match', !match.practice && match.bot && match.phase === 'ready' && match.remaining === 300, match);
  check('Match clock returns', await page.locator('#timer').isVisible());
  await page.keyboard.press('Escape'); await page.locator('[data-action="mode"]').click();
  check('Pause-menu practice selection also starts immediately', await page.evaluate(() => window.__game.practice && window.__game.phase === 'playing' && !window.__game.paused));
  const migration = await page.evaluate(async () => {
    const { defaults, loadSettings, STORAGE_KEY } = await import('/src/bindings.ts');
    const old = defaults(); delete old.keyboard.mode; delete old.gamepad.mode; old.keyboard.pause = ['Escape', 'KeyP']; old.keyboard.boost = ['KeyV'];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(old)); const migrated = loadSettings(), migratedMode = [...migrated.keyboard.mode];
    migrated.keyboard.mode = ['KeyO']; localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)); const custom = loadSettings();
    localStorage.removeItem(STORAGE_KEY);
    return { pause: migrated.keyboard.pause, mode: migratedMode, custom: custom.keyboard.mode, boost: custom.keyboard.boost };
  });
  check('Old P-to-pause migrates while custom bindings survive', migration.pause.join() === 'Escape' && migration.mode.join() === 'KeyP' && migration.custom.join() === 'KeyO' && migration.boost.join() === 'KeyV', migration);
  check('No browser errors', errors.length === 0, errors);
} finally { await browser.close(); }
