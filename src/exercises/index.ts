import type { ExerciseDefinition, HoldExercise, RepExercise } from '../definitions.js';
import { lungeInSquatSet, squat } from './squat.js';

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
  // One foot steps forward and back each rep (walking lunges too: the step is judged from where it started).
  footwork: {
    expect: 'forward',
    cues: {
      squat: 'Step one foot forward — that was a squat, this set is lunges',
      planted: 'Step forward into each lunge — that was a split squat',
      back: 'Step forward, not back — that was a reverse lunge',
      across: 'Step forward, not back — that was a reverse lunge',
    },
  },
  checks: [{ id: 'chest-dropping', cue: 'Keep your chest tall', warn: 40, fail: 60, failCue: "Leaned too far forward — that one doesn't count" }],
  required: ['leftHip', 'rightHip', 'leftKnee', 'rightKnee'],
};

/**
 * Only halfway down, kinder to tight knees. Barely bending isn't a rep, and neither is a full squat.
 * Measured: a phone test's half squats 106–137° and full squats in the same set 51–55°; a real
 * half-squat demo 72–97°; real full squats 39–60°. So under 66° it was the other move.
 */
export const halfSquat: RepExercise = {
  ...squat,
  ...lungeInSquatSet('half squats'),
  id: 'half-squat',
  name: 'Half squat',
  thresholds: { top: 160, bottom: 148 },
  depth: {
    target: 135,
    cue: 'Bend a little more — about halfway down',
    noRepBelow: 66,
    tooDeepCue: 'That was a full squat — this set is half squats, stop about halfway down',
  },
};

/** Feet wide, toes out; the knees still track over the toes. */
export const sumoSquat: RepExercise = {
  ...squat,
  ...lungeInSquatSet('sumo squats', 'feet wide'),
  id: 'sumo-squat',
  name: 'Sumo squat',
  // Ordinary squats measured 0.8–1.2 on real video, a sumo stance about 2.2 (docs/TESTING.md).
  width: {
    min: 1.5,
    cue: 'Step your feet a little wider',
    noRepBelow: 1.25,
    noRepCue: "Feet wider — that was a squat, this set is sumo squats",
  },
  depth: {
    target: 100,
    cue: 'Sit a little lower — thighs towards level',
    noRepAbove: 125,
    noRepCue: "Not deep enough — that one doesn't count",
  },
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
  // The feet jump apart and back every rep, so moving feet aren't a sign the camera moved.
  plantedFeet: false,
  // Both feet jump out as the arms go up (judged only when the feet and their sideways movement can be seen).
  feetOut: {
    expect: 2,
    cues: {
      1: 'Jump both feet out together — that was a step jack',
      0: 'Jump your feet out wide as your arms go up',
    },
  },
  required: ['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftHip', 'rightHip'],
};

/** Step back into the lunge; the back knee still drops towards the floor. */
export const reverseLunge: RepExercise = {
  ...lunge,
  id: 'reverse-lunge',
  name: 'Reverse lunge',
  stance: { expect: 'staggered', cue: 'Step one foot back — that was a squat, this set is reverse lunges' },
  footwork: {
    expect: 'back',
    cues: {
      squat: 'Step one foot back — that was a squat, this set is reverse lunges',
      planted: 'Step back into each lunge — that was a split squat',
      forward: 'Step back, not forward — that was a forward lunge',
    },
  },
};

/** Feet stay where they are, one forward and one back: straight down and up. */
export const splitSquat: RepExercise = {
  ...lunge,
  id: 'split-squat',
  name: 'Split squat',
  plantedFeet: true,
  stance: { expect: 'staggered', cue: 'Keep one foot forward and one back — this set is split squats' },
  // Only feet side by side are refused. A split squat's back heel lifts and rolls, and side-on the
  // pose model loses track of the far ankle: real split squats read "steps" of 0.15–0.63 of leg
  // length, the same as real side-on lunges (0.15–0.33), so a lunge in this set can't honestly be
  // told apart and isn't called one. Depth and form are still judged.
  footwork: {
    expect: 'planted',
    cues: { squat: 'Keep one foot forward and one back — this set is split squats' },
  },
};

