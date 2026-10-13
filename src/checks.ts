import { angleFromVertical, bodyPoint, distance2d, imagePoint, isVisible, midpoint } from './geometry.js';
import type { PointName } from './landmarks.js';
import type { PoseFrame } from './types.js';

/**
 * A form check looks at the frame where the rep was deepest.
 * Returns true for a fault, false for good form, or null when the camera angle can't tell.
 */
type CheckFn = (frame: PoseFrame, params: Readonly<Record<string, number>>, minVisibility: number) => boolean | null;

function allVisible(frame: PoseFrame, names: readonly PointName[], minVisibility: number): boolean {
  return names.every((n) => isVisible(frame, n, minVisibility));
}

/** Knees collapsing inward relative to the ankles. Needs a roughly front-facing view. */
const kneesCaving: CheckFn = (frame, params, minVisibility) => {
  const names: PointName[] = ['leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle', 'leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'];
  if (!allVisible(frame, names, minVisibility)) return null;

  const shoulderWidth = distance2d(imagePoint(frame, 'leftShoulder'), imagePoint(frame, 'rightShoulder'));
  const torsoLength = distance2d(
    midpoint(imagePoint(frame, 'leftShoulder'), imagePoint(frame, 'rightShoulder')),
    midpoint(imagePoint(frame, 'leftHip'), imagePoint(frame, 'rightHip')),
  );
  // Side-on views squash the shoulders together; knee width is meaningless there.
  if (torsoLength === 0 || shoulderWidth / torsoLength < (params.minFrontness ?? 0.35)) return null;

  const kneeWidth = Math.abs(imagePoint(frame, 'leftKnee').x - imagePoint(frame, 'rightKnee').x);
  const ankleWidth = Math.abs(imagePoint(frame, 'leftAnkle').x - imagePoint(frame, 'rightAnkle').x);
  if (ankleWidth < 0.01) return null;
  return kneeWidth / ankleWidth < (params.minRatio ?? 0.75);
};

/** Torso tipping too far forward. Uses 3D points when available, since a forward lean points at a front camera. */
const chestDropping: CheckFn = (frame, params, minVisibility) => {
  if (!allVisible(frame, ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'], minVisibility)) return null;
  const shoulders = midpoint(bodyPoint(frame, 'leftShoulder'), bodyPoint(frame, 'rightShoulder'));
  const hips = midpoint(bodyPoint(frame, 'leftHip'), bodyPoint(frame, 'rightHip'));
  return angleFromVertical(shoulders, hips) > (params.maxTorsoLean ?? 55);
};

/**
 * How far the hips sit below (+) or above (-) the straight shoulder-to-ankle line, as a fraction of
 * that line's length. Needs a side view of a roughly horizontal body; null otherwise.
 */
function hipLineOffset(frame: PoseFrame, minVisibility: number): number | null {
  for (const side of ['left', 'right'] as const) {
    const names: PointName[] = [`${side}Shoulder`, `${side}Hip`, `${side}Ankle`];
    if (!allVisible(frame, names, minVisibility)) continue;
    const s = imagePoint(frame, `${side}Shoulder`);
    const h = imagePoint(frame, `${side}Hip`);
    const a = imagePoint(frame, `${side}Ankle`);
    const length = distance2d(s, a);
    if (length === 0 || Math.abs(a.x - s.x) < length * 0.7) return null; // not horizontal enough
    const lineY = s.y + ((h.x - s.x) / (a.x - s.x)) * (a.y - s.y);
    return (h.y - lineY) / length; // image y grows downward, so positive means sagging
  }
  return null;
}

const hipsSagging: CheckFn = (frame, params, minVisibility) => {
  const offset = hipLineOffset(frame, minVisibility);
  return offset === null ? null : offset > (params.maxOffset ?? 0.06);
};

const hipsPiking: CheckFn = (frame, params, minVisibility) => {
  const offset = hipLineOffset(frame, minVisibility);
  return offset === null ? null : offset < -(params.maxOffset ?? 0.08);
};

/** One hip hitched higher than the other. Needs a roughly front-facing view. */
const hipsUneven: CheckFn = (frame, params, minVisibility) => {
  if (!allVisible(frame, ['leftHip', 'rightHip'], minVisibility)) return null;
  const left = imagePoint(frame, 'leftHip');
  const right = imagePoint(frame, 'rightHip');
  const width = Math.abs(left.x - right.x);
  if (width < 0.02) return null;
  return Math.abs(left.y - right.y) / width > (params.maxTilt ?? 0.25);
};

export const CHECKS = {
  'knees-caving': kneesCaving,
  'chest-dropping': chestDropping,
  'hips-sagging': hipsSagging,
  'hips-piking': hipsPiking,
  'hips-uneven': hipsUneven,
} satisfies Record<string, CheckFn>;

export type CheckId = keyof typeof CHECKS;
