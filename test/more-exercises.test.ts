import { describe, expect, it } from 'vitest';
import { POINTS } from '../src/landmarks.js';
import {
  curtsyLunge,
  gluteBridge,
  halfSquat,
  jumpingJack,
  kneePushUp,
  lunge,
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
  it("counts when the person's straight legs only read about 152° (side-on), learning their standing angle", () => {
    const reps = run(new RepDetector(halfSquat), motion([152, 152, 115, 152, 115, 152, 115, 152], 15));
    expect(reps.filter((r) => r.counted)).toHaveLength(3);
  });

  it('still ignores small wobbles when the standing angle is learned that low', () => {
    const reps = run(new RepDetector(halfSquat), motion([152, 152, 145, 152, 144, 152, 146, 152], 15));
    expect(reps).toHaveLength(0);
  });

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

/**
 * Two reps of a lunge-family move facing the camera, with the feet doing what the move does:
 * forward (left foot steps towards the camera), back (right foot steps away), across (right foot
 * steps away and behind the left), split (feet stay one forward, one back), or squat (feet stay side
 * by side). The back knee drops towards the floor in all but the squat.
 */
function lungeMove(kind: 'forward' | 'back' | 'across' | 'split' | 'squat'): PoseFrame[] {
  // Stand, two reps with a moment standing between them (as people do), stand.
  const knees = [175, 175, 175, 175, 175, 175, 175, 175];
  for (let rep = 0; rep < 2; rep++) {
    for (let i = 1; i <= 30; i++) knees.push(175 - 90 * Math.sin((Math.PI * i) / 30));
    knees.push(175, 175, 175, 175, 175, 175, 175, 175);
  }
  return knees.map((knee, i) => {
    const t = i * 33;
    if (kind === 'squat') return figure(t, { knee });
    const drop = (1.1 * (175 - knee)) / 90;
    const step = 0.16 * Math.min(1, (175 - knee) / 30);
    const plant = -drop * 0.2; // lungeGap lowers the back ankle with its knee; undo that
    const shift: Record<typeof kind, { left?: [number, number]; right?: [number, number] }> = {
      forward: { left: [0, step], right: [0, plant] },
      back: { right: [0, plant - step] },
      across: { right: [-0.2 * Math.min(1, (175 - knee) / 30), plant - step] },
      split: { left: [0, 0.1], right: [0, plant - 0.1] },
    };
    return figure(t, { knee, lungeGap: drop, ankleShift: shift[kind] });
  });
}

describe('lunge variations', () => {
  it.each([
    [lunge, 'forward'],
    [reverseLunge, 'back'],
    [reverseLunge, 'across'],
    [splitSquat, 'split'],
    [curtsyLunge, 'across'],
    [squat, 'squat'],
  ] as const)('$name counts its own footwork (%s)', (exercise, kind) => {
    const reps = run(new RepDetector(exercise), lungeMove(kind));
    expect(reps.map((r) => r.verdict)).toEqual(['good', 'good']);
  });

  it.each([
    [lunge, 'back', /not back — that was a reverse lunge/i],
    [lunge, 'split', /that was a split squat/i],
    [reverseLunge, 'forward', /not forward — that was a forward lunge/i],
    [splitSquat, 'forward', /keep your feet where they are/i],
    [splitSquat, 'back', /keep your feet where they are/i],
    [curtsyLunge, 'back', /cross your back foot behind/i],
    [curtsyLunge, 'forward', /not forward/i],
    [squat, 'forward', /that's a lunge/i],
    [squat, 'split', /that's a lunge/i],
  ] as const)('%s: refuses a %s lunge and says which move it was', (exercise, kind, cue) => {
    const reps = run(new RepDetector(exercise), lungeMove(kind));
    expect(reps.map((r) => r.counted)).toEqual([false, false]);
    expect(reps[0]!.cues[0]).toMatch(cue);
  });

  it('says which lunge the set is when someone squats instead', () => {
    const reps = run(new RepDetector(reverseLunge), motion([175, 85, 175], 15));
    expect(reps[0]!.cues[0]).toMatch(/one foot back/i);
  });
});

describe('jumping feet', () => {
  // Found on a real phone (2026-10-17): every jumping jack was rejected as "the camera moved",
  // because the feet jumping apart looked like the whole picture shifting.
  // The feet land wide (well past the shoulders) as soon as the arms start to rise, as in a real jack.
  const jacks = (t: number, a: number) => figure(t, { knee: 178, armRaise: a, feetHalfWidth: a > 40 ? 0.24 : 0.08 });
  // A step jack: only the left foot steps out to the side.
  const stepJacks = (t: number, a: number) => figure(t, { knee: 178, armRaise: a, ankleShift: { left: [a > 40 ? -0.16 : 0, 0] } });

  it('counts jumping jacks whose feet jump apart and back', () => {
    const reps = run(new RepDetector(jumpingJack), sweep([10, 170, 10, 170, 10, 170, 10], jacks, 10));
    expect(reps.filter((r) => r.counted)).toHaveLength(3);
    expect(reps.flatMap((r) => r.cues).join(' ')).not.toMatch(/camera moved/i);
  });

  it('counts step jacks whose foot steps out and back', () => {
    const reps = run(new RepDetector(stepJack), sweep([10, 170, 10, 170, 10, 170, 10], stepJacks, 15));
    expect(reps.filter((r) => r.counted)).toHaveLength(3);
  });

  it('tells jumping jacks and step jacks apart', () => {
    const asStep = run(new RepDetector(stepJack), sweep([10, 170, 10, 170, 10], jacks, 15));
    expect(asStep.map((r) => r.counted)).toEqual([false, false]);
    expect(asStep[0]!.cues[0]).toMatch(/one foot at a time/i);
    const asJump = run(new RepDetector(jumpingJack), sweep([10, 170, 10, 170, 10], stepJacks, 10));
    expect(asJump.map((r) => r.counted)).toEqual([false, false]);
    expect(asJump[0]!.cues[0]).toMatch(/both feet/i);
  });
});

describe('step jack', () => {
  it("doesn't count arm sweeps when no foot steps out", () => {
    const frames = sweep([10, 170, 10, 170, 10, 170, 10], (t, a) => figure(t, { knee: 178, armRaise: a }), 10);
    const reps = run(new RepDetector(stepJack), frames);
    expect(reps.filter((r) => r.counted)).toHaveLength(0);
    expect(reps[0]!.cues[0]).toMatch(/step one foot out/i);
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
