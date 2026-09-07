import { Prediction } from './prediction';
import { canonicalInput, encodeCommands, decodeFrames, type Command } from './protocol';
import { type Input } from '../config';
import type { Game } from '../game';
import type { Checkpoint, Slot } from '../simulation';

declare const __SIM_BUILD__: string;
export class OnlineClient {
  prediction!: Prediction;
  ws?: WebSocket; pc?: RTCPeerConnection; channel?: RTCDataChannel;
  epoch = 0; slot: Slot = 0; ready = false; disposed = false;
  rtt = 60; players = 1; state = 'CONNECTING';
  resyncReason = '';
  private baselineRequestedAt = 0;
  private confirmedAt = 0;
  private lastError = '';
  private receivedBaseline = false;
  private waitingBaseline = false;
  private lastFrameAt = 0;
  private lastUpdate = 0;
  private lastPing = 0;
  private lastRecover = 0;
  private anchorTick = 0; private anchorTime = 0;
  private queuedJump = false;
  private recent: Command[] = [];
  private reconnects = 0;
  private controlChain: Promise<void> = Promise.resolve();
  private remoteCandidates: RTCIceCandidateInit[] = [];
  constructor(public game: Game, public room: string, private seatToken: string, private status: (text: string) => void, private unavailable?: (text: string) => void) {}
  static endpoint() { return import.meta.env.VITE_GAME_SERVER || location.origin; }
  async connect() {
    if (this.disposed) return;
    this.ready = this.receivedBaseline = this.waitingBaseline = false;
    this.remoteCandidates = []; this.setStatus('CONNECTING');
    const ws = new WebSocket(OnlineClient.endpoint().replace(/^http/, 'ws') + '/api/connect');
    this.ws = ws; ws.binaryType = 'arraybuffer';
    ws.onopen = () => this.send({ type: 'join', room: this.room, token: this.seatToken, build: __SIM_BUILD__ });
    ws.onmessage = message => {
      if (this.disposed || this.ws !== ws) return;
      this.controlChain = this.controlChain.then(async () => {
        if (this.ws !== ws || this.disposed) return;
        if (typeof message.data === 'string') await this.control(JSON.parse(message.data));
        else if (new Uint8Array(message.data)[0] === 0x1f) await this.baseline(message.data, ws);
        else this.frames(new Uint8Array(message.data));
      }).catch(error => { console.error('Online session:', error); this.setStatus('CONNECTION ERROR — RECONNECTING'); ws.close(); });
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ready = false; this.pc?.close();
      if (!this.disposed && this.reconnects++ < 5) { this.setStatus('RECONNECTING'); setTimeout(() => { void this.connect(); }, 1500); }
      else if (!this.disposed) {
        const message = this.lastError || 'Connection lost. Create or join a match to try again.';
        this.setStatus(message); this.unavailable?.(message);
      }
    };
    ws.onerror = () => ws.close();
  }
  send(message: unknown) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message)); }
  private setStatus(text: string) { this.state = text; this.status(text); }
  private async control(message: Record<string, any>) {
    if (message.type === 'error') { this.reconnects = 5; this.lastError = String(message.message); this.setStatus(this.lastError); return; }
    if (message.type === 'welcome') {
      this.epoch = message.epoch; this.slot = message.slot;
      if (!this.prediction) { this.prediction = new Prediction(this.game, this.slot); await this.prediction.init(); }
      this.prediction.slot = this.slot;
      this.prediction.onEvent = event => this.game.presentEvent(event);
      this.game.view.setOnlineSlot(this.slot);
      const pc = new RTCPeerConnection({ iceServers: message.iceServers }); this.pc = pc;
      pc.onicecandidate = event => { if (this.pc === pc && event.candidate) this.send({ type: 'candidate', candidate: event.candidate.candidate, mid: event.candidate.sdpMid || '0' }); };
      pc.onconnectionstatechange = () => { if (this.pc === pc && pc.connectionState === 'failed') this.ws?.close(); };
      const channel = pc.createDataChannel('physics', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
      this.channel = channel; channel.binaryType = 'arraybuffer';
      channel.onmessage = e => { if (this.pc === pc && e.data instanceof ArrayBuffer) this.frames(new Uint8Array(e.data)); };
      channel.onopen = () => { if (this.pc === pc) this.markReady(); };
      channel.onclose = () => { if (this.pc === pc) this.ws?.close(); };
      // Chrome offers so it owns ICE nomination, including TCP TURN fallback.
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      this.send({ type: 'description', descriptionType: 'offer', sdp: offer.sdp });
    }
    if (message.type === 'description' && message.descriptionType === 'answer' && this.pc) {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
      for (const candidate of this.remoteCandidates) await this.pc.addIceCandidate(candidate); this.remoteCandidates = [];
    }
    if (message.type === 'candidate' && this.pc) {
      const candidate = { candidate: message.candidate, sdpMid: message.mid };
      if (this.pc.remoteDescription) await this.pc.addIceCandidate(candidate); else this.remoteCandidates.push(candidate);
    }
    if (message.type === 'players') { this.players = message.count; this.setStatus(this.players === 2 ? 'CONNECTED' : 'WAITING FOR OPPONENT'); }
    if (message.type === 'pong') {
      const now = performance.now(), sample = now - message.time;
      if (sample >= 0 && sample < 1500) {
        this.rtt = this.rtt * .7 + sample * .3;
        this.anchorTick = Math.max(this.anchorTick, message.tick); this.anchorTime = now;
      }
    }
  }
  private async baseline(bytes: ArrayBuffer, source: WebSocket) {
    const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    if (this.disposed || this.ws !== source) return;
    const data = JSON.parse(text);
    if (data.build !== __SIM_BUILD__ || data.epoch !== this.epoch) throw new Error('Simulation build mismatch');
    const saved = data.saved as Checkpoint;
    const raw = atob(data.saved.physics.world);
    saved.physics.world = Uint8Array.from(raw, c => c.charCodeAt(0));
    this.prediction.baseline(saved);
    this.recent = []; this.queuedJump = false; this.game.controls.clear();
    this.receivedBaseline = true; this.waitingBaseline = false; this.reconnects = 0;
    this.anchorTick = saved.match.tickNumber; this.anchorTime = performance.now(); this.lastFrameAt = this.anchorTime;
    this.game.view.cameraReady = false; this.game.view.clearNetworkCorrection();
    this.markReady();
  }
  private markReady() {
    if (this.receivedBaseline && this.channel?.readyState === 'open') {
      this.ready = true; this.lastUpdate = performance.now(); this.lastFrameAt = this.confirmedAt = this.lastUpdate;
      this.send({ type: 'ready' }); this.send({ type: 'recover', from: this.prediction.confirmed.tickNumber + 1 });
      this.send({ type: 'ping', time: performance.now() }); this.setStatus('WAITING FOR OPPONENT');
    }
  }
  private frames(bytes: Uint8Array) {
    if (!this.ready) return;
    const frames = decodeFrames(bytes, this.epoch); if (!frames?.length) return;
    this.lastFrameAt = performance.now(); this.prediction.receive(frames);
  }
  private resync(reason: string) {
    if (this.waitingBaseline) return;
    this.resyncReason = reason; this.baselineRequestedAt = performance.now(); this.waitingBaseline = true; this.ready = false; this.send({ type: 'baseline' }); this.setStatus('SYNCHRONIZING');
  }
  update(now: number, input: Input) {
    if (!this.ready) {
      if (this.waitingBaseline && now - this.baselineRequestedAt > 1500) { this.baselineRequestedAt = now; this.send({ type: 'baseline' }); }
      return;
    }
    if (now - this.lastFrameAt > 3000) { this.ws?.close(); return; }
    if (now - this.lastUpdate > 500) { this.lastUpdate = now; this.resync('browser stalled'); return; }
    this.lastUpdate = now;
    const previousCorrections = this.prediction.stats.corrections;
    const previousConfirmed = this.prediction.confirmed.tickNumber;
    if (!this.prediction.reconcile()) { this.resync('state mismatch'); return; }
    if (this.prediction.confirmed.tickNumber !== previousConfirmed) this.confirmedAt = now;
    if (now - this.confirmedAt > 1500) { this.resync('history unavailable'); return; }
    if (this.prediction.stats.corrections !== previousCorrections) this.game.view.correctNetwork(this.prediction.lastCorrection);
    const authoritative = this.prediction.confirmed.tickNumber;
    const clockTarget = Math.floor(this.anchorTick + (now - this.anchorTime + this.rtt) * .12 + 3);
    const catchingUp = clockTarget - authoritative > 64;
    const desired = catchingUp ? this.game.tickNumber : Math.min(authoritative + 48, clockTarget);
    if (desired - this.game.tickNumber > 64) { this.resync('prediction fell behind'); return; }
    this.queuedJump ||= input.jump;
    let count = 0;
    while (this.game.tickNumber < desired && count++ < 8) {
      const command = this.prediction.predict({ ...input, jump: this.queuedJump }); this.queuedJump = false;
      this.recent.push(command); if (this.recent.length > 12) this.recent.shift();
      if (command.tick % 2 === 0 && this.channel?.readyState === 'open' && this.channel.bufferedAmount < 8192) this.channel.send(encodeCommands(this.epoch, this.recent).buffer as ArrayBuffer);
    }
    if (now - this.lastPing > 1000) { this.lastPing = now; this.send({ type: 'ping', time: now }); }
    if (now - this.lastRecover > 200 && !this.prediction.pending.has(authoritative + 1)
      && (this.prediction.pending.size > 0 || clockTarget - authoritative > 32)) {
      this.lastRecover = now; this.send({ type: 'recover', from: authoritative + 1 });
    }
    if (now - this.lastFrameAt > 500) this.setStatus('CONNECTION INTERRUPTED');
    else if (catchingUp) this.setStatus('SYNCHRONIZING');
    else if (this.players === 2 && this.state !== 'CONNECTED') this.setStatus('CONNECTED');
    this.game.hud.set('net-stats', `${Math.round(this.rtt)} MS · ${Math.max(0, this.game.tickNumber - authoritative)} TICKS AHEAD`);
  }
  rematch() { this.send({ type: 'rematch' }); }
  dispose() { this.disposed = true; this.ready = false; this.send({ type: 'leave' }); this.ws?.close(); this.pc?.close(); this.prediction?.dispose(); }
}
