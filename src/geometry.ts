import { POINTS, type PointName } from './landmarks.js';
import type { Landmark, PoseFrame } from './types.js';

export const DEFAULT_MIN_VISIBILITY = 0.5;

interface Vec {
  x: number;
  y: number;
  z: number;
}

const RAD_TO_DEG = 180 / Math.PI;

export function point(frame: PoseFrame, name: PointName): Landmark | undefined {
  return frame.landmarks[POINTS[name]];
}

/**
 * A point the camera can see: confident enough, and inside the picture. The pose model also guesses
 * points beyond the frame edge, sometimes with fair confidence (feet below a close phone scored
 * 0.5–0.7); judging feet from such guesses called squats lunges and blamed the phone for moving.
 */
export function isVisible(frame: PoseFrame, name: PointName, minVisibility = DEFAULT_MIN_VISIBILITY): boolean {
  const p = point(frame, name);
  return p !== undefined && (p.visibility ?? 1) >= minVisibility && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}

/** Image-space position with x scaled by the aspect ratio, so distances are in a uniform unit. */
export function imagePoint(frame: PoseFrame, name: PointName): Vec {
  const p = point(frame, name);
  if (!p) throw new Error(`Missing landmark ${name}`);
  return { x: p.x * (frame.aspect ?? 1), y: p.y, z: 0 };
}

/** Prefers metric world coordinates (view-independent), falling back to image space. */
export function bodyPoint(frame: PoseFrame, name: PointName): Vec {
  const w = frame.world?.[POINTS[name]];
  return w ?? imagePoint(frame, name);
}

function angleBetween(u: Vec, v: Vec): number {
  const dot = u.x * v.x + u.y * v.y + u.z * v.z;
  const len = Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z);
  if (len === 0) return 0;
  return Math.acos(Math.min(1, Math.max(-1, dot / len))) * RAD_TO_DEG;
}

/** Interior angle at `b` formed by a-b-c, in degrees (180 = straight). */
export function jointAngle(frame: PoseFrame, a: PointName, b: PointName, c: PointName): number {
  const pa = bodyPoint(frame, a);
  const pb = bodyPoint(frame, b);
  const pc = bodyPoint(frame, c);
  return angleBetween(
    { x: pa.x - pb.x, y: pa.y - pb.y, z: pa.z - pb.z },
    { x: pc.x - pb.x, y: pc.y - pb.y, z: pc.z - pb.z },
  );
}

/** Angle in degrees between the segment from→to and straight down (0 = pointing down; y grows downward). */
export function angleFromVertical(from: Vec, to: Vec): number {
  return angleBetween({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }, { x: 0, y: 1, z: 0 });
}

export function midpoint(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

export function distance2d(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
