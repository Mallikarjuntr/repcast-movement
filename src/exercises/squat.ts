import type { RepExercise } from '../definitions.js';

/**
 * Thresholds tuned on real phone recordings: full squats bottom out around 50–65° at the knee,
 * half squats around 105–125°.
 */
export const squat: RepExercise = {
  id: 'squat',
  name: 'Squat',
  type: 'rep',
  metric: { joint: 'knee', fallback: 'thigh-drop' },
  thresholds: { top: 160, bottom: 135 },
  depth: {
    target: 95,
    cue: 'Go a little lower — hips to knee level',
    noRepAbove: 120,
    noRepCue: "Not deep enough — that one doesn't count",
  },
  minRepMs: 700,
  maxRepMs: 8000,
  upright: { maxTilt: 30 },
  stance: { expect: 'square', cue: "That's a lunge — this set is squats, feet side by side" },
  checks: [
    { id: 'knees-caving', cue: 'Push your knees out', warn: 0.75, fail: 0.55, failCue: "Knees caved in too far — that one doesn't count" },
    { id: 'chest-dropping', cue: 'Keep your chest up', warn: 55, fail: 72, failCue: "Chest dropped too far — that one doesn't count" },
  ],
  required: ['leftHip', 'rightHip', 'leftKnee', 'rightKnee'],
};
