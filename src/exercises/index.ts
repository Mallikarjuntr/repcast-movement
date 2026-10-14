import type { ExerciseDefinition, HoldExercise, RepExercise } from '../definitions.js';
import { squat } from './squat.js';

export { squat };

export const lunge: RepExercise = {
  id: 'lunge',
  name: 'Lunge',
  type: 'rep',
  metric: { joint: 'knee', pick: 'min', fallback: 'thigh-drop' },
  thresholds: { top: 160, bottom: 130 },
  depth: {
    target: 100,
    cue: 'Sink a little lower — back knee towards the floor',
    noRepAbove: 125,
    noRepCue: "Not low enough — that one doesn't count",
  },
  minRepMs: 700,
  maxRepMs: 8000,
  upright: { maxTilt: 30 },
  plantedFeet: false,
  stance: { expect: 'staggered', cue: 'Step one foot forward — that was a squat, this set is lunges' },
  checks: [{ id: 'chest-dropping', cue: 'Keep your chest tall', warn: 40, fail: 60, failCue: "Leaned too far forward — that one doesn't count" }],
  required: ['leftHip', 'rightHip', 'leftKnee', 'rightKnee'],
};

/** Arms sweep from the sides to overhead; the shoulder angle grows, so it is inverted. */
export const jumpingJack: RepExercise = {
  id: 'jumping-jack',
  name: 'Jumping jack',
  type: 'rep',
  metric: { joint: 'shoulder', invert: true },
  thresholds: { top: 130, bottom: 50 },
  minRepMs: 300,
  maxRepMs: 4000,
  upright: { maxTilt: 25 },
  required: ['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftHip', 'rightHip'],
};

/** Best filmed from the side with the phone on the floor. */
export const plank: HoldExercise = {
  id: 'plank',
  name: 'Plank',
  type: 'hold',
  targets: [
    { measure: 'torso-tilt', angle: 90, tolerance: 25, cue: 'Get down into a plank — body flat' },
    { measure: 'joint', joint: 'body', angle: 175, tolerance: 15, cue: 'Make a straight line from shoulders to heels' },
  ],
  checks: [
    { id: 'hips-sagging', cue: 'Lift your hips a little', warn: 0.06 },
    { id: 'hips-piking', cue: 'Lower your hips', warn: 0.08 },
  ],
  targetSeconds: 30,
  required: ['leftHip', 'rightHip'],
};

/** Vrikshasana: stand on one leg, the other foot pressed to the standing leg. */
export const treePose: HoldExercise = {
  id: 'tree-pose',
  name: 'Tree pose (Vrikshasana)',
  type: 'hold',
  targets: [
    { measure: 'torso-tilt', angle: 0, tolerance: 20, cue: 'Stand tall' },
    { measure: 'joint', joint: 'knee', pick: 'max', angle: 175, tolerance: 15, cue: 'Keep your standing leg straight' },
    { measure: 'joint', joint: 'knee', pick: 'min', angle: 60, tolerance: 40, cue: 'Bend your knee and lift your foot onto your standing leg' },
  ],
  checks: [{ id: 'hips-uneven', cue: 'Level your hips', warn: 0.25 }],
  targetSeconds: 20,
  required: ['leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'],
};

export const EXERCISES: Record<string, ExerciseDefinition> = {
  [squat.id]: squat,
  [lunge.id]: lunge,
  [jumpingJack.id]: jumpingJack,
  [plank.id]: plank,
  [treePose.id]: treePose,
};
