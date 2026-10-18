import { describe, expect, it } from 'vitest';
import { POINTS } from '../src/landmarks.js';
import { HoldDetector, jumpingJack, lunge, plank, RepDetector, treePose, type HoldUpdate, type PoseFrame } from '../src/index.js';
import { figure, motion } from './figure.js';

function countReps(detector: RepDetector, frames: PoseFrame[]): number {
  for (const f of frames) detector.update(f);
  return detector.count;
}

function setPoint(frame: PoseFrame, name: keyof typeof POINTS, x: number, y: number): void {
  for (const list of [frame.landmarks, frame.world!]) {
    (list as { x: number; y: number; z: number; visibility?: number }[])[POINTS[name]] = { x, y, z: 0, visibility: 0.99 };
  }
}

/** Side view of a plank, head on the left. `sag` pushes the hips down (+) or up (-). */
function plankFrame(t: number, sag = 0): PoseFrame {
  const frame = figure(t, { knee: 178 });
  for (const side of ['left', 'right'] as const) {
    setPoint(frame, `${side}Shoulder`, 0.3, 0.5);
    setPoint(frame, `${side}Hip`, 0.52, 0.5 + sag);
    setPoint(frame, `${side}Knee`, 0.63, 0.5);
    setPoint(frame, `${side}Ankle`, 0.75, 0.5);
  }
  return frame;
}

/** Standing on the left leg with the right foot lifted against it. */
function treeFrame(t: number): PoseFrame {
  const frame = figure(t, { knee: 178, torsoLean: 5 });
  setPoint(frame, 'rightKnee', 0.66, 0.62);
  setPoint(frame, 'rightAnkle', 0.53, 0.68);
  return frame;
}

function hold(detector: HoldDetector, makeFrame: (t: number) => PoseFrame, seconds: number): HoldUpdate[] {
  const updates: HoldUpdate[] = [];
  for (let t = 0; t <= seconds * 1000; t += 33) updates.push(detector.update(makeFrame(t)));
  return updates;
}

/**
 * A forward lunge facing the camera: the left foot steps towards the camera (down the picture) as
 * the knees bend, the right (back) knee drops towards the floor, and the foot steps home at the top.
 */
function forwardLunge(gap: number) {
  return motion([175, 85, 175, 85, 175], 15).map((f, i, all) => {
    const knee = 175 - (175 - 85) * Math.abs(Math.sin((Math.PI * i) / ((all.length - 1) / 2)));
    const drop = (gap * (175 - knee)) / 90;
    const step = 0.12 * Math.min(1, (175 - knee) / 30);
    // lungeGap lowers the back ankle with its knee; keep that foot planted.
    return figure(f.t, { knee, lungeGap: drop, ankleShift: { left: [0, step], right: [0, -drop * 0.2] } });
  });
}

describe('lunge', () => {
  it('counts lunges with one knee dropping towards the floor', () => {
    const frames = forwardLunge(1.1);
    const detector = new RepDetector(lunge);
    for (const f of frames) detector.update(f);
    expect(detector.count).toBe(2);
  });

  it('counts lunges facing the camera, where the knee gap looks smaller', () => {
    // From the front the front thigh points at the camera, so the knees look closer in height:
    // a real lunge facing the camera measured 0.39–0.54 of torso length (here ~0.45 at the bottom).
    const frames = forwardLunge(0.56);
    const detector = new RepDetector(lunge);
    for (const f of frames) detector.update(f);
    expect(detector.count).toBe(2);
  });

  it("doesn't count a squat during a lunge set", () => {
    const detector = new RepDetector(lunge);
    const results = motion([175, 85, 175], 15).map((f) => detector.update(f).rep).filter(Boolean);
    expect(detector.count).toBe(0);
    expect(results[0]!.cues[0]).toMatch(/one foot forward/i);
  });
});

describe('jumping jack', () => {
  const sweeps = (feetOut: boolean) => {
    const frames: PoseFrame[] = [];
    let t = 0;
    for (const [from, to] of [[10, 170], [170, 10], [10, 170], [170, 10], [10, 170], [170, 10]] as const) {
      for (let s = 0; s <= 10; s++) {
        const a = from + ((to - from) * s) / 10;
        frames.push(figure(t, { knee: 178, armRaise: a, feetHalfWidth: feetOut && a > 40 ? 0.24 : 0.08 }));
        t += 33;
      }
    }
    return frames;
  };

  it('counts arms sweeping from the sides to overhead as the feet jump out', () => {
    expect(countReps(new RepDetector(jumpingJack), sweeps(true))).toBe(3);
  });

  it("doesn't count arm sweeps when the feet stay together, and says why", () => {
    const detector = new RepDetector(jumpingJack);
    const reps = sweeps(false).map((f) => detector.update(f).rep).filter(Boolean);
    expect(detector.count).toBe(0);
    expect(reps[0]!.cues[0]).toMatch(/feet out/i);
  });

  it('ignores half arm raises', () => {
    const frames = [10, 60, 90, 60, 10].map((a, i) => figure(i * 100, { knee: 178, armRaise: a }));
    expect(countReps(new RepDetector(jumpingJack), frames)).toBe(0);
  });
});

describe('plank', () => {
  it('times a straight plank and completes at the target', () => {
    const updates = hold(new HoldDetector(plank), (t) => plankFrame(t), 31);
    const last = updates[updates.length - 1]!;
    expect(last.holding).toBe(true);
    expect(last.heldMs).toBeGreaterThanOrEqual(30_000);
    expect(updates.filter((u) => u.completed)).toHaveLength(1);
    expect(last.faults).toHaveLength(0);
  });

  it('keeps timing a slight sag but asks to lift the hips', () => {
    const last = hold(new HoldDetector(plank), (t) => plankFrame(t, 0.035), 2).at(-1)!;
    expect(last.holding).toBe(true);
    expect(last.faults.map((f) => f.id)).toEqual(['hips-sagging']);
  });

  it('flags hips piked up', () => {
    const last = hold(new HoldDetector(plank), (t) => plankFrame(t, -0.045), 2).at(-1)!;
    expect(last.faults.map((f) => f.id)).toContain('hips-piking');
  });

  it('does not run the timer while standing', () => {
    const last = hold(new HoldDetector(plank), (t) => figure(t, { knee: 178 }), 3).at(-1)!;
    expect(last.holding).toBe(false);
    expect(last.heldMs).toBe(0);
    expect(last.offTarget.length).toBeGreaterThan(0);
  });

  it('rides out a brief slip without stopping the timer', () => {
    const detector = new HoldDetector(plank);
    hold(detector, (t) => plankFrame(t), 2);
    const slip = detector.update(figure(2100, { knee: 178 }));
    expect(slip.holding).toBe(true);
  });
});

describe('tree pose', () => {
  it('holds when standing on one leg with the other knee bent', () => {
    const last = hold(new HoldDetector(treePose), treeFrame, 3).at(-1)!;
    expect(last.offTarget).toEqual([]);
    expect(last.holding).toBe(true);
    expect(last.wobble).not.toBeNull();
    expect(last.wobble!).toBeLessThan(0.01);
  });

  it('asks to lift the foot when both legs are straight', () => {
    const last = hold(new HoldDetector(treePose), (t) => figure(t, { knee: 178 }), 1).at(-1)!;
    expect(last.holding).toBe(false);
    expect(last.offTarget).toContain(treePose.targets[2]!.cue);
  });
});
