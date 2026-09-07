import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
await mkdir('test-results/refinements', { recursive: true });
try {
  await page.goto('http://127.0.0.1:5179'); await page.waitForFunction(() => window.__game?.view && !document.querySelector('#loading'));
  await page.screenshot({ path: 'test-results/refinements/arena.png' });
  const camera = async (name, position, target) => {
    await page.evaluate(({position,target}) => { const g=window.__game; g.scenario('drive'); g.view.camera.position.set(...position);g.view.look.set(...target);g.view.camera.lookAt(g.view.look);g.view.camera.updateMatrixWorld();g.view.draw(); }, {position,target});
    await page.screenshot({ path: `test-results/refinements/${name}.png` });
  };
  await camera('corner', [26, 8, 34], [36, 3, 45]);
  await camera('goal-mouth', [17, 4, 39], [7, 1.8, 51]);
  await camera('goal-interior', [0, 3.3, 48], [6, 3.3, 57]);
  await camera('ceiling', [0, 8, 0], [16, 21, -20]);
  await page.evaluate(() => { const g=window.__game; g.scenario('goal-blue'); g.advance(.6); });
  let previous = 0;
  for (const age of [.15,.35,.75,1.3,2.3,3.5]) {
    await page.evaluate(delta => { const g=window.__game;for(let t=0;t<delta;t+=1/60)g.view.update(1/60,'goal',g.celebration);g.view.draw(); }, age-previous); previous=age;
    await page.screenshot({ path: `test-results/refinements/explosion-${age}.png` });
  }
  const metrics = await page.evaluate(() => { const g=window.__game;g.scenario('air');g.advance(.65,{jump:true,throttle:1,pitch:-1});const end=g.snapshot();g.advance(.2,{throttle:1,pitch:-1});const held=g.snapshot();g.scenario('air');g.advance(.35,{roll:1});return {end,held,roll:g.physics.player.body.angvel()}; });
  await writeFile('test-results/refinements/visual-report.json',JSON.stringify({metrics,errors},null,2));
  console.log(JSON.stringify({metrics,errors},null,2));
  if(errors.length)throw new Error(errors.join('\n'));
} finally {await browser.close();}
