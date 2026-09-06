# Credits and references

## Octane model

This work is based on [“Octane - Rocket League Car”](https://sketchfab.com/3d-models/octane-rocket-league-car-9910f0a5d158425bbc7deb60c7a81f69) by [Jako](https://sketchfab.com/fairlight51), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The locally served glTF, binary, and texture files were obtained from the credited asset copy in [manrajpannu/rl-dart](https://github.com/manrajpannu/rl-dart/tree/main/public/models/octane). Changes in this game include scale, orientation, paint colors, surface properties, wheel pivots, and emissive inserts. The original credit file is retained in `public/models/octane/license.txt`.

## Ball model

This work is based on [“Ball - Rocket League”](https://sketchfab.com/3d-models/ball-rocket-league-2c8911aa1dcd4c53bad842f2d354dfe2) by [Jako](https://sketchfab.com/fairlight51), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Files were obtained from [manrajpannu/rl-dart](https://github.com/manrajpannu/rl-dart/tree/main/public/models/ball). Changes include scale, material tuning, and light colors. The original credit file is retained in `public/models/ball/license.txt`.

## Font

Barlow Condensed by Jeremy Tribby, distributed through Fontsource under the SIL Open Font License. License: `public/fonts/OFL.txt`.

## Logo

The original [Rocket League logo](https://commons.wikimedia.org/wiki/File:Rocket_League_logo.svg) by Psyonix, Inc. is used under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), as credited on Wikimedia Commons. The local SVG copies retain the original geometry, with white lettering for the dark HUD and a shield-only crop for compact screens and loading. These adaptations are also licensed under CC BY-SA 4.0. The logo remains a trademark of its respective owner.

## Visual and handling references

- [Official Champions Field promotional image](https://rl-cdn.psyonix.com/bucket/web/news/rl/Champions-Field-06.jpg), Psyonix. Used as a visual reference; the image is not bundled into the game.
- [RocketSim reference constants](https://github.com/ZealanL/RocketSim/blob/main/src/RLConst.h), ZealanL and contributors. Used to calibrate the independently written handling controller. Gravity, maximum speed, jump impulse and hold acceleration, and boost acceleration/consumption are expressed at approximately 100 reference units per world unit.
- [RLBot useful game values](https://wiki.rlbot.org/v4/botmaking/useful-game-values/). Reference for standard arena width, length, ceiling, goal dimensions, corner planes, and approximate ramp radius.
- [Rocket Science: Dodges explained](https://rocketscience.fyi/know/videos/dodges), HalfwayDead. Reference measurements for powered dodge duration, horizontal impulse, momentum scaling, vertical damping, and five-tick minimum before pitch cancellation. The independently written dodge controller intentionally uses a quicker 0.5-second powered phase and stronger recovery damping following play feedback; this tuning differs from the reference.
- [RocketSim air-control implementation](https://github.com/ZealanL/RocketSim/blob/main/src/Sim/Car/Car.cpp). Reference for local-axis angular torque, damping, roll cap, post-flip pitch recovery, wheel adhesion/ceiling release, and overturned-car auto-flip constants.
- [RocketSim driving and boost implementation](https://github.com/ZealanL/RocketSim/blob/main/src/Sim/Car/Car.cpp), together with its reference constants above. Reference for boost-implied throttle, the engine torque curve, supersonic thresholds, and boost acceleration. The 1.59-second acceleration figure is measured in this recreation, not a capture of the original game.
- [RocketSim wheel friction solver](https://github.com/ZealanL/RocketSim/blob/c2baacb8f4b441dd8505e63c2aeb5a1679b60b02/src/Sim/btVehicleRL/btVehicleRL.cpp), with `Car.cpp` and `RLConst.h` at the same revision. Reference for effective tire mass, lateral slip friction, speed-dependent steering angles, handbrake blending, and 525 uu/s² coasting resistance. These inform the Rapier controller; steering and suspension remain independently implemented.
- [Rocket League Lightspeed trail reference](https://earlygame.com/rocket-league/best-rocket-trails). Visual inspiration for independently generated wheel ribbons; no reference image or original trail asset is bundled.
- [Rocket League in-game HUD screenshot](https://steamcommunity.com/sharedfiles/filedetails/?id=800886843). Visual reference for the compact blue/orange score tiles and asymmetric segmented boost dial. The interface and animations are independently implemented with HTML, CSS and SVG.
- User-supplied own/opponent goal comparison image. Reference for the layered frame, recessed curved interior, team lighting, hex flooring and own-goal shields; arrow annotations were ignored. Goal geometry, materials and shield artwork are independently generated.
- [Rapier JavaScript rigid-body documentation](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/).

Rocket League, Octane, Champions Field, and associated names belong to their respective owners. This local fan recreation is not affiliated with Psyonix or Epic Games.

## Sound effects

23 original Ogg files from [ItsBrank/RocketLeague-Audio](https://github.com/ItsBrank/RocketLeague-Audio), pinned to `af49f0471dcf0b5ba02bc6a9c753b81f7d231b82`. See [audio credits](public/audio/rocket-league/CREDITS.md), [per-file provenance and hashes](public/audio/rocket-league/manifest.json), and the [preserved upstream license](public/audio/rocket-league/UPSTREAM-LICENSE). Original Rocket League audio is associated with Psyonix / Epic Games. No music is included.
