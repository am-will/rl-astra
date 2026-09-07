// Generate with RocketSim c2baacb8f4b441dd8505e63c2aeb5a1679b60b02.
// See docs/ball-physics-parity.md for build instructions. No game assets needed.
#include "src/RocketSim.h"
#include <iomanip>
#include <iostream>
#include <memory>
using namespace RocketSim;

Vec fromGame(float x, float y, float z) { return Vec(-z * 100, -x * 100, y * 100); }
void vectorJSON(Vec v, float scale = .01f) {
  std::cout << '[' << -v.y * scale << ',' << v.z * scale << ',' << -v.x * scale << ']';
}
std::unique_ptr<Arena> arena(bool floor) {
  ArenaConfig config;
  config.useCustomBroadphase = false;
  auto a = std::unique_ptr<Arena>(Arena::Create(GameMode::THE_VOID, config, 120));
  if (floor) {
    auto shape = new btStaticPlaneShape(btVector3(0, 0, 1), 0);
    auto body = new btRigidBody(0, nullptr, shape);
    body->setFriction(RLConst::ARENA_COLLISION_BASE_FRICTION);
    body->setRestitution(RLConst::ARENA_COLLISION_BASE_RESTITUTION);
    body->setUserPointer(a.get());
    a->_worldCollisionRBs.push_back(body);
    a->_bulletWorld.addRigidBody(body);
  }
  return a;
}
int main() {
  RocketSim::InitFromMem({}, true);
  std::cout << std::setprecision(9);
  std::cout << "{\"revision\":\"c2baacb8f4b441dd8505e63c2aeb5a1679b60b02\",\"drops\":[";
  bool comma = false;
  for (float h : {2.f, 5.f, 10.f}) {
    auto a = arena(true);
    BallState s; s.pos = fromGame(0,h,0); s.vel.z = -.001f; a->ball->SetState(s);
    bool bounced = false; float peak = 0, incoming = 0, outgoing = 0;
    for (int i=0;i<600;i++) {
      auto before = a->ball->GetState(); a->Step(); auto after = a->ball->GetState();
      if (!bounced && before.vel.z < 0 && after.vel.z > 20) {
        bounced = true; incoming = before.vel.z / 100; outgoing = after.vel.z / 100;
      }
      if (bounced) { peak = std::max(peak, (after.pos.z - RLConst::BALL_COLLISION_RADIUS_SOCCAR)/100); if (after.vel.z < 0) break; }
    }
    if (comma) std::cout << ','; comma = true;
    std::cout << "{\"height\":" << h << ",\"peak\":" << peak << ",\"incoming\":" << incoming << ",\"outgoing\":" << outgoing << '}';
  }
  std::cout << "],\"angledBounces\":["; comma = false;
  for (float spin : {0.f, -4.f, 4.f}) {
    auto a=arena(true); BallState s; s.pos=fromGame(0,1.5,0); s.vel=fromGame(8,-6,3);
    s.angVel=Vec(-spin,0,0); a->ball->SetState(s);
    BallState end;
    for(int i=0;i<120;i++) {a->Step();end=a->ball->GetState();if(end.vel.z>0)break;}
    if(comma)std::cout<<',';comma=true;
    std::cout << "{\"spin\":"<<spin<<",\"velocity\":";vectorJSON(end.vel);
    std::cout << ",\"angularVelocity\":";vectorJSON(end.angVel,1);std::cout<<'}';
  }
  std::cout << "],\"flight\":["; comma = false;
  for (int ticks : {1,60,120}) {
    auto a = arena(false); BallState s;
    s.pos = fromGame(0,10,0); s.vel = fromGame(10,5,-8); s.angVel = Vec(1,-2,3); a->ball->SetState(s);
    a->Step(ticks); auto end = a->ball->GetState();
    if (comma) std::cout << ','; comma=true;
    std::cout << "{\"ticks\":" << ticks << ",\"position\":"; vectorJSON(end.pos);
    std::cout << ",\"velocity\":"; vectorJSON(end.vel);
    std::cout << ",\"spin\":"; vectorJSON(end.angVel,1); std::cout << '}';
  }
  std::cout << "],\"hitFormula\":["; comma=false;
  for (auto position : {fromGame(0,.6,-1.5),fromGame(.8,.4,-1.2),fromGame(0,-.6,-1.5)}) {
    for (float speed : {0.f,2.f,5.f,14.f,23.f,46.f,60.f}) {
      auto a=arena(false); auto car=a->AddCar(Team::BLUE); CarState c;
      c.pos = fromGame(0,10,0); c.vel = fromGame(0,0,-speed); car->SetState(c);
      BallState b; b.pos=c.pos+position; a->ball->SetState(b);
      float friction=0,restitution=0;
      a->ball->_OnHit(car,Vec(),friction,restitution,GameMode::SOCCAR,a->GetMutatorConfig(),10);
      if(comma)std::cout<<',';comma=true;
      std::cout << "{\"relativePosition\":"; vectorJSON(position);
      std::cout << ",\"relativeVelocity\":"; vectorJSON(-c.vel);
      std::cout << ",\"addedVelocity\":"; vectorJSON(a->ball->_velocityImpulseCache * BT_TO_UU); std::cout << '}';
    }
  }
  std::cout << "],\"shots\":[";comma=false;
  for (float speed : {2.f,4.f,7.f,14.f,23.f}) {
    auto a=arena(true);auto car=a->AddCar(Team::BLUE);CarState c;
    c.pos=fromGame(0,.17,3);car->SetState(c);
    BallState b;b.pos=fromGame(0,.9125,1.3);a->ball->SetState(b);
    a->Step(36);c=car->GetState();c.vel=fromGame(0,0,-speed);car->SetState(c);
    b=BallState();b.pos=fromGame(0,.9125,1.3);a->ball->SetState(b);
    car->controls.throttle=1;car->controls.boost=speed>20;
    for(int i=0;i<120;i++) {a->Step();if(car->GetState().ballHitInfo.isValid)break;}
    if(comma)std::cout<<',';comma=true;
    std::cout << "{\"speed\":"<<speed<<",\"velocity\":";vectorJSON(a->ball->GetState().vel);std::cout<<'}';
  }
  std::cout << "]}\n";
}
