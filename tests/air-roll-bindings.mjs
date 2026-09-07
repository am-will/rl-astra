import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.testPad = { index: 0, id: 'DualSense Wireless Controller', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, () => ({ value: 0, pressed: false, touched: false })) };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.testPad] });
  });
  const ready = async () => {
    await page.waitForFunction(() => window.__game?.view && !document.querySelector('#loading'));
    await page.waitForFunction(() => window.__game.controls.pad && !window.__game.controls.padBlocked);
    await page.evaluate(() => window.__game.scenario('air'));
  };
  const pad = (button = null, stick = 0) => page.evaluate(({ button, stick }) => {
    window.testPad.buttons.forEach((b, i) => Object.assign(b, { value: i === button ? 1 : 0, pressed: i === button, touched: i === button }));
    window.testPad.axes[0] = stick;
    window.__game.controls.poll(performance.now());
  }, { button, stick });
  const read = () => page.evaluate(() => window.__game.controls.read());
  const rotation = () => page.evaluate(() => {
    const g = window.__game;
    g.scenario('air');
    for (let i = 0; i < 24; i++) g.tick(g.controls.read());
    const q = g.physics.player.body.rotation();
    // Roof direction in car's initial frame: +X is the driver's right.
    return 2 * (q.x * q.y - q.z * q.w);
  });
  const openAerial = async () => {
    await page.keyboard.press('Escape');
    await page.locator('[data-action="bindings"]').first().click();
    await page.locator('[data-category="aerial"]').click();
  };
  const resume = async () => {
    await page.locator('.bindings-close').click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__game.controls.padBlocked);
  };
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5179');
  await ready();

  for (const [key, side] of [['q', -1], ['e', 1]]) {
    await page.keyboard.down(key);
    assert.ok((await rotation()) * side > .3, `${key} tips the roof ${side < 0 ? 'left' : 'right'}`);
    await page.keyboard.up(key);
  }
  for (const [button, side] of [[4, -1], [5, 1]]) {
    await pad(button);
    assert.ok((await rotation()) * side > .3, `Default shoulder button ${button} rolls in its labeled direction`);
    await pad();
  }
  for (const side of [-1, 1]) {
    await pad(2, side);
    assert.equal((await read()).yaw, 0, 'Regular air roll consumes stick yaw');
    assert.ok((await rotation()) * side > .3, 'Regular air roll follows the stick direction');
    await pad();
  }
  console.log('PASS Default keyboard, directional controller, and modifier air roll turn in their labeled directions');

  await openAerial();
  await page.locator('[data-bind="rollRight"][data-device="gamepad"][data-slot="0"]').click();
  await page.waitForFunction(() => window.__game.controls.capture?.armed);
  await pad(2);
  await page.waitForFunction(() => !window.__game.controls.capture);
  await pad();
  assert.equal(await page.locator('[data-bind="rollRight"][data-device="gamepad"][data-slot="0"]').innerText(), 'Square');
  await page.locator('[data-bind="rollRight"][data-device="keyboard"][data-slot="0"]').click();
  await page.keyboard.press('i');
  await resume();

  const verifyRebound = async () => {
    for (const stick of [0, -1, 1]) {
      await pad(2, stick);
      const input = await read();
      assert.equal(input.roll, -1, `Square keeps right roll with stick ${stick}`);
      assert.equal(input.yaw || 0, -stick || 0, 'Directional roll keeps independent air steering');
      assert.equal(input.drift, true, 'Square can still share powerslide');
      if (stick === 0) assert.ok(await rotation() > .3, 'Menu-rebound Square physically rolls right');
      await pad();
    }
    await pad(5);
    assert.equal((await read()).roll, 0, 'Old R1 binding no longer rolls');
    await pad();
    await page.keyboard.down('i');
    assert.ok(await rotation() > .3, 'Menu-rebound keyboard key physically rolls right');
    await page.keyboard.up('i');
    await page.keyboard.down('e');
    assert.equal((await read()).roll, 0, 'Old keyboard binding no longer rolls');
    await page.keyboard.up('e');
  };
  await verifyRebound();
  await page.reload();
  await ready();
  await verifyRebound();
  console.log('PASS Menu rebinding to Square and a new keyboard key works during gameplay and survives reload');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