/** Step back and across, like a curtsy; judged like a lunge. */
export const curtsyLunge: RepExercise = {
  ...lunge,
  id: 'curtsy-lunge',
  name: 'Curtsy lunge',
  // The crossed back leg keeps the front knee less bent than in a lunge: a phone test's curtsies
  // reached 88–121°, so the lunge's 100° target flagged nearly every one.
  depth: {
    target: 115,
    cue: 'Sink a little lower — back knee towards the floor',
    noRepAbove: 130,
    noRepCue: "Not low enough — that one doesn't count",
  },
  stance: { expect: 'staggered', cue: 'Step one foot back and across — this set is curtsy lunges' },
  // Back and across, behind the front leg. Side-on the crossing can't be seen, so a step back counts.
  footwork: {
    expect: 'across',
    cues: {
      squat: 'Step one foot back and across — this set is curtsy lunges',
      planted: 'Step back and across into each lunge — this set is curtsy lunges',
      forward: 'Step back and across, not forward — this set is curtsy lunges',
      back: 'Cross your back foot behind your front leg — that was a reverse lunge',
    },
  },
};

/** A jumping jack without the jump: one foot steps out as the arms go up. A little slower. */
export const stepJack: RepExercise = {
  ...jumpingJack,
  id: 'step-jack',
  name: 'Step jack',
  minRepMs: 500,
  maxRepMs: 5000,
  feetOut: {
    expect: 1,
    cues: {
      2: 'One foot at a time, no jump — that was a jumping jack',
      0: 'Step one foot out to the side as your arms go up',
    },
  },
};

/**
 * Elbows bend and straighten while the body stays in one line. Filmed side-on with the phone on the
 * floor; reps only start lying down, so arm movements while standing never count.
 */
export const pushUp: RepExercise = {
  id: 'push-up',
  name: 'Push-up',
  type: 'rep',
  metric: { joint: 'elbow' },
  thresholds: { top: 150, bottom: 125 },
  depth: {
    target: 100,
    cue: 'Go a little lower — chest towards the floor',
    noRepAbove: 118,
    noRepCue: "Not low enough — that one doesn't count",
  },
  minRepMs: 600,
  maxRepMs: 8000,
  lying: { minTilt: 45 },
  checks: [
    { id: 'hips-sagging', cue: 'Squeeze your glutes — keep your hips up', warn: 0.07, fail: 0.15, failCue: "Hips sagged too far — that one doesn't count" },
    { id: 'hips-piking', cue: 'Lower your hips into one straight line', warn: 0.09 },
  ],
  required: ['leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow'],
};

/** Push-ups from the knees: same arms, a lighter load. The line is shoulders to knees, so no hip checks. */
export const kneePushUp: RepExercise = {
  ...pushUp,
  id: 'knee-push-up',
  name: 'Knee push-up',
  checks: [],
};

/**
 * Lying on your back, knees bent: lift the hips until shoulders, hips and knees make a straight line.
 * The hip angle opens during the rep, so it is inverted (180° = hips fully up → 0).
 */
export const gluteBridge: RepExercise = {
  id: 'glute-bridge',
  name: 'Glute bridge',
  type: 'rep',
  metric: { joint: 'hip', invert: true },
  thresholds: { top: 40, bottom: 22 },
  depth: { target: 12, cue: 'Lift your hips higher — squeeze at the top' },
  minRepMs: 600,
  maxRepMs: 8000,
  lying: { minTilt: 45 },
  required: ['leftHip', 'rightHip', 'leftKnee', 'rightKnee'],
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
  [halfSquat.id]: halfSquat,
  [sumoSquat.id]: sumoSquat,
  [lunge.id]: lunge,
  [reverseLunge.id]: reverseLunge,
  [splitSquat.id]: splitSquat,
  [curtsyLunge.id]: curtsyLunge,
  [jumpingJack.id]: jumpingJack,
  [stepJack.id]: stepJack,
  [pushUp.id]: pushUp,
  [kneePushUp.id]: kneePushUp,
  [gluteBridge.id]: gluteBridge,
  [plank.id]: plank,
  [treePose.id]: treePose,
};
