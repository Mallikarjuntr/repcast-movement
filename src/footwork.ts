import { imagePoint, isVisible } from './geometry.js';
import { isSideOn } from './measures.js';
import type { PointName, Side } from './landmarks.js';
import type { PoseFrame } from './types.js';

interface Point {
  x: number;
  y: number;
}

/** Where the feet stood at the start of a rep, and which way the person faces. */
export interface FeetAnchor {
  feet: [Point, Point];
  /** How far one foot already stood in front of the other (split stance), over leg length. */
  split: number;
  /** Unit vector of the person's forward direction in the image (heel to toe). */
  forward: Point;
  /** Hip-to-ankle length in the image: the ruler. */
  leg: number;
  /** Whether the camera sees the person from the front or at an angle (sideways movement is visible). */
  frontish: boolean;
}

/** What the feet did by one frame of a rep, relative to the anchor. Distances are over leg length. */
export interface FeetFrame {
  /** How far the foot that moved most has gone. */
  step: number;
  /** How far the other foot has gone. */
  still: number;
  /**
   * Whether the moving foot became the front foot: the still leg's knee height minus the moving
   * leg's, over leg length. At the bottom of any lunge the front knee is up near hip height and the
   * back knee down near the floor, from any camera angle: + the moving foot is in front (forward
   * lunge), − it is behind (reverse or curtsy). 0 when the knees can't both be seen.
   */
  ahead: number;
  /**
   * Sideways gap between the moving and the still foot, over the gap they started with: about 1 for
   * an ordinary lunge, near or below 0 when the moving foot crossed behind (curtsy). Null side-on or
   * when the feet started too close together to tell.
   */
  across: number | null;
  /** How far each foot moved outward, away from the body's middle (jacks): [smaller, larger]. Null side-on. */
  out: [number, number] | null;
}

const SIDES: readonly Side[] = ['left', 'right'];
/**
 * Heel-to-toe length over leg length below which the feet point at the camera and their direction
 * can't be read: then forward is taken as towards the camera, which is down the image for a phone at
 * hip height (nearer floor points sit lower in the picture).
 */
const FORESHORTENED_FOOT = 0.12;
/** Feet closer sideways than this (over leg length) at the start can't show a cross-over. */
const MIN_SIDE_GAP = 0.05;

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const len = (a: Point) => Math.hypot(a.x, a.y);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * The feet's starting position from standing frames (medians, so one jittery frame can't skew it).
 * People step out before they bend, and those straight-legged frames look like standing too, so
 * only the half of the frames with the feet closest together are used.
 */
