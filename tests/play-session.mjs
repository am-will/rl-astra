import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('test-results/live-play', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: 'test-results/live-play', size: { width: 1280, height: 800 } } });
const page = await context.newPage();
const errors = [], samples = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
const shot = async name => { await page.screenshot({ path: `test-results/live-play/${name}.png` }); samples.push({ name, ...await page.evaluate(() => window.__game.snapshot()) }); console.log(name, samples.at(-1).fps.toFixed(1), 'FPS'); };
try {
  await page.goto('http://127.0.0.1:5179'); await page.waitForFunction(() => window.__game);
  await shot('01-kickoff');
  await page.keyboard.press('b'); await page.keyboard.down('w'); await page.keyboard.down('Shift');
  await page.waitForFunction(() => window.__game.phase === 'playing');
  await page.waitForTimeout(1700); await shot('02-boosting');
  await page.keyboard.up('Shift'); await page.keyboard.down('d'); await page.keyboard.down('Control');
  await page.waitForTimeout(800); await shot('03-powerslide');
  await page.keyboard.up('Control'); await page.keyboard.up('d');
  await page.keyboard.press('c'); await page.waitForTimeout(700);
  await page.keyboard.up('w'); await page.keyboard.down('Space');
  await page.waitForTimeout(180); await page.keyboard.up('Space'); await page.keyboard.down('s');
  await page.waitForTimeout(380); await page.keyboard.up('s'); await page.keyboard.down('Shift');
  await page.waitForTimeout(1300); await shot('04-aerial');
  await page.keyboard.up('Shift'); await page.keyboard.down('e'); await page.waitForTimeout(430); await page.keyboard.up('e');
  await page.waitForTimeout(800); await shot('05-recovery');
  await page.keyboard.press('r'); await page.keyboard.press('c');
  await page.keyboard.down('w'); await page.keyboard.down('Shift'); await page.waitForTimeout(2300);
  await page.keyboard.up('w'); await page.keyboard.up('Shift'); await shot('06-challenge');
  await page.evaluate(() => { const g = window.__game; g.scenario('goal-blue'); g.testing = false; g.phase = 'playing'; });
  await page.waitForFunction(() => window.__game.phase === 'goal'); await page.waitForTimeout(320); await shot('07-goal-explosion');
  await page.waitForFunction(() => window.__game.phase === 'playing'); await shot('08-reset');
  await writeFile('test-results/live-play/report.json', JSON.stringify({ samples, errors }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await context.close(); await browser.close(); }
