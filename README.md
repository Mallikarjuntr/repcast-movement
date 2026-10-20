# repcast-movement

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) ![Vitest: 72 tests](https://img.shields.io/badge/Vitest-72_tests-2C2C2C?logo=vitest&logoColor=00FF74) ![MediaPipe Pose](https://img.shields.io/badge/works_with-MediaPipe_Pose-0097A7?logo=mediapipe&logoColor=white) ![License: MIT](https://img.shields.io/badge/License-MIT-3DA639?logo=opensourceinitiative&logoColor=white)

An open-source movement engine that turns body pose landmarks (for example from [MediaPipe Pose](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)) into **reps**, **holds** and **form feedback**.

Every exercise is built from two primitives:

| Primitive | Detects | Examples |
|---|---|---|
| **Rep** | A joint angle that dips and returns: counts reps, measures depth, runs form checks at the deepest point | Squat, lunge, jumping jack, push-up, sit-to-stand |
| **Hold** | A pose kept within tolerance: times the hold, rides out brief slips, measures wobble | Plank, yoga asanas, balance tests |

Exercises are **plain data**, so adding a new one needs no new code.

### An honest coach

Every rep attempt gets a verdict instead of a blind count:

| Verdict | Meaning |
|---|---|
| `good` | Deep enough, clean form — counts |
| `fix` | Counts, with a correction (slightly shallow, mild fault) |
| `no-rep` | Doesn't count, with the reason: not deep enough, big form break, wrong exercise (a lunge in a squat set), not standing upright, or the camera moved |

Built-in gates stop false reps: reps only start from an upright standing position, the feet must stay planted in moves where they should (otherwise the phone or person moved), and attempts that are too fast or too slow are ignored.

### Telling look-alike moves apart

Several moves look the same at the bottom of the rep, so the engine also follows **what the feet did** (`footwork` and `feetOut` in a definition). It remembers where the feet stood before the rep (from the standing frames with the feet closest together, since people step out before they bend) and, at the bottom, which foot moved, how far, and where it ended:

- **Forward or back:** at the bottom of any lunge the front knee is up near hip height and the back knee down near the floor, from any camera angle. So if the foot that moved has the higher knee, it stepped forward (a lunge); if the lower, it stepped back (a reverse lunge).
- **Across:** facing the camera, a back foot that ends behind and past the other one is a curtsy lunge (side-on that can't be seen, so a step back counts).
- **Planted:** neither foot moved is a squat, or a split squat when the feet started one in front of the other.
- **Out:** in jacks, both feet stepping out sideways is a jumping jack; one foot is a step jack.

A rep whose feet can't be seen clearly keeps the benefit of the doubt. A wrong move doesn't count, and the cue says what it was: *"Step forward, not back — that was a reverse lunge"*, *"Keep your feet where they are — that was a lunge, this set is split squats"*, *"One foot at a time, no jump — that was a jumping jack"*. Half squats also refuse a full squat (*"That was a full squat — this set is half squats"*).

Smoothing is set for 15 frames a second and speeds up on slower phones, so a phone managing 7 fps still keeps up with fast moves like jumping jacks.

### Wherever the phone is

People prop their phone wherever it fits, so the engine is checked from the front, at 45° and side-on, on real recordings and on a rendered 3D trainer seen from all three angles (see `docs/TESTING.md` §9 in [repcast-tv-app](https://github.com/Mallikarjuntr/repcast-tv-app)). That found and fixed five view problems, each with a test here:

- Jumping feet in a jumping jack read as "the camera moved".
- Facing the camera, the pose model swaps left and right ankles for a frame; that read as "the camera moved".
- Side-on, with the feet out of view, hip sway was measured against a shoulder width of almost zero.
- Facing the camera, a lunge's knees look closer in height than from the side, so lunges were called squats. Lunge evidence is now judged with a lower cut-off when both legs are visible, and a stricter one side-on.
- And a person whose straight legs only read ~150° (common side-on) never "stood tall" for half squats: the start-of-rep line now follows their own standing angle.

## Install

```bash
npm install github:Mallikarjuntr/repcast-movement
```

## Use

```ts
import { RepDetector, squat } from 'repcast-movement';

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
import { HoldDetector, plank } from 'repcast-movement';

const hold = new HoldDetector(plank);
const { holding, heldMs, completed, offTarget, faults, wobble } = hold.update(frame);
```

## Built-in exercises

| Exercise | Type | Checks |
|---|---|---|
| `squat` | rep | depth (no rep above 120°), knees caving in, chest dropping, feet side by side; keeps counting when the feet are out of frame |
| `halfSquat` | rep | halfway depth: not too shallow, and not a full squat |
| `sumoSquat` | rep | depth and a wide stance |
| `lunge` | rep | depth, chest dropping, one foot steps forward |
| `reverseLunge` | rep | as lunge, one foot steps back |
| `splitSquat` | rep | as lunge, feet stay put in a split stance |
| `curtsyLunge` | rep | as lunge, the back foot steps behind and across |
| `jumpingJack` | rep | full arm sweep, both feet jump out |
| `stepJack` | rep | full arm sweep, one foot steps out |
| `pushUp`, `kneePushUp` | rep | elbow depth lying down; hips sagging or piking (push-up) |
| `gluteBridge` | rep | hips lifted into one line, lying down |
| `plank` | hold | straight body line, hips sagging, hips piking |
| `treePose` (Vrikshasana) | hold | standing leg straight, foot lifted, hips level, wobble |

## Define your own

```ts
import type { RepExercise } from 'repcast-movement';

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
