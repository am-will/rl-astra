import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {simulationBuild} from './build-id.mjs';
const prefix=process.argv[2];if(!prefix)throw Error('Usage: node scripts/verify-replay.mjs path/to/room-id (without extension)');
const data=JSON.parse(gunzipSync(await readFile(prefix+'.baseline.gz')));
assert.equal(data.build,simulationBuild(),'Replay requires its original simulation build');
data.saved.physics.world=new Uint8Array(Buffer.from(data.saved.physics.world,'base64'));
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom'});let sim;
try{
 const {Simulation}=await vite.ssrLoadModule('/src/simulation.ts');sim=new Simulation();await sim.initPhysics();sim.restore(data.saved);
 const first=sim.tickNumber;let verified=0;
 for(const line of (await readFile(prefix+'.jsonl','utf8')).trim().split('\n')){
  const row=JSON.parse(line);assert.equal(row.build,data.build);assert.equal(row.epoch,data.epoch);
  for(const frame of row.frames){if(frame.tick<=first)continue;assert.equal(frame.tick,sim.tickNumber+1,'Gap in replay');sim.step(frame.inputs,frame.start);if(frame.hash){assert.equal(sim.digest(),frame.hash,`Replay mismatch at ${frame.tick}`);verified++;}}
 }
 console.log(JSON.stringify({build:data.build,baselineTick:first,finalTick:sim.tickNumber,verifiedHashes:verified,hash:sim.digest()}));
 assert(verified>0,'Replay must include verified physics beyond the baseline');
}finally{sim?.physics.world.free();await vite.close();}