export function feetAnchor(standing: readonly PoseFrame[], minVisibility: number): FeetAnchor | null {
  const gap = (f: PoseFrame) => len(sub(imagePoint(f, 'leftAnkle'), imagePoint(f, 'rightAnkle')));
  const seenBoth = standing.filter((f) => isVisible(f, 'leftAnkle', minVisibility) && isVisible(f, 'rightAnkle', minVisibility));
  const frames = [...seenBoth].sort((a, b) => gap(a) - gap(b)).slice(0, Math.max(3, Math.ceil(seenBoth.length / 2)));
  const ankles: [Point[], Point[]] = [[], []];
  const toes: [Point[], Point[]] = [[], []];
  const legs: number[] = [];
  let frontish = 0;
  let sideOn = 0;
  let facing = 0;
  for (const frame of frames) {
    const seen = (n: PointName) => isVisible(frame, n, minVisibility);
    if (!seen('leftAnkle') || !seen('rightAnkle')) continue;
    SIDES.forEach((side, i) => {
      const ankle = imagePoint(frame, `${side}Ankle`);
      ankles[i]!.push(ankle);
      if (seen(`${side}Heel`) && seen(`${side}Toe`)) toes[i]!.push(sub(imagePoint(frame, `${side}Toe`), imagePoint(frame, `${side}Heel`)));
      if (seen(`${side}Hip`)) legs.push(len(sub(ankle, imagePoint(frame, `${side}Hip`))));
    });
    const view = isSideOn(frame, minVisibility);
    if (view === false) frontish++;
    else if (view === true) sideOn++;
    // Facing the camera, the person's left shoulder is on the right of the (unmirrored) picture.
    if (seen('leftShoulder') && seen('rightShoulder')) facing += Math.sign(imagePoint(frame, 'leftShoulder').x - imagePoint(frame, 'rightShoulder').x);
  }
  if (ankles[0].length === 0 || legs.length === 0) return null;
  const leg = median(legs);
  const at = (pts: Point[]): Point => ({ x: median(pts.map((p) => p.x)), y: median(pts.map((p) => p.y)) });
  // Both feet averaged: toes turned out (squats, and sumo squats far more) point apart, and either
  // foot alone would make the sideways gap between the feet read as one foot ahead of the other.
  const eachFoot = toes.filter((t) => t.length > 0).map(at);
  const toe = eachFoot.length ? { x: eachFoot.reduce((n, p) => n + p.x, 0) / eachFoot.length, y: eachFoot.reduce((n, p) => n + p.y, 0) / eachFoot.length } : { x: 0, y: 0 };
  // Seen from behind, forward is away from the camera: up the picture.
  const forward = len(toe) / leg >= FORESHORTENED_FOOT ? { x: toe.x / len(toe), y: toe.y / len(toe) } : { x: 0, y: facing < 0 ? -1 : 1 };
  const feet: [Point, Point] = [at(ankles[0]), at(ankles[1])];
  return { feet, split: Math.abs(dot(sub(feet[0], feet[1]), forward)) / leg, forward, leg, frontish: frontish > sideOn };
}

/** What the feet did by this frame. Null when the ankles aren't both visible. */
export function feetFrame(anchor: FeetAnchor, frame: PoseFrame, minVisibility: number): FeetFrame | null {
  if (!isVisible(frame, 'leftAnkle', minVisibility) || !isVisible(frame, 'rightAnkle', minVisibility) || anchor.leg <= 0) return null;
  const now: [Point, Point] = [imagePoint(frame, 'leftAnkle'), imagePoint(frame, 'rightAnkle')];
  const [a0, a1] = anchor.feet;
  // Facing the camera the pose model sometimes swaps left and right: pair each foot with the
  // starting position that makes the least total movement.
  const straight = len(sub(now[0], a0)) + len(sub(now[1], a1));
  const swapped = len(sub(now[0], a1)) + len(sub(now[1], a0));
  const pairs: [Point, Point][] = straight <= swapped ? [[a0, now[0]], [a1, now[1]]] : [[a0, now[1]], [a1, now[0]]];
  /** Which side's ankle (left = 0) each pair's current foot is. */
  const sideOf = straight <= swapped ? [0, 1] : [1, 0];
  const moves = pairs.map(([from, to]) => len(sub(to, from)) / anchor.leg);
  const m = moves[0]! >= moves[1]! ? 0 : 1;
  const knee = (i: number) => {
    const name = i === 0 ? 'leftKnee' : 'rightKnee';
    return isVisible(frame, name, minVisibility) ? imagePoint(frame, name).y : null;
  };
  const moveKnee = knee(sideOf[m]!);
  const stillKnee = knee(sideOf[1 - m]!);
  const [moveFrom, moveTo] = pairs[m]!;
  const [stillFrom, stillTo] = pairs[1 - m]!;
  const side: Point = { x: anchor.forward.y, y: -anchor.forward.x };
  const startGap = dot(sub(moveFrom, stillFrom), side);
  const middle = { x: (a0.x + a1.x) / 2, y: (a0.y + a1.y) / 2 };
  const outward = ([from, to]: [Point, Point]) => (dot(sub(to, from), side) * Math.sign(dot(sub(from, middle), side) || 1)) / anchor.leg;
  const out = pairs.map(outward).sort((a, b) => a - b) as [number, number];
  return {
    step: moves[m]!,
    still: moves[1 - m]!,
    ahead: moveKnee !== null && stillKnee !== null ? (stillKnee - moveKnee) / anchor.leg : 0,
    across: anchor.frontish && Math.abs(startGap) / anchor.leg >= MIN_SIDE_GAP ? dot(sub(moveTo, stillTo), side) / startGap : null,
    out: anchor.frontish ? out : null,
  };
}

