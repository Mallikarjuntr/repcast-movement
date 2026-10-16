import { describe, expect, it } from 'vitest';
import { POINTS } from '../src/landmarks.js';
import {
  curtsyLunge,
  gluteBridge,
  halfSquat,
  kneePushUp,
  pushUp,
  RepDetector,
  reverseLunge,
  splitSquat,
  stepJack,
  squat,
  sumoSquat,
  type PoseFrame,
  type RepResult,
} from '../src/index.js';
import { figure, motion } from './figure.js';

type Name = keyof typeof POINTS;

function run(detector: RepDetector, frames: PoseFrame[]): RepResult[] {
  return frames.map((f) => detector.update(f).rep).filter((r): r is RepResult => r !== undefined);
}

/** A side-on frame built from image points (head on the left); both sides share the points. */
function sideFrame(t: number, points: Partial<Record<'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle', [number, number]>>): PoseFrame {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  for (const [part, [x, y]] of Object.entries(points)) {
    for (const side of ['left', 'right'] as const) {
      const name = `${side}${part.charAt(0).toUpperCase()}${part.slice(1)}` as Name;
      landmarks[POINTS[name]] = { x, y, z: 0, visibility: 0.99 };
    }
  }
  if (points.shoulder) landmarks[POINTS.nose] = { x: points.shoulder[0] - 0.06, y: points.shoulder[1] - 0.02, z: 0, visibility: 0.99 };
  return { t, landmarks, world: landmarks.map((p) => ({ ...p })) };
}

/**
 * Side view of a push-up at a given elbow angle: hands on the floor under the shoulders, body in one
 * line to the feet. `sag` drops the hips below that line (fraction of the frame).
 */
function pushUpFrame(t: number, elbow: number, sag = 0): PoseFrame {
  const arm = 0.1;
  const wrist: [number, number] = [0.32, 0.7];
  const reach = 2 * arm * Math.sin((elbow * Math.PI) / 360); // shoulder-to-wrist distance
  const shoulder: [number, number] = [0.32, 0.7 - reach];
  const bend = Math.sqrt(Math.max(0, arm * arm - (reach / 2) ** 2));
  const elbowPt: [number, number] = [0.32 + bend, 0.7 - reach / 2];
  const ankle: [number, number] = [0.82, 0.68];
  const lineY = (x: number) => shoulder[1] + ((x - shoulder[0]) / (ankle[0] - shoulder[0])) * (ankle[1] - shoulder[1]);
  return sideFrame(t, { shoulder, elbow: elbowPt, wrist, hip: [0.56, lineY(0.56) + sag], knee: [0.69, lineY(0.69)], ankle });
}

/** Side view of a glute bridge: shoulders and feet on the floor, `lift` 0 (hips down) → 1 (one straight line). */
function bridgeFrame(t: number, lift: number): PoseFrame {
  const shoulder: [number, number] = [0.3, 0.75];
  const knee: [number, number] = [0.55, 0.6];
  const lineAtHip = 0.75 - 0.15 * (0.15 / 0.25);
  return sideFrame(t, { shoulder, hip: [0.45, 0.75 + (lineAtHip - 0.75) * lift], knee, ankle: [0.62, 0.75] });
}

/** Frames every 33 ms through the given values. */
function sweep<T>(values: number[], make: (t: number, v: number) => T, steps = 15): T[] {
  const out: T[] = [];
  let t = 0;
  for (let i = 0; i < values.length - 1; i++) {
    for (let s = 0; s < steps; s++) {
      out.push(make(t, values[i]! + ((values[i + 1]! - values[i]!) * s) / steps));
      t += 33;
    }
  }
  out.push(make(t, values[values.length - 1]!));
  return out;
}

function lungeFrames(): PoseFrame[] {
  return motion([175, 85, 175, 85, 175], 15).map((f, i, all) => {
    const knee = 175 - (175 - 85) * Math.abs(Math.sin((Math.PI * i) / ((all.length - 1) / 2)));
    return figure(f.t, { knee, lungeGap: (1.1 * (175 - knee)) / 90 });
  });
}

describe('half squat', () => {
  it('counts squats that only go halfway', () => {
    const reps = run(new RepDetector(halfSquat), motion([175, 125, 175, 125, 175], 15));
    expect(reps.filter((r) => r.counted)).toHaveLength(2);
  });
});

