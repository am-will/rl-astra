# Champions Field

A playable local car-soccer game built with Three.js, Rapier, TypeScript, and Vite. It opens directly on the pitch. All models, textures, fonts, and sounds are served or generated locally.

## Run

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5179/**. Press **W** or squeeze **R2** to begin the three-second kickoff. DualSense works through Chrome’s Gamepad API over USB or Bluetooth. Focus the tab and press a controller button to make it available to the browser.

```sh
npm run build     # Type-check and build production files
npm run preview   # Serve the production build
npm test          # Gameplay, arena, aerial control, keyboard/controller, and settings checks
npm run test:fidelity # Camera preferences, Ultra shaders, boost effects, and responsive settings
npm run test:controls # Controller mapping, rebinding persistence, ceiling release, and recovery
npm run test:speed    # Supersonic timing, momentum after ball hits, and wheel trails
npm run test:hud      # Boost gauge, pickup feedback, scoreboard and compact layouts
npm run test:goals # Goal scoring and actual rendered shield visibility from both sides
npm run test:feel  # Impact calibration, goal clearance/ramp driving, camera framing and refresh rates
npm run test:impact # Goal blast control, demolitions, subtle ball trail, clear goal net, saved quality
npm run test:impact-visuals # Goal interior and demolition drive-through screenshots
npm run test:feel-live # Record actual high-ball, wall and goal-wall play with camera/frame-time metrics
npm run test:play # Record a live play session and capture screenshots
npm run test:visuals  # Inspect ramps, goal interiors, ceiling, and explosion stages
npm run test:showcase # Record both goal explosions and measure frame times
```

Browser tests use Chrome at its standard macOS path. Set `CHROME_PATH` to a different Chrome/Chromium executable if necessary. The game server must be running for tests. Test output is saved to `test-results/`. On a fresh machine, run `npx playwright install ffmpeg` once before recording video.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrow keys | Drive and steer; pitch and yaw in the air |
| Space | Jump; hold for more height; hop upright when resting upside down |
| Space again | Double jump; hold a direction for a dodge |
| Shift | Rocket boost |
| **B** | **Toggle unlimited boost** |
| Q / E | Air roll left / right |
| Ctrl / PgDn | E-brake / powerslide |
| C | Toggle ball camera |
| R | Recover car to kickoff position |
| 5 / Numpad 5 | Restart match |
| Esc | Pause |
| **P** | **Toggle solo practice / match** |
| H | Full controls |
| M | Mute / unmute |
| F | Fullscreen |

Open **Esc / Options → Controls & bindings** to replace, add, or remove keyboard keys and controller buttons/axis directions. Settings save automatically in this browser. Driving, Aerial, and Match & menu tabs cover every action. Stick/dodge deadzones and steering/aerial sensitivities are adjustable. The connection indicator and live input monitor show what Chrome receives. Escape always goes back, even if its binding is removed. Controller menus use the left stick/D-pad, Cross to select, Circle to go back, and Options to pause/resume. Disconnecting the active controller pauses play.

| DualSense default | Action |
| --- | --- |
| R2 / L2 | Analog accelerate / brake and reverse |
| Left stick | Steer; pitch/yaw in air; direction for a dodge |
| Cross | Jump, double jump/dodge, self-righting hop |
| Circle | Boost |
| Square | Powerslide; hold with left stick to air roll |
| L1 / R1 | Air roll left / right |
| Triangle | Ball camera |
| Options | Pause / resume |
| Create / Share | Controls guide |
| D-pad up / down | Reset car / toggle unlimited boost |

Land all four wheel traces on the ball to regain the flip. Opposing pitch cancels an ongoing forward/backward flip. Landing on the wheels cancels a dodge and allows wavedash-style recovery. Small boost pads provide 12 boost and respawn after four seconds; large pads refill the tank and respawn after ten seconds.

Open **Esc / Options → Camera & visuals** for saved FOV, camera height, distance, and downward-angle sliders. The field remains visible for a live paused preview. Car cam follows the selected pitch; ball cam biases its framing while keeping the ball visible. Switch camera modes from the preview button. Camera reset leaves quality and boost preferences intact.

**Performance** is the default and includes the detailed Octane materials, textured field, shadows, and all gameplay effects without bloom. **High** adds bloom and extra pixel density. **Ultra** adds 500,000 instanced grass tufts, warm sunset lighting, richer reflections, 4096px shadows, and up to 2× pixel density. All tiers share the painted team crests, infield lanes, and physical car materials. Ultra costs more GPU time; choose Performance for the lightest rendering.

The saved **Boost style** selector offers **Classic**, the original focused orange afterburner, and **Inferno**, a hot rolling plume that cools into gray smoke. Inferno particles remain in world space through turns, expire after release, and clear on teleports or style changes. Both styles work in every quality tier.

Press **P** to toggle untimed solo practice, which starts immediately and skips kickoff countdowns. The pause menu includes solo practice, a five-minute match against Maverick, restart, unlimited boost, audio, and performance rendering. Tied matches enter sudden-death overtime. The clock stays at zero while a live ball is airborne.

## Implementation

- `src/arena.ts`: Shared curved collision/render meshes, tapered goal entrances, rounded goal interiors, 20.48-unit ceiling, and procedural honeycomb.
- `src/physics.ts`: Rapier rigid bodies, four-wheel suspension traces, curved wall transitions, contact impulses, jump/dodge control, pads, goal detection, and demolitions.
- `src/game.ts`: Fixed 120 Hz simulation, bot behavior, match lifecycle, input actions, and development-only test scenarios.
- `src/render.ts`: Interpolated car/ball poses between 120 Hz physics steps, lighting, shadowing, bloom, and effects.
- `src/follow-camera.ts`: Smooth angular orbit, spring distance, roughly 0.38-second mode transitions, two-subject ball framing, high-ball field of view, and collision avoidance against opaque ramps. Transparent arena walls do not pin the camera to the car.
- `src/goal-frame.ts`: Layered beveled goal surrounds, silver U-shaped borders around flat side panels, inset team lamps, hex-tiled sills, and three translucent own-goal shields.
- `src/stadium.ts`: Procedural grass, seating, crowds, goal nets, wall mesh, trusses, banners, boost pads, and the monument.
- `src/models.ts`: Detailed Octane and ball assets, material setup, and independent wheel pivots.
- `src/boost-pad.ts`: Low three-lobed silver housings, recessed sockets, and amber inserts. Collected large orbs contract into their sockets over 180 ms; small emitters dim and retract over 120 ms. Small pads use a silver three-lobed plate, recessed amber disk, and six translucent energy curtains. The housing remains visible during cooldown.
- `src/rocket-boost.ts`: Animated twin orange afterburners with bright cores, rippling edges, lateral drift, and smooth release; no continuous boost smoke cloud.
- `src/speed-trails.ts`: Short ribbons following the rear wheels through turns and aerials. Faint silver streaks become cyan/cobalt (blue team) or amber/red (orange team) at supersonic speed. Fixed-rate sampling keeps the trail consistent across refresh rates, with no smoke or particle cloud.
- `src/effects.ts`: Boost fire, sparse short-lived ball speed sparks, skid marks, and synthesized audio.
- `src/demolition.ts`: Reusable fireballs, expanding shock rings, spark streaks, tumbling tires/body fragments, BOOM lettering, and thin smoke that clears quickly and fades near the camera.
- `src/goal-explosion.ts`, `src/blast-pass.ts`: Stellar Collapse goal celebration: plasma corona, singularity and accretion disk, 15,000 GPU particles, branching lightning, curved energy jets, ground shockwave, screen refraction, dynamic lighting, and bass/rumble audio. Geometry is reused between goals.
- `src/ball-marker.ts`: High-contrast, height-scaled ground reticle, projected onto the floor and ramps.
- `src/boost-gauge.ts`, `src/match-hud.css`: Amber-to-coral segmented boost dial with thin, wide numerals with smooth fuel sweep, trailing drain glow, animated pickup surges, boost flow, low-fuel and supersonic states; compact score tiles with goal animations and overtime styling. Reduced-motion preferences suppress decorative animations.
- `src/controls.ts`, `src/bindings.ts`: Keyboard and polled Gamepad API inputs, analog deadzones, edge-triggered actions, safe hotplug handling, validated persistent bindings.
- `src/controls-menu.ts`, `src/hud.ts`, `src/style.css`: Rebinding/capture UI, controller status and live monitor, tuning, responsive match UI and active-device hints.

Countdown, kickoff, goals, overtime and event popups use chunky gradient lettering with black outlines and offset black shadows, matching the demolition art. Announcements animate with a short pop; reduced-motion preferences suppress that entrance.

The end-wall floor fillet keeps its full radius until 1.5 metres from each goalpost, then rounds directly into the mouth. Goal side walls are flat, parallel planes running straight back at constant width. Only the rear curves in the depth/height plane, using an asymmetric profile with a roughly 16-degree upper arm and 2.5-degree lower sill, joined by a smooth rear curve and extruded across the goal width. The visible net and collision shell share this geometry. Curved rear surfaces retain fine transparent honeycomb, with silver U-shaped borders in the flat left and right side planes. Three faint shields mark the blue own goal from the field side only. The camera can pass through the transparent goal shell. End-stand seats and crowd share an exclusion around both goal shells. Gentle car touches add about 10% less velocity, tapering back to full strength with speed; straight grounded hits have a further 4% reduction in upward velocity gain.

Goal celebrations keep the cars and all driving/aerial inputs active. The blast launches nearby cars more strongly and fades with distance; the match clock and scored ball stay stopped until the next kickoff. Demolished cars are temporarily disabled in place so the camera remains above the field before respawn.

New and restarted matches default to ball cam. Straight-line acceleration from rest to supersonic measures 1.59 seconds with boost, using RocketSim's throttle curve and boost acceleration. Boost alone supplies full throttle. Holding the accelerator preserves speed after releasing boost, while coasting and braking still slow the car. Supersonic begins at 2200 reference units per second, with a one-second grace band down to 2100; the wheel trails, status label, and demolition eligibility share that state. Maximum speed remains 2300. Ramp transitions transport velocity with the changing surface normal; suspension pushes along the contact normal, and tire grip redirects most rolling momentum instead of deleting it. Low chassis friction improves landings while preserving ball friction. Coasting and airborne drag are gentler; active braking remains strong. Rear-wheel trails use the loaded tire geometry for their positions and widths, starting beneath the tread with a soft leading fade.

Fast, square, grounded ball contacts preserve more forward car momentum, tapering in between 1500 and 2200 reference units per second. This is a deliberate feel adjustment, applied after the ball response. In the full-speed test the car exits the hit at about 2218 rather than 1961, allowing a follow-up demolition; the ball's launch velocity remains near its previous value. Gentle and glancing contacts receive no added momentum retention.

The car and ball use credited detailed models. Champions Field is a procedural reconstruction inspired by the original stadium, not the original map asset. The field uses the documented 81.92 × 102.4 × 20.48 dimensions, with a 2.56-unit floor fillet and smoothly joined corner planes. Handling constants for speed, gravity, jump, boost acceleration, air torque/damping, and fuel consumption are derived from RocketSim's reference values, scaled into this world. Air roll caps at 5.5 rad/s (roughly 1.14 seconds per sustained turn). A normal directional dodge completes one bounded rotation with a 0.3-second pitch recovery lock; opposite pitch still cancels it. Suspension only pushes away from a surface. Wheel adhesion follows RocketSim’s baseline 0.5 g plus an orientation-dependent wall force; on a flat ceiling it cannot cancel gravity, so wheel contact releases naturally and greater speed carries the car farther. Jumping while the chassis rests upside down starts a 0.4-second recovery roll with a 2-unit/s hop, inspired by RocketSim’s auto-flip constants. Rapier suspension and collision response are independently implemented; this is not a frame-exact reimplementation of Rocket League or a network multiplayer client.

See [CREDITS.md](./CREDITS.md) for model, font, and reference attribution.

Controller tests inject a standard DualSense-shaped Gamepad API device into a separate automated Chrome session. They cover analog input, one-shot actions, remapping, persistence, menu navigation, disconnect/reconnect, and live driving/recovery. This validates the browser input path, not a physical controller’s USB/Bluetooth connection.
