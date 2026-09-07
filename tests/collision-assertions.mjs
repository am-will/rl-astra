import assert from 'node:assert/strict';
const speed=v=>Math.hypot(v.x,v.y,v.z),change=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
// Outcome checks are independent of the engine's hit-effect callback: solver
// contacts and the resulting physical velocity must both support the claim.
export function assertOutcomes(name,states){
 const byTick=new Map(states.map(s=>[s.tick,s])),hits=states.filter(s=>s.contacts.length);
 for(const s of states)for(const b of s.poses){assert(Object.values(b.p).every(Number.isFinite)&&Object.values(b.q).every(Number.isFinite)&&Object.values(b.v).every(Number.isFinite),'non-finite body state');if(b.enabled)assert(Math.abs(b.p.x)<45&&Math.abs(b.p.z)<62&&b.p.y>-2,`${name} tick ${s.tick}: body escaped arena ${JSON.stringify(b)}`);}
 for(const slot of [0,1]){
  const hit=hits.find(s=>s.contacts.includes(slot?'orange-ball':'blue-ball'));
  if(!hit)continue;
  const before=byTick.get(hit.tick-1),after=byTick.get(hit.tick+1);if(!before||!after)continue;
  assert(change(before.poses[2].v,after.poses[2].v)>1,`${name}: ${slot} contacted ball but imparted no significant impulse`);
  if(name===(slot?'orange':'blue')+'-moving')assert(speed(before.poses[2].v)>1,'moving-ball fixture must still be moving at impact');
  if(name===(slot?'orange':'blue')+'-stationary')assert(Math.abs(after.poses[2].v.z)>2&&Math.sign(after.poses[2].v.z)===(slot?1:-1),'stationary shot must travel away from striker');
 }
 const carHit=hits.find(s=>s.contacts.includes('cars'));
 if(name==='head-on'||name==='sideways'){
  assert(carHit,'car contact required');const pre=byTick.get(carHit.tick-1),after=byTick.get(carHit.tick+8);
  assert(pre&&after);assert([0,1].some(i=>change(pre.poses[i].v,after.poses[i].v)>1),'car collision must change momentum');
 }
 if(name==='simultaneous'||name==='staggered'){
  const blue=hits.find(s=>s.contacts.includes('blue-ball')).tick,orange=hits.find(s=>s.contacts.includes('orange-ball')).tick;
  assert(name==='simultaneous'?Math.abs(blue-orange)<=2:orange-blue>=3,`${name}: challenge timing was not exercised (${blue}, ${orange})`);
 }
}
