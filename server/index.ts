import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { readdir, stat, unlink, chmod, appendFile, mkdir, writeFile, rename, copyFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { PeerConnection, initLogger, type DataChannel } from 'node-datachannel';
import { PROTOCOL, MAX_PACKET } from '../src/network/protocol';
import type { Slot } from '../src/simulation';

declare const __SIM_BUILD__: string;
const build = __SIM_BUILD__;
initLogger('Warning', (level, message) => console.warn('WebRTC', level, message));
const compress = promisify(gzip);
const secret = process.env.ALPHA_KEY;
if (!secret || secret.length < 20) throw new Error('ALPHA_KEY must contain at least 20 characters');
const rtcPublicIP = process.env.RTC_PUBLIC_IP;
if (rtcPublicIP && isIP(rtcPublicIP) !== 4) throw new Error('RTC_PUBLIC_IP must be an IPv4 address');
// Docker publishes this exact UDP port range. Advertise the public side of that
// static mapping, while keeping the process in its isolated network namespace.
function advertisedCandidates(candidate: string): string[] {
  if (!rtcPublicIP) return [candidate];
  const parts = candidate.trim().split(/\s+/);
  if (parts.length < 8 || parts[2].toLowerCase() !== 'udp' || isIP(parts[4]) !== 4 || parts[4].startsWith('127.')) return [];
  // The co-located TURN service reaches this single allowlisted private address.
  // Retain it alongside the public mapping to avoid Docker hairpin NAT changing
  // the source address of ICE replies on the relay path.
  const internal = parts[4] === process.env.RTC_PRIVATE_IP ? [candidate] : [];
  parts[4] = rtcPublicIP; return [parts.join(' '), ...internal];
}
function receivedCandidate(candidate: string): string {
  const parts = candidate.trim().split(/\s+/), relayIP = process.env.RTC_RELAY_PRIVATE_IP;
  // A local TURN allocation advertises its public NAT mapping to the browser.
  // Reach the allocation on the shared bridge so ICE sees its actual source
  // address, preserving the browser's TCP TURN transport association.
  if (relayIP && parts[4] === rtcPublicIP && parts[7] === 'relay' && Number(parts[5]) >= 50110 && Number(parts[5]) <= 50141) parts[4] = relayIP;
  return parts.join(' ');
}
const publicOrigin = process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:5179';
const staticRoot = resolve(process.env.STATIC_DIR || 'dist');
const logRoot = resolve(process.env.LOG_DIR || 'test-results/server-replays');
await mkdir(logRoot, { recursive: true });
function browserIceServers() {
  const urls = process.env.TURN_URLS?.split(',').filter(Boolean);
  const turnSecret = process.env.TURN_SECRET;
  if (!urls || !turnSecret) return [];
  const username = `${Math.floor(Date.now() / 1000) + 3600}:${randomBytes(8).toString('hex')}`;
  const credential = createHmac('sha1', turnSecret).update(username).digest('base64');
  return [{ urls, username, credential }];
}
async function pruneReplays() {
  const files = await Promise.all((await readdir(logRoot)).filter(f => /\.(jsonl|gz)$/.test(f)).map(async name => ({ name, ...(await stat(`${logRoot}/${name}`)) })));
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  let total = 0;
  for (const file of files) {
    total += file.size;
    if (total > 256 * 1024 * 1024 && ![...rooms.keys()].some(id => file.name.startsWith(id + '.'))) await unlink(`${logRoot}/${file.name}`);
  }
}
const token = () => randomBytes(24).toString('base64url');
const equal = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
interface Peer { ws: WebSocket; pc?: PeerConnection; dc?: DataChannel; candidates: { candidate: string; mid: string }[]; ready: boolean; lastBaseline: number; baselinePending: boolean; budget: number; budgetAt: number; controlBudget: number; controlAt: number; }
interface Room { id: string; code: string; epoch: number; tokens: string[]; worker: Worker; peers: [Peer | null, Peer | null]; initialized: Promise<void>; lastActive: number; stats: Record<string, unknown>; tick: number; tickAt: number; logBytes: number; logChain: Promise<unknown>; }
const rooms = new Map<string, Room>();
const baselineRequests = new Map<string, { room: Room; peer: Peer; slot: Slot }>();
const send = (ws: WebSocket, value: unknown) => { if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 8 * 1024 * 1024) ws.send(JSON.stringify(value)); };
function closeRoom(room: Room, reason: string) {
  if (!rooms.delete(room.id)) return;
  for (const [id, request] of baselineRequests) if (request.room === room) baselineRequests.delete(id);
  for (const peer of room.peers) if (peer) { send(peer.ws, { type: 'error', message: reason }); peer.ws.close(); peer.pc?.close(); }
  void room.worker.terminate();
}
function newRoom(): Room {
  const id = randomBytes(6).toString('hex'), epoch = randomBytes(4).readUInt32LE();
  const worker = new Worker(new URL('./room.mjs', import.meta.url), { workerData: { epoch } });
  let initialized!: () => void;
  const room: Room = { id, code: Array.from(randomBytes(8), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join(''), epoch, tokens: [token(), token()], worker, peers: [null, null], initialized: new Promise(r => { initialized = r; }), lastActive: Date.now(), stats: {}, tick: 0, tickAt: performance.now(), logBytes: 0, logChain: Promise.resolve() };
  rooms.set(id, room);
  worker.on('message', async message => {
    if (message.type === 'initialized') { initialized(); worker.postMessage({ type: 'baseline', request: 'log' }); }
    if (message.type === 'frames') { room.tick = message.tick; room.tickAt = performance.now(); }
    if (message.type === 'frames') for (const peer of room.peers) if (peer?.ready && peer.dc?.isOpen() && peer.dc.bufferedAmount() < 8192) { try { peer.dc.sendMessageBinary(Buffer.from(message.bytes)); } catch { peer.ws.close(); } }
    if (message.type === 'recover') { const peer = room.peers[message.slot as Slot]; if (peer?.ready && peer.ws.bufferedAmount < 32768) peer.ws.send(message.bytes); }
    if (message.type === 'stats') room.stats = message;
    if (message.type === 'fatal') closeRoom(room, message.reason);
    if (message.type === 'replay') {
      const line = JSON.stringify({ build, epoch, frames: message.frames }) + '\n';
      room.logChain = room.logChain.then(async () => {
        // Bounded local diagnostics. Rotation keeps the latest two log segments.
        if (room.logBytes > 16 * 1024 * 1024) {
          await copyFile(`${logRoot}/${id}.baseline.gz`, `${logRoot}/${id}.previous.baseline.gz`);
          await rename(`${logRoot}/${id}.jsonl`, `${logRoot}/${id}.previous.jsonl`);
          room.logBytes = 0; worker.postMessage({ type: 'baseline', request: 'log' });
        }
        await appendFile(`${logRoot}/${id}.jsonl`, line); room.logBytes += Buffer.byteLength(line);
      }).catch(error => console.error('Replay log failed', error.message));
    }
    if (message.type === 'baseline') {
      const saved = message.saved;
      const data = await compress(JSON.stringify({ build, epoch, saved: { ...saved, physics: { ...saved.physics, world: Buffer.from(saved.physics.world).toString('base64') } } })).catch(() => null);
      for (const requestId of message.requests as string[]) {
        if (requestId === 'log') { if (data) room.logChain = room.logChain.then(() => writeFile(`${logRoot}/${id}.baseline.gz`, data)).catch(error => console.error('Replay baseline failed', error.message)); continue; }
        const request = baselineRequests.get(requestId); baselineRequests.delete(requestId);
        if (request && request.peer.ws.readyState === WebSocket.OPEN) {
          if (data) request.peer.ws.send(data); else request.peer.ws.close();
        }
      }
    }
  });
  worker.on('error', error => { console.error('Room failed', id, String(error)); closeRoom(room, 'The match server stopped. Create a new room.'); });
  worker.on('exit', code => { if (rooms.has(id)) closeRoom(room, `The match server stopped (${code}).`); });
  return room;
}
function requestBaseline(room: Room, peer: Peer, slot: Slot) {
  if (peer.baselinePending || Date.now() - peer.lastBaseline < 1000) return;
  peer.baselinePending = true; peer.ready = false; peer.lastBaseline = Date.now();
  room.worker.postMessage({ type: 'disconnect', slot });
  const request = token(); baselineRequests.set(request, { room, peer, slot });
  room.worker.postMessage({ type: 'baseline', request });
}
let joinAttempts = 0, joinWindow = Date.now();
let createdRooms = 0, createWindow = Date.now();
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2' };
const http = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && origin !== publicOrigin) { res.writeHead(403).end(); return; }
  if (origin) { res.setHeader('Access-Control-Allow-Origin', publicOrigin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type'); res.setHeader('Access-Control-Allow-Methods', 'POST, GET'); res.writeHead(204).end(); return; }
  if (req.url === '/api/health') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, build, protocol: PROTOCOL, rooms: rooms.size })); return; }
  if (req.url === '/api/join' && req.method === 'POST') {
    if (Date.now() - joinWindow > 60_000) { joinWindow = Date.now(); joinAttempts = 0; }
    if (++joinAttempts > 30) { res.writeHead(429).end('Too many join attempts. Please wait a minute.'); return; }
    let body = '';
    try {
      for await (const chunk of req) { body += chunk.toString(); if (body.length > 1024) { res.writeHead(413).end(); return; } }
      const input = JSON.parse(body), code = typeof input?.code === 'string' ? input.code.toUpperCase().replace(/[-\s]/g, '') : '';
      if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) { res.writeHead(400).end('Enter the eight-character join code.'); return; }
      const room = [...rooms.values()].find(room => equal(room.code, code));
      if (!room || room.peers[1]) { res.writeHead(404).end('That match is unavailable or already has two players.'); return; }
      res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ id: room.id, seatToken: room.tokens[1], build }));
    } catch { if (!res.writableEnded) res.writeHead(400).end('Invalid join request.'); }
    return;
  }
  if (req.url === '/api/admin/status' && req.method === 'GET') {
    if (!equal(req.headers.authorization || '', `Bearer ${secret}`)) { res.writeHead(401).end(); return; }
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ build, memory: process.memoryUsage(), rooms: [...rooms.values()].map(room => ({ id: room.id, tick: room.tick, stats: room.stats, peers: room.peers.map(p => p ? { ready: p.ready, baselinePending: p.baselinePending, channel: p.dc?.isOpen(), connection: p.pc?.state() } : null) })) })); return;
  }
  if (req.url === '/api/rooms' && req.method === 'POST') {
    if (rooms.size >= Number(process.env.MAX_ROOMS || 1)) { res.writeHead(503).end('The alpha server is full. Try again after the current room closes.'); return; }
    if (Date.now() - createWindow > 60_000) { createWindow = Date.now(); createdRooms = 0; }
    if (createdRooms >= 30) { res.writeHead(429).end('Too many matches created. Please wait a minute.'); return; }
    createdRooms++;
    const room = newRoom();
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ id: room.id, code: room.code, hostToken: room.tokens[0], inviteToken: room.tokens[1], build })); return;
  }
  if (!['GET', 'HEAD'].includes(req.method || '')) { res.writeHead(405).end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', publicOrigin).pathname);
    const file = resolve(staticRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(staticRoot + sep)) { res.writeHead(403).end(); return; }
    const stream = createReadStream(file);
    stream.on('error', () => { if (!res.headersSent) res.writeHead(404); res.end(); });
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public,max-age=31536000,immutable' : 'no-cache');
    if (req.method === 'HEAD') { stream.destroy(); res.end(); } else stream.pipe(res);
  } catch { res.writeHead(400).end(); }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
