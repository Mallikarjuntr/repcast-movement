import { describe, expect, it } from 'vitest';
import { RepDetector, squat, type RepResult } from '../src/index.js';
import { figure, motion } from './figure.js';

function run(frames: ReturnType<typeof motion>) {
  const detector = new RepDetector(squat);
  const reps: RepResult[] = [];
  for (const frame of frames) {
    const update = detector.update(frame);
    if (update.rep) reps.push(update.rep);
  }
  return { detector, reps };
}

describe('RepDetector with the squat definition', () => {
  it('measures the knee angle of the synthetic figure', () => {
    const detector = new RepDetector(squat, { smoothing: 1 });
    expect(detector.update(figure(0, { knee: 120 })).metric).toBeCloseTo(120, 0);
  });

  it('counts deep squats and marks them deep enough', () => {
    const { reps } = run(motion([175, 95, 175, 95, 175, 95, 175]));
    expect(reps).toHaveLength(3);
    expect(reps.map((r) => r.count)).toEqual([1, 2, 3]);
    expect(reps.every((r) => r.depthOk === true && r.faults.length === 0)).toBe(true);
  });

  it('counts a shallow squat but flags the depth', () => {
    const { reps } = run(motion([175, 125, 175]));
    expect(reps).toHaveLength(1);
    expect(reps[0]!.depthOk).toBe(false);
    expect(reps[0]!.bottom).toBeGreaterThan(squat.depth!.target);
  });

  it('ignores small wobbles near standing', () => {
    const { reps } = run(motion([175, 150, 172, 148, 175]));
    expect(reps).toHaveLength(0);
  });

  it('waits until the person has stood tall before counting', () => {
    const { reps, detector } = run(motion([100, 95, 175]));
    expect(reps).toHaveLength(0);
    expect(detector.count).toBe(0);
  });

  it('treats very fast dips as noise', () => {
    const { reps } = run(motion([175, 95, 175], 4));
    expect(reps).toHaveLength(0);
  });

  it('keeps counting from the thigh angle when the feet are out of frame', () => {
    const detector = new RepDetector(squat);
    const reps: RepResult[] = [];
    let usedFallback = false;
    for (const frame of motion([175, 95, 175, 95, 175], 15, { hideAnkles: true })) {
      const update = detector.update(frame);
      usedFallback ||= update.usingFallback;
      if (update.rep) reps.push(update.rep);
    }
    expect(usedFallback).toBe(true);
    expect(reps).toHaveLength(2);
  });

  it('flags knees caving in at the bottom', () => {
    const frames = [
      ...motion([175, 95], 15),
      ...motion([95, 95], 3, { kneeWidthRatio: 0.5 }, 15 * 33 + 33),
      ...motion([95, 175], 15, {}, 19 * 33 + 66),
    ];
    const { reps } = run(frames);
    expect(reps).toHaveLength(1);
    expect(reps[0]!.faults.map((f) => f.id)).toContain('knees-caving');
  });

  it('flags the chest dropping forward', () => {
    const { reps } = run(motion([175, 95, 175], 15, { torsoLean: 70 }));
    expect(reps).toHaveLength(1);
    expect(reps[0]!.faults.map((f) => f.id)).toContain('chest-dropping');
  });

  it('reports which required points are hidden', () => {
    const detector = new RepDetector(squat);
    const frame = figure(0, { knee: 175 });
    frame.landmarks[25]!.visibility = 0.1;
    expect(detector.update(frame).missing).toEqual(['leftKnee']);
  });
});
