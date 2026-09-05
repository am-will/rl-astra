import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('test-results/paint', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const results = [], errors = [];
const check = (name, pass, detail = {}) => { assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); results.push({ name, detail }); console.log(`PASS ${name}`); };
try {
  const p = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  p.on('pageerror', e => errors.push(e.message)); p.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  const ready = () => p.waitForFunction(() => window.__game && !document.querySelector('#loading'));
  await p.goto('http://127.0.0.1:5179'); await ready();
  check('Fresh browser defaults to Ultraviolet; six paint options include Classic', await p.evaluate(() => window.__game.view.paintJob === 'ultraviolet' && document.querySelector('#paint-job').options.length === 6));
  await p.evaluate(() => { const g = window.__game; g.scenario('drive'); g.physics.resetCar(g.physics.player, 0, 12); g.view.update(0, 'playing'); g.action('visuals'); });
  const before = await p.evaluate(() => ({ cam: { ...window.__game.view.followCamera.settings }, ballCam: window.__game.view.ballCam, pos: window.__game.physics.player.body.translation() }));
  for (const job of ['classic', 'crimson', 'rally', 'midnight', 'glacier', 'ultraviolet']) {
    await p.locator(`[data-paint="${job}"]`).click();
    check(`${job} swatch selects, previews and saves its finish`, await p.evaluate(job => { const g = window.__game; return g.view.paintJob === job && g.view.paintPreview && g.paused && document.querySelector('#paint-job').value === job && localStorage.getItem('champions-field.paint-job') === job && document.querySelector(`[data-paint="${job}"]`).getAttribute('aria-pressed') === 'true'; }, job));
  }
  await p.locator('#paint-job').focus(); await p.keyboard.press('g'); await p.keyboard.press('Enter');
  await p.evaluate(() => { window.__game.visualSettings.navigate('left'); });
  check('Keyboard and controller can select finishes without driving', await p.evaluate(() => window.__game.view.paintJob === 'midnight' && window.__game.controls.read().throttle === 0));
  const angles = [];
  for (const angle of ['front', 'side', 'rear']) { await p.locator(`[data-paint-angle="${angle}"]`).click(); await p.waitForTimeout(80); angles.push(await p.evaluate(() => window.__game.view.camera.position.toArray())); }
  check('Front, side and rear preview controls move the camera', new Set(angles.map(a => a.join(','))).size === 3, angles);
  const after = await p.evaluate(() => ({ cam: { ...window.__game.view.followCamera.settings }, ballCam: window.__game.view.ballCam, pos: window.__game.physics.player.body.translation() }));
  check('Preview preserves camera preferences, camera mode and car position', JSON.stringify(before) === JSON.stringify(after), { before, after });
  await p.locator('#paint-job').selectOption('ultraviolet'); await p.locator('[data-paint-angle="front"]').click();
  await p.screenshot({ path: 'test-results/paint/options-desktop.png' });
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(100);
  const mobile = await p.evaluate(() => { const v = window.__game.view, r = document.querySelector('.visual-menu').getBoundingClientRect(), b = document.querySelector('#close-visuals').getBoundingClientRect(), center = v.player.root.position.clone().project(v.camera); return { x: r.x, right: r.right, top: r.top, bottom: r.bottom, done: b.bottom, carY: (1 - center.y) * innerHeight / 2, width: innerWidth, height: innerHeight }; });
  check('Phone preview exposes the car above the menu and keeps Done visible', mobile.x >= 0 && mobile.right <= mobile.width && mobile.bottom <= mobile.height && mobile.done <= mobile.height && mobile.carY > 60 && mobile.carY < mobile.top - 30, mobile);
  await p.screenshot({ path: 'test-results/paint/options-mobile.png' });
  await p.locator('#close-visuals').click(); await p.waitForTimeout(80);
  check('Done leaves paint preview and restores the chosen gameplay FOV', await p.evaluate(fov => !window.__game.view.paintPreview && Math.abs(window.__game.view.camera.fov - (fov + 9)) < .01, before.cam.fov));
  await p.reload(); await ready();
  check('Selected paint persists after reload', await p.evaluate(() => window.__game.view.paintJob === 'ultraviolet'));
  await p.evaluate(() => window.__game.action('visuals')); await p.locator('#paint-job').selectOption('crimson'); await p.locator('#reset-camera').click();
  check('Camera reset exits preview and retains the selected paint', await p.evaluate(() => !window.__game.view.paintPreview && window.__game.view.paintJob === 'crimson'));
  await p.setViewportSize({ width: 1100, height: 760 });
  await p.evaluate(() => { window.requestAnimationFrame = () => 0; }); await p.waitForTimeout(80);
  await p.evaluate(() => {
    const g = window.__game, v = g.view; g.scenario('drive'); g.physics.resetCar(g.physics.player, 0, 12); v.paintPreview = false; v.update(0, 'playing');
    document.querySelector('#hud').style.display = 'none';
    const c = v.player.root.position; v.camera.fov = 34; v.camera.updateProjectionMatrix(); v.camera.position.set(c.x - 2, c.y + 1.05, c.z - 2.55); v.camera.lookAt(c.x, c.y + .09, c.z); v.camera.updateMatrixWorld();
    window.paintPixels = () => { v.draw(); const canvas = document.createElement('canvas'); canvas.width = v.renderer.domElement.width; canvas.height = v.renderer.domElement.height; const ctx = canvas.getContext('2d'); ctx.drawImage(v.renderer.domElement, 0, 0); return ctx.getImageData(0, 0, canvas.width, canvas.height).data; };
    window.paintDiff = (a, b) => { let count = 0; for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 3) count++; return count; };
  });
  const rendering = await p.evaluate(() => {
    const v = window.__game.view, samples = {}, animation = {}, state = [];
    const bot = v.bot.root.children.find(m => m.material?.name === 'Octane_Body').material;
    for (const job of ['classic', 'ultraviolet', 'crimson', 'rally', 'midnight', 'glacier']) {
      v.setPaintJob(job); samples[job] = window.paintPixels(); const programs = v.renderer.info.programs.length;
      v.carPaint.update(.65); animation[job] = window.paintDiff(samples[job], window.paintPixels());
      state.push({ job, programCount: programs, bot: bot.color.getHexString() });
    }
    const pairwise = []; const ids = Object.keys(samples);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairwise.push({ a: ids[i], b: ids[j], pixels: window.paintDiff(samples[ids[i]], samples[ids[j]]) });
    v.setPaintJob('classic'); const restored = window.paintDiff(samples.classic, window.paintPixels());
    v.setPaintJob('ultraviolet'); const programs = v.renderer.info.programs.length;
    for (let i = 0; i < 18; i++) { v.setPaintJob(ids[i % ids.length]); v.draw(); }
    return { animation, pairwise, restored, state, programsBefore: programs, programsAfter: v.renderer.info.programs.length };
  });
  check('Every finish has visibly distinct rendered pixels', rendering.pairwise.every(pair => pair.pixels > 4000), rendering.pairwise);
  check('Purple visibly animates while the five other finishes remain still', rendering.animation.ultraviolet > 800 && Object.entries(rendering.animation).every(([job, pixels]) => job === 'ultraviolet' || pixels === 0), rendering.animation);
  check('Classic appearance survives repeated paint switches exactly', rendering.restored === 0, rendering.restored);
  check('Paint changes leave the orange opponent alone and reuse shader programs', rendering.state.every(row => row.bot === 'e87512') && rendering.programsAfter === rendering.programsBefore, rendering);
  const classic = await p.evaluate(async () => {
    const { detailedCar, loadDetailedModels } = await import('/src/models.ts'), v = window.__game.view;
    const source = await loadDetailedModels(), untouched = detailedCar(source.car, 'blue');
    untouched.root.position.copy(v.player.root.position); untouched.root.quaternion.copy(v.player.root.quaternion); untouched.wheels.forEach((w, i) => w.rotation.copy(v.player.wheels[i].rotation));
    v.setPaintJob('classic'); const actual = window.paintPixels(); v.player.root.visible = false; v.scene.add(untouched.root); const expected = window.paintPixels();
    v.scene.remove(untouched.root); v.player.root.visible = true;
    return window.paintDiff(actual, expected);
  });
  check('Classic matches an untouched original blue car rendered in the same scene', classic < 30, classic);
  await p.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await p.evaluate(() => { const v = window.__game.view; v.setPaintJob('ultraviolet'); v.carPaint.update(0); const a = window.paintPixels(); v.carPaint.update(2); return window.paintDiff(a, window.paintPixels()); });
  check('Reduced-motion preference freezes the purple animation', reduced === 0, reduced);
  await p.emulateMedia({ reducedMotion: 'no-preference' });
  const rates = await p.evaluate(() => {
    const v = window.__game.view, samples = []; v.setPaintJob('ultraviolet');
    for (const hz of [30, 60, 144]) { v.carPaint.time = 0; for (let i = 0; i < hz; i++) v.carPaint.update(1 / hz); samples.push(window.paintPixels()); }
    return [window.paintDiff(samples[0], samples[1]), window.paintDiff(samples[0], samples[2])];
  });
  check('Purple animation is frame-rate independent at 30, 60 and 144 Hz', rates.every(pixels => pixels === 0), rates);
  await p.evaluate(() => localStorage.setItem('champions-field.paint-job', 'invalid')); await p.reload(); await ready();
  check('Invalid saved paint falls back to Ultraviolet', await p.evaluate(() => window.__game.view.paintJob === 'ultraviolet'));
  await p.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Storage disabled'); }; window.__game.action('visuals'); });
  await p.locator('#paint-job').selectOption('glacier');
  check('Unavailable storage still applies paint and reports session-only saving', await p.evaluate(() => window.__game.view.paintJob === 'glacier' && document.querySelector('#visual-save').textContent === 'APPLIED FOR THIS SESSION'));
  check('No browser or shader errors', errors.length === 0, errors);
  await writeFile('test-results/paint/checks.json', JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); }
