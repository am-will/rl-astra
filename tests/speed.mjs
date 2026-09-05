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
  const acceleration = await page.evaluate(async () => {
    const { emptyInput, STEP } = await import('/src/config.ts'), g = window.__game, rows = [];
    for (const throttle of [0, 1]) {
      g.scenario('drive'); g.physics.resetCar(g.physics.player, 8, 35); g.physics.ball.setEnabled(false); g.physics.unlimited = true;
      for (let i = 0; i < 60; i++) g.physics.step(emptyInput(), emptyInput());
      let first = null, maxSpeed = 0;
      for (let i = 0; i < 240; i++) {
        g.physics.step({ ...emptyInput(), throttle, boost: true }, emptyInput());
        const v = g.physics.player.body.linvel(), speed = Math.hypot(v.x, v.y, v.z);
        maxSpeed = Math.max(speed, maxSpeed); if (speed >= 22 && first === null) first = (i + 1) * STEP;
      }
      const before = g.physics.player.speed;
      for (let i = 0; i < 120; i++) g.physics.step({ ...emptyInput(), throttle: 1 }, emptyInput());
      const retained = g.physics.player.speed;
      for (let i = 0; i < 24; i++) g.physics.step({ ...emptyInput(), throttle: -1 }, emptyInput());
      rows.push({ throttle, first, maxSpeed, before, retained, braked: g.physics.player.speed, sonicAfterBrake: g.physics.player.supersonic });
    }
    return rows;
  });
  check('Rest to supersonic matches the reference acceleration curve', acceleration.every(r => r.first >= 1.55 && r.first <= 1.65), acceleration);
  check('Boost alone accelerates as quickly as throttle plus boost', acceleration[0].first === acceleration[1].first, acceleration);
  check('Maximum speed remains 2300 uu/s', acceleration.every(r => r.maxSpeed <= 23.01 && r.maxSpeed >= 22.95), acceleration);
  check('Holding throttle preserves speed after releasing boost', acceleration.every(r => r.retained > 22 && Math.abs(r.retained - r.before) < .05), acceleration);
  check('Braking still removes supersonic promptly', acceleration.every(r => r.braked < 21 && !r.sonicAfterBrake), acceleration);

  const contact = await page.evaluate(async () => {
    const { emptyInput } = await import('/src/config.ts'), g = window.__game;
    g.scenario('collision'); g.physics.unlimited = false; g.physics.botEnabled = true;
    g.physics.resetCar(g.physics.bot, 0, -4, Math.PI); g.physics.player.body.setLinvel({ x: 0, y: 0, z: -23 }, true);
    const hits = []; let previous = 23, demo = false;
    for (let i = 0; i < 100; i++) {
      const beforeHits = g.hits;
      g.physics.step({ ...emptyInput(), throttle: 1 }, emptyInput());
      const v = g.physics.player.body.linvel(), speed = Math.hypot(v.x, v.y, v.z);
      if (g.hits > beforeHits) hits.push({ before: previous, after: speed, ball: { ...g.physics.ball.linvel() } });
      previous = speed; demo ||= g.physics.bot.demolished > 0;
    }
    return { hits, demo };
  });
  check('A full-speed ball hit preserves the car’s supersonic margin', contact.hits.length > 0 && contact.hits[0].after > 22 && contact.hits[0].after < contact.hits[0].before, contact);
  check('A car can hit the ball then demolish the opponent without more boost', contact.demo, contact);
  check('Full-speed ball launch remains near its previous power', Math.abs(contact.hits[0].ball.z + 26.545) < .6 && Math.abs(contact.hits[0].ball.y - 10.94) < .5, contact.hits[0]);

  const grace = await page.evaluate(async () => {
    const { emptyInput } = await import('/src/config.ts'), g = window.__game;
    g.scenario('drive'); g.physics.ball.setEnabled(false);
    const c = g.physics.player, step = () => g.physics.step({ ...emptyInput(), throttle: 1 }, emptyInput());
    c.body.setLinvel({ x: 0, y: 0, z: -21.5 }, true); step(); const belowDoesNotStart = !c.supersonic;
    c.body.setLinvel({ x: 0, y: 0, z: -22.5 }, true); step(); const started = c.supersonic;
    c.body.setLinvel({ x: 0, y: 0, z: -21.5 }, true); for (let i = 0; i < 90; i++) step(); const retained = c.supersonic;
    for (let i = 0; i < 40; i++) step(); const expired = !c.supersonic;
    g.restart(); const reset = !c.supersonic && c.supersonicGrace === 0;
    return { belowDoesNotStart, started, retained, expired, reset };
  });
  check('Supersonic has a bounded grace band and resets with the car', Object.values(grace).every(Boolean), grace);

  const trails = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js'), { SpeedTrails } = await import('/src/speed-trails.ts');
    const records = [], scene = new T.Scene(), pos = new T.Vector3(), q = new T.Quaternion();
    for (const hz of [30, 60, 144]) {
      const trail = new SpeedTrails(scene);
      for (let i = 0; i < hz; i++) { pos.set(0, .38, -23 * i / hz); trail.update(pos, q, 23, true, true, 1 / hz); }
      const visible = trail.mesh.visible, geometry = trail.mesh.geometry;
      const vertices = geometry.getAttribute('position'), birth = geometry.getAttribute('born'), now = trail.mesh.material.uniforms.time.value;
      let length = 0;
      for (let i = 0; i < vertices.count; i++) if (now - birth.getX(i) < .18) length = Math.max(length, vertices.getZ(i) - pos.z - trail.origin.z);
      const finite = Array.from(vertices.array).every(Number.isFinite), before = [...vertices.array];
      trail.update(pos, q, 23, true, true, 0);
      const paused = before.every((n, i) => n === vertices.array[i]);
      pos.x += 25; trail.update(pos, q, 23, true, true, 1 / hz);
      const teleportSafe = Math.max(...Array.from(vertices.array).filter((_, i) => i % 3 === 0)) - Math.min(...Array.from(vertices.array).filter((_, i) => i % 3 === 0)) < 2;
      trail.update(pos, q, 23, true, false, 1 / hz); const demoClears = !trail.mesh.visible;
      records.push({ hz, visible, length, finite, paused, teleportSafe, demoClears });
      geometry.dispose(); trail.mesh.material.dispose(); scene.remove(trail.mesh);
    }
    return records;
  });
  check('Wheel ribbons remain finite, pause cleanly and clear on teleport/demo', trails.every(r => r.visible && r.finite && r.paused && r.teleportSafe && r.demoClears), trails);
  check('Ribbon length stays consistent across 30/60/144 Hz', trails.every(r => r.length > 3.8 && r.length < 4.2), trails);
  const alignment = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js'), { SpeedTrails } = await import('/src/speed-trails.ts');
    const { createCarModel } = await import('/src/assets.ts'), { loadDetailedModels, detailedCar } = await import('/src/models.ts');
    const fallback = createCarModel('blue'); fallback.root.scale.setScalar(.5);
    const detailed = detailedCar((await loadDetailedModels()).car, 'blue'), rows = [];
    for (const [name, model] of [['fallback', fallback], ['detailed', detailed]]) {
      const trail = new SpeedTrails(new T.Scene()); trail.configureWheels(model);
      model.root.updateMatrixWorld(true);
      const bounds = model.wheels.map(w => new T.Box3().setFromObject(w)).sort((a,b) => b.min.z - a.min.z).slice(0,2).sort((a,b) => a.min.x - b.min.x);
      rows.push({ name, tires: bounds.map((b,i) => ({ centered: Math.abs(trail.wheelX[i] - (b.min.x+b.max.x)/2) < .001, narrower: trail.wheelWidth[i]*2 < (b.max.x-b.min.x)*.8, underTread: trail.origin.y > b.min.y && trail.origin.y < b.min.y+.05 && trail.origin.z > b.min.z && trail.origin.z < b.max.z, width: trail.wheelWidth[i]*2, origin: trail.origin.toArray() })) });
    }
    return rows;
  });
  check('Both car models align narrow ribbon starts beneath each rear tire', alignment.every(r => r.tires.every(t => t.centered && t.narrower && t.underTread)), alignment);
  check('No browser errors', errors.length === 0, errors);
  await mkdir('test-results/speed-trails', { recursive: true });
  await writeFile('test-results/speed-trails/behavior.json', JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); }
