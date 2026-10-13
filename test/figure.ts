import { POINTS } from '../src/landmarks.js';
import type { Landmark, PoseFrame } from '../src/types.js';

export interface FigureOptions {
  /** Hip-knee-ankle angle in degrees (180 = standing straight). */
  knee: number;
  /** Torso tilt from vertical in degrees. */
  torsoLean?: number;
  /** Horizontal knee spacing relative to ankle spacing (1 = knees over ankles). */
  kneeWidthRatio?: number;
  /** Hide the ankles, as when the feet are cut off at the bottom of the frame. */
  hideAnkles?: boolean;
}

const SHIN = 0.2;
const THIGH = 0.2;
const TORSO = 0.25;
const ANKLE_HALF_WIDTH = 0.08;
const DEG = Math.PI / 180;

/** A front-facing stick figure whose shins stay vertical while the thighs fold forward. */
export function figure(t: number, opts: FigureOptions): PoseFrame {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const fold = (180 - opts.knee) * DEG;
  const lean = (opts.torsoLean ?? 10) * DEG;
  const kneeHalf = ANKLE_HALF_WIDTH * (opts.kneeWidthRatio ?? 1);

  const set = (name: keyof typeof POINTS, x: number, y: number, z: number, visibility = 0.99) => {
    landmarks[POINTS[name]] = { x, y, z, visibility };
  };

  for (const [side, sign] of [['left', -1], ['right', 1]] as const) {
    const ankleX = 0.5 + sign * ANKLE_HALF_WIDTH;
    const kneeX = 0.5 + sign * kneeHalf;
    const kneeY = 0.9 - SHIN;
    // The thigh rotates toward the camera (z) and is foreshortened vertically.
    const hipY = kneeY - THIGH * Math.cos(fold);
    const hipZ = -THIGH * Math.sin(fold);
    set(`${side}Ankle`, ankleX, 0.9, 0, opts.hideAnkles ? 0.1 : 0.99);
    set(`${side}Knee`, kneeX, kneeY, 0);
    set(`${side}Hip`, 0.5 + sign * 0.06, hipY, hipZ);
    set(`${side}Shoulder`, 0.5 + sign * 0.1, hipY - TORSO * Math.cos(lean), hipZ - TORSO * Math.sin(lean));
  }

  // World landmarks share the geometry so 3D joint angles are exact.
  return { t, landmarks, world: landmarks.map((p) => ({ ...p })) };
}

/** Frames every 33 ms that move the knee angle through the given waypoints. */
export function motion(waypoints: number[], stepsPerSegment = 15, extra: Omit<FigureOptions, 'knee'> = {}, startT = 0): PoseFrame[] {
  const frames: PoseFrame[] = [];
  let t = startT;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i]!;
    const to = waypoints[i + 1]!;
    for (let s = 0; s < stepsPerSegment; s++) {
      frames.push(figure(t, { ...extra, knee: from + ((to - from) * s) / stepsPerSegment }));
      t += 33;
    }
  }
  frames.push(figure(t, { ...extra, knee: waypoints[waypoints.length - 1]! }));
  return frames;
}
