// Original numbered clips; provenance and hashes are in public/audio/rocket-league/manifest.json.
// Car01 is the stock OEM motor bank; OctaneMK2 belongs to the ZSR family.
export const AUDIO_CLIPS = {
  "engineIdle": "SFX_Motor_Car01_0005.ogg",
  "engineLow": "SFX_Motor_Car01_0002.ogg",
  "engineHigh": "SFX_Motor_Car01_0003.ogg",
  "boostStart": "SFX_Boost_Standard_0002.ogg",
  "boostLoop": "SFX_Boost_Standard_0003.ogg",
  "boostStop": "SFX_Boost_Standard_0001.ogg",
  "tires": "SFX_Car_Tires_0007.ogg",
  "drift": "SFX_Car_Tires_0001.ogg",
  "hitSoft": "SFX_Impacts_0015.ogg",
  "hitHard": "SFX_Impacts_0013.ogg",
  "hitAlt": "SFX_Impacts_0450.ogg",
  "jump": "SFX_Car_Movements_0001.ogg",
  "jumpAlt": "SFX_Car_Movements_0015.ogg",
  "dodge": "SFX_Car_Movements_0004.ogg",
  "land": "SFX_Impacts_0007.ogg",
  "demolition": "SFX_Impacts_0489.ogg",
  "pickup": "SFX_UI_Boost_0003.ogg",
  "countdown": "SFX_UI_Countdown_0001.ogg",
  "go": "SFX_UI_Countdown_0002.ogg",
  "goal": "SFX_GoalExplosion_NewDefault_0001.ogg",
  "cheer": "SFX_BG_Crowd_0003.ogg",
  "flipReset": "SFX_UI_InGame_0001.ogg",
  "menu": "SFX_UI_InGame_0006.ogg"
} as const;
export type AudioClip = keyof typeof AUDIO_CLIPS;
