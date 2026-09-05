import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const output = 'test-results/stadium-presentation';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const results = [], errors = [];
const check = (name, pass, detail) => { assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); results.push({ name, detail }); console.log(`PASS ${name}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => localStorage.setItem('champions-field.quality', 'ultra'));
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5179');
  await page.waitForFunction(() => window.__game && !document.querySelector('#loading'));
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; window.__game.testing = true; }); await page.waitForTimeout(80);
  const motion = await page.evaluate(async () => {
    const T=await import('/node_modules/.vite/deps/three.js'),v=window.__game.view,p=v.stadium.presentation,renderer=v.renderer;
    const scene=new T.Scene();scene.background=new T.Color(0x050c16);scene.add(new T.HemisphereLight(0xc4ddff,0x26351d,2),new T.DirectionalLight(0xffffff,3));
    const camera=new T.PerspectiveCamera(45,1.6,.1,300),rows=[];renderer.setRenderTarget(null);
    const capture=()=>{renderer.render(scene,camera);const gl=renderer.getContext(),pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;};
    const diff=(a,b)=>{let count=0;for(let i=0;i<a.length;i+=4)if(Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>5)count++;return count;};
    for(const [name,position,target] of [
      ['stadium-live-screen',[-43,25,0],[-66,25,0]],
      ['stadium-panorama-ribbon',[-44,17,1],[-64,16.2,0]],
      ['stadium-wind-banner',[-47,27,-52],[-60,27,-52]],
      ['stadium-crowd',[28,10,3],[53,10,0]],
    ]) {
      const source=v.scene.getObjectByName(name),copy=source.clone();copy.children.filter(c=>c.userData.cameraFadeOverlay).forEach(c=>copy.remove(c));scene.add(copy);
      camera.position.fromArray(position);camera.lookAt(...target);camera.updateMatrixWorld();
      const version=source.instanceMatrix?.version;p.update(0);capture();const a=capture(),paused=capture();p.update(1.7);const b=capture();
      rows.push({name,changed:diff(a,b),paused:diff(a,paused),instancesStable:source.instanceMatrix?.version===version});scene.remove(copy);
    }
    // Render the actual searchlight geometry with the same moving transforms as the stadium.
    const beam=p.atmosphere.getObjectByName('stadium-searchlight'),copy=beam.clone();scene.add(copy);camera.position.set(-25,42,-22);camera.lookAt(-57,55,-44);camera.updateMatrixWorld();
    p.update(0);copy.quaternion.copy(beam.quaternion);capture();const a=capture();p.update(4);copy.quaternion.copy(beam.quaternion);const b=capture();
    rows.push({name:'stadium-searchlight',changed:diff(a,b),paused:diff(b,capture()),instancesStable:true});
    p.update(v.time);v.draw();return rows;
  });
  check('Screens, ribbons, cloth, crowd and roof beams visibly animate, with stable paused frames', motion.every(r=>r.changed>250&&r.paused===0&&r.instancesStable), motion);
  const match = await page.evaluate(() => {
    const g=window.__game,v=g.view,p=v.stadium.presentation;g.scenario('drive');g.blue=2;g.orange=1;g.remaining=74.3;g.advance(0);
    const initial=p.matchKey,version=p.scoreboardTexture.version;g.advance(0);const stable=p.scoreboardTexture.version===version;
    g.overtime=true;g.remaining=13;g.advance(0);const overtime=p.matchKey;
    g.practice=true;g.advance(0);const practice=p.matchKey;
    g.practice=false;g.overtime=false;g.phase='playing';g.score('blue');g.advance(0);v.update(.1,'goal');
    const celebration=p.celebration.value,color=p.celebrationColor.value.getHexString(),goal=p.matchKey;
    g.restart();g.advance(0);v.update(0,'ready');return{initial,stable,overtime,practice,celebration,color,goal,reset:p.celebration.value};
  });
  check('The real match updates the stadium score/clock, practice, overtime and goal celebration', match.initial==='2:1:75:false:false:playing'&&match.stable&&match.overtime.includes(':true:playing')&&match.practice.includes(':true:true:playing')&&match.celebration>.9&&match.color==='168bff'&&match.goal.startsWith('3:1:')&&match.reset===0, match);
  const lifecycle=await page.evaluate(()=>{
    const g=window.__game,v=g.view,p=v.stadium.presentation;g.scenario('drive');const rows=[];
    for(const quality of ['performance','high','ultra','performance','ultra']){v.setQuality(quality);v.update(.1,'playing');v.draw();rows.push({quality,atmosphere:p.atmosphere.visible,screen:!!v.scene.getObjectByName('stadium-live-screen'),clock:p.time.value});}
    const before=p.time.value;v.update(0,'playing');const paused=p.time.value===before;
    v.update(.1,'playing');v.draw();const gl=v.renderer.getContext(),one=new Uint8Array(4),times=[],programs=v.renderer.info.programs.length;
    for(let i=0;i<25;i++){const start=performance.now();v.update(1/60,'playing');v.draw();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,one);times.push(performance.now()-start);}
    times.sort((a,b)=>a-b);return{rows,paused,programsAdded:v.renderer.info.programs.length-programs,p50:times[12],p95:times[23],drawCalls:v.renderer.info.render.calls};
  });
  check('Quality switches preserve stadium motion; Ultra gates atmosphere and steady frames create no shaders', lifecycle.rows.every(r=>r.screen&&r.atmosphere===(r.quality==='ultra'))&&lifecycle.paused&&lifecycle.programsAdded===0,lifecycle);
  await page.evaluate(()=>{const g=window.__game,v=g.view;v.camera.position.set(8,3,18);v.camera.lookAt(55,17,0);v.camera.updateMatrixWorld();v.stadium.grass.update(v.camera.position,v.player.root.position,v.time);g.positionLabels();v.draw();});
  await page.screenshot({path:`${output}/arena-final.png`});
  check('No browser or shader errors',errors.length===0,errors);
  await writeFile(`${output}/checks.json`,JSON.stringify({results,errors},null,2));
}finally{await browser.close();}
