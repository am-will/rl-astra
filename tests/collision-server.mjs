import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {simulationBuild} from '../scripts/build-id.mjs';
export async function buildFixtureServer(){
 const fixture=JSON.stringify(resolve('tests/collision-scenarios.mjs'));
 await build({entryPoints:['server/index.ts','server/room.ts'],outdir:'test-results/fixture-server',outExtension:{'.js':'.mjs'},platform:'node',target:'node22',format:'esm',bundle:true,packages:'external',define:{__SIM_BUILD__:JSON.stringify(simulationBuild())},plugins:[{name:'test-fixtures-only',setup(b){b.onLoad({filter:/server\/(index|room)\.ts$/},async args=>{
  let contents=await readFile(args.path,'utf8');
  if(args.path.endsWith('/index.ts')) {
   contents="let fixtureName='kickoff'; const fixtureStates = new Map();\n"+contents;
   contents=contents.replace('workerData: { epoch }','workerData: { epoch, fixtureName }');
   contents=contents.replace("worker.on('message', async message => {","worker.on('message', async message => { if(message.type==='test-state'){fixtureStates.set(message.tick,message);if(fixtureStates.size>2500)fixtureStates.delete(fixtureStates.keys().next().value);return;}");
   contents=contents.replace("const origin = req.headers.origin;",`if(req.url?.startsWith('/api/test/') && req.headers.authorization === 'Bearer '+secret){if(req.url.startsWith('/api/test/scenario/')){fixtureName=req.url.split('/').at(-1)!;fixtureStates.clear();res.end('ok');}else res.end(JSON.stringify([...fixtureStates.values()]));return;}\nconst origin = req.headers.origin;`);
  } else {
   contents=`import { setupScenario, contacts, poses } from ${fixture};\n`+contents;
   contents=contents.replace('await authority.init();',`await authority.init();const originalReset=authority.sim.resetMatch.bind(authority.sim);authority.sim.resetMatch=()=>{originalReset();setupScenario(authority.sim,workerData.fixtureName,false);};authority.sim.kickoff=()=>{authority.sim.phase='playing';authority.sim.phaseTime=0;authority.sim.emit({kind:'kickoff'});authority.sim.emit({kind:'go'});};const testEvents=[];authority.sim.onEvent=e=>testEvents.push(e);`);
   contents=contents.replace('const duration = performance.now() - started;',`port.postMessage({type:'test-state',tick:frame.tick,hash:authority.sim.digest(),contacts:contacts(authority.sim),poses:poses(authority.sim),events:testEvents.splice(0),start:frame.start});\nconst duration = performance.now() - started;`);
  }
  return {contents,loader:'ts',resolveDir:resolve('server')};
 });}}]});
}
