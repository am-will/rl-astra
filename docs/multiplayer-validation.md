# Multiplayer validation — September 7, 2026

Deployed simulation build: `49c84d953dcfe367af8d`. This includes the lobby update: anonymous Create Match generates exactly eight characters, and expired sessions return to the lobby. Physics measurements below were collected before this UI update. The final recovery-only change was additionally checked with delayed-baseline integration, protocol/safety tests, and a public TCP-relay reconnect. URL: https://rl-astra.amwill.dev.

## Join-code update verification

The deployed eight-character-code flow passed in two real, fully rendered Chrome clients over both direct UDP and forced TCP TURN relay connections. Tests created a match without a password, joined by code, drove both cars, reconnected after reload, recovered an expired saved seat, returned the guest to the lobby when the host left, then reversed who created and joined the next match. Both runs reported zero simulation desyncs and no browser errors. Admin authentication, Origin checks, seat isolation, malformed inputs and the one-room capacity limit also passed. Logs: `test-results/deployed-eight-character.log` and `test-results/deployed-eight-character-relay.log`.

## Collision and prediction results

**45 deterministic cases passed**, comparing 54,720 client ticks against the matching server ticks. **45 fully rendered two-Chrome cases passed**, comparing 73,218 client ticks against the matching server ticks. Every required contact was explicitly observed in Rapier contact manifolds; the tests also checked resulting momentum changes, challenge timing, arena containment and exactly-once authoritative events.

Cases: kickoff; blue/orange hits on stationary and moving balls; simultaneous and staggered challenges; head-on and sideways car collisions; car–ball–car sandwich contacts; boosted offset challenges; last-moment boost, jump and steering changes; and airborne ball contact. Each ran ideal/direct, regional, and stress profiles. The stress browser path injected 55–105 ms per direction, 10% data-packet loss, and actual reordering. Both clients used the real signaling and data-channel implementations.

The deterministic clock model puts clients ahead of server *now* by an upstream delay plus margin; confirmed state is additionally behind by the downstream delay. It does not mistakenly put clients a full RTT ahead of server now. A 90-tick neutral warm-up aligns the scripted inputs before the challenge; controls release at tick 450 so recovery can be measured.

Maximum in-play, same-tick prediction corrections in the rendered matrix:

| Network profile | Local car position | Opponent position | Ball position | Local rotation | Opponent rotation | Ball rotation |
|---|---:|---:|---:|---:|---:|---:|
| Direct | 0.122 m | 0.412 m | 0.121 m | 3.25° | 7.67° | 5.16° |
| Regional | 0.409 m | 0.795 m | 0.375 m | 2.95° | 20.34° | 23.30° |
| Stress | 0.890 m | 1.456 m | 0.904 m | 2.50° | 39.34° | 53.28° |

These are worst corrections, not typical per-frame errors. The surprise jump challenge produced the largest errors. Expected match-start teleports are identified by the authoritative kickoff event and reported separately. No in-play position correction reached the renderer's 3 m snap threshold.

The deterministic stress cases stopped producing significant corrections within **225 ms** of control release. In the separately recorded rendered jump/challenge stress case, remaining visual correction fell below **2 cm / 0.01 rad within 392 ms** of release. Both cars and the ball were measured. The entire matrix passed its explicit recovery gates (650 ms regional/direct; 900 ms stress), not just the checksum check.

Rendered frame p95 was **16.8 ms or less** in every case. The regional and stress runs had no frame over 16.8 ms in this matrix. The direct suite's worst frame was 50 ms; its worst case p99 remained under 35 ms, and there were no frames longer than 50 ms. These tests used two 960×600 Chrome contexts, the performance graphics preset, and an NVIDIA RTX PRO 6000 GPU. They demonstrate smooth rendering on this workstation, not a universal hardware performance guarantee.

Reports: `test-results/collisions.json`, `test-results/browser-collisions-all.json`, and `test-results/browser-collisions-stress.json` (recorded worst-case fixture). The side-by-side recording is `test-results/multiplayer-collision.mp4`. Video views are aligned approximately by their end timestamps; use the matching-tick measurements for exact physics comparisons.

## Other checks

