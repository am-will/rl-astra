import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import type { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createBloomPass } from './bloom-pass';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
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
import { SupersonicStreaks } from './supersonic-streaks';
import { FlameSmoke } from './flame-smoke';
import { ExhaustBackfire } from './exhaust-backfire';
import { BOOST_OUTLET } from './octane-outlets';
import { BallDirection } from './ball-direction';
import { TurfDebris } from './turf-debris';
import { CarPaint, validPaintJob, type PaintJob } from './car-paint';
import type { CorrectionSample } from './network/prediction';
import { createUltraSky } from './ultra-sky';
import { UltraOcclusion } from './ultra-occlusion';
import { CinematicMotionPass, createCinematicGrade } from './cinematic-pass';

export type QualityLevel = 'performance' | 'high' | 'ultra';
export type BoostStyle = 'classic' | 'inferno';

export class GameRenderer {
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(69, innerWidth / innerHeight, .15, 550);
  renderer: T.WebGLRenderer;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  occlusion: UltraOcclusion;
  motion: CinematicMotionPass;
  motionBlur = true;
  grade = createCinematicGrade();
  antialias = new SMAAPass();
  blast = createBlastPass();
  stadium: Stadium;
  player: CarModel; bot: CarModel;
  ball: T.Group;
  ballGround: T.Mesh;
  ballDirection: BallDirection;
  effects: Effects;
  boosts: [RocketBoost, RocketBoost];
  infernos: [FlameSmoke, FlameSmoke];
  exhausts: [ExhaustBackfire, ExhaustBackfire];
  boostStyle: BoostStyle = 'inferno';
  paintJob: PaintJob = 'ultraviolet';
  carPaint!: CarPaint;
  paintPreview = false;
  paintPreviewAngle: 'front' | 'side' | 'rear' = 'front';
  private lastPaintFrame = performance.now();
  speedTrails: [SpeedTrails, SpeedTrails];
  supersonicStreaks: SupersonicStreaks;
  turfDebris: [TurfDebris, TurfDebris];
  audio = new GameAudio();
  ballCam = true;
  cameraLook = 0;
  shake = 0;
  time = 0;
  look = new T.Vector3();
  cameraForward = new T.Vector3(0, 0, -1);
  cameraReady = false;
  private networkRotations = [new T.Quaternion(), new T.Quaternion(), new T.Quaternion()];
  private networkOffsets = [new T.Vector3(), new T.Vector3(), new T.Vector3()];
  get localModel() { return this.physics.localSlot === 0 ? this.player : this.bot; }
  get remoteModel() { return this.physics.localSlot === 0 ? this.bot : this.player; }
  setOnlineSlot(slot: 0 | 1) {
    this.carPaint?.set('classic');
    this.physics.localSlot = slot; this.cameraReady = false;
    this.carPaint = new CarPaint(this.localModel); this.carPaint.set(this.paintJob);
    this.clearNetworkCorrection();
  }
  clearNetworkCorrection() { for (const offset of this.networkOffsets) offset.set(0, 0, 0); for (const rotation of this.networkRotations) rotation.identity(); }
  correctNetwork(correction: CorrectionSample | null) {
    if (!correction) return;
    if (correction.transition) { this.clearNetworkCorrection(); return; }
    for (let i = 0; i < 3; i++) {
      this.networkRotations[i].multiply(new T.Quaternion().copy(correction.bodies[i].rotation)).normalize();
      this.networkOffsets[i].add(new T.Vector3().copy(correction.bodies[i].offset));
      // Teleports and respawns cut immediately; only small positional corrections ease out.
      if (this.networkOffsets[i].length() > 3) { this.networkOffsets[i].set(0, 0, 0); this.networkRotations[i].identity(); }
      if (this.networkRotations[i].angleTo(new T.Quaternion()) > 1.6) this.networkRotations[i].identity();
    }
  }
  followCamera = new FollowCamera();
  qualityLevel: QualityLevel = 'high';
  get quality() { return this.qualityLevel !== 'performance'; }
  private sun = new T.DirectionalLight();
  private fill = new T.DirectionalLight();
  private ambient = new T.HemisphereLight(0xc5e1ff, 0x233524, 1.25);
  private sky = createUltraSky();
  private shadowCenter = new T.Vector3();
  private shadowRight = new T.Vector3();
  private shadowUp = new T.Vector3();
  private sunOffset = new T.Vector3(-50, 42, -35);
  private playerWasDemolished = false;
  constructor(container: HTMLElement, public physics: Physics) {
    try {
      const saved = localStorage.getItem('champions-field.quality');
      if (saved === 'performance' || saved === 'high' || saved === 'ultra') this.qualityLevel = saved;
      this.motionBlur = localStorage.getItem('champions-field.motion-blur') !== 'off';
      const boost = localStorage.getItem('champions-field.boost-style');
      if (boost === 'classic' || boost === 'inferno') this.boostStyle = boost;
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
    this.scene.add(this.sky);
    this.scene.add(this.ambient);
    const moon = this.sun; moon.color.setHex(0xe2f2ff); moon.intensity = 2.2; moon.position.set(-25, 65, 22); moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048); moon.shadow.camera.left = -65; moon.shadow.camera.right = 65; moon.shadow.camera.top = 65; moon.shadow.camera.bottom = -65; moon.shadow.camera.far = 160; moon.shadow.bias = -.0005; moon.shadow.normalBias = .025;
    this.scene.add(moon, moon.target);
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
    this.exhausts = [new ExhaustBackfire(this.scene), new ExhaustBackfire(this.scene)];
    this.speedTrails = [new SpeedTrails(this.scene), new SpeedTrails(this.scene, true)];
    this.supersonicStreaks = new SupersonicStreaks(this.scene);
    this.speedTrails[0].configureWheels(this.player); this.speedTrails[1].configureWheels(this.bot);
    this.turfDebris = [new TurfDebris(this.scene), new TurfDebris(this.scene)];
    this.turfDebris[0].configureWheels(this.player); this.turfDebris[1].configureWheels(this.bot);
    const target = new T.WebGLRenderTarget(innerWidth, innerHeight, { type: T.HalfFloatType, depthTexture: new T.DepthTexture(innerWidth, innerHeight, T.UnsignedIntType) });
    this.composer = new EffectComposer(this.renderer, target); this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.motion = new CinematicMotionPass(this.camera); this.composer.addPass(this.motion.depthPass);
    this.occlusion = new UltraOcclusion(this.scene, this.camera); this.composer.addPass(this.occlusion);
    this.composer.addPass(this.motion);
    this.bloom = createBloomPass(new T.Vector2(innerWidth, innerHeight)); this.bloom.enabled = this.quality;
    this.composer.addPass(this.bloom); this.composer.addPass(this.blast); this.composer.addPass(this.antialias); this.composer.addPass(this.grade); this.composer.addPass(new OutputPass());
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
  /** Prepare first-use shader programs, textures and buffers while the loading screen is up. */
  async prepareGraphics() {
    const passStates = this.composer.passes.map(pass => pass.enabled), toScreen = this.composer.renderToScreen;
    const grassVisible = this.stadium.grass.mesh.visible, skyVisible = this.sky.visible, atmosphereVisible = this.stadium.presentation.atmosphere.visible;
    const target = this.renderer.getRenderTarget();
    const culling: [T.Object3D, boolean][] = [];
    try {
      this.effects.goal(new T.Vector3(0, 3, FIELD.length), 0x39b7ff);
      for (const burst of this.effects.demolitions.bursts) burst.trigger(this.player.root.position, new T.Vector3(), new T.Quaternion(), 0xff931f);
      this.effects.update(.7); // Includes the delayed singularity and every debris/smoke material.
      for (const [i, model] of [this.player, this.bot].entries()) {
        this.boosts[i].update(model.root.position, model.root.quaternion, new T.Vector3(), true, .12);
        this.infernos[i].update(model.root.position, model.root.quaternion, new T.Vector3(), true, .12, this.camera);
        this.exhausts[i].update(model.root.position, model.root.quaternion, 0, 0, false, true, 0, model.lighting?.exhaustOutlet);
        this.exhausts[i].trigger();
      }
      for (const root of [this.effects.explosion.root, ...this.effects.demolitions.bursts.map(b => b.root)]) {
        root.traverse(object => { culling.push([object, object.frustumCulled]); object.frustumCulled = false; });
      }
      this.stadium.grass.mesh.visible = this.sky.visible = this.stadium.presentation.atmosphere.visible = true;
      this.composer.passes.forEach(pass => { pass.enabled = true; });
      this.composer.renderToScreen = false;
      this.scene.updateMatrixWorld(true);
      // Compile for the same linear HDR target used during play, including hidden materials.
      this.renderer.setRenderTarget(this.composer.readBuffer);
      await this.renderer.compileAsync(this.scene, this.camera);
      // Drawing offscreen also uploads effect geometry/textures and prepares the blast post pass.
      this.draw();
    } finally {
      this.effects.explosion.reset(); this.effects.demolitions.reset();
      this.boosts.forEach(effect => effect.reset()); this.infernos.forEach(effect => effect.reset()); this.exhausts.forEach(effect => effect.reset());
      for (const [object, frustumCulled] of culling) object.frustumCulled = frustumCulled;
      this.stadium.grass.mesh.visible = grassVisible; this.sky.visible = skyVisible; this.stadium.presentation.atmosphere.visible = atmosphereVisible;
      this.composer.passes.forEach((pass, i) => { pass.enabled = passStates[i]; });
      this.composer.renderToScreen = toScreen; this.renderer.setRenderTarget(target);
      this.update(0, 'ready');
    }
  }
  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); this.composer.setSize(innerWidth, innerHeight); this.supersonicStreaks.resize(innerWidth, innerHeight); }
  toggleQuality() { const modes: QualityLevel[] = ['performance', 'high', 'ultra']; this.setQuality(modes[(modes.indexOf(this.qualityLevel) + 1) % modes.length]); }
  setQuality(level: QualityLevel) {
    this.qualityLevel = level;
    const ultra = level === 'ultra', pixelRatio = Math.min(devicePixelRatio, ultra ? 2 : this.quality ? 1.5 : 1);
    this.renderer.setPixelRatio(pixelRatio); this.composer.setPixelRatio(pixelRatio); this.bloom.enabled = this.quality; this.bloom.radius = ultra ? .62 : .5; this.bloom.threshold = ultra ? 1.35 : 1.25;
    this.motion.enabled = this.motion.depthPass.enabled = this.quality && this.motionBlur; this.motion.reset();
    this.occlusion.enabled = ultra;
    // Smooth the actual composed image, including fine grass and bright engine cores.
    this.antialias.enabled = ultra;
    this.stadium.grass.mesh.visible = ultra; this.sky.visible = ultra;
    this.stadium.presentation.atmosphere.visible = ultra;
    this.sun.color.setHex(ultra ? 0xffd4ad : 0xc7dcff); this.sun.intensity = ultra ? 2.15 : 1.9;
    this.sun.position.set(ultra ? -50 : -25, ultra ? 42 : 65, ultra ? -35 : 22);
    this.sun.target.position.set(0, 0, 0);
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = shadowCamera.bottom = -65; shadowCamera.right = shadowCamera.top = 65; shadowCamera.updateProjectionMatrix();
    this.sun.shadow.normalBias = ultra ? .012 : .025; this.sun.shadow.bias = ultra ? -.00012 : -.0005;
    this.fill.intensity = ultra ? .65 : .75; this.ambient.intensity = ultra ? .46 : .8; this.scene.environmentIntensity = ultra ? .6 : .46;
    (this.scene.fog as T.FogExp2).color.setHex(ultra ? 0x17293e : 0x102139); (this.scene.fog as T.FogExp2).density = ultra ? .0038 : .0045;
    const size = ultra ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; this.sun.shadow.mapSize.set(size, size); }
    this.resize();
    try { localStorage.setItem('champions-field.quality', level); } catch { /* The selected mode still applies for this session. */ }
  }
  setMotionBlur(enabled: boolean) {
    this.motionBlur = enabled; this.motion.enabled = this.motion.depthPass.enabled = enabled && this.quality; this.motion.reset();
    try { localStorage.setItem('champions-field.motion-blur', enabled ? 'on' : 'off'); } catch { /* Apply without persistence. */ }
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
    const enabled = model.root.visible && (car !== this.physics.bot || this.physics.botEnabled);
    const active = car.boosting && enabled;
    const index = model === this.player ? 0 : 1, velocity = new T.Vector3().copy(car.body.linvel());
    const signedSpeed = velocity.dot(new T.Vector3(0, 0, -1).applyQuaternion(model.root.quaternion));
    const braking = (car.drifting && car.speed > .5) || (!active && (car.throttle < -.05 || car.throttle * signedSpeed < -.5));
    const engineThrottle = car.throttle * signedSpeed < -.5 ? 0 : car.throttle;
    model.lighting?.update(dt, active, braking, engineThrottle, enabled);
    this.exhausts[index].update(model.root.position, model.root.quaternion, car.speed, car.throttle, active, enabled, dt, model.lighting?.exhaustOutlet);
    const classic = this.boostStyle === 'classic';
    if (!enabled) { this.boosts[index].reset(); this.infernos[index].reset(); }
    this.boosts[index].update(model.root.position, model.root.quaternion, velocity, active && classic, dt);
    this.boosts[index].root.visible &&= classic;
    this.infernos[index].update(model.root.position, model.root.quaternion, velocity, active && this.boostStyle === 'inferno', dt, this.camera);
    this.speedTrails[index].update(model.root.position, model.root.quaternion, car.speed, car.supersonic, car.grounded, enabled, dt);
    if (active && classic && dt > 0 && Math.random() < dt * 35) {
      const behind = new T.Vector3(0, 0, 1).applyQuaternion(model.root.quaternion);
      this.effects.emit(new T.Vector3((Math.random() < .5 ? -1 : 1) * BOOST_OUTLET.x, BOOST_OUTLET.y + (Math.random() - .5) * BOOST_OUTLET.height, BOOST_OUTLET.z + .6).applyQuaternion(model.root.quaternion).add(model.root.position), behind.multiplyScalar(6), 0xffa52e, .12 + Math.random() * .15, .06);
    }
    this.turfDebris[index].update(model, car, this.physics.pads, dt, model.root.visible && (index === 0 || this.physics.botEnabled), this.qualityLevel === 'ultra');
    this.stadium.grass.setTireContacts(index, this.turfDebris[index].contacts, model.root.quaternion);
  }
  update(dt: number, phase: string, celebration?: T.Vector3, alpha = 1) {
    this.time += dt;
    const paintNow = performance.now();
    this.carPaint.update(this.paintPreview ? Math.min(.05, (paintNow - this.lastPaintFrame) / 1000) : dt); this.lastPaintFrame = paintNow;
    this.syncCar(this.player, this.physics.player, dt, alpha); this.syncCar(this.bot, this.physics.bot, dt, alpha); this.bot.root.visible &&= this.physics.botEnabled;
    this.ball.visible = phase !== 'goal';
    this.ball.position.lerpVectors(this.physics.ballPreviousPosition, new T.Vector3().copy(this.physics.ball.translation()), alpha); this.ball.quaternion.slerpQuaternions(this.physics.ballPreviousRotation, new T.Quaternion().copy(this.physics.ball.rotation()), alpha);
    for (const [i, model] of [this.player.root, this.bot.root, this.ball].entries()) {
      this.networkOffsets[i].multiplyScalar(Math.exp(-dt / .065)); model.position.add(this.networkOffsets[i]);
      this.networkRotations[i].slerp(new T.Quaternion(), 1 - Math.exp(-dt / .065)); model.quaternion.premultiply(this.networkRotations[i]);
    }
    const ground = this.physics.groundBelow(this.ball.position);
    const markerRadius = 1.55 + Math.sqrt(Math.max(0, this.ball.position.y - ground.position.y - FIELD.ballRadius)) * .46;
    this.ballGround.scale.setScalar(markerRadius);
    this.ballGround.position.copy(ground.position).addScaledVector(ground.normal, .045);
    this.ballGround.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), ground.normal);
    this.ballGround.visible = phase !== 'goal';
    this.ballDirection.update(this.localModel.root.position, this.ball.position, !this.ballCam && this.localModel.root.visible && phase !== 'goal' && phase !== 'ended');
    this.effects.ballStreak.update(this.ball.position, new T.Vector3().copy(this.physics.ball.linvel()), dt, this.ball.visible && phase === 'playing');
    for (const obj of this.scene.children) if (obj.name === 'contact-shadow') {
      const owner = obj.userData.owner as T.Object3D; obj.position.set(owner.position.x, .025, owner.position.z); obj.visible = owner.visible;
      (obj as T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>).material.opacity = .55 / Math.max(1, owner.position.y * .55);
    }
    this.stadium.update(this.physics.pads, this.time); this.effects.update(dt);
    this.bloom.strength = (this.qualityLevel === 'ultra' ? .44 : .36) + this.effects.explosion.impact * .3;
    this.renderer.toneMappingExposure = .97 - this.effects.explosion.impact * .12;
    const car = this.physics.localCar, pos = this.localModel.root.position, q = this.localModel.root.quaternion;
    if (this.playerWasDemolished && car.demolished <= 0) this.cameraReady = false;
    this.playerWasDemolished = car.demolished > 0;
    const cameraCut = !this.cameraReady;
    const focus = phase === 'goal' && celebration ? this.effects.explosion.root.position : this.ball.position;
    this.followCamera.update(this.camera, pos, q, focus, car.demolished > 0 ? 0 : car.speed, this.ballCam, car.flipTime > 0, dt, !this.cameraReady, (from, to) => this.physics.cameraClearance(from, to), this.cameraLook);
    if (dt > 0 || !this.cameraReady) { this.cameraForward.copy(this.followCamera.forward); this.look.copy(this.followCamera.look); }
    this.cameraReady = true;
    this.shake = Math.max(0, this.shake - dt * 1.5);
    // Render shake never feeds back into the next frame's follow position.
    if (this.followCamera.settings.shake && dt > 0) { this.camera.position.x += (Math.random() - .5) * (this.shake * .15 + this.effects.explosion.impact * .35); this.camera.position.y += (Math.random() - .5) * (this.shake * .1 + this.effects.explosion.impact * .23); }
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
    this.motion.update(dt, car.speed, this.motionBlur && this.quality && !this.paintPreview && (phase === 'playing' || phase === 'goal'), cameraCut, pos, this.ball.position);
    this.supersonicStreaks.update(this.camera, pos, new T.Vector3().copy(car.body.linvel()), car.supersonic,
      this.localModel.root.visible && !this.paintPreview && (phase === 'playing' || phase === 'goal'), dt);
    this.effects.demolitions.updateCamera(this.camera.position);
    this.stadium.updateCamera(this.camera.position);
    this.stadium.grass.update(this.camera.position, this.localModel.root.position, this.time);
    this.sky.material.uniforms.skyTime.value = this.time;
    if (this.qualityLevel === 'ultra') this.updateSunShadow();
    const blastCenter = this.effects.explosion.root.position.clone().project(this.camera);
    this.blast.enabled = this.effects.explosion.root.visible && blastCenter.z < 1 && Number.isFinite(blastCenter.x) && Number.isFinite(blastCenter.y);
    this.blast.uniforms.center.value.set(blastCenter.x * .5 + .5, blastCenter.y * .5 + .5);
    this.blast.uniforms.time.value = this.effects.explosion.age;
    this.blast.uniforms.aspect.value = this.camera.aspect;
    this.audio.update(car, phase === 'playing' || phase === 'goal' || phase === 'countdown', dt, phase === 'countdown');
  }
  private updateSunShadow() {
    // Keep the car and ball in a tighter, texel-aligned shadow frustum for crisp, stable details.
    const distance = this.player.root.position.distanceTo(this.ball.position);
    this.shadowCenter.copy(this.player.root.position);
    if (distance < 70) this.shadowCenter.lerp(this.ball.position, .5);
    const radius = Math.ceil(Math.min(55, Math.max(20, distance < 70 ? distance * .5 + 10 : 24)) / 5) * 5;
    this.shadowRight.crossVectors(T.Object3D.DEFAULT_UP, this.sunOffset).normalize();
    this.shadowUp.crossVectors(this.sunOffset, this.shadowRight).normalize();
    const texel = radius * 2 / this.sun.shadow.mapSize.x;
    for (const axis of [this.shadowRight, this.shadowUp]) { const p = this.shadowCenter.dot(axis); this.shadowCenter.addScaledVector(axis, Math.round(p / texel) * texel - p); }
    this.sun.target.position.copy(this.shadowCenter); this.sun.position.copy(this.shadowCenter).add(this.sunOffset);
    const camera = this.sun.shadow.camera;
    if (camera.right !== radius) { camera.left = camera.bottom = -radius; camera.right = camera.top = radius; camera.updateProjectionMatrix(); }
  }
  draw() { this.renderer.info.reset(); this.composer.render(); }
}
