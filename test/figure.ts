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
  /** Arms raised sideways from the body, in degrees (0 = arms down, 180 = straight up). Omit to hide the arms. */
  armRaise?: number;
  /** Lunge stance: drop the right knee by this fraction of thigh length (back knee towards the floor). */
  lungeGap?: number;
  /** Camera shake: shift the whole image up/down by this much (world points unaffected). */
  shiftY?: number;
  /** Person lying on their side: rotate the whole body 90°. */
  lying?: boolean;
  /** Half the distance between the ankles (default 0.08; the shoulders are 0.1 either side). */
  feetHalfWidth?: number;
  /** Camera turned away from facing: shrinks every sideways distance in the image (0.7 ≈ 45°, 0.2 ≈ side-on). */
  turn?: number;
}

const SHIN = 0.2;
const THIGH = 0.2;
const TORSO = 0.25;
const ANKLE_HALF_WIDTH = 0.08;
const HIP_HALF_WIDTH = 0.06;
const DEG = Math.PI / 180;

/** A front-facing stick figure whose shins stay vertical while the thighs fold forward. */
export function figure(t: number, opts: FigureOptions): PoseFrame {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const fold = (180 - opts.knee) * DEG;
  const lean = (opts.torsoLean ?? 10) * DEG;
  const feetHalf = opts.feetHalfWidth ?? ANKLE_HALF_WIDTH;
  // With a chosen foot width the legs stand straight (knees on the hip-to-ankle line) and the knees
  // move out over the toes as the squat deepens, as in a real wide stance. Otherwise shins stay vertical.
  const depth = Math.min(1, fold / (90 * DEG));
  const standingKnee = (feetHalf + HIP_HALF_WIDTH) / 2;
  const kneeHalf =
    opts.feetHalfWidth === undefined
      ? feetHalf * (opts.kneeWidthRatio ?? 1)
      : standingKnee + (feetHalf * (opts.kneeWidthRatio ?? 1) - standingKnee) * depth;

  const set = (name: keyof typeof POINTS, x: number, y: number, z: number, visibility = 0.99) => {
    landmarks[POINTS[name]] = { x, y, z, visibility };
  };

  for (const [side, sign] of [['left', -1], ['right', 1]] as const) {
    const ankleX = 0.5 + sign * feetHalf;
    const kneeX = 0.5 + sign * kneeHalf;
    const kneeY = 0.9 - SHIN;
    // The thigh rotates toward the camera (z) and is foreshortened vertically.
    const hipY = kneeY - THIGH * Math.cos(fold);
    const hipZ = -THIGH * Math.sin(fold);
    set(`${side}Ankle`, ankleX, 0.9, 0, opts.hideAnkles ? 0.1 : 0.99);
    set(`${side}Knee`, kneeX, kneeY, 0);
    set(`${side}Hip`, 0.5 + sign * HIP_HALF_WIDTH, hipY, hipZ);
    const shoulderX = 0.5 + sign * 0.1;
    const shoulderY = hipY - TORSO * Math.cos(lean);
    set(`${side}Shoulder`, shoulderX, shoulderY, hipZ - TORSO * Math.sin(lean));
    if (opts.armRaise !== undefined) {
      const raise = opts.armRaise * DEG;
      set(`${side}Elbow`, shoulderX + sign * 0.15 * Math.sin(raise), shoulderY + 0.15 * Math.cos(raise), hipZ - TORSO * Math.sin(lean));
    }
  }

  if (opts.lungeGap) {
    for (const name of ['rightKnee', 'rightAnkle'] as const) {
      const p = landmarks[POINTS[name]]!;
      landmarks[POINTS[name]] = { ...p, y: p.y + opts.lungeGap * THIGH };
    }
  }
  if (opts.turn !== undefined) {
    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i]!;
      landmarks[i] = { ...p, x: 0.5 + (p.x - 0.5) * opts.turn };
    }
  }
  if (opts.lying) {
    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i]!;
      landmarks[i] = { ...p, x: 0.5 + (p.y - 0.5), y: 0.5 - (p.x - 0.5) };
    }
  }
  // World landmarks share the geometry so 3D joint angles are exact.
  const world = landmarks.map((p) => ({ ...p }));
  const image = opts.shiftY ? landmarks.map((p) => ({ ...p, y: p.y + opts.shiftY! })) : landmarks;
  return { t, landmarks: image, world };
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
