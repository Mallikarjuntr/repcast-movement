import { describe, expect, it } from 'vitest';
import { RepDetector, squat, type PoseFrame, type RepResult } from '../src/index.js';
import { figure, motion, type FigureOptions } from './figure.js';

function run(frames: PoseFrame[], detector = new RepDetector(squat)) {
  const reps: RepResult[] = [];
  for (const frame of frames) {
    const update = detector.update(frame);
    if (update.rep) reps.push(update.rep);
  }
  return { detector, reps };
}

/** One squat down to `bottom` and back, with options that ramp in with depth (0 standing .. 1 at the bottom). */
function squatRep(bottom: number, startT: number, atDepth: (d: number) => Omit<FigureOptions, 'knee'> = () => ({})): PoseFrame[] {
  const frames: PoseFrame[] = [];
  for (let i = 0; i <= 40; i++) {
    const d = i <= 20 ? i / 20 : (40 - i) / 20;
    frames.push(figure(startT + i * 40, { knee: 175 - (175 - bottom) * d, ...atDepth(d) }));
  }
  return frames;
}

function stand(startT: number, n = 10): PoseFrame[] {
  return Array.from({ length: n }, (_, i) => figure(startT + i * 40, { knee: 175 }));
}

describe('RepDetector with the squat definition', () => {
  it('measures the knee angle of the synthetic figure', () => {
    const detector = new RepDetector(squat, { smoothing: 1 });
    expect(detector.update(figure(0, { knee: 120 })).metric).toBeCloseTo(120, 0);
  });

  it('counts deep, clean squats as good reps', () => {
    const { reps, detector } = run([...stand(0), ...squatRep(65, 400), ...squatRep(60, 2100), ...squatRep(70, 3800)]);
    expect(reps.map((r) => r.verdict)).toEqual(['good', 'good', 'good']);
    expect(detector.count).toBe(3);
  });

  it('counts a slightly shallow squat but asks for more depth', () => {
    const [rep] = run([...stand(0), ...squatRep(110, 400)]).reps;
    expect(rep).toMatchObject({ counted: true, verdict: 'fix', depthOk: false });
    expect(rep!.cues[0]).toMatch(/lower/i);
  });

  it("doesn't count a half squat, and says why", () => {
    const { reps, detector } = run([...stand(0), ...squatRep(125, 400)]);
    expect(reps[0]).toMatchObject({ counted: false, verdict: 'no-rep' });
    expect(reps[0]!.cues[0]).toMatch(/not deep enough/i);
    expect(detector.count).toBe(0);
  });

  it("learns a person's own standing posture when their knees never fully straighten", () => {
    const soft: PoseFrame[] = Array.from({ length: 15 }, (_, i) => figure(i * 40, { knee: 154 }));
    for (const [n, start] of [[1, 600], [2, 2400], [3, 4200]] as const) {
      for (let i = 0; i <= 40; i++) {
        const d = i <= 20 ? i / 20 : (40 - i) / 20;
        soft.push(figure(start + i * 40, { knee: 154 - (154 - 70) * d }));
      }
      void n;
    }
    const { detector } = run(soft);
    expect(detector.count).toBe(3);
  });

  it('ignores small wobbles near standing', () => {
    expect(run(motion([175, 150, 172, 148, 175])).reps).toHaveLength(0);
  });

  it('waits until the person has stood tall before counting', () => {
    expect(run(motion([100, 95, 175])).reps).toHaveLength(0);
  });

  it('treats very fast dips as noise', () => {
    expect(run(motion([175, 70, 175], 4)).reps).toHaveLength(0);
  });

  it('keeps counting from the thigh angle when the feet are out of frame', () => {
    const detector = new RepDetector(squat);
    let usedFallback = false;
    let counted = 0;
    for (const frame of motion([175, 75, 175, 75, 175], 15, { hideAnkles: true })) {
      const update = detector.update(frame);
      usedFallback ||= update.usingFallback;
      if (update.rep?.counted) counted++;
    }
    expect(usedFallback).toBe(true);
    expect(counted).toBe(2);
  });

  it('asks to push the knees out when they drift in a little', () => {
    const [rep] = run([...stand(0), ...squatRep(65, 400, (d) => ({ kneeWidthRatio: 1 - 0.32 * d }))]).reps;
    expect(rep).toMatchObject({ counted: true, verdict: 'fix' });
    expect(rep!.faults.map((f) => [f.id, f.severity])).toContainEqual(['knees-caving', 'fix']);
  });

  it("doesn't count a rep where the knees cave in badly", () => {
    const [rep] = run([...stand(0), ...squatRep(65, 400, (d) => ({ kneeWidthRatio: 1 - 0.5 * d }))]).reps;
    expect(rep).toMatchObject({ counted: false, verdict: 'no-rep' });
    expect(rep!.cues[0]).toMatch(/knees caved/i);
  });

  it('flags a forward lean, and rejects a big one', () => {
    const lean = (deg: number) => (d: number) => ({ torsoLean: 10 + (deg - 10) * d });
    const { reps } = run([...stand(0), ...squatRep(65, 400, lean(62)), ...squatRep(65, 2100, lean(80))]);
    expect(reps.map((r) => r.verdict)).toEqual(['fix', 'no-rep']);
    expect(reps[1]!.cues[0]).toMatch(/chest dropped/i);
  });

  it('reports which required points are hidden', () => {
    const frame = figure(0, { knee: 175 });
    frame.landmarks[25]!.visibility = 0.1;
    expect(new RepDetector(squat).update(frame).missing).toEqual(['leftKnee']);
  });
});

describe('the honest spotter: things that must not count', () => {
  it('never counts a person lying down, however the knees move', () => {
    const lying = motion([175, 70, 175, 70, 175, 70, 175], 15, { lying: true });
    expect(run(lying).reps).toHaveLength(0);
  });

  it("doesn't count a camera shake that fakes a knee bend", () => {
    // Standing still while the phone shakes: the image jumps and the pose estimate glitches.
    const frames: PoseFrame[] = [...stand(0)];
    for (let i = 0; i <= 30; i++) {
      const glitch = i > 5 && i < 25;
      frames.push(figure(400 + i * 40, { knee: glitch ? 90 : 175, shiftY: glitch ? 0.12 * Math.sin(i) : 0 }));
    }
    frames.push(...stand(1700));
    const { reps, detector } = run(frames);
    expect(detector.count).toBe(0);
    for (const rep of reps) expect(rep.cues[0]).toMatch(/camera moved/i);
  });

  it("doesn't count lunges during a squat set", () => {
    const { reps, detector } = run([...stand(0), ...squatRep(80, 400, (d) => ({ lungeGap: 1.1 * d }))]);
    expect(detector.count).toBe(0);
    expect(reps[0]!.cues[0]).toMatch(/lunge/i);
  });

  it('ignores a "rep" that takes far too long', () => {
    const slow: PoseFrame[] = [...stand(0)];
    for (let i = 0; i <= 40; i++) {
      const d = i <= 20 ? i / 20 : (40 - i) / 20;
      slow.push(figure(400 + i * 250, { knee: 175 - 110 * d }));
    }
    expect(run(slow).reps).toHaveLength(0);
  });
});
