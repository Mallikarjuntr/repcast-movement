import type { RepExercise } from '../definitions.js';

export const squat: RepExercise = {
  id: 'squat',
  name: 'Squat',
  type: 'rep',
  metric: { joint: 'knee', fallback: 'thigh-drop' },
  thresholds: { top: 160, bottom: 135 },
  depth: { target: 105, cue: 'Go a little lower — hips to knee level' },
  minRepMs: 500,
  checks: [
    { id: 'knees-caving', cue: 'Push your knees out', params: { minRatio: 0.75 } },
    { id: 'chest-dropping', cue: 'Keep your chest up', params: { maxTorsoLean: 55 } },
  ],
  required: ['leftHip', 'rightHip', 'leftKnee', 'rightKnee'],
};
