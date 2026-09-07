import assert from 'node:assert/strict';
// Positions use arena metres; the car chassis is ~0.96 m wide / 1.47 m long.
// The regional gate keeps local corrections below a chassis width. Stress is
// deliberately harsher (110–210 ms RTT, 10% loss): larger remote errors are
// tolerated briefly, but never the renderer's 3 m / 1.6 rad teleport cutoff.
export const budgets={ideal:{distance:[.08,.4,.15],rotation:[.12,.2,.2]},direct:{distance:[.3,.7,.35],rotation:[.2,.5,.6]},regional:{distance:[.6,1.5,.9],rotation:[.25,.9,1]},stress:{distance:[1.1,2.4,1.5],rotation:[.35,1.4,1.4]}};
export function assertCorrectionBudget(samples,slot,profile,label){
 const budget=budgets[profile],gameplay=samples.filter(s=>!s.transition);
 for(const c of gameplay)for(const [role,i]of [slot,1-slot,2].entries()){
  assert(c.bodies[i].distance<=budget.distance[role],`${label}: body ${i} distance ${c.bodies[i].distance.toFixed(3)} > ${budget.distance[role]} at ${c.tick}`);
  assert(c.bodies[i].radians<=budget.rotation[role],`${label}: body ${i} rotation ${c.bodies[i].radians.toFixed(3)} > ${budget.rotation[role]} at ${c.tick}`);
 }
 return gameplay;
}
