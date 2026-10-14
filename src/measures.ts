import type { JointName } from './definitions.js';
import { angleFromVertical, bodyPoint, isVisible, jointAngle, midpoint } from './geometry.js';
import { POINTS as POINT_INDEX, SIDES, type PointName, type Side } from './landmarks.js';
import type { PoseFrame } from './types.js';

/** The three points whose middle one is the joint being measured. */
export const JOINT_POINTS: Record<JointName, Record<Side, [PointName, PointName, PointName]>> = {
  knee: { left: ['leftHip', 'leftKnee', 'leftAnkle'], right: ['rightHip', 'rightKnee', 'rightAnkle'] },
  hip: { left: ['leftShoulder', 'leftHip', 'leftKnee'], right: ['rightShoulder', 'rightHip', 'rightKnee'] },
  elbow: { left: ['leftShoulder', 'leftElbow', 'leftWrist'], right: ['rightShoulder', 'rightElbow', 'rightWrist'] },
  shoulder: { left: ['leftHip', 'leftShoulder', 'leftElbow'], right: ['rightHip', 'rightShoulder', 'rightElbow'] },
  body: { left: ['leftShoulder', 'leftHip', 'leftAnkle'], right: ['rightShoulder', 'rightHip', 'rightAnkle'] },
};

/** Angles of a joint on each side where all three points are visible. */
export function jointAngles(frame: PoseFrame, joint: JointName, minVisibility: number): number[] {
  return SIDES.map((side) => JOINT_POINTS[joint][side])
    .filter((pts) => pts.every((p) => isVisible(frame, p, minVisibility)))
    .map(([a, b, c]) => jointAngle(frame, a, b, c));
}

/** Torso tilt from upright in degrees (0 = standing straight, 90 = lying flat), or null if hidden. */
export function torsoTilt(frame: PoseFrame, minVisibility: number): number | null {
  const names: PointName[] = ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'];
  if (!names.every((n) => isVisible(frame, n, minVisibility))) return null;
  const shoulders = midpoint(bodyPoint(frame, 'leftShoulder'), bodyPoint(frame, 'rightShoulder'));
  const hips = midpoint(bodyPoint(frame, 'leftHip'), bodyPoint(frame, 'rightHip'));
  return angleFromVertical(shoulders, hips);
}

/**
 * Standing up: torso within `maxTilt` of vertical and, in the image, shoulders above hips above knees.
 * A person lying down, a ceiling or a blurry frame fails this.
 */
export function isUpright(frame: PoseFrame, maxTilt: number, minVisibility: number): boolean {
  const tilt = torsoTilt(frame, minVisibility);
  if (tilt === null || tilt > maxTilt) return false;
  const y = (n: PointName) => (isVisible(frame, n, minVisibility) ? frame.landmarks[POINT_INDEX[n]]!.y : null);
  const shoulders = avg(y('leftShoulder'), y('rightShoulder'));
  const hips = avg(y('leftHip'), y('rightHip'));
  const knees = avg(y('leftKnee'), y('rightKnee'));
  if (shoulders === null || hips === null) return false;
  return shoulders < hips && (knees === null || hips < knees);
}

/**
 * Foot stance from the knees: in a lunge one knee drops far below the other (back knee to the floor),
 * in a squat both stay level. Measured as the knee height gap over thigh length, in 3D when available.
 */
export function stance(frame: PoseFrame, minVisibility: number): 'square' | 'staggered' | null {
  const names: PointName[] = ['leftHip', 'rightHip', 'leftKnee', 'rightKnee'];
  if (!names.every((n) => isVisible(frame, n, minVisibility))) return null;
  const lk = bodyPoint(frame, 'leftKnee');
  const rk = bodyPoint(frame, 'rightKnee');
  const thigh = (distance3d(bodyPoint(frame, 'leftHip'), lk) + distance3d(bodyPoint(frame, 'rightHip'), rk)) / 2;
  if (thigh === 0) return null;
  return Math.abs(lk.y - rk.y) / thigh > 0.5 ? 'staggered' : 'square';
}

function avg(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return (a + b) / 2;
}

function distance3d(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export type Pick = 'mean' | 'min' | 'max';

export function pick(values: number[], how: Pick = 'mean'): number | null {
  if (values.length === 0) return null;
  if (how === 'min') return Math.min(...values);
  if (how === 'max') return Math.max(...values);
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
