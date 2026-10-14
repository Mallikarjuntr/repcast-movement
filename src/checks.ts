import { angleFromVertical, bodyPoint, distance2d, imagePoint, isVisible, midpoint } from './geometry.js';
import type { PointName } from './landmarks.js';
import type { PoseFrame } from './types.js';

/**
 * A form check measures one thing about a frame (a ratio or an angle), or returns null when the
 * camera angle can't tell. Each exercise decides how much is a fixable fault and how much means
 * the rep doesn't count.
 */
interface Check {
  measure: (frame: PoseFrame, minVisibility: number) => number | null;
  /** Whether larger or smaller measurements are worse. */
  worse: 'above' | 'below';
}

function allVisible(frame: PoseFrame, names: readonly PointName[], minVisibility: number): boolean {
  return names.every((n) => isVisible(frame, n, minVisibility));
}

/** Knee width divided by ankle width; drops below 1 as the knees collapse inward. Needs a front-ish view. */
function kneeWidthRatio(frame: PoseFrame, minVisibility: number): number | null {
  const names: PointName[] = ['leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle', 'leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'];
  if (!allVisible(frame, names, minVisibility)) return null;
  const shoulderWidth = distance2d(imagePoint(frame, 'leftShoulder'), imagePoint(frame, 'rightShoulder'));
  const torsoLength = distance2d(
    midpoint(imagePoint(frame, 'leftShoulder'), imagePoint(frame, 'rightShoulder')),
    midpoint(imagePoint(frame, 'leftHip'), imagePoint(frame, 'rightHip')),
  );
  // Side-on views squash the shoulders together; knee width is meaningless there.
  if (torsoLength === 0 || shoulderWidth / torsoLength < 0.35) return null;
  const kneeWidth = Math.abs(imagePoint(frame, 'leftKnee').x - imagePoint(frame, 'rightKnee').x);
  const ankleWidth = Math.abs(imagePoint(frame, 'leftAnkle').x - imagePoint(frame, 'rightAnkle').x);
  return ankleWidth < 0.01 ? null : kneeWidth / ankleWidth;
}

/** Torso angle from upright in degrees, using 3D points when available (a forward lean points at a front camera). */
function torsoLean(frame: PoseFrame, minVisibility: number): number | null {
  if (!allVisible(frame, ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'], minVisibility)) return null;
  const shoulders = midpoint(bodyPoint(frame, 'leftShoulder'), bodyPoint(frame, 'rightShoulder'));
  const hips = midpoint(bodyPoint(frame, 'leftHip'), bodyPoint(frame, 'rightHip'));
  return angleFromVertical(shoulders, hips);
}

/**
 * How far the hips sit below (+) or above (-) the straight shoulder-to-ankle line, as a fraction of
 * that line's length. Needs a side view of a roughly horizontal body.
 */
function hipLineOffset(frame: PoseFrame, minVisibility: number): number | null {
  for (const side of ['left', 'right'] as const) {
    const names: PointName[] = [`${side}Shoulder`, `${side}Hip`, `${side}Ankle`];
    if (!allVisible(frame, names, minVisibility)) continue;
    const s = imagePoint(frame, `${side}Shoulder`);
    const h = imagePoint(frame, `${side}Hip`);
    const a = imagePoint(frame, `${side}Ankle`);
    const length = distance2d(s, a);
    if (length === 0 || Math.abs(a.x - s.x) < length * 0.7) return null;
    const lineY = s.y + ((h.x - s.x) / (a.x - s.x)) * (a.y - s.y);
    return (h.y - lineY) / length; // image y grows downward, so positive means sagging
  }
  return null;
}

/** One hip hitched higher than the other, relative to hip width. Needs a front-ish view. */
function hipTilt(frame: PoseFrame, minVisibility: number): number | null {
  if (!allVisible(frame, ['leftHip', 'rightHip'], minVisibility)) return null;
  const left = imagePoint(frame, 'leftHip');
  const right = imagePoint(frame, 'rightHip');
  const width = Math.abs(left.x - right.x);
  return width < 0.02 ? null : Math.abs(left.y - right.y) / width;
}

export const CHECKS = {
  'knees-caving': { measure: kneeWidthRatio, worse: 'below' },
  'chest-dropping': { measure: torsoLean, worse: 'above' },
  'hips-sagging': { measure: hipLineOffset, worse: 'above' },
  'hips-piking': { measure: (f, v) => { const o = hipLineOffset(f, v); return o === null ? null : -o; }, worse: 'above' },
  'hips-uneven': { measure: hipTilt, worse: 'above' },
} satisfies Record<string, Check>;

export type CheckId = keyof typeof CHECKS;

export type Severity = 'fix' | 'fail';

/** Grades one check against an exercise's thresholds: null = fine or can't tell. */
export function gradeCheck(id: CheckId, frame: PoseFrame, warn: number, fail: number | undefined, minVisibility: number): Severity | null {
  const check: Check = CHECKS[id];
  const value = check.measure(frame, minVisibility);
  if (value === null) return null;
  const beyond = (limit: number) => (check.worse === 'above' ? value > limit : value < limit);
  if (fail !== undefined && beyond(fail)) return 'fail';
  return beyond(warn) ? 'fix' : null;
}
