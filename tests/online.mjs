import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const url = process.env.GAME_URL || 'http://127.0.0.1:5179';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const pages = [], errors = [], samples = [];
setTimeout(() => { console.error('Online integration test exceeded 3 minutes'); process.exit(1); }, 180000).unref();
try {
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({ viewport: { width: 640, height: 400 } });
    await context.addInitScript(() => { localStorage.setItem('champions-field.quality', 'performance'); localStorage.setItem('champions-field.motion-blur', 'off'); });
    const page = await context.newPage(); pages.push(page);
    page.on('pageerror', e => { errors.push(e.message); console.log('PAGE ERROR', e.message); });
    page.on('console', e => { if (e.type() === 'error') console.log('CONSOLE', e.text()); });
    console.log('Loading seat', i); await page.goto(url); await page.waitForFunction(() => window.__game && !document.querySelector('#loading'), null, { timeout: 60000 });
    // Render the initial scene, then reduce software-raster load while testing transport timing.
    await page.evaluate(() => { const g = window.__game; g.view.testDraw = g.view.draw.bind(g.view); g.view.draw = () => {}; });
  }
  console.log('Both game views loaded');
  const host = pages[0], guest = pages[1];
  await host.locator('#online-toggle').click();
  await host.locator('#online-create button').click();
  await host.waitForFunction(() => sessionStorage.getItem('alpha-invite'), null, { timeout: 10000 });
  const code = await host.evaluate(() => sessionStorage.getItem('alpha-code'));
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  console.log('Room created');
  await guest.locator('#online-toggle').click(); await guest.locator('#join-code').fill(code); await guest.locator('#online-join button').click();
  console.log('Join code submitted');
  await Promise.all(pages.map(p => p.waitForFunction(() => window.__game?.online?.ready && window.__game.online.players === 2, null, { timeout: 60000 })));
  console.log('PASS host creates code; second Chrome client joins over WebRTC and synchronizes');
  const slot = await guest.evaluate(() => ({ slot: window.__game.physics.localSlot, same: window.__game.view.localModel === window.__game.view.bot, label: document.querySelector('.team-orange .team-label').textContent }));
  assert.deepEqual(slot, { slot: 1, same: true, label: 'YOU' });
  await Promise.all(pages.map(p => p.waitForFunction(() => window.__game.phase === 'playing', null, { timeout: 15000 })));
  if (process.env.NETWORK_IMPAIR === '1') {
    await Promise.all(pages.map(p => p.evaluate(() => {
      const o = window.__game.online; let seed = 419; const random = () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
      const frames = o.frames.bind(o), channelSend = o.channel.send.bind(o.channel), send = o.send.bind(o), control = o.control.bind(o);
      o.frames = bytes => { if (random() > .1) setTimeout(() => frames(bytes), 35 + random()*50); };
      o.channel.send = bytes => { if (random() > .08) setTimeout(() => { if(o.channel.readyState==='open') channelSend(bytes); }, 35 + random()*50); };
      o.send = message => { if(message.type==='ping') setTimeout(()=>send(message),60); else send(message); };
      o.control = async message => { if(message.type==='pong') await new Promise(resolve=>setTimeout(resolve,60)); return control(message); };
    })));
    // Let the input lead adapt to the measured RTT before the first challenge.
    await new Promise(resolve => setTimeout(resolve, 3500));
    console.log('Injecting ~120ms RTT, 8–10% data loss and up to 50ms jitter');
  }
  await host.keyboard.down('w'); await host.keyboard.down('Shift'); await guest.keyboard.down('w');
  for (let i = 0; i < 18; i++) {
    if (i === 3) await host.keyboard.press('Space');
    if (i === 6) await guest.keyboard.down('a');
    if (i === 10) await guest.keyboard.up('a');
    await new Promise(r => setTimeout(r, 1000));
    const states = await Promise.all(pages.map(p => p.evaluate(() => {
      const o = window.__game.online;
      return { tick: o.prediction.confirmed.tickNumber, predicted: window.__game.tickNumber, ready: o.ready, rtt: o.rtt, phase: window.__game.phase, stats: o.prediction.stats, position: window.__game.physics.localCar.body.translation(), speed: window.__game.physics.localCar.speed, state: o.state, pending: o.prediction.pending.size };
    })));
    samples.push(states);
    if (i % 4 === 0) console.log('SAMPLE', JSON.stringify(states));
  }
  assert(samples.every(pair => pair.every(p => p.stats.desyncs === 0)), 'Chrome confirmed state differs from server');
  assert(samples.at(-1).every(p => p.ready && p.tick > 1200), 'clients must keep progressing');
  assert(samples.some(pair => pair.every(p => p.speed > 5)), 'both seats drive their own car');
  console.log('PASS live two-car physics, input prediction and authoritative hashes across Node and Chrome');
  const beforeReconnect = await guest.evaluate(() => { const o = window.__game.online; o.ws.close(); return o.prediction.confirmed.tickNumber; });
  await guest.waitForFunction(t => window.__game.online.ready && window.__game.online.prediction.confirmed.tickNumber > t + 180, beforeReconnect, { timeout: 20000 });
  assert.equal(await guest.evaluate(() => window.__game.online.prediction.stats.desyncs), 0);
  console.log('PASS disconnected seat reconnects into current authoritative match');
  await mkdir('test-results', { recursive: true });
  await Promise.all(pages.map(p => p.evaluate(() => window.__game.view.testDraw())));
  await host.screenshot({ path: 'test-results/online-blue.png' }); await guest.screenshot({ path: 'test-results/online-orange.png' });
  assert.deepEqual(errors, []);
} catch (error) {
  console.log('FAIL', error);
  for (const p of pages) console.log(await p.evaluate(() => ({ status: document.querySelector('#net-status')?.textContent, ready: window.__game?.online?.ready, baseline: window.__game?.online?.receivedBaseline, dc: window.__game?.online?.channel?.readyState, pc: window.__game?.online?.pc?.connectionState, phase: window.__game?.phase, reason: window.__game?.online?.resyncReason, drift: window.__game?.online?.prediction?.lastDesync, stats: window.__game?.online?.prediction?.stats })).catch(() => 'unavailable'));
  throw error;
} finally {
  await mkdir('test-results', { recursive: true }); await writeFile('test-results/online.json', JSON.stringify({ errors, samples }, null, 2));
  for (const p of pages) await p.evaluate(() => window.__game?.online?.dispose()).catch(() => {});
  await browser.close();
}
