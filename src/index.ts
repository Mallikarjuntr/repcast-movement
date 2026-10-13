export type { Landmark, PoseFrame } from './types.js';
export { POINTS, type PointName, type Side } from './landmarks.js';
export type { CheckConfig, ExerciseDefinition, HoldExercise, HoldTarget, JointName, RepExercise } from './definitions.js';
export { CHECKS, type CheckId } from './checks.js';
export { jointAngles, torsoTilt, type Pick } from './measures.js';
export { RepDetector, type Fault, type RepDetectorOptions, type RepPhase, type RepResult, type RepUpdate } from './rep-detector.js';
export { HoldDetector, type HoldDetectorOptions, type HoldUpdate } from './hold-detector.js';
export { EXERCISES, jumpingJack, lunge, plank, squat, treePose } from './exercises/index.js';