- **21,600 cross-runtime ticks:** an uninterrupted Node simulation matched Chrome, including independently timed full solver restores. No confirmed drift.
- **Network/protocol suite:** 2,400 restored solver ticks, 3,600 lossy two-client ticks, duplicate/late/malformed inputs, bounded recovery, goals, kickoff and two-party rematch.
- **Existing gameplay regressions:** all 36 suites passed, including controls, original handling, arena/ramp contacts, cameras, goals, effects, graphics and demolition behavior. Two tests needed their hardcoded dynamic import updated to the pinned deterministic Rapier package. Linux execution used Chrome with hardware GPU rendering; software-only headless rendering was not used as evidence of playability.
- **Public deployment:** two real Chrome clients created/joined using a code, drove independently, and reloaded/reconnected over direct UDP, forced UDP TURN, and forced TCP TURN. The selected candidate reports included the TURN transport, URL and allocated port. Chrome may label a NAT-adjusted relay candidate `prflx`; relay-only policy plus its `relayProtocol`/TURN URL verifies the route.
- **Safety:** admin key, exact Origin, room cap, seat isolation, invalid codes, oversized/malformed messages and process survival passed. Both UDP and TCP unauthenticated TURN allocation requests returned 401. A repository scan found no admin key in tracked or nonignored files. Remote secret files are mode 600.
- **Slow join:** both baselines were deliberately delayed 3.5 seconds, beyond the original 256-tick window. Both clients caught up through bounded reliable batches, then completed a rendered kickoff with same-tick agreement and no frame above 16.8 ms. The server now retains 30 seconds of applied inputs while each client recovery request is limited to 256 ticks.
- **Replay (build `d92327d0f442df290559`):** 4,558 ticks of a real Hetzner match replayed locally from baseline tick 2 through tick 4,560; all 570 recorded hashes matched.

## Server capacity

Measured on the existing Hetzner server: Node 22.23.2, three shared AMD EPYC Rome vCPUs, about 3.7 GB RAM. A 14,400-tick isolated benchmark reported:

| Measurement | Time |
|---|---:|
| Physics tick median | 0.096 ms |
| Physics tick p95 | 0.250 ms |
| Physics tick p99 | 0.477 ms |
| Worst tick | 7.498 ms |
| Available time per 120 Hz tick | 8.333 ms |
| Full checkpoint p95 | 19.217 ms |

Benchmark RSS was about 179 MiB; an active public room was around 252 MiB. The game container is limited to 1 GiB. Snapshot creation is occasional, rather than a per-frame operation. The shared host can still experience contention, so this deployment deliberately admits one match. The benchmark does not authorize increasing room capacity without another load test.

## Problems found and fixed

1. Restoring Rapier could misclassify static colliders through cached JS `parent()` metadata. Explicit collider roles fixed the Node/Chrome divergence.
2. Prediction invented opponent control release when its horizon exceeded 100 ms. It now predicts held controls while authority independently handles actual missing-input timeout.
3. Correction could wait for the next eight-tick checksum. Applied-input differences now trigger immediate reconciliation.
4. Visual smoothing counted normal between-frame motion as error. It now adds only the same-tick correction delta.
5. A transient old connection could deliver late asynchronous work during reconnection. Socket/peer identity guards prevent that work reaching the new connection.
6. Docker public/private ICE mappings interfered with co-located TURN. Explicit, fixed internal routes and public candidate mappings resolved the route.
7. The default native ICE backend rejected zero-valued Chrome TCP-TURN tie breakers. The server uses the supported libnice backend built from pinned node-datachannel/libdatachannel releases, retaining DTLS fingerprint verification.
8. Baseline downloads could exceed the original two-second history window. A 30-second server journal and bounded, repeated catch-up requests fix slow joins without enlarging client rollback work.
9. Replay rotation needed to preserve the previous segment's full baseline. Each retained segment now has its own checkpoint.

The result is a tested 1v1 alpha. Prediction errors under latency remain visible briefly, especially after an opponent's unexpected aerial input. Same-tick confirmed physics agrees exactly in the tested cases; subjective enjoyment still benefits from real players with their actual hardware and routes.
