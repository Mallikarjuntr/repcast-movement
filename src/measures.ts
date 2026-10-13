import type { JointName } from './definitions.js';
import { angleFromVertical, bodyPoint, isVisible, jointAngle, midpoint } from './geometry.js';
import { SIDES, type PointName, type Side } from './landmarks.js';
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

export type Pick = 'mean' | 'min' | 'max';

export function pick(values: number[], how: Pick = 'mean'): number | null {
  if (values.length === 0) return null;
  if (how === 'min') return Math.min(...values);
  if (how === 'max') return Math.max(...values);
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
