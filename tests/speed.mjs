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
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; window.__game.testing = true; });
  await page.waitForTimeout(80);
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
      for (let i = 0; i < hz; i++) { pos.set(0, .38, -23 * i / hz); trail.update(pos, q, 23, true, true, true, 1 / hz); }
      const visible = trail.mesh.visible, geometry = trail.mesh.geometry;
      const vertices = geometry.getAttribute('position'), birth = geometry.getAttribute('born'), now = trail.mesh.material.uniforms.time.value, lifetime = trail.mesh.material.uniforms.lifetime.value;
      let length = 0;
      for (let i = 0; i < vertices.count; i++) if (now - birth.getX(i) < lifetime) length = Math.max(length, vertices.getZ(i) - pos.z - trail.origin.z);
      const finite = Array.from(vertices.array).every(Number.isFinite), before = [...vertices.array];
      trail.update(pos, q, 23, true, true, true, 0);
      const paused = before.every((n, i) => n === vertices.array[i]);
      pos.x += 25; trail.update(pos, q, 23, true, true, true, 1 / hz);
      const teleportSafe = Math.max(...Array.from(vertices.array).filter((_, i) => i % 3 === 0)) - Math.min(...Array.from(vertices.array).filter((_, i) => i % 3 === 0)) < 2;
      trail.update(pos, q, 23, true, true, false, 1 / hz); const demoClears = !trail.mesh.visible;
      records.push({ hz, visible, length, finite, paused, teleportSafe, demoClears });
      geometry.dispose(); trail.mesh.material.dispose(); scene.remove(trail.mesh);
    }
    return records;
  });
  check('Wheel ribbons remain finite, pause cleanly and clear on teleport/demo', trails.every(r => r.visible && r.finite && r.paused && r.teleportSafe && r.demoClears), trails);
  check('Longer supersonic ribbons stay consistent across 30/60/144 Hz', trails.every(r => r.length > 7.1 && r.length < 7.4), trails);
  const alignment = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js'), { SpeedTrails } = await import('/src/speed-trails.ts');
    const { createCarModel } = await import('/src/assets.ts'), { loadDetailedModels, detailedCar } = await import('/src/models.ts');
    const fallback = createCarModel('blue'); fallback.root.scale.setScalar(.5);
    const detailed = detailedCar((await loadDetailedModels()).car, 'blue'), rows = [];
    for (const [name, model] of [['fallback', fallback], ['detailed', detailed]]) {
      const trail = new SpeedTrails(new T.Scene()); trail.configureWheels(model);
      model.root.updateMatrixWorld(true);
      const bounds = model.wheels.map(w => new T.Box3().setFromObject(w)).sort((a,b) => b.min.z - a.min.z).slice(0,2).sort((a,b) => a.min.x - b.min.x);
      const position = new T.Vector3(0, .335, 0), rotation = new T.Quaternion();
      for (let i = 0; i < 60; i++) { position.z -= 23 / 60; trail.update(position, rotation, 23, true, true, true, 1 / 60); }
      const vertices = trail.mesh.geometry.getAttribute('position');
      const heights = Array.from({ length: vertices.count }, (_, i) => vertices.getY(i));
      const centerHeights = Array.from({ length: vertices.count / 2 }, (_, i) => (vertices.getY(i * 2) + vertices.getY(i * 2 + 1)) / 2);
      rows.push({ name, aboveGrass: Math.min(...heights) > .174, noHook: Math.max(...centerHeights) - Math.min(...centerHeights) < .000001,
        tires: bounds.map((b,i) => ({ centered: Math.abs(trail.wheelX[i] - (b.min.x+b.max.x)/2) < .001, narrower: trail.wheelWidth[i]*2 < (b.max.x-b.min.x)*.8,
          rearTread: trail.origin.y > (b.min.y+b.max.y)/2 && trail.origin.y < b.max.y && trail.origin.z > (b.min.z+b.max.z)/2 && trail.origin.z < b.max.z,
          width: trail.wheelWidth[i]*2, origin: trail.origin.toArray() })) });
      trail.mesh.geometry.dispose(); trail.mesh.material.dispose();
    }
    return rows;
  });
  check('Both car models emit flat ribbons from the rear tread entirely above the grass', alignment.every(r => r.aboveGrass && r.noHook && r.tires.every(t => t.centered && t.narrower && t.rearTread)), alignment);
  const buildup = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js'), { SpeedTrails } = await import('/src/speed-trails.ts');
    return [14, 18, 21, 23].map(speed => {
      const effect = new SpeedTrails(new T.Scene()), position = new T.Vector3(), rotation = new T.Quaternion();
      for (let i = 0; i < 60; i++) { position.z -= speed / 60; effect.update(position, rotation, speed, speed >= 22, true, true, 1 / 60); }
      const result = { speed, visible: effect.mesh.visible, power: effect.strength, lifetime: effect.mesh.material.uniforms.lifetime.value };
      effect.mesh.geometry.dispose(); effect.mesh.material.dispose(); return result;
    });
  });
  check('Tire trails stay off below supersonic speed', buildup.slice(0, 3).every(r => !r.visible && r.power === 0) && buildup[3].visible && buildup[3].power > .99, buildup);

  const trailGating = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js'), { SpeedTrails } = await import('/src/speed-trails.ts');
    const trail = new SpeedTrails(new T.Scene()), position = new T.Vector3(0, .335, 0), rotation = new T.Quaternion();
    const run = () => { for (let i = 0; i < 30; i++) { position.z -= 23 / 60; trail.update(position, rotation, 23, true, true, true, 1 / 60); } };
    run(); const active = trail.mesh.visible;
    trail.update(position, rotation, 23, true, false, true, 0); const takeoffClears = !trail.mesh.visible && trail.count === 0;
    position.y = 3;
    for (let i = 0; i < 30; i++) { position.z -= 23 / 60; trail.update(position, rotation, 23, true, false, true, 1 / 60); }
    const noAirTrail = !trail.mesh.visible && trail.count === 0;
    position.y = .335; run(); const landed = trail.mesh.visible && Array.from(trail.mesh.geometry.getAttribute('position').array).every((v, i) => i % 3 !== 1 || v < .4);
    trail.update(position, rotation, 20, false, true, true, 0); const speedLossClears = !trail.mesh.visible && trail.count === 0;
    trail.mesh.geometry.dispose(); trail.mesh.material.dispose();
    return { active, takeoffClears, noAirTrail, landed, speedLossClears };
  });
  check('Tire trails clear on takeoff or speed loss and resume without an airborne connection', Object.values(trailGating).every(Boolean), trailGating);

  const streaks = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js'), { SupersonicStreaks } = await import('/src/supersonic-streaks.ts');
    const rows = [];
    for (const hz of [30, 60, 144]) {
      const effect = new SupersonicStreaks(new T.Scene()), camera = new T.PerspectiveCamera(69, 1.6, .15, 550);
      const position = new T.Vector3(), velocity = new T.Vector3(0, 0, -23);
      effect.resize(1440, 900);
      effect.update(camera, position, velocity, false, true, 1 / hz); const belowDoesNotStart = !effect.mesh.visible;
      for (let i = 0; i < hz; i++) { position.addScaledVector(velocity, 1 / hz); camera.position.copy(position); effect.update(camera, position, velocity, true, true, 1 / hz); }
      const geometry = effect.mesh.geometry, vertices = geometry.getAttribute('position'), before = [...vertices.array];
      const active = effect.mesh.visible && effect.mesh.material.uniforms.strength.value > .99;
      effect.update(camera, position, velocity, true, true, 0);
      const paused = before.every((v, i) => v === vertices.array[i]);
      const directions = [];
      for (const yaw of [Math.PI / 2, Math.PI]) {
        position.addScaledVector(velocity, 1 / hz); camera.position.copy(position);
        camera.rotation.y = yaw; camera.updateMatrixWorld(); effect.update(camera, position, velocity, true, true, 1 / hz);
        directions.push(effect.mesh.material.uniforms.velocity.value.toArray());
      }
      const finite = Array.from(vertices.array).every(Number.isFinite);
      for (let i = 0; i < hz; i++) effect.update(camera, position, velocity, false, true, 1 / hz);
      const faded = !effect.mesh.visible;
      effect.update(camera, position, velocity, true, true, .1); position.x += 25;
      effect.update(camera, position, velocity, true, true, 0); const resetClears = !effect.mesh.visible;
      effect.update(camera, position, velocity, true, true, .1);
      effect.update(camera, position, velocity, true, false, 0); const hiddenClears = !effect.mesh.visible;
      rows.push({ hz, belowDoesNotStart, active, paused, finite, faded, resetClears, hiddenClears, directions });
      geometry.dispose(); effect.mesh.material.dispose();
    }
    return rows;
  });
  check('Camera streaks start only at supersonic, freeze on pause, fade on braking and clear on reset/demo', streaks.every(r => r.belowDoesNotStart && r.active && r.paused && r.finite && r.faded && r.resetClears && r.hiddenClears), streaks);
  check('Camera-space flow changes to sideways and converging when looking beside or behind travel', streaks.every(r => r.directions[0][0] > 22.9 && r.directions[1][2] > 22.9), streaks);

  const flight = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js'), { SupersonicStreaks } = await import('/src/supersonic-streaks.ts');
    const rows = [];
    for (const [name, yaw] of [['forward', 0], ['backward', Math.PI], ['right', Math.PI / 2], ['left', -Math.PI / 2], ['orbit', 0]]) {
      const effect = new SupersonicStreaks(new T.Scene()), camera = new T.PerspectiveCamera(69, 1.6, .15, 550);
      const position = new T.Vector3(), velocity = new T.Vector3(0, 0, -23), dt = 1 / 60;
      camera.rotation.y = yaw; camera.updateMatrixWorld(); effect.resize(1440, 900);
      effect.update(camera, position, velocity, true, true, dt);
      const before = effect.specks.map(p => ({ alive: p.life > 0, cycle: p.cycle, world: p.position.clone().applyQuaternion(camera.quaternion).add(camera.position), screen: p.position.clone().applyMatrix4(camera.projectionMatrix) }));
      position.addScaledVector(velocity, dt); camera.position.copy(position);
      if (name === 'orbit') camera.rotation.y += .6 * dt;
      camera.updateMatrixWorld(); effect.update(camera, position, velocity, true, true, dt);
      const paths = effect.specks.flatMap((p, i) => {
        const b = before[i]; if (!p.life || !b.alive || b.cycle !== p.cycle) return [];
        const screen = p.position.clone().applyMatrix4(camera.projectionMatrix), delta = screen.clone().sub(b.screen);
        return [{ worldError: p.position.clone().applyQuaternion(camera.quaternion).add(camera.position).distanceTo(b.world), x: delta.x, radial: delta.x * b.screen.x + delta.y * b.screen.y }];
      });
      rows.push({ name, survivors: paths.length, anchored: paths.every(p => p.worldError < .00001), x: paths.reduce((s,p) => s+p.x,0)/paths.length, radial: paths.reduce((s,p) => s+p.radial,0)/paths.length, angular: effect.mesh.material.uniforms.angularVelocity.value.length() });
      effect.mesh.geometry.dispose(); effect.mesh.material.dispose();
    }
    return rows;
  });
  check('Dust remains in world space while forward, backward, side and orbit views produce the reference flow', flight.every(r => r.survivors >= 5 && r.anchored) && flight[0].radial > 0 && flight[1].radial < 0 && flight[2].x < 0 && flight[3].x > 0 && flight[4].angular > .59, flight);

  const integration = await page.evaluate(() => {
    const g = window.__game, v = g.view;
    g.scenario('drive'); g.physics.resetCar(g.physics.player, 10, 32); g.physics.unlimited = true; v.ballCam = false; v.cameraReady = false;
    for (let i = 0; i < 150; i++) g.advance(1 / 60, { throttle: 1, boost: true });
    const accelerating = v.supersonicStreaks.mesh.visible && v.speedTrails[0].mesh.visible;
    for (let i = 0; i < 20; i++) g.advance(1 / 60, { throttle: 1 });
    const afterBoost = v.supersonicStreaks.mesh.visible && !g.physics.player.boosting;
    g.advance(1 / 60, { throttle: 1, jump: true, jumpHeld: true });
    const jumpClearsTires = !g.physics.player.grounded && !v.speedTrails[0].mesh.visible;
    for (let i = 0; i < 15; i++) g.advance(1 / 60, { throttle: 1, boost: true });
    const airborne = !g.physics.player.grounded && !v.speedTrails[0].mesh.visible && v.supersonicStreaks.mesh.visible;
    v.paintPreview = true; v.update(0, 'playing'); const previewClears = !v.supersonicStreaks.mesh.visible; v.paintPreview = false;
    v.update(.1, 'playing'); g.physics.player.demolished = 1; v.update(0, 'playing'); const demoClears = !v.supersonicStreaks.mesh.visible;
    g.restart(); v.update(0, 'ready'); const readyClears = !v.supersonicStreaks.mesh.visible;
    return { accelerating, afterBoost, jumpClearsTires, airborne, previewClears, demoClears, readyClears };
  });
  check('Gameplay drives both effects, keeps streaks after boost release and hides them in previews/reset/demo', Object.values(integration).every(Boolean), integration);

  await mkdir('test-results/speed-trails', { recursive: true });
  const renders = [];
  for (const quality of ['performance', 'ultra']) {
    const render = await page.evaluate(quality => {
      const g = window.__game, v = g.view;
      v.setQuality(quality); g.scenario('drive'); g.physics.resetCar(g.physics.player, 10, 32); g.physics.unlimited = true; v.ballCam = false; v.cameraReady = false;
      for (let i = 0; i < 150; i++) g.advance(1 / 60, { throttle: 1, boost: true });
      for (let i = 0; i < 8; i++) g.advance(1 / 60, { throttle: 1 });
      const car = g.physics.player;
      g.hud.camera(false); g.hud.el('event-toast').classList.remove('visible'); g.positionLabels();
      g.hud.update({ blue: 0, orange: 0, time: 300, boost: car.boost, boosting: car.boosting, speed: car.speed, supersonic: car.supersonic, unlimited: true, grounded: car.grounded, fps: 60, overtime: false }, 1);
      const gl = v.renderer.getContext(), width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
      const pixels = () => { v.draw(); const p = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, p); return p; };
      v.supersonicStreaks.mesh.visible = false; const before = pixels();
      v.supersonicStreaks.mesh.visible = true; const after = pixels();
      let changed = 0, center = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (Math.max(Math.abs(after[i] - before[i]), Math.abs(after[i + 1] - before[i + 1]), Math.abs(after[i + 2] - before[i + 2])) > 3) {
          changed++; if (Math.hypot((x / width * 2 - 1) * .85, y / height * 2 - 1) < .12) center++;
        }
      }
      return { quality, changed, center, width, height };
    }, quality);
    renders.push(render);
    await page.screenshot({ path: `test-results/speed-trails/${quality}-supersonic.png` });
    if (quality === 'ultra') {
      await page.evaluate(() => {
        const g = window.__game, v = g.view, p = v.player.root.position;
        v.supersonicStreaks.mesh.visible = false;
        v.camera.position.set(p.x - 4, p.y + 1.1, p.z + 2.8); v.camera.fov = 50; v.camera.updateProjectionMatrix();
        v.camera.lookAt(p.x, p.y, p.z + 1.8); v.camera.updateMatrixWorld();
        v.stadium.grass.update(v.camera.position, p, v.time); g.positionLabels(); v.draw();
      });
      await page.screenshot({ path: 'test-results/speed-trails/ultra-tire-profile.png' });
    }
  }
  check('Streaks actually render in Performance and Ultra while leaving the center clear', renders.every(r => r.changed > 60 && r.center < 5 && r.changed / (r.width * r.height) < .025), renders);
  check('No browser errors', errors.length === 0, errors);
  await writeFile('test-results/speed-trails/behavior.json', JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); }
