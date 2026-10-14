# spotter-movement

An open-source movement engine that turns body pose landmarks (for example from [MediaPipe Pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)) into **reps**, **holds** and **form feedback**.

Every exercise is built from two primitives:

| Primitive | Detects | Examples |
|---|---|---|
| **Rep** | A joint angle that dips and returns: counts reps, measures depth, runs form checks at the deepest point | Squat, lunge, jumping jack, push-up, sit-to-stand |
| **Hold** | A pose kept within tolerance: times the hold, rides out brief slips, measures wobble | Plank, yoga asanas, balance tests |

Exercises are **plain data**, so adding a new one needs no new code.

### An honest spotter

Every rep attempt gets a verdict instead of a blind count:

| Verdict | Meaning |
|---|---|
| `good` | Deep enough, clean form — counts |
| `fix` | Counts, with a correction (slightly shallow, mild fault) |
| `no-rep` | Doesn't count, with the reason: not deep enough, big form break, wrong exercise (a lunge in a squat set), not standing upright, or the camera moved |

Built-in gates stop false reps: reps only start from an upright standing position, both feet must stay planted (otherwise the phone or person moved), and attempts that are too fast or too slow are ignored.

## Install

```bash
npm install github:Mallikarjuntr/spotter-movement
```

## Use

```ts
import { RepDetector, squat } from 'spotter-movement';

const detector = new RepDetector(squat);

// For each video frame (e.g. from MediaPipe's PoseLandmarker.detectForVideo):
const update = detector.update({
  t: performance.now(),
  landmarks: result.landmarks[0],      // normalized image points
  world: result.worldLandmarks[0],     // optional 3D points, makes angles view-independent
  aspect: video.videoWidth / video.videoHeight,
});

if (update.rep) {
  const { counted, verdict, cues, count } = update.rep; // e.g. false, 'no-rep', ["Not deep enough — that one doesn't count"], 7
}
```

Holds work the same way:

```ts
import { HoldDetector, plank } from 'spotter-movement';

const hold = new HoldDetector(plank);
const { holding, heldMs, completed, offTarget, faults, wobble } = hold.update(frame);
```

## Built-in exercises

| Exercise | Type | Checks |
|---|---|---|
| `squat` | rep | depth (no rep above 120°), knees caving in, chest dropping, feet side by side; keeps counting when the feet are out of frame |
| `lunge` | rep | depth, chest dropping, one foot forward |
| `jumpingJack` | rep | full arm sweep |
| `plank` | hold | straight body line, hips sagging, hips piking |
| `treePose` (Vrikshasana) | hold | standing leg straight, foot lifted, hips level, wobble |

## Define your own

```ts
import type { RepExercise } from 'spotter-movement';

export const sitToStand: RepExercise = {
  id: 'sit-to-stand',
  name: 'Sit to stand',
  type: 'rep',
  metric: { joint: 'knee' },
  thresholds: { top: 160, bottom: 110 },
  minRepMs: 800,
  upright: { maxTilt: 30 },
  required: ['leftHip', 'rightHip', 'leftKnee', 'rightKnee'],
};
```

Joints: `knee`, `hip`, `elbow`, `shoulder` (arm raise) and `body` (shoulder-hip-ankle line). Checks (each with a `warn` threshold and an optional `fail` threshold that costs the rep): `knees-caving`, `chest-dropping`, `hips-sagging`, `hips-piking`, `hips-uneven`.

## Develop

```bash
npm ci
npm test
```

## License

MIT
