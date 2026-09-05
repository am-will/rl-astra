import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createBall, createCarModel, type CarModel } from './assets';
import { Effects } from './effects';
import { GameAudio } from './game-audio';
import { Stadium, glowTexture } from './stadium';
import { FIELD } from './config';
import type { Physics, Car } from './physics';
import { loadDetailedModels, detailedCar, detailedBall } from './models';
import { createBallMarker } from './ball-marker';
import { createBlastPass } from './blast-pass';
import { FollowCamera } from './follow-camera';
import { RocketBoost } from './rocket-boost';
import { SpeedTrails } from './speed-trails';
import { FlameSmoke } from './flame-smoke';
import { BallDirection } from './ball-direction';
import { TurfDebris } from './turf-debris';
import { CarPaint, validPaintJob, type PaintJob } from './car-paint';

export type QualityLevel = 'performance' | 'high' | 'ultra';
export type BoostStyle = 'classic' | 'inferno';

export class GameRenderer {
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(69, innerWidth / innerHeight, .15, 550);
  renderer: T.WebGLRenderer;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  blast = createBlastPass();
  stadium: Stadium;
  player: CarModel; bot: CarModel;
  ball: T.Group;
  ballGround: T.Mesh;
  ballDirection: BallDirection;
  effects: Effects;
  boosts: [RocketBoost, RocketBoost];
  infernos: [FlameSmoke, FlameSmoke];
  boostStyle: BoostStyle = 'classic';
  paintJob: PaintJob = 'ultraviolet';
  carPaint!: CarPaint;
  paintPreview = false;
  paintPreviewAngle: 'front' | 'side' | 'rear' = 'front';
  private lastPaintFrame = performance.now();
  speedTrails: [SpeedTrails, SpeedTrails];
  turfDebris: [TurfDebris, TurfDebris];
  audio = new GameAudio();
  ballCam = true;
  cameraLook = 0;
  shake = 0;
  time = 0;
  look = new T.Vector3();
  cameraForward = new T.Vector3(0, 0, -1);
  cameraReady = false;
  followCamera = new FollowCamera();
  qualityLevel: QualityLevel = 'performance';
  get quality() { return this.qualityLevel !== 'performance'; }
  private sun = new T.DirectionalLight();
  private fill = new T.DirectionalLight();
  private ambient = new T.HemisphereLight(0xc5e1ff, 0x233524, 1.25);
  private sky!: T.Mesh;
  private playerWasDemolished = false;
  constructor(container: HTMLElement, public physics: Physics) {
    try {
      const saved = localStorage.getItem('champions-field.quality');
      if (saved === 'high' || saved === 'ultra') this.qualityLevel = saved;
      if (localStorage.getItem('champions-field.boost-style') === 'inferno') this.boostStyle = 'inferno';
      const paint = localStorage.getItem('champions-field.paint-job');
      if (validPaintJob(paint)) this.paintJob = paint;
    } catch { /* Use the default visual preset when storage is unavailable. */ }
    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.quality ? Math.min(devicePixelRatio, 1.5) : 1); this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.id = 'game-canvas'; this.renderer.domElement.setAttribute('aria-label', '3D car soccer arena. Use W A S D to drive.'); container.prepend(this.renderer.domElement);
    this.scene.background = new T.Color(0x0b172d); this.scene.fog = new T.FogExp2(0x102139, .0045);
    const pmrem = new T.PMREMGenerator(this.renderer), env = new RoomEnvironment();
    // Broad light banks create legible reflections across the small car's curved panels.
    for (const side of [-1, 1]) {
      const panel = new T.Mesh(new T.PlaneGeometry(10, 2), new T.MeshBasicMaterial({ color: new T.Color(side > 0 ? 0xd3eaff : 0xffc98c).multiplyScalar(1.4), side: T.DoubleSide }));
      panel.position.set(side * 6, 6, -3); panel.lookAt(0, 0, 0); env.add(panel);
    }
    this.scene.environment = pmrem.fromScene(env, .025).texture; pmrem.dispose(); env.dispose(); this.scene.environmentIntensity = .48;
    this.sky = new T.Mesh(new T.SphereGeometry(240, 40, 24), new T.ShaderMaterial({ side: T.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec3 vDirection;void main(){vec3 d=normalize(vDirection);float horizon=exp(-max(d.y,0.)*7.);vec3 color=mix(vec3(.025,.07,.16),vec3(.54,.39,.25),horizon);float sun=pow(max(0.,dot(d,normalize(vec3(-50.,42.,-35.)))),180.);color+=vec3(1.7,.85,.3)*sun;gl_FragColor=vec4(color,1.);#include <tonemapping_fragment>
#include <colorspace_fragment>}`.replace(';#include',';\n#include') }));
    this.sky.name = 'ultra-sunset-sky'; this.sky.renderOrder = -5; this.scene.add(this.sky);
    this.scene.add(this.ambient);
    const moon = this.sun; moon.color.setHex(0xe2f2ff); moon.intensity = 2.2; moon.position.set(-25, 65, 22); moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048); moon.shadow.camera.left = -65; moon.shadow.camera.right = 65; moon.shadow.camera.top = 65; moon.shadow.camera.bottom = -65; moon.shadow.camera.far = 160; moon.shadow.bias = -.0005; moon.shadow.normalBias = .025;
    this.scene.add(moon);
    const fill = this.fill; fill.color.setHex(0x90c9ff); fill.intensity = 1.1; fill.position.set(45, 24, -35); this.scene.add(fill);
    this.stadium = new Stadium(this.scene, physics.pads);
    this.player = createCarModel('blue'); this.bot = createCarModel('orange'); this.scene.add(this.player.root, this.bot.root);
    this.carPaint = new CarPaint(this.player); this.carPaint.set(this.paintJob);
    this.player.root.scale.setScalar(.5); this.bot.root.scale.setScalar(.5);
    this.ball = createBall(); this.scene.add(this.ball);
    this.ballGround = createBallMarker(); this.scene.add(this.ballGround);
    this.ballDirection = new BallDirection(this.scene);
    // Soft contact shadows preserve weight under the broad stadium lighting.
    for (const owner of [this.player.root, this.bot.root, this.ball]) {
      const shadow = new T.Mesh(new T.PlaneGeometry(2.6, 2.6), new T.MeshBasicMaterial({ map: glowTexture(), color: 0x000000, transparent: true, opacity: .57, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.userData.owner = owner; shadow.name = 'contact-shadow'; this.scene.add(shadow);
    }
    this.effects = new Effects(this.scene);
    this.boosts = [new RocketBoost(this.scene), new RocketBoost(this.scene)];
    this.infernos = [new FlameSmoke(this.scene), new FlameSmoke(this.scene)];
    this.speedTrails = [new SpeedTrails(this.scene), new SpeedTrails(this.scene, true)];
    this.speedTrails[0].configureWheels(this.player); this.speedTrails[1].configureWheels(this.bot);
    this.turfDebris = [new TurfDebris(this.scene), new TurfDebris(this.scene)];
    this.turfDebris[0].configureWheels(this.player); this.turfDebris[1].configureWheels(this.bot);
    this.composer = new EffectComposer(this.renderer); this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new T.Vector2(innerWidth, innerHeight), .32, .45, 1.2); this.bloom.enabled = this.quality;
    this.composer.addPass(this.bloom); this.composer.addPass(this.blast); this.composer.addPass(new OutputPass());
    window.addEventListener('resize', () => this.resize());
    this.setQuality(this.qualityLevel);
    this.update(0, 'ready');
  }
  async loadAssets() {
    const source = await loadDetailedModels();
    const old = [this.player.root, this.bot.root, this.ball];
    this.player = detailedCar(source.car, 'blue');
    this.carPaint = new CarPaint(this.player); this.carPaint.set(this.paintJob);
    this.bot = detailedCar(source.car, 'orange');
    this.ball = detailedBall(source.ball);
    const replacement = [this.player.root, this.bot.root, this.ball];
    old.forEach(o => this.scene.remove(o)); replacement.forEach(o => this.scene.add(o));
    this.scene.children.filter(o => o.name === 'contact-shadow').forEach(o => { const index = old.indexOf(o.userData.owner); if (index >= 0) o.userData.owner = replacement[index]; });
    this.stadium.addMonument(source.car, source.ball);
    this.speedTrails[0].configureWheels(this.player); this.speedTrails[1].configureWheels(this.bot);
    this.turfDebris[0].configureWheels(this.player); this.turfDebris[1].configureWheels(this.bot);
    old.forEach(root => root.traverse(o => { if (o instanceof T.Mesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } }));
    this.update(0, 'ready');
  }
  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); this.composer.setSize(innerWidth, innerHeight); }
  toggleQuality() { const modes: QualityLevel[] = ['performance', 'high', 'ultra']; this.setQuality(modes[(modes.indexOf(this.qualityLevel) + 1) % modes.length]); }
  setQuality(level: QualityLevel) {
    this.qualityLevel = level;
    const ultra = level === 'ultra', pixelRatio = Math.min(devicePixelRatio, ultra ? 2 : this.quality ? 1.5 : 1);
    this.renderer.setPixelRatio(pixelRatio); this.composer.setPixelRatio(pixelRatio); this.bloom.enabled = this.quality; this.bloom.radius = ultra ? .4 : .45; this.bloom.threshold = ultra ? 2.2 : 1.2;
    this.stadium.grass.mesh.visible = ultra; this.sky.visible = ultra;
    this.sun.color.setHex(ultra ? 0xffc786 : 0xe2f2ff); this.sun.intensity = ultra ? 3.1 : 2.2;
    this.sun.position.set(ultra ? -50 : -25, ultra ? 42 : 65, ultra ? -35 : 22);
    this.fill.intensity = ultra ? 1.2 : 1.1; this.ambient.intensity = ultra ? .8 : 1.25; this.scene.environmentIntensity = ultra ? .58 : .48;
    (this.scene.fog as T.FogExp2).color.setHex(ultra ? 0x34464d : 0x102139); (this.scene.fog as T.FogExp2).density = ultra ? .0034 : .0045;
    const size = ultra ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; this.sun.shadow.mapSize.set(size, size); }
    this.resize();
    try { localStorage.setItem('champions-field.quality', level); } catch { /* The selected mode still applies for this session. */ }
  }
  setBoostStyle(style: BoostStyle) {
    this.boostStyle = style; this.boosts.forEach(effect => effect.reset()); this.infernos.forEach(effect => effect.reset());
    try { localStorage.setItem('champions-field.boost-style', style); } catch { /* Apply without persistence. */ }
  }
  setPaintJob(paint: PaintJob) {
    this.paintJob = paint; this.carPaint.set(paint);
    try { localStorage.setItem('champions-field.paint-job', paint); return true; } catch { return false; }
  }
  syncCar(model: CarModel, car: Car, dt: number, alpha: number) {
    model.root.visible = car.demolished <= 0;
    model.root.position.lerpVectors(car.previousPosition, new T.Vector3().copy(car.body.translation()), alpha); model.root.quaternion.slerpQuaternions(car.previousRotation, new T.Quaternion().copy(car.body.rotation()), alpha);
    for (const wheel of model.wheels) { wheel.rotation.x -= car.speed * dt / .24; if (wheel.userData.front) wheel.rotation.y = car.steer * .4; }
    const active = car.boosting && car.demolished <= 0 && (car !== this.physics.bot || this.physics.botEnabled);
    const index = model === this.player ? 0 : 1, velocity = new T.Vector3().copy(car.body.linvel());
    const classic = this.boostStyle === 'classic';
    this.boosts[index].update(model.root.position, model.root.quaternion, velocity, active && classic, dt);
    this.boosts[index].root.visible &&= classic;
    if (car.demolished > 0 || (index === 1 && !this.physics.botEnabled)) this.infernos[index].reset();
    this.infernos[index].update(model.root.position, model.root.quaternion, velocity, active && this.boostStyle === 'inferno', dt, this.camera);
    this.speedTrails[model === this.player ? 0 : 1].update(model.root.position, model.root.quaternion, car.speed, car.supersonic, model.root.visible && (car !== this.physics.bot || this.physics.botEnabled), dt);
    if (active && classic && dt > 0 && Math.random() < dt * 35) {
      const behind = new T.Vector3(0, 0, 1).applyQuaternion(model.root.quaternion);
      this.effects.emit(new T.Vector3(Math.random() < .5 ? -.255 : .255, .025, 1.6).applyQuaternion(model.root.quaternion).add(model.root.position), behind.multiplyScalar(6), 0xffa52e, .12 + Math.random() * .15, .06);
    }
    this.turfDebris[index].update(model, car, this.physics.pads, dt, model.root.visible && (index === 0 || this.physics.botEnabled));
  }
  update(dt: number, phase: string, celebration?: T.Vector3, alpha = 1) {
    this.time += dt;
    const paintNow = performance.now();
    this.carPaint.update(this.paintPreview ? Math.min(.05, (paintNow - this.lastPaintFrame) / 1000) : dt); this.lastPaintFrame = paintNow;
    this.syncCar(this.player, this.physics.player, dt, alpha); this.syncCar(this.bot, this.physics.bot, dt, alpha); this.bot.root.visible &&= this.physics.botEnabled;
    this.ball.visible = phase !== 'goal';
    this.ball.position.lerpVectors(this.physics.ballPreviousPosition, new T.Vector3().copy(this.physics.ball.translation()), alpha); this.ball.quaternion.slerpQuaternions(this.physics.ballPreviousRotation, new T.Quaternion().copy(this.physics.ball.rotation()), alpha);
    const ground = this.physics.groundBelow(this.ball.position);
    const markerRadius = 1.55 + Math.sqrt(Math.max(0, this.ball.position.y - ground.position.y - FIELD.ballRadius)) * .46;
    this.ballGround.scale.setScalar(markerRadius);
    this.ballGround.position.copy(ground.position).addScaledVector(ground.normal, .045);
    this.ballGround.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), ground.normal);
    this.ballGround.visible = phase !== 'goal';
    this.ballDirection.update(this.player.root.position, this.ball.position, !this.ballCam && this.player.root.visible && phase !== 'goal' && phase !== 'ended');
    this.effects.ballStreak.update(this.ball.position, new T.Vector3().copy(this.physics.ball.linvel()), dt, this.ball.visible && phase === 'playing');
    for (const obj of this.scene.children) if (obj.name === 'contact-shadow') {
      const owner = obj.userData.owner as T.Object3D; obj.position.set(owner.position.x, .025, owner.position.z); obj.visible = owner.visible;
      (obj as T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>).material.opacity = .55 / Math.max(1, owner.position.y * .55);
    }
    this.stadium.update(this.physics.pads, this.time); this.effects.update(dt);
    this.bloom.strength = (this.qualityLevel === 'ultra' ? .22 : .32) + this.effects.explosion.impact * .35;
    this.renderer.toneMappingExposure = (this.qualityLevel === 'ultra' ? 1.08 : 1.05) - this.effects.explosion.impact * .16;
    const car = this.physics.player, pos = this.player.root.position, q = this.player.root.quaternion;
    if (this.playerWasDemolished && car.demolished <= 0) this.cameraReady = false;
    this.playerWasDemolished = car.demolished > 0;
    const focus = phase === 'goal' && celebration ? this.effects.explosion.root.position : this.ball.position;
    this.followCamera.update(this.camera, pos, q, focus, car.demolished > 0 ? 0 : car.speed, this.ballCam, car.flipTime > 0, dt, !this.cameraReady, (from, to) => this.physics.cameraClearance(from, to), this.cameraLook);
    if (dt > 0 || !this.cameraReady) { this.cameraForward.copy(this.followCamera.forward); this.look.copy(this.followCamera.look); }
    this.cameraReady = true;
    this.shake = Math.max(0, this.shake - dt * 1.5);
    // Render shake never feeds back into the next frame's follow position.
    if (dt > 0) { this.camera.position.x += (Math.random() - .5) * (this.shake * .15 + this.effects.explosion.impact * .35); this.camera.position.y += (Math.random() - .5) * (this.shake * .1 + this.effects.explosion.impact * .23); }
    if (this.paintPreview) {
      const narrow = innerWidth <= 650;
      const angle = { front: [-2.2, 1.15, -2.65], side: [-3.15, 1.05, -.65], rear: [2.15, 1.2, 2.7] }[this.paintPreviewAngle];
      this.camera.fov = narrow ? 46 : 38; this.camera.updateProjectionMatrix();
      this.camera.position.copy(pos).add(new T.Vector3(...angle).multiplyScalar(narrow ? 1.75 : 1).applyQuaternion(q));
      const target = pos.clone().add(new T.Vector3(0, .12, 0).applyQuaternion(q));
      this.camera.lookAt(target);
      target.addScaledVector(new T.Vector3(narrow ? 0 : 1, narrow ? 1 : 0, 0).applyQuaternion(this.camera.quaternion), narrow ? -1.4 : .72);
      this.camera.lookAt(target);
    }
    this.camera.updateMatrixWorld();
    this.effects.demolitions.updateCamera(this.camera.position);
    this.stadium.updateCamera(this.camera.position);
    this.stadium.grass.update(this.camera.position, this.player.root.position, this.time);
    const blastCenter = this.effects.explosion.root.position.clone().project(this.camera);
    this.blast.enabled = this.effects.explosion.root.visible && blastCenter.z < 1 && Number.isFinite(blastCenter.x) && Number.isFinite(blastCenter.y);
    this.blast.uniforms.center.value.set(blastCenter.x * .5 + .5, blastCenter.y * .5 + .5);
    this.blast.uniforms.time.value = this.effects.explosion.age;
    this.blast.uniforms.aspect.value = this.camera.aspect;
    this.audio.update(car, phase === 'playing' || phase === 'goal' || phase === 'countdown', dt, phase === 'countdown');
  }
  draw() { this.renderer.info.reset(); this.composer.render(); }
}
