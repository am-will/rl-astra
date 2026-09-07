# Dedicated 1v1 alpha

Play at **https://rl-astra.amwill.dev** in desktop Chrome. Open **Online 1v1** and choose **Create match**. An eight-character join code is generated automatically, with no access key or password to enter. Send that code to a friend; they choose **Join match** and enter it. Either player can create the match. Only one room / two players is admitted on this alpha deployment.

The browser stores the current seat in session storage so reloading reconnects that tab. Expired or closed rooms return to the lobby automatically. Leaving as host closes the room; leaving as guest frees that seat. An empty room expires after 60 seconds. A match continues while a player opens a menu or disconnects; missing controls release after 100 ms. Rematches require both players to request another match.

## Architecture and physics guarantees

The dedicated Node process owns a 120 Hz Rapier simulation, both cars, the ball, boosts, clock, goals, demolitions, and respawns. Clients submit quantized controls for future ticks. They cannot submit positions, scores, impulses, or claimed hits. Each input tick is accepted once, within a bounded future window. The server's applied input stream is the truth, including the actual fallback controls used after a lost packet.

Each browser runs a confirmed simulation plus a predicted simulation of **the entire interacting world**. The confirmed copy consumes server-applied inputs in order and checks the server's hash every eight ticks. The predicted copy immediately applies local input, predicts held opponent input, and restores/replays a complete confirmed checkpoint when needed. Unexpected applied inputs trigger correction immediately; periodic checksums independently detect state drift. Correction includes solver state, car controller state, timers and boost pads. It does not patch only body positions.

This follows the approach described in Psyonix's [2018 Rocket League networking presentation](https://media.gdcvault.com/gdc2018/presentations/Cone_Jared_It_Is_Rocket.pdf): dedicated authority, fixed ticks, prediction of interacting actors, and rollback/replay. It does not claim to reproduce today's proprietary Rocket League implementation or handling. Historical research and the initial feasibility investigation are in [multiplayer-plan.md](multiplayer-plan.md).

