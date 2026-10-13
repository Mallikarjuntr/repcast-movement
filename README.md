# spotter-movement

An open-source movement engine that turns body pose landmarks (for example from [MediaPipe Pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)) into **reps**, **holds** and **form feedback**.

Every exercise is built from two primitives:

| Primitive | Detects | Examples |
|---|---|---|
| **Rep** | A joint angle that dips and returns: counts reps, measures depth, runs form checks at the deepest point | Squat, lunge, jumping jack, push-up, sit-to-stand |
| **Hold** | A pose kept within tolerance: times the hold, rides out brief slips, measures wobble | Plank, yoga asanas, balance tests |

Exercises are **plain data**, so adding a new one needs no new code.

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
  console.log(update.rep.count, update.rep.depthOk, update.rep.faults.map((f) => f.cue));
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
| `squat` | rep | depth, knees caving in, chest dropping; keeps counting when the feet are out of frame |
| `lunge` | rep | depth, chest dropping |
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
  required: ['leftHip', 'rightHip', 'leftKnee', 'rightKnee'],
};
```

Joints: `knee`, `hip`, `elbow`, `shoulder` (arm raise) and `body` (shoulder-hip-ankle line). Checks: `knees-caving`, `chest-dropping`, `hips-sagging`, `hips-piking`, `hips-uneven`.

## Develop

```bash
npm ci
npm test
```

## License

MIT
