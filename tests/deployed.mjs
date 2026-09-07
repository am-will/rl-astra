import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
const origin = process.env.GAME_URL || 'https://rl-astra.amwill.dev';
const relay = process.env.FORCE_RELAY === '1', tcp = process.env.TURN_TCP === '1';
const name = relay ? tcp ? 'relay-tcp' : 'relay' : 'direct';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/opt/google/chrome/chrome', args:['--no-sandbox','--enable-gpu','--use-angle=gl','--ozone-platform=x11','--disable-dev-shm-usage','--disable-background-timer-throttling','--disable-renderer-backgrounding'] });
const pages=[], errors=[], samples=[], paths=[];
try {
  for (let seat=0;seat<2;seat++) {
    const context=await browser.newContext({viewport:{width:640,height:400}});
    await context.addInitScript(({relay,tcp})=>{
      localStorage.setItem('champions-field.quality','performance');
      const RTC=RTCPeerConnection; window.testPeers=[];
      window.RTCPeerConnection=class extends RTC {
        constructor(config) {
          if(relay) config={...config,iceTransportPolicy:'relay'};
          if(tcp) config.iceServers=config.iceServers.map(s=>({...s,urls:(Array.isArray(s.urls)?s.urls:[s.urls]).filter(u=>u.includes('transport=tcp'))})).filter(s=>s.urls.length);
          super(config); window.testPeers.push(this); this.addEventListener("icecandidateerror",e=>console.log("ICEERROR",e.errorCode,e.errorText)); this.addEventListener("icecandidate",e=>{if(e.candidate)console.log("ICECANDIDATE",e.candidate.candidate)});
        }
      };
      // Initial and final visuals render normally. During transport measurement,
      // bypass software rasterization so a headless GPU cannot masquerade as lag.
      for(const proto of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]) for(const method of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']) {
        const original=proto[method]; if(original) proto[method]=function(...args){if(!window.testSkipDraw) return original.apply(this,args);};
      }
    },{relay,tcp});
    const page=await context.newPage(); pages.push(page);
    page.on('pageerror',e=>errors.push(e.message)); page.on('console',e=>{if(e.text().startsWith('ICE'))console.log(e.text()); if(e.text().includes('Simulation drift') || e.type()==='error') {errors.push(e.text());console.log(e.type(),e.text());}});
    console.log('Loading deployed seat',seat,name);
    await page.goto(origin);await page.waitForFunction(()=>typeof window.multiplayerStatus==='function' && !document.querySelector('#loading'),null,{timeout:60000});
    if(seat===0) {await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/deployed-lobby.png'});}
    await page.evaluate(()=>{window.testSkipDraw=false;});
  }
  const [host,guest]=pages;
  // An expired saved seat must return to usable forms without a manual reset.
  await guest.evaluate(()=>sessionStorage.setItem('alpha-seat',JSON.stringify({room:'expired-room',seat:'expired-seat'})));
  await guest.reload();
  await guest.waitForFunction(()=>window.multiplayerStatus?.().state==='OFFLINE' && !document.querySelector('#online-menu')?.hidden && !sessionStorage.getItem('alpha-seat'),null,{timeout:40000});
  assert.equal(await host.locator('#alpha-key').count(),0);
  console.log('PASS expired session returns to lobby without an access key');
  await host.locator('#online-toggle').click();await host.locator('#online-create button').click();
  await host.locator('#room-code').filter({hasText:'JOIN CODE:'}).waitFor();
  const code=(await host.locator('#room-code').innerText()).replace('JOIN CODE: ','');
  assert.match(code,/^[A-HJ-NP-Z2-9]{8}$/);
  await host.screenshot({path:`test-results/deployed-code-${name}.png`});
  await guest.locator('#join-code').fill(code);await guest.locator('#online-join button').click();
  await Promise.all(pages.map(p=>p.waitForFunction(()=>window.multiplayerStatus().ready && window.multiplayerStatus().phase==='playing',null,{timeout:40000})));
  assert.equal((await host.evaluate(()=>window.multiplayerStatus())).slot,0);assert.equal((await guest.evaluate(()=>window.multiplayerStatus())).slot,1);
  console.log('PASS deployed join code and both player slots',name);
  await host.keyboard.down('w');await host.keyboard.down('Shift');await guest.keyboard.down('w');
  const duration=Number(process.env.TEST_SECONDS||25);
  for(let second=0;second<duration;second++) {
    if(second===3) await host.keyboard.press('Space'); if(second===6) await guest.keyboard.down('a'); if(second===11) await guest.keyboard.up('a');
    await new Promise(r=>setTimeout(r,1000));
    const pair=await Promise.all(pages.map(p=>p.evaluate(()=>window.multiplayerStatus()))); samples.push(pair);
    if(second%10===0)console.log('SAMPLE',JSON.stringify(pair));
  }
  assert(samples.every(pair=>pair.every(p=>p.statistics.desyncs===0)),'deployed authoritative state diverged');
  assert(samples.at(-1).every(p=>p.ready && p.tick>1200),'match must keep advancing');
  assert(samples.some(pair=>pair.every(p=>p.speed>5)),'both players must drive');
  for(const page of pages) paths.push(await page.evaluate(async()=>{
    const pc=window.testPeers.at(-1),stats=await pc.getStats();let selected;
    stats.forEach(s=>{if(s.type==='transport'&&s.selectedCandidatePairId)selected=stats.get(s.selectedCandidatePairId);});
    const local=selected&&stats.get(selected.localCandidateId),remote=selected&&stats.get(selected.remoteCandidateId);
    return {policy:pc.getConfiguration().iceTransportPolicy,address:local?.address,port:local?.port,url:local?.url,local:local?.candidateType,protocol:local?.protocol,relayProtocol:local?.relayProtocol,remote:remote?.candidateType,rtt:selected?.currentRoundTripTime};
  }));
  if(relay)assert(paths.every(p=>p.policy==='relay' && ['udp','tcp'].includes(p.relayProtocol)),`must actually use TURN: ${JSON.stringify(paths)}`);
  if(tcp)assert(paths.every(p=>p.relayProtocol==='tcp'),`must use TCP relay: ${JSON.stringify(paths)}`);
  console.log('PASS deployed physics, scores and transport',name,JSON.stringify(paths));
  const prior=await guest.evaluate(()=>window.multiplayerStatus().tick);await guest.reload();
  await guest.waitForFunction(t=>window.multiplayerStatus?.().ready && window.multiplayerStatus().tick>t,null===prior?0:prior,{timeout:40000});
  await guest.evaluate(()=>{window.testSkipDraw=false;});
  console.log('PASS deployed reload reconnect',name);
  assert.deepEqual(errors,[]);
  await host.evaluate(()=>{window.testSkipDraw=false;});await host.screenshot({path:`test-results/deployed-${name}.png`});
  await host.locator('#online-leave').evaluate(button=>button.click());
  await guest.waitForFunction(()=>window.multiplayerStatus?.().state==='OFFLINE' && !document.querySelector('#online-menu')?.hidden && !sessionStorage.getItem('alpha-seat'),null,{timeout:40000});
  await guest.locator('#online-create button').click();
  await guest.locator('#room-code').filter({hasText:'JOIN CODE:'}).waitFor();
  const reverseCode=(await guest.locator('#room-code').innerText()).replace('JOIN CODE: ','');
  assert.match(reverseCode,/^[A-HJ-NP-Z2-9]{8}$/);assert.notEqual(reverseCode,code);
  await host.waitForFunction(()=>window.multiplayerStatus?.().state==='OFFLINE');
  await host.locator('#online-toggle').click();await host.locator('#join-code').fill(reverseCode.toLowerCase());await host.locator('#online-join button').click();
  await Promise.all(pages.map(p=>p.waitForFunction(()=>window.multiplayerStatus().ready && window.multiplayerStatus().phase==='playing',null,{timeout:40000})));
  assert.equal((await host.evaluate(()=>window.multiplayerStatus())).slot,1);assert.equal((await guest.evaluate(()=>window.multiplayerStatus())).slot,0);
  await guest.locator('#online-leave').evaluate(button=>button.click());
  console.log('PASS host leave returns guest to lobby; either player creates and joins with eight characters');
  assert.deepEqual(errors,[]);
} catch(error) {
  for(const page of pages)console.log('Failure state',await page.evaluate(()=>({status:window.multiplayerStatus?.(),text:document.querySelector('#net-status')?.textContent,pc:window.testPeers?.map(p=>({ice:p.iceConnectionState,connection:p.connectionState}))})).catch(()=>null));
  throw error;
} finally {
  await mkdir('test-results',{recursive:true});await writeFile(`test-results/deployed-${name}.json`,JSON.stringify({origin,errors,samples,paths},null,2));
  if(pages[0])await pages[0].locator('#online-leave').evaluate(button=>button.click()).catch(()=>{});
  await browser.close();
}