`@dimforge/rapier3d-deterministic-compat` is pinned to 0.19.3. The [upstream feature-selection documentation](https://github.com/dimforge/rapier.js/#feature-selection) distinguishes it from the ordinary compatibility package. Testing also found a Rapier JS deserialization bug: `Collider.parent()` could misclassify unattached arena colliders after restoring a checkpoint, with different behavior in Node and Chrome. Arena collider roles are now explicitly recorded at construction. No private engine fields or global math functions are patched.

Exact agreement means **the same authoritative physics tick**. It does not mean two players with different latency see identical pixels at the same wall-clock instant. An unexpected opponent jump or ball challenge can briefly invalidate a prediction. Displayed corrections decay with a 65 ms time constant, independently of physics. Corrections compare poses at the same tick, so ordinary motion is not mistaken for rollback error. Kickoff teleports are identified separately. Large teleports and respawns cut immediately.

## Transport and recovery

The server image compiles the pinned native transport with its supported libnice backend. Packet capture showed that Chrome TCP-TURN checks could carry a zero-valued ICE tiebreaker, which the default libjuice backend rejected as a missing attribute. The libnice build completes those connections without weakening DTLS certificate verification. Chrome initiates the offer, and both ends explicitly negotiate channel 0.

HTTPS/WebSocket handles signaling, seat authentication, full baselines, reliable missing-history recovery, and clock samples. An unordered, zero-retransmit WebRTC data channel carries redundant input/frame batches; a lost old physics packet does not block newer packets. Commands and frames have an explicit protocol version, room epoch, strict sizes, and bounded history. Up to 12 recent ticks are repeated per normal packet. The server retains 30 seconds of authoritative history; each reliable catch-up batch is capped at 256 ticks, and a client advances at most 64 confirmed ticks per update. This permits a slow baseline transfer to catch up without repeatedly downloading another checkpoint.

Initial/resync baselines are currently large: roughly 12 MB raw engine state and 3–4 MB compressed on the wire. Routine play transfers input frames, not full checkpoints. Baseline creation and compression are kept out of the regular physics path; the worker uses fixed steps and refuses to silently change time step if overloaded. A stalled/background browser resynchronizes rather than advancing an unbounded catch-up loop.

The server is in **Ashburn, Virginia**, on the existing Hetzner `starswap` machine. It is suitable for this one-match alpha based on measured tick headroom. It is not a central-US location; actual RTT depends on both testers' routes. No additional VM was purchased. Existing provider bandwidth allowances still apply.

## Verification

Measured results, correction/rotation tables, and the rendered recording are described in [multiplayer-validation.md](multiplayer-validation.md).

Run from the repository with `npm ci`, then `npm run build`.

- `npm run test:netcode`: protocol abuse boundaries, missing-input releases, complete-checkpoint reproduction, two-client delayed/lost/reordered input replay, goal/kickoff/rematch agreement.
- `npm run test:cross-runtime`: 21,600 ticks comparing an uninterrupted Node world with Chrome, including repeated independent restores of active solver state.
- `npm run test:collisions`: controlled kickoff, both stationary/moving-ball strikers, simultaneous/staggered challenges, head-on/sideways bumps, ball/car sandwiches, boosted offset challenges, last-moment boost/steering/jump, and aerial contacts. Each runs ideal, regional, and stress delivery profiles. Tests require solver contact, resulting impulse, matching same-tick server/client hashes, and exactly-once authoritative events.
- `npm run test:multiplayer-browser`: repeats the fixtures over the actual WebSocket/WebRTC server and **two independent Chrome contexts with full GPU rendering enabled**. An isolated test bundle adds fixtures and read-only per-tick observations; those endpoints and controls are absent from the deployed bundle. The script owns its Vite and server processes. `PROFILE=direct|regional|stress` and `SCENARIO=...` select subsets.
- `npm run test:slow-join`: delays both baselines by 3.5 seconds, then verifies catch-up and a rendered kickoff.
- `npm run test:turn-auth`: requires unauthenticated UDP and TCP TURN allocation attempts to be rejected.
- `npm run test:server-safety`: anonymous room creation, admin/seat authentication, exact Origin checks, room cap, malformed and oversized messages, invalid codes, duplicate seats, and process survival.
- `npm run test:deployed`: real public hostname, join code UI, both seats driving, transport inspection, and reload reconnection. `FORCE_RELAY=1` forces relay; `TURN_TCP=1` selects its TCP route.
- `npm test`: the preexisting offline handling, controls, camera, rendering, effects, arena, goals and demolition regression suites. Set `CHROME_PATH` for the Chrome executable on this host.

Collision tests measure each body's correction distance and quaternion angle at the same predicted tick, plus work time and settling after controls are released. Browser tests also measure rendered correction offsets, frame intervals, and netcode time. Gates are explicit in `tests/collision-budgets.mjs`; they remain below the renderer's teleport thresholds. Regional and stress tolerances differ because the latter injects approximately 110–210 ms round-trip delay, 10% packet loss, and reordering. Frame gates require p95 <22 ms, p99 <35 ms, no frame >=100 ms, and fewer than 1% over 50 ms. Measurements on this workstation are evidence for this environment, not a promise of 60 fps on every Chrome device.

Reports and screenshots are written under gitignored `test-results/`. Match-start teleports are reported separately from in-play prediction corrections, rather than silently discarding large errors. Input scripts stop after tick 450, following a 90-tick shared warm-up so the tests can check recovery, not only continued motion.

## Deployment and operation

Only the new `rl-astra` services are managed by this project. The existing Traefik, Star Swap, portfolio and other services remain independently managed.

`deploy/compose.alpha.yml` defines the game, its HTTP Unix-socket proxy, and coturn. The project proxy uses Nginx 1.30.4, a current stable release with published security fixes ([official release notes](https://nginx.org/)). Traefik terminates TLS using the existing `le` resolver. Cloudflare has a DNS-only A record for `rl-astra.amwill.dev` pointing at the existing host. Game HTTP has no publicly exposed raw Node port.

The game is non-root, with a read-only root filesystem, dropped capabilities, a PID limit and a 1 GB memory limit. UDP 50000–50031 is reserved for game ICE. TURN uses UDP/TCP 3478 and UDP relay ports 50110–50141. Its expiring authenticated credentials are issued to room participants, with allocation/bandwidth quotas; relay peers are restricted to this game's public IP and exact private bridge IP. Docker IPs are fixed for the game and TURN so their internal route is stable. Public and internal ICE mappings must be updated together if the host/network changes.

Remote directory: `/home/starswap/rl-astra`. Configuration secrets are in `.env.alpha` and generated `turnserver.conf`, both mode 600, outside the image and repository. The admin key (`ALPHA_KEY`) and TURN HMAC secret are independent. Do not print or commit them.

Check service health with `curl https://rl-astra.amwill.dev/api/health`, and inspect `docker compose -f compose.yml ps` in the remote directory. `/api/admin/status` requires the admin key and reports room tick timing, memory, readiness and connection state. Do not expose the key in a copied command or shell history.

Replays contain accepted controls and checksums, with compressed full baselines. Logs rotate at 16 MB into two segments; inactive replay retention is capped at 256 MB. Each segment preserves its own baseline. To verify a copied replay, check out its original simulation build and run `npm run verify:replay -- path/to/room-id` (omit extensions). A server shutdown may omit the last fraction of a second because frames are logged in one-second batches.

Update procedure: run build and relevant tests locally; upload `dist`, `dist-server`, package manifests and `Dockerfile.alpha` to the remote build directory; build/tag a new image; recreate only this project's game service. Browser/server build IDs must match. Keep the previous image tag for rollback, then recheck HTTPS, join and gameplay. Server replacement terminates active matches, so deploy between alpha sessions.
