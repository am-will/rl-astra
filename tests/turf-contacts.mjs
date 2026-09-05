import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const output = 'test-results/turf-contacts';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const results = [], errors = [];
const check = (name, pass, detail) => { assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); results.push({ name, detail }); console.log(`PASS ${name}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => localStorage.setItem('champions-field.quality', 'ultra'));
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5179');
  await page.waitForFunction(() => window.__game && !document.querySelector('#loading'));
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; window.__game.testing = true; }); await page.waitForTimeout(80);
  await page.evaluate(async () => {
    window.T = await import('/node_modules/.vite/deps/three.js');
    const g = window.__game, v = g.view; g.scenario('drive'); g.physics.resetCar(g.physics.player, 10, 20); g.advance(.25);
    window.captureTurf = () => { v.draw(); const gl = v.renderer.getContext(), a = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, a); return a; };
    window.turfDelta = (a,b,i) => Math.max(...[0,1,2].map(c => Math.abs(a[i+c]-b[i+c])));
  });
  const patches = await page.evaluate(() => {
    const g = window.__game, v = g.view, c = g.physics.player, grass = v.stadium.grass, rows = [];
    v.occlusion.enabled = v.bloom.enabled = v.antialias.enabled = false;
    for (const angle of [0, .72, Math.PI/2]) {
      c.body.setRotation(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0), angle), true);
      c.grounded = true; c.groundNormal.set(0,1,0); v.update(0, 'playing');
      const contacts = v.turfDebris[0].contacts.map(p => p.clone()), rotation = v.player.root.quaternion.clone();
      v.player.root.visible = v.bot.root.visible = false;
      v.camera.position.set(10,7,20); v.camera.up.set(0,0,-1); v.camera.fov = 32; v.camera.updateProjectionMatrix(); v.camera.lookAt(10,0,20); v.camera.updateMatrixWorld();
      grass.update(v.camera.position,v.player.root.position,0); grass.setTireContacts(1,[],rotation); grass.setTireContacts(0,[],rotation);
      const before = window.captureTurf(); grass.setTireContacts(0,contacts,rotation); const after = window.captureTurf();
      const w=v.renderer.domElement.width,h=v.renderer.domElement.height,hit=contacts.map(()=>0);
      const eye=v.camera.position, target=new T.Vector3(); let changed=0,center=0,outside=0;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
        const i=(y*w+x)*4;if(window.turfDelta(before,after,i)<=5)continue;
        target.set((x+.5)/w*2-1,(y+.5)/h*2-1,.5).unproject(v.camera).sub(eye).normalize();
        target.multiplyScalar((.05-eye.y)/target.y).add(eye); changed++;
        const local=target.clone().sub(v.player.root.position).applyQuaternion(rotation.clone().invert());
        if(Math.abs(local.x)<.12&&Math.abs(local.z)<.27)center++;
        let inside=false;
        contacts.forEach((p,i)=>{if(Math.hypot(p.x-target.x,p.z-target.z)<.29){hit[i]++;inside=true;}});
        if(!inside)outside++;
      }
      rows.push({angle,contacts:contacts.length,hit,changed,center,outside});
    }
    v.camera.up.set(0,1,0);v.occlusion.enabled=v.bloom.enabled=v.antialias.enabled=true;
    return rows;
  });
  check('Four separate tire patches rotate with the car and leave the chassis center untouched', patches.every(r=>r.contacts===4&&r.hit.every(n=>n>50)&&r.center===0&&r.outside<r.changed*.01), patches);
  await page.screenshot({ path: `${output}/four-patches.png` });
  const contactState = await page.evaluate(() => {
    const g=window.__game,v=g.view,c=g.physics.player,rows=[];
    for(const [name,x,y,z,grounded,demolished,angle] of [['ground',10,.308,20,true,0,0],['jump',10,2,20,false,0,0],['roll',10,2,20,false,0,Math.PI/2],['demo',10,.308,20,true,1,0],['pad',-31,.308,0,true,0,0],['goal',0,.308,55,true,0,0]]) {
      c.body.setTranslation({x,y,z},true);c.body.setRotation(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),angle),true);c.grounded=grounded;c.demolished=demolished;v.update(0,'playing');
      rows.push({name,contacts:v.turfDebris[0].contacts.length,active:v.stadium.grass.uniforms.grassTires.value.slice(0,4).filter(p=>p.x<1e4).length});
    }
    c.demolished=0;return rows;
  });
  check('Compression clears immediately in the air, during demolition, and off the turf', contactState.every(r=>r.contacts===(r.name==='ground'?4:0)&&r.active===r.contacts), contactState);
  const halo = await page.evaluate(async () => {
    const g=window.__game,v=g.view;g.scenario('drive');g.physics.resetCar(g.physics.player,10,20);g.advance(.25);v.update(0,'playing');
    const c=v.player.root.position;v.camera.position.set(c.x-3.4,c.y+2.1,c.z+3.8);v.camera.fov=48;v.camera.updateProjectionMatrix();v.camera.lookAt(c.x,.3,c.z);v.camera.updateMatrixWorld();v.stadium.grass.update(v.camera.position,c,0);
    v.bloom.enabled=v.antialias.enabled=false;v.draw();v.renderer.shadowMap.autoUpdate=false;
    const capture=enabled=>{v.player.root.visible=enabled;return window.captureTurf();};
    v.occlusion.enabled=false;const shown=capture(true),hidden=capture(false),w=v.renderer.domElement.width,h=v.renderer.domElement.height,mask=new Uint8Array(w*h);
    for(let y=3;y<h-3;y++)for(let x=3;x<w-3;x++)if(window.turfDelta(shown,hidden,(y*w+x)*4)>1)for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)mask[(y+dy)*w+x+dx]=1;
    v.occlusion.enabled=true;const material=v.occlusion.blendMaterial,original=material.fragmentShader;
    const {GTAOBlendShader}=await import('/node_modules/three/examples/jsm/shaders/GTAOShader.js');
    const rows=[];
    for(const [name,shader] of [['legacy',GTAOBlendShader.fragmentShader],['fixed',original]]) {
      material.fragmentShader=shader;material.needsUpdate=true;const a=capture(true),b=capture(false);let bright=0,max=0;
      for(let i=0;i<mask.length;i++)if(!mask[i]){const delta=(a[i*4]+a[i*4+1]+a[i*4+2]-b[i*4]-b[i*4+1]-b[i*4+2])/3;if(delta>3)bright++;max=Math.max(max,delta);}
      rows.push({name,bright,max});
    }
    v.player.root.visible=true;v.renderer.shadowMap.autoUpdate=true;v.bloom.enabled=v.antialias.enabled=true;v.draw();return rows;
  });
  check('The car no longer brightens the surrounding grass through ambient occlusion', halo[0].bright>50&&halo[1].bright<halo[0].bright*.05, halo);
  await page.screenshot({ path: `${output}/silhouette.png` });
  const debris = [];
  for(const drift of [false,true]) {
    const row=await page.evaluate(drift=>{
      const g=window.__game,v=g.view,fx=v.turfDebris[0];g.scenario('drive');g.physics.resetCar(g.physics.player,10,20);g.advance(.25);v.ballCam=false;v.cameraReady=false;
      g.physics.player.body.setLinvel({x:0,y:0,z:-16},true);fx.reset();
      for(let i=0;i<55;i++)g.advance(1/60,{throttle:1,steer:.85,drift});
      fx.smoke.mesh.visible=false;
      const compare=()=>{fx.mesh.visible=false;const a=window.captureTurf();fx.mesh.visible=true;const b=window.captureTurf();let changed=0;for(let i=0;i<a.length;i+=4)if(window.turfDelta(a,b,i)>8)changed++;return changed;};
      const grass=compare();v.stadium.grass.mesh.visible=false;const bare=compare();v.stadium.grass.mesh.visible=true;v.draw();
      const active=fx.pool.filter(p=>p.life>0);return{drift,grass,bare,count:fx.mesh.count,maxHeight:Math.max(...active.map(p=>p.position.y)),above:active.filter(p=>p.position.y>.2).length,depthTest:fx.mesh.material.depthTest};
    },drift);debris.push(row);
    await page.screenshot({path:`${output}/${drift?'drift':'turn'}-clumps.png`});
  }
  check('Turning and drifting clumps visibly clear the grass canopy with normal depth testing', debris.every(r=>r.count>5&&r.above>5&&r.maxHeight>.35&&r.grass>120&&r.grass>r.bare*.5&&r.depthTest), debris);
  check('No browser or shader errors', errors.length===0, errors);
  await writeFile(`${output}/checks.json`,JSON.stringify({results,errors},null,2));
} finally { await browser.close(); }
