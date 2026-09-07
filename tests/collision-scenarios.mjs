// Shared by the deterministic harness and a separately bundled, loopback-only
// test server. These fixtures are never imported by the deployed application.
export const scenarioNames = ['kickoff','blue-stationary','orange-stationary','blue-moving','orange-moving','simultaneous','staggered','head-on','sideways','ball-sandwich','boosted-offset','late-boost','jump-challenge','steer-challenge','airborne-ball'];
export function setupScenario(sim, name, reset=true) {
  if (!scenarioNames.includes(name)) throw Error(`Unknown collision fixture ${name}`);
  if(reset)sim.resetMatch(); sim.phase='playing'; sim.remaining=300;
  const p=sim.physics; p.botEnabled=true;
  const place=(car,x,z,yaw=0,speed=0)=>{
    car.body.setTranslation({x,y:.34,z},true);
    car.body.setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);
    car.body.setLinvel({x:-Math.sin(yaw)*speed,y:0,z:-Math.cos(yaw)*speed},true);
    car.body.setAngvel({x:0,y:0,z:0},true);
  };
  place(p.player,0,8);place(p.bot,0,-8,Math.PI);
  p.ball.setTranslation({x:0,y:1.02,z:0},true);p.ball.setLinvel({x:0,y:0,z:0},true);
  if(name==='kickoff'){place(p.player,0,29);place(p.bot,0,-29,Math.PI);}
  if(name.includes('stationary')||name.includes('moving')) {
    const slot=name.startsWith('blue')?0:1;
    place(slot?p.player:p.bot,20,20);
    if(name.includes('moving'))p.ball.setLinvel({x:0,y:0,z:slot?-4:4},true);
  }
  if(name==='head-on'||name==='sideways')p.ball.setTranslation({x:20,y:1.02,z:0},true);
  if(name==='sideways'){place(p.player,0,8);place(p.bot,8,0,Math.PI/2);}
  if(name==='ball-sandwich'){place(p.player,-.35,6);place(p.bot,.35,-6,Math.PI);}
  if(name==='boosted-offset'){place(p.player,-.5,12);place(p.bot,.5,-12,Math.PI);}
  if(name==='airborne-ball'){for(const car of [p.player,p.bot]){const v=car.body.translation();car.body.setTranslation({...v,y:4},true);car.body.setLinvel({x:0,y:0,z:car===p.player?-12:12},true);}p.ball.setTranslation({x:0,y:4.7,z:0},true);}
  return sim;
}
export function scenarioInput(name,tick,slot) {
  tick -= 90; // Shared neutral warm-up lets both clocks and input leads settle.
  const active=!(name.startsWith('blue-')&&slot===1||name.startsWith('orange-')&&slot===0);
  const delay=name==='staggered'&&slot===1?18:0;
  const lateBoost=name==='late-boost'&&slot===1&&tick>=100&&tick<165;
  const jump=name==='jump-challenge'&&tick===116;
  return {throttle:active&&tick>delay&&tick<360?1:0,steer: name==='steer-challenge'&&tick>=108&&tick<120?(slot?-.2:.2):name==='boosted-offset'&&tick>55&&tick<75?(slot?-.02:.02):0,
    boost: active&&tick>delay&&tick<360&&(name==='kickoff'||name==='boosted-offset'||lateBoost),jump,jumpHeld:name==='jump-challenge'&&tick>=116&&tick<124,drift:false,
    pitch:0,yaw:0,roll:0,dodgeForward:0,dodgeSide:0};
}
export function contacts(sim) {
  const p=sim.physics,result=[];
  for(const [name,a,b] of [['blue-ball',p.player.collider,p.ballCollider],['orange-ball',p.bot.collider,p.ballCollider],['cars',p.player.collider,p.bot.collider]]) {
    if(!a.isEnabled()||!b.isEnabled())continue;
    p.world.contactPair(a,b,m=>{for(let i=0;i<m.numContacts();i++)if(m.contactDist(i)<=.015&&!result.includes(name))result.push(name);});
  }
  return result;
}
export function requiredContacts(name) {
  if(name.startsWith('blue-'))return ['blue-ball'];if(name.startsWith('orange-'))return ['orange-ball'];
  if(name==='head-on'||name==='sideways')return ['cars'];
  if(name==='ball-sandwich')return ['blue-ball','orange-ball','cars'];
  return ['blue-ball','orange-ball'];
}
export function poses(sim){return [sim.physics.player.body,sim.physics.bot.body,sim.physics.ball].map(b=>({p:b.translation(),q:b.rotation(),v:b.linvel(),enabled:b.isEnabled()}));}
export function percentile(values,p){return [...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]||0;}
