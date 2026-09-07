import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';
const url = 'http://127.0.0.1:18787', key = 'isolated-security-test-key-123456789';
const server = spawn(process.execPath, ['dist-server/index.mjs'], { env: { ...process.env, PORT: '18787', PUBLIC_ORIGIN: url, ALPHA_KEY: key, LOG_DIR: 'test-results/safety-replays' }, stdio: ['ignore','pipe','pipe'] });
let output=''; server.stdout.on('data', b=>output+=b); server.stderr.on('data', b=>output+=b);
const wait = ms=>new Promise(r=>setTimeout(r,ms));
async function connect(message, origin=url) {
  const ws=new WebSocket(url.replace('http','ws')+'/api/connect',{origin});
  await once(ws,'open'); if (message!==undefined) ws.send(JSON.stringify(message)); return ws;
}
async function rejected(message) { const ws=await connect(message); await Promise.race([once(ws,'close'),wait(3000).then(()=>{throw new Error('Invalid connection remained open')})]); }
try {
  for(let i=0;i<100;i++) { if(output.includes('listening')) break; if(server.exitCode!==null) throw new Error(output); await wait(50); }
  const health=await (await fetch(url+'/api/health')).json();
  assert.equal((await fetch(url+'/api/admin/status')).status,401);
  assert.equal((await fetch(url+'/api/rooms',{method:'POST',headers:{Authorization:`Bearer ${key}`,Origin:'https://untrusted.invalid'}})).status,403);
  for(const message of [null,[],{}, {type:'join',build:health.build,room:'unknown',token:'x'}, {type:'join',build:'old',room:'unknown',token:'x'}]) await rejected(message);
  const room=await (await fetch(url+'/api/rooms',{method:'POST'})).json();
  assert.match(room.code,/^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal((await fetch(url+'/api/rooms',{method:'POST',headers:{Authorization:`Bearer ${key}`}})).status,503);
  for(const body of ['null','{}','{bad','{"code":"１２３４５６７８"}']) assert.equal((await fetch(url+'/api/join',{method:'POST',body})).status,400);
  assert.equal((await fetch(url+'/api/join',{method:'POST',body:'x'.repeat(2000)})).status,413);
  assert.equal((await fetch(url+'/api/join',{method:'POST',body:JSON.stringify({code:'ZZZZ-ZZZZ'})})).status,404);
  const joined=await (await fetch(url+'/api/join',{method:'POST',body:JSON.stringify({code:room.code.toLowerCase()})})).json();
  assert.equal(joined.id,room.id); assert.equal(joined.seatToken,room.inviteToken); assert(!('hostToken' in joined));
  const host=await connect({type:'join',room:room.id,token:room.hostToken,build:health.build});
  const welcome=await new Promise(resolve=>host.on('message',(bytes,binary)=>{if(!binary){const m=JSON.parse(bytes); if(m.type==='welcome') resolve(m);}}));
  assert.equal(welcome.slot,0);
  await rejected({type:'join',room:room.id,token:room.hostToken,build:health.build});
  // Binary traffic on the signaling socket is forbidden.
  host.send(Buffer.alloc(3)); await once(host,'close');
  const status=await (await fetch(url+'/api/admin/status',{headers:{Authorization:`Bearer ${key}`}})).json();
  assert.equal(status.rooms.length,1); assert.equal(status.rooms[0].peers[0],null);
  assert.equal(server.exitCode,null);
  console.log('PASS anonymous eight-character room creation, admin authentication, Origin checks, room capacity, malformed/oversized messages, code validation, seat isolation and process survival');
} catch(error) { console.error(output); throw error; } finally { if(server.exitCode===null) { server.kill('SIGTERM'); await once(server,'exit'); } }
