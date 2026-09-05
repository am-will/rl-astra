import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const results = [], errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
const check = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); };

try {
  await mkdir('test-results/goal-shape', { recursive: true });
  await page.goto('http://127.0.0.1:5179');
  await page.waitForFunction(() => window.__game?.view && !document.querySelector('#loading'));
  for (const [view, position, target] of [
    ['own-front', [0, 3.1, 34], [0, 3, 55]],
    ['inside-out', [0, 2.8, 56], [0, 2.5, 44]],
    ['opponent-front', [0, 3.1, -34], [0, 3, -55]],
  ]) {
    const visibility = await page.evaluate(({ position, target }) => {
      const g = window.__game; g.scenario('drive');
      const v = g.view; v.camera.position.set(...position); v.camera.lookAt(...target); v.camera.updateMatrixWorld();
      const shields = v.scene.getObjectByName('own-goal-shields');
      const gl = v.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const capture = () => { v.draw(); const pixels = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels); return pixels; };
      const on = capture(), changed = [];
      for (const shield of shields.children) {
        shield.visible = false; const off = capture(); let pixels = 0;
        for (let i = 0; i < on.length; i += 4) if (Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2]) > 3) pixels++;
        changed.push(pixels); shield.visible = true;
      }
      v.draw(); return { changed, pixels: w * h, drawCalls: v.renderer.info.render.calls };
    }, { position, target });
    check(view === 'own-front' ? 'All three shields visibly render from the field' : `Shield overlay leaves ${view} unobstructed`,
      visibility.changed.length === 3 && visibility.changed.every(n => view === 'own-front' ? n > 100 : n === 0), visibility);
    await page.screenshot({ path: `test-results/goal-shape/verified-${view}.png` });
  }
  for (const end of [-1, 1]) {
    const score = await page.evaluate(end => {
      const g = window.__game; g.scenario(end < 0 ? 'goal-blue' : 'goal-orange');
      const previous = end < 0 ? g.blue : g.orange;
      g.advance(.8); return { phase: g.phase, scored: (end < 0 ? g.blue : g.orange) - previous };
    }, end);
    check(`Ball crosses the reshaped goal ${end} and scores once`, score.phase === 'goal' && score.scored === 1, score);
  }
  check('No browser or shader errors', errors.length === 0, errors);
  await writeFile('test-results/goal-shape/checks.json', JSON.stringify({ results, errors }, null, 2));
  assert.ok(results.every(r => r.pass), JSON.stringify(results.filter(r => !r.pass)));
} finally { await browser.close(); }
