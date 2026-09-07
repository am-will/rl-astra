import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { Vector3 } from 'three';

const reference = JSON.parse(await readFile(new URL('./reference/rocketsim-ball.json', import.meta.url), 'utf8'));
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const results = [];
const check = (name, pass, detail) => { assert.ok(pass, `${name}: ${JSON.stringify(detail)}`); results.push({ name, detail }); console.log('PASS', name); };
const vector = v => new Vector3(v.x, v.y, v.z);
let p;
try {
  const { Physics } = await vite.ssrLoadModule('/src/physics.ts');
  const { ballHitVelocity } = await vite.ssrLoadModule('/src/ball-physics.ts');
  const { emptyInput, FIELD } = await vite.ssrLoadModule('/src/config.ts');
  p = new Physics(); await p.init(); p.botEnabled = false;
  const neutral = emptyInput(), step = (input = neutral) => p.step(input, neutral);
  const reset = () => { p.reset(); p.resetCar(p.player, 20, 25); };

  const formulaErrors = reference.hitFormula.map(row => ballHitVelocity(new Vector3(...row.relativePosition), new Vector3(...row.relativeVelocity), new Vector3(0,0,-1)).distanceTo(new Vector3(...row.addedVelocity)));
  check('Extra hit velocity matches the compiled RocketSim reference at 21 speeds and angles', Math.max(...formulaErrors) < .00001, { maxError: Math.max(...formulaErrors) });
  check('Ball retains the reference mass and sphere inertia with separate contact materials', Math.abs(p.ball.mass() - 30) < .00001 && Math.abs(p.ball.principalInertia().x - .4 * 30 * FIELD.ballRadius ** 2) < .0001, { mass: p.ball.mass(), inertia: p.ball.principalInertia() });

  const drops = [];
  for (const row of reference.drops) {
    reset(); p.ball.setTranslation({ x:0, y:row.height, z:0 }, true); p.ball.setLinvel({x:0,y:-.00001,z:0},true);
    let bounced = false, peak = 0, ratio = 0;
    for (let i=0;i<600;i++) {
      const incoming = p.ball.linvel().y; step(); const outgoing = p.ball.linvel().y;
      if (!bounced && incoming < 0 && outgoing > .2) { bounced = true; ratio = outgoing / -incoming; }
      if (bounced) { peak = Math.max(peak, p.ball.translation().y - FIELD.ballRadius); if (outgoing < 0) break; }
    }
    drops.push({ height: row.height, peak, referencePeak: row.peak, ratio, relativeError: Math.abs(peak / row.peak - 1) });
  }
  check('Floor drops retain 60% normal speed and rebound within 1% of RocketSim', drops.every(r => Math.abs(r.ratio - .6) < .002 && r.relativeError < .01), drops);

  const bounces = [];
  for (const row of reference.angledBounces) {
    reset();p.ball.setTranslation({x:0,y:1.5,z:0},true);p.ball.setLinvel({x:8,y:-6,z:3},true);p.ball.setAngvel({x:0,y:0,z:row.spin},true);
    for(let i=0;i<120;i++){step();if(p.ball.linvel().y>0)break;}
    bounces.push({spin:row.spin,velocity:vector(p.ball.linvel()).toArray(),reference:row.velocity,velocityError:vector(p.ball.linvel()).distanceTo(new Vector3(...row.velocity)),spinError:vector(p.ball.angvel()).distanceTo(new Vector3(...row.angularVelocity))});
  }
  console.log('ANGLED BOUNCES',JSON.stringify(bounces));
  check('Angled floor bounces follow RocketSim with forward and backward spin', bounces.every(r=>r.velocityError<.2&&r.spinError<.2),bounces);

  const walls=[];
  for(const ceiling of [false,true]) {
    reset();p.ball.setTranslation(ceiling?{x:0,y:18,z:0}:{x:38,y:8,z:0},true);
    p.ball.setLinvel(ceiling?{x:0,y:12,z:0}:{x:12,y:0,z:0},true);
    let contacts=0,wrongContacts=0,material;
    for(let i=0;i<120;i++) {
      step();
      p.world.contactPairsWith(p.ballWorldCollider,other=>{
        if(p.isArenaCollider(other))p.world.contactPair(p.ballWorldCollider,other,m=>{
          for(let j=0;j<m.numSolverContacts();j++){contacts++;material={friction:m.solverContactFriction(j),restitution:m.solverContactRestitution(j)};}
        });
      });
      p.world.contactPairsWith(p.ballCollider,other=>{if(p.isArenaCollider(other))p.world.contactPair(p.ballCollider,other,m=>{wrongContacts+=m.numSolverContacts();});});
      if((ceiling?p.ball.linvel().y:p.ball.linvel().x)<0)break;
    }
    walls.push({ceiling,contacts,wrongContacts,material,velocity:vector(p.ball.linvel()).toArray()});
  }
  check('Walls and ceiling use only the arena collider and its reference material',walls.every(r=>r.contacts>0&&r.wrongContacts===0&&Math.abs(r.material.friction-.35)<.00001&&Math.abs(r.material.restitution-.6)<.00001&&(r.ceiling?r.velocity[1]:r.velocity[0])<0),walls);

  const flights = [];
  for (const row of reference.flight) {
    reset(); p.ball.setTranslation({x:0,y:10,z:0},true); p.ball.setLinvel({x:10,y:5,z:-8},true); p.ball.setAngvel({x:2,y:3,z:-1},true);
    for(let i=0;i<row.ticks;i++)step();
    flights.push({ ticks:row.ticks, positionError:vector(p.ball.translation()).distanceTo(new Vector3(...row.position)), velocityError:vector(p.ball.linvel()).distanceTo(new Vector3(...row.velocity)), spinError:vector(p.ball.angvel()).distanceTo(new Vector3(...row.spin)) });
  }
  check('Free flight matches RocketSim velocity and preserves spin over one second', flights.every(r => r.velocityError < .001 && r.positionError < .03 && r.spinError < .00001), flights);

  const shots = [];
  const materials = [];
  for (const row of reference.shots) {
    p.reset(); p.resetCar(p.player,0,3); for(let i=0;i<36;i++)step();
    p.ball.setTranslation({x:0,y:FIELD.ballRadius,z:1.3},true);p.player.body.setLinvel({x:0,y:0,z:-row.speed},true);
    let hit=false;p.onHit=()=>{hit=true;};
    for(let i=0;i<120;i++){step({...neutral,throttle:1,boost:row.speed>20});if(hit)break;}
    const v=vector(p.ball.linvel());
    p.world.contactPair(p.player.collider,p.ballCollider,m=>{for(let i=0;i<m.numSolverContacts();i++)materials.push({friction:m.solverContactFriction(i),restitution:m.solverContactRestitution(i)});});
    shots.push({speed:row.speed,velocity:v.toArray(),referenceVelocity:row.velocity,liftRatio:v.y/row.velocity[1],forwardRatio:v.z/row.velocity[2]});
    assert(hit,`No contact at speed ${row.speed}`);
  }
  console.log('SHOT COMPARISON', JSON.stringify(shots));
  check('Grounded shots stay within 15% lift and 27% forward speed of the Octane reference', shots.every(r=>r.velocity.every(Number.isFinite)&&Math.abs(r.liftRatio-1)<.15&&Math.abs(r.forwardRatio-1)<.27), shots);
  check('Actual car contacts use friction 2 and zero restitution', materials.length>0&&materials.every(m=>m.friction===2&&m.restitution===0),materials);

  // Restoring in the middle of repeated touches must preserve cooldowns and both
  // contact colliders, including the case where solver contacts are already warm.
  p.reset();p.resetCar(p.player,0,1.5);p.ball.setTranslation({x:0,y:FIELD.ballRadius,z:0},true);
  const drive={...neutral,throttle:1}; for(let i=0;i<20;i++)step(drive);
  const saved=p.checkpoint();for(let i=0;i<120;i++)step(drive);const expected=JSON.stringify(p.canonicalState());
  p.restore(saved);for(let i=0;i<120;i++)step(drive);
  check('Contact material and hit cooldown restoration reproduces the same trajectory exactly', JSON.stringify(p.canonicalState())===expected, {});

  // The extra impulse must be zero for bodies translating together; removing
  // the old base kick prevents a stationary touch from being a powered hit.
  check('Equal car/ball velocities produce no extra kick', ballHitVelocity(new Vector3(0,.6,-1.5),new Vector3(),new Vector3(0,0,-1)).length()===0,{});
  await mkdir('test-results/ball-physics',{recursive:true});
  await writeFile('test-results/ball-physics/comparison.json',JSON.stringify({reference:reference.revision,results},null,2));
} finally { p?.world.free(); await vite.close(); }