/** What a rep's feet did, as one of the patterns the moves are told apart by. */
export type FootPattern = 'planted' | 'forward' | 'back' | 'across' | 'shifted' | 'unknown';

/**
 * A foot that moved at least this far (over leg length) stepped. Measured on real video: squats
 * moved a foot 0.01–0.1; real lunge steps 0.16–0.73 (side-on ones read smallest).
 */
export const STEP = 0.15;
/** Under this neither foot moved: the feet stayed planted. */
export const PLANTED = 0.12;
/**
 * The moving leg's knee at least this far above (or below) the other knee settles forward or back.
 * Clear readings: real reverse lunges −0.33 to −0.4, rendered lunges at 45° and side-on 0.2–0.28.
 * But side-on the pose model often stacks the hidden knee on the visible one (real forward lunges
 * read −0.06 to 0.11, a reverse rep +0.13), so weaker readings leave the direction open rather than
 * call a good rep wrong.
 */
export const AHEAD = 0.18;
/** At or under this share of its starting sideways gap, the back foot crossed behind (curtsy). */
export const ACROSS = 0.4;
/** A start stance with one foot this far in front of the other is a split stance. */
export const SPLIT = 0.35;
/**
 * A start stance this far split is one even a squat set can trust: planted squats and sumo squats at
 * 45° read up to 0.46, side-on split squats in our gym clips 0.72–0.85 (repcast-tv-app docs/TESTING.md §14).
 */
export const CLEAR_SPLIT = 0.6;
/**
 * Both feet moving at least this far means the whole body moved (walking about between reps, or
 * coming closer to the phone), not one foot stepping: a phone test read 0.38–0.52 for the foot that
 * moved least when the person moved about, against 0.02–0.25 in most lunges (a few read up to 0.41:
 * those reps then go unjudged on footwork rather than risk calling a squat a lunge).
 */
export const SHIFTED = 0.3;
/** A foot that moved at least this far outward stepped out (jacks); under half of it, it stayed. */
export const OUT = 0.12;

export interface FeetPicture {
  step: number;
  still: number;
  ahead: number;
  across: number | null;
  out: [number, number] | null;
  split: number;
}

/** The rep's footwork from its medians: forward, back, back and across, planted, or can't tell. */
export function footPattern(feet: FeetPicture | null): FootPattern {
  if (!feet) return 'unknown';
  if (feet.still >= SHIFTED) return 'shifted';
  if (feet.step < PLANTED) return 'planted';
  if (feet.step < STEP) return 'unknown';
  if (feet.ahead >= AHEAD) return 'forward';
  if (feet.ahead > -AHEAD) return 'unknown';
  return feet.across !== null && feet.across <= ACROSS ? 'across' : 'back';
}

/**
 * How many feet stepped out (jacks): 0, 1 or 2, or null when it can't be told. Facing the camera it
 * is the outward movement; at an angle that is foreshortened, so how far each foot moved at all is
 * used instead (rendered at 45°: a jumping jack moved both feet 0.33–0.5, a step jack one foot about
 * 0.2 and the other under 0.04).
 */
export function feetOut(feet: FeetPicture | null): 0 | 1 | 2 | null {
  if (!feet) return null;
  if (feet.out) {
    const [low, high] = feet.out;
    if (low >= OUT) return 2;
    if (high >= OUT && low < OUT / 2) return 1;
    if (high < OUT / 2) return 0;
    return null;
  }
  if (feet.still >= BOTH_MOVED) return 2;
  if (feet.step >= OUT && feet.still < OUT / 2) return 1;
  if (feet.step < OUT / 2) return 0;
  return null;
}

/** At an angle, both feet moving at least this far (over leg length) is a jump out. */
const BOTH_MOVED = 0.25;