describe('sumo squat', () => {
  const wide = { feetHalfWidth: 0.2, kneeWidthRatio: 1.05 };

  it('counts deep squats with the knees out over wide feet', () => {
    const reps = run(new RepDetector(sumoSquat), motion([175, 90, 175, 90, 175], 15, wide));
    expect(reps.filter((r) => r.verdict === 'good')).toHaveLength(2);
  });

  it('still counts a wide stance filmed from 45°', () => {
    const reps = run(new RepDetector(sumoSquat), motion([175, 90, 175, 90, 175], 15, { ...wide, turn: 0.7 }));
    expect(reps.filter((r) => r.verdict === 'good')).toHaveLength(2);
  });

  it("doesn't count an ordinary squat stance, and says why", () => {
    const reps = run(new RepDetector(sumoSquat), motion([175, 90, 175], 15, { feetHalfWidth: 0.09 }));
    expect(reps).toHaveLength(1);
    expect(reps[0]!.counted).toBe(false);
    expect(reps[0]!.cues[0]).toMatch(/Feet wider/);
  });

  it("doesn't count an ordinary stance from 45° either", () => {
    const reps = run(new RepDetector(sumoSquat), motion([175, 90, 175], 15, { feetHalfWidth: 0.09, turn: 0.7 }));
    expect(reps[0]!.counted).toBe(false);
  });

  it('counts a slightly narrow stance but asks for wider feet', () => {
    const reps = run(new RepDetector(sumoSquat), motion([175, 90, 175], 15, { feetHalfWidth: 0.14, kneeWidthRatio: 1.05 }));
    expect(reps[0]!.verdict).toBe('fix');
    expect(reps[0]!.cues).toContain('Step your feet a little wider');
  });

  it("can't judge width side-on or with the feet hidden, so it doesn't penalise", () => {
    const sideOn = run(new RepDetector(sumoSquat), motion([175, 90, 175], 15, { feetHalfWidth: 0.09, turn: 0.2 }));
    const noFeet = run(new RepDetector(sumoSquat), motion([175, 90, 175], 15, { feetHalfWidth: 0.09, hideAnkles: true }));
    for (const reps of [sideOn, noFeet]) expect(reps.every((r) => !r.cues.some((c) => /wider/i.test(c)))).toBe(true);
  });

  it('leaves ordinary squats alone', () => {
    const reps = run(new RepDetector(squat), motion([175, 80, 175], 15, { feetHalfWidth: 0.09 }));
    expect(reps[0]!.verdict).toBe('good');
  });
});

describe('lunge variations', () => {
  it.each([reverseLunge, splitSquat, curtsyLunge])('$name counts a staggered stance', (exercise) => {
    const reps = run(new RepDetector(exercise), lungeFrames());
    expect(reps.filter((r) => r.counted)).toHaveLength(2);
  });

  it('says which lunge the set is when someone squats instead', () => {
    const reps = run(new RepDetector(reverseLunge), motion([175, 85, 175], 15));
    expect(reps[0]!.cues[0]).toMatch(/one foot back/i);
  });
});

describe('step jack', () => {
  it('counts arm sweeps like a jumping jack', () => {
    const frames = sweep([10, 170, 10, 170, 10, 170, 10], (t, a) => figure(t, { knee: 178, armRaise: a }), 10);
    expect(run(new RepDetector(stepJack), frames).filter((r) => r.counted)).toHaveLength(3);
  });
});

describe('push-up', () => {
  it('counts full push-ups filmed side-on', () => {
    const reps = run(new RepDetector(pushUp), sweep([170, 85, 170, 85, 170], (t, e) => pushUpFrame(t, e)));
    expect(reps.map((r) => r.verdict)).toEqual(['good', 'good']);
  });

  it("doesn't count a push-up that stops short, and says why", () => {
    const reps = run(new RepDetector(pushUp), sweep([170, 120, 170], (t, e) => pushUpFrame(t, e)));
    expect(reps[0]!.counted).toBe(false);
    expect(reps[0]!.cues[0]).toMatch(/not low enough/i);
  });

  it("doesn't count reps with the hips sagging badly", () => {
    const reps = run(new RepDetector(pushUp), sweep([170, 85, 170], (t, e) => pushUpFrame(t, e, 0.09)));
    expect(reps[0]!.counted).toBe(false);
    expect(reps[0]!.cues[0]).toMatch(/hips sagged/i);
  });

  it('never counts arm bends while standing', () => {
    const frames = sweep([170, 60, 170, 60, 170], (t, e) => {
      // Standing, front view, forearms curling up.
      const frame = figure(t, { knee: 178, armRaise: 0 });
      for (const side of ['left', 'right'] as const) {
        const elbow = frame.landmarks[POINTS[`${side}Elbow`]]!;
        const wrist = { x: elbow.x, y: elbow.y + 0.12 * Math.cos(((180 - e) * Math.PI) / 180), z: -0.12 * Math.sin(((180 - e) * Math.PI) / 180), visibility: 0.99 };
        (frame.landmarks as PoseFrame['landmarks'][number][])[POINTS[`${side}Wrist`]] = wrist;
        (frame.world as PoseFrame['landmarks'][number][])[POINTS[`${side}Wrist`]] = wrist;
      }
      return frame;
    });
    const detector = new RepDetector(pushUp);
    run(detector, frames);
    expect(detector.count).toBe(0);
  });

  it('knee push-ups count without the hip-line checks', () => {
    const reps = run(new RepDetector(kneePushUp), sweep([170, 85, 170], (t, e) => pushUpFrame(t, e, 0.06)));
    expect(reps[0]!.counted).toBe(true);
  });
});

describe('glute bridge', () => {
  it('counts hips lifting into a straight line and back down', () => {
    const reps = run(new RepDetector(gluteBridge), sweep([0, 1, 0, 1, 0], (t, l) => bridgeFrame(t, l)));
    expect(reps.map((r) => r.verdict)).toEqual(['good', 'good']);
  });

  it('asks for more height when the hips only lift partway', () => {
    // About 1.7 s a rep, as people really bridge (a faster flick is ignored as noise).
    const reps = run(new RepDetector(gluteBridge), sweep([0, 0.75, 0], (t, l) => bridgeFrame(t, l), 25));
    expect(reps[0]!.verdict).toBe('fix');
    expect(reps[0]!.cues[0]).toMatch(/hips higher/i);
  });

  it('never counts while standing', () => {
    const detector = new RepDetector(gluteBridge);
    run(detector, motion([175, 90, 175, 90, 175], 15));
    expect(detector.count).toBe(0);
  });
});
