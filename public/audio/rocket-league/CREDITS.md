# Rocket League sound effects

These 24 original Ogg files come from [ItsBrank/RocketLeague-Audio](https://github.com/ItsBrank/RocketLeague-Audio), pinned to commit `af49f0471dcf0b5ba02bc6a9c753b81f7d231b82` (the repository identifies the game extraction as version `211123.48895.355454`). The selected files cover stock OEM-A motors, Standard boost, tires, impacts, movement, vehicle explosions, pickups, countdown, default goal explosion, crowd reaction, and UI cues. No music is included.

The files retain their original names and bytes. `manifest.json` records every original repository path, Git blob ID, SHA-256 and game cue. The repository's license is preserved verbatim in `UPSTREAM-LICENSE`. Rocket League and its original audio are associated with Psyonix / Epic Games; the repository's license declaration does not establish ownership of the original game assets.

Playback mixes the motor layers by throttle and speed, with lower motor volume, restrained pitch, and natural release into coasting. It blends a 12 ms loop seam in memory, attenuates and pans distant world events, and limits the combined mix. The source files are unchanged.
