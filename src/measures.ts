import type { JointName } from './definitions.js';
import { angleFromVertical, bodyPoint, imagePoint, isVisible, jointAngle, midpoint } from './geometry.js';
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
 * Lying down (push-ups, bridges): the shoulder-to-hip line, on whichever side is visible, at least
 * `minTilt` degrees from vertical in the image. Uses image points: side-on, the 3D estimate is unreliable.
 */
export function isLying(frame: PoseFrame, minTilt: number, minVisibility: number): boolean {
  for (const side of SIDES) {
    const shoulder: PointName = `${side}Shoulder`;
    const hip: PointName = `${side}Hip`;
    if (!isVisible(frame, shoulder, minVisibility) || !isVisible(frame, hip, minVisibility)) continue;
    return angleFromVertical(imagePoint(frame, shoulder), imagePoint(frame, hip)) >= minTilt;
  }
  return false;
}

/**
 * Knee height gap over standing torso length above which the stance is a lunge, when both legs can be
 * seen. Measured at the bottom of reps (2026-10-17, replay bench): squats, half and sumo squats from the
 * front, 45° and the side, real and rendered, stay at or under 0.3 in 94–100% of frames (median
 * 0.02–0.06); real lunges are over 0.3 in ~60%, and a lunge facing the camera measured 0.39–0.54,
 * which the old single cut-off of 0.55 called a squat.
 */
export const STAGGERED_KNEE_GAP = 0.3;
/**
 * The same, seen side-on, where the pose model can misplace the hidden leg: side-on squats never went
 * over 0.45, side-on lunges did in 44–57% of bottom frames.
 */
export const STAGGERED_KNEE_GAP_SIDE_ON = 0.45;

/**
 * Foot stance from the knees: in a lunge the back knee drops towards the floor, far below the front
 * knee; in a squat both stay level. Measured in the image as the knee height gap over the person's
 * standing torso length, which works from front and side views alike (the 3D estimate is unreliable
 * from the side, where one leg hides the other).
 */
export function stance(frame: PoseFrame, minVisibility: number, standingTorso: number): 'square' | 'staggered' | null {
  if (standingTorso <= 0 || !isVisible(frame, 'leftKnee', minVisibility) || !isVisible(frame, 'rightKnee', minVisibility)) return null;
  const gap = Math.abs(frame.landmarks[POINT_INDEX.leftKnee]!.y - frame.landmarks[POINT_INDEX.rightKnee]!.y);
  // A big gap means a lunge from any angle. A small one only means "square" when both legs can be
  // seen: from the side the pose model often stacks the hidden leg on the visible one.
  const legsSeen = isSideOn(frame, minVisibility) === false;
  if (gap / standingTorso > (legsSeen ? STAGGERED_KNEE_GAP : STAGGERED_KNEE_GAP_SIDE_ON)) return 'staggered';
  return legsSeen ? 'square' : null;
}

/**
 * How wide the feet are: the ankle-to-ankle span over the shoulder span, both in the image. Both
 * run across the body, so turning the camera (up to the recommended 45°) shrinks them alike and the
 * ratio holds: about 0.8–1.2 for an ordinary squat stance, 2 or more for a sumo stance. Null when
 * the ankles or shoulders are hidden, or side-on, where the legs overlap and can't be told apart.
 */
export function stanceWidth(frame: PoseFrame, minVisibility: number): number | null {
  const names: PointName[] = ['leftShoulder', 'rightShoulder', 'leftAnkle', 'rightAnkle'];
  if (!names.every((n) => isVisible(frame, n, minVisibility))) return null;
  if (isSideOn(frame, minVisibility) !== false) return null;
  const span = (a: PointName, b: PointName) => {
    const pa = imagePoint(frame, a);
    const pb = imagePoint(frame, b);
    return Math.hypot(pa.x - pb.x, pa.y - pb.y);
  };
  const shoulders = span('leftShoulder', 'rightShoulder');
  return shoulders > 0 ? span('leftAnkle', 'rightAnkle') / shoulders : null;
}

/**
 * Shoulder width over torso length below which the camera sees the person side-on. Facing the camera
 * is about 0.8–1.0; the recommended 45° placement about 0.55–0.65; side-on 0.1–0.3.
 */
export const SIDE_ON_RATIO = 0.45;

/**
 * True when the camera sees the person from the side, so one leg hides the other; null when the
 * shoulders and hips aren't visible enough to tell.
 */
export function isSideOn(frame: PoseFrame, minVisibility: number): boolean | null {
  const names: PointName[] = ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'];
  if (!names.every((n) => isVisible(frame, n, minVisibility))) return null;
  const p = (n: PointName) => frame.landmarks[POINT_INDEX[n]]!;
  const aspect = frame.aspect ?? 1;
  const shoulderWidth = Math.hypot((p('leftShoulder').x - p('rightShoulder').x) * aspect, p('leftShoulder').y - p('rightShoulder').y);
  const midX = (a: PointName, b: PointName) => ((p(a).x + p(b).x) / 2) * aspect;
  const midY = (a: PointName, b: PointName) => (p(a).y + p(b).y) / 2;
  const torso = Math.hypot(midX('leftShoulder', 'rightShoulder') - midX('leftHip', 'rightHip'), midY('leftShoulder', 'rightShoulder') - midY('leftHip', 'rightHip'));
  return torso > 0 ? shoulderWidth / torso < SIDE_ON_RATIO : null;
}

function avg(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return (a + b) / 2;
}


export type Pick = 'mean' | 'min' | 'max';

export function pick(values: number[], how: Pick = 'mean'): number | null {
  if (values.length === 0) return null;
  if (how === 'min') return Math.min(...values);
  if (how === 'max') return Math.max(...values);
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