http.on('upgrade', (req, socket, head) => {
  if (req.url !== '/api/connect' || req.headers.origin !== publicOrigin || wss.clients.size >= 20) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});
wss.on('connection', ws => {
  let room: Room | undefined, slot: Slot = 0, peer: Peer | undefined, authed = false;
  const deadline = setTimeout(() => { if (!authed) ws.close(); }, 5000);
  const connectedDeadline = setTimeout(() => { if (!peer?.ready) { send(ws, { type: 'error', message: 'Could not establish the game connection. Check your network and rejoin.' }); ws.close(); } }, 20000);
  ws.on('message', (raw, binary) => { void (async () => {
    if (binary) { ws.close(); return; }
    let message;
    try { message = JSON.parse(raw.toString()); if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid message'); } catch { ws.close(); return; }
    if (!authed) {
      if (message.type !== 'join' || message.build !== build || typeof message.room !== 'string' || typeof message.token !== 'string') { send(ws, { type: 'error', message: 'Invalid invitation or outdated game. Reload and try again.' }); ws.close(); return; }
      room = rooms.get(message.room);
      const index = room?.tokens.findIndex(t => equal(t, message.token)) ?? -1;
      if (!room || index < 0 || room.peers[index]?.ws.readyState === WebSocket.OPEN) { send(ws, { type: 'error', message: 'Room unavailable or this seat is already connected.' }); ws.close(); return; }
      slot = index as Slot; authed = true; clearTimeout(deadline);
      peer = { ws, candidates: [], ready: false, lastBaseline: 0, baselinePending: false, budget: 0, budgetAt: Date.now(), controlBudget: 0, controlAt: Date.now() };
      room.peers[slot] = peer; room.lastActive = Date.now();
      const pc = new PeerConnection(`${room.id}-${slot}`, { iceServers: [], disableAutoNegotiation: true, portRangeBegin: Number(process.env.RTC_PORT_BEGIN || 50000), portRangeEnd: Number(process.env.RTC_PORT_END || 50100), maxMessageSize: MAX_PACKET });
      peer.pc = pc;
      pc.onLocalDescription((sdp, type) => {
        const publicSdp = sdp.split('\r\n').flatMap(line => line.startsWith('a=candidate:') ? advertisedCandidates(line.slice(2)).map(c => 'a=' + c) : [line]).join('\r\n');
        send(ws, { type: 'description', sdp: publicSdp, descriptionType: type });
      });
      pc.onLocalCandidate((candidate, mid) => { for (const advertised of advertisedCandidates(candidate)) send(ws, { type: 'candidate', candidate: advertised, mid }); });
      pc.onStateChange(state => { if (state === 'failed' || state === 'closed') ws.close(); });
      send(ws, { type: 'welcome', epoch: room.epoch, slot, build, iceServers: browserIceServers() });
      const dc = pc.createDataChannel('physics', { negotiated: true, id: 0, unordered: true, maxRetransmits: 0 }); peer.dc = dc;
      dc.onMessage(bytes => {
        if (!peer?.ready || !room || typeof bytes === 'string' || bytes.byteLength > MAX_PACKET) return;
        const now = Date.now(); if (now - peer.budgetAt >= 1000) { peer.budgetAt = now; peer.budget = 0; }
        if (++peer.budget > 180) return;
        room.worker.postMessage({ type: 'input', slot, bytes });
      });
      await room.initialized;
      if (ws.readyState === WebSocket.OPEN) requestBaseline(room, peer, slot);
      return;
    }
    if (!room || !peer) return;
    const controlNow = Date.now();
    if (controlNow - peer.controlAt >= 1000) { peer.controlAt = controlNow; peer.controlBudget = 0; }
    if (++peer.controlBudget > 60) { ws.close(); return; }
    if (message.type === 'description' && typeof message.sdp === 'string' && message.descriptionType === 'offer') {
      if (peer.pc?.remoteDescription()) return;
      try {
        peer.pc?.setRemoteDescription(message.sdp.split('\r\n').map((line: string) => line.startsWith('a=candidate:') ? 'a=' + receivedCandidate(line.slice(2)) : line).join('\r\n'), 'offer');
        for (const candidate of peer.candidates) peer.pc?.addRemoteCandidate(candidate.candidate, candidate.mid);
        peer.candidates = []; peer.pc?.setLocalDescription('answer');
      } catch { ws.close(); }
    } else if (message.type === 'candidate' && typeof message.candidate === 'string' && typeof message.mid === 'string') {
      try {
        const candidate = receivedCandidate(message.candidate);
        if (peer.pc?.remoteDescription()) peer.pc.addRemoteCandidate(candidate, message.mid);
        else if (peer.candidates.length < 32) peer.candidates.push({ candidate, mid: message.mid });
      } catch { ws.close(); }
    } else if (message.type === 'ready' && peer.dc?.isOpen()) {
      clearTimeout(connectedDeadline);
      peer.ready = true; peer.baselinePending = false; room.worker.postMessage({ type: 'ready', slot });
      for (const p of room.peers) if (p) send(p.ws, { type: 'players', count: room.peers.filter(p => p?.ready).length });
    } else if (message.type === 'baseline') requestBaseline(room, peer, slot);
    else if (message.type === 'recover' && Number.isInteger(message.from) && message.from > 0) room.worker.postMessage({ type: 'recover', slot, from: message.from });
    else if (message.type === 'ping' && typeof message.time === 'number') send(ws, { type: 'pong', time: message.time, tick: room.tick + Math.min(24, (performance.now() - room.tickAt) * .12) });
    else if (message.type === 'rematch') room.worker.postMessage({ type: 'rematch', slot });
    else if (message.type === 'leave') { if (slot === 0) closeRoom(room, 'The host left the match. Create or join another game.'); else { room.tokens[slot] = token(); ws.close(); } }
  })().catch(error => { console.error('Session error:', String(error)); ws.close(); }); });
  ws.on('error', () => ws.close());
  ws.on('close', () => {
    clearTimeout(deadline); clearTimeout(connectedDeadline);
    for (const [id, request] of baselineRequests) if (request.peer === peer) baselineRequests.delete(id);
    if (room && peer && room.peers[slot] === peer) {
      room.peers[slot] = null; room.lastActive = Date.now(); room.worker.postMessage({ type: 'disconnect', slot });
      for (const p of room.peers) if (p) send(p.ws, { type: 'players', count: room.peers.filter(p => p?.ready).length });
    }
    peer?.pc?.close();
  });
});
setInterval(() => {
  void pruneReplays().catch(error => console.error('Replay cleanup:', String(error)));
  for (const room of rooms.values()) {
    if (room.peers.some(p => p?.ws.readyState === WebSocket.OPEN)) room.lastActive = Date.now();
    else if (Date.now() - room.lastActive > 60_000) closeRoom(room, 'Room expired');
  }
}, 10_000).unref();
const shutdown = () => { for (const room of rooms.values()) closeRoom(room, 'Server restarting'); wss.close(); http.close(); setTimeout(() => process.exit(), 1000).unref(); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
if (process.env.SOCKET_PATH) {
  const socketPath = process.env.SOCKET_PATH;
  await unlink(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  http.listen(socketPath, () => { void chmod(socketPath, 0o666); console.log(`1v1 server listening; build ${build}`); });
} else http.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => console.log(`1v1 server listening; build ${build}`));
