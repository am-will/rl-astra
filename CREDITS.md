# Credits and references

## Octane model

This work is based on [“Octane - Rocket League Car”](https://sketchfab.com/3d-models/octane-rocket-league-car-9910f0a5d158425bbc7deb60c7a81f69) by [Jako](https://sketchfab.com/fairlight51), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The locally served glTF, binary, and texture files were obtained from the credited asset copy in [manrajpannu/rl-dart](https://github.com/manrajpannu/rl-dart/tree/main/public/models/octane). Changes in this game include scale, orientation, paint colors, surface properties, wheel pivots, and emissive inserts. The original credit file is retained in `public/models/octane/license.txt`.

## Ball model

This work is based on [“Ball - Rocket League”](https://sketchfab.com/3d-models/ball-rocket-league-2c8911aa1dcd4c53bad842f2d354dfe2) by [Jako](https://sketchfab.com/fairlight51), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Files were obtained from [manrajpannu/rl-dart](https://github.com/manrajpannu/rl-dart/tree/main/public/models/ball). Changes include scale, material tuning, and light colors. The original credit file is retained in `public/models/ball/license.txt`.

## Font

Barlow Condensed by Jeremy Tribby, distributed through Fontsource under the SIL Open Font License. License: `public/fonts/OFL.txt`.

## Visual and handling references

- [Official Champions Field promotional image](https://rl-cdn.psyonix.com/bucket/web/news/rl/Champions-Field-06.jpg), Psyonix. Used as a visual reference; the image is not bundled into the game.
- [RocketSim reference constants](https://github.com/ZealanL/RocketSim/blob/main/src/RLConst.h), ZealanL and contributors. Used to calibrate the independently written handling controller. Gravity, maximum speed, jump impulse and hold acceleration, and boost acceleration/consumption are expressed at approximately 100 reference units per world unit.
- [RLBot useful game values](https://wiki.rlbot.org/v4/botmaking/useful-game-values/). Reference for standard arena width, length, ceiling, goal dimensions, corner planes, and approximate ramp radius.
- [RocketSim air-control implementation](https://github.com/ZealanL/RocketSim/blob/main/src/Sim/Car/Car.cpp). Reference for local-axis angular torque, damping, roll cap, post-flip pitch recovery, wheel adhesion/ceiling release, and overturned-car auto-flip constants.
- [RocketSim driving and boost implementation](https://github.com/ZealanL/RocketSim/blob/main/src/Sim/Car/Car.cpp), together with its reference constants above. Reference for boost-implied throttle, the engine torque curve, supersonic thresholds, and boost acceleration. The 1.59-second acceleration figure is measured in this recreation, not a capture of the original game.
- [Rocket League Lightspeed trail reference](https://earlygame.com/rocket-league/best-rocket-trails). Visual inspiration for independently generated wheel ribbons; no reference image or original trail asset is bundled.
- [Rocket League in-game HUD screenshot](https://steamcommunity.com/sharedfiles/filedetails/?id=800886843). Visual reference for the compact blue/orange score tiles and asymmetric segmented boost dial. The interface and animations are independently implemented with HTML, CSS and SVG.
- [Rapier JavaScript rigid-body documentation](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/).

Rocket League, Octane, Champions Field, and associated names belong to their respective owners. This local fan recreation is not affiliated with Psyonix or Epic Games.
