// Standard soccar dimensions / 100; RLBot Useful Game Values and RocketSim.
export const FIELD = { width: 40.96, length: 51.2, height: 20.48, goalWidth: 8.92755, goalHeight: 6.42775, goalDepth: 8.8, ballRadius: .92, rampRadius: 2.56, cornerCut: 11.52 };
// One world unit is approximately 100 Rocket League units. Reference: RocketSim RLConst.h.
export const CAR = { maxSpeed: 23, driveSpeed: 14.1, supersonic: 22, gravity: 6.5, jumpSpeed: 875 / 300, jumpHoldAcceleration: 4375 / 300, boostGroundAcceleration: 2975 / 300, boostAirAcceleration: 3175 / 300, boostDrain: 100 / 3 };
export const BLUE = 0x168bff;
export const ORANGE = 0xff931f;
export const STEP = 1 / 120;
export const MATCH_LENGTH = 300;
export interface Input { throttle: number; steer: number; pitch: number; roll: number; boost: boolean; jump: boolean; jumpHeld: boolean; drift: boolean; yaw?: number; dodgeForward?: number; dodgeSide?: number; }
export const emptyInput = (): Input => ({ throttle: 0, steer: 0, pitch: 0, roll: 0, boost: false, jump: false, jumpHeld: false, drift: false });
