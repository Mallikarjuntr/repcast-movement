import { gradeCheck, type CheckId, type Severity } from './checks.js';
import type { RepExercise } from './definitions.js';
import { DEFAULT_MIN_VISIBILITY, distance2d, imagePoint, isVisible, midpoint } from './geometry.js';
import { SIDES, type PointName } from './landmarks.js';
import { isLying, isUpright, jointAngles, pick, stance, stanceWidth } from './measures.js';
import type { PoseFrame } from './types.js';

/** Per-frame decay of the standing thigh reference, so it adapts if the person moves nearer or farther. */
const THIGH_REFERENCE_DECAY = 0.9995;
const RAD_TO_DEG = 180 / Math.PI;
/** If both feet move more than this fraction of leg length during one rep, the camera (or person) moved. */
const MAX_FOOT_DRIFT = 0.3;
/** Without visible feet: hip drift sideways, as a fraction of shoulder width. */
const MAX_HIP_DRIFT = 0.8;
/**
 * People stand with different knee straightness (and the lite pose model under-reads straight legs),
 * so "back at the top" is set this far below the person's own standing angle.
 */
const STANDING_MARGIN = 10;
/** Upright frames remembered to learn the standing angle (about 5 s at 15–19 fps). */
const STANDING_WINDOW = 90;
/** Standing frames averaged for the feet's starting position, so one jittery frame can't skew it. */
const ANCHOR_FRAMES = 8;
/** After the legs straighten, how long the torso may take to come upright before the rep is judged. */
const FINISH_GRACE_MS = 1200;
/** Share of bottom frames showing a lunge stance that makes the rep a lunge (lunge evidence is the reliable kind). */
const STAGGERED_VOTE = 0.35;
/** Keep at least this gap between the top and bottom lines, so wobbles never count. */
const MIN_HYSTERESIS = 12;

/** `waiting`: not yet seen standing tall. `top`: between reps. `down`: inside a rep. */
export type RepPhase = 'waiting' | 'top' | 'down';

/** good: clean rep. fix: counts, with a correction. no-rep: doesn't count. */
export type Verdict = 'good' | 'fix' | 'no-rep';

export interface Fault {
  id: CheckId;
  cue: string;
  severity: Severity;
}

export interface RepResult {
  /** Counted reps so far (this one included only if it counted). */
  count: number;
  counted: boolean;
  verdict: Verdict;
  /** What the coach says, most important first. For a no-rep, the first reason is why. */
  cues: string[];
  /** Lowest smoothed angle reached during the rep, in degrees. */
  bottom: number;
  /** null when the exercise has no depth target. */
  depthOk: boolean | null;
  faults: Fault[];
  durationMs: number;
}

export interface RepUpdate {
  /** Smoothed metric in degrees, or null when the body isn't visible enough. */
  metric: number | null;
  phase: RepPhase;
  /** Required points currently out of view. */
  missing: PointName[];
  /** True when the angle is estimated from the thigh because the ankles are hidden. */
  usingFallback: boolean;
  /** Present only on the frame that finishes a rep attempt, counted or not. */
  rep?: RepResult;
}

export interface RepDetectorOptions {
  /** Exponential smoothing factor, 0..1. Higher follows movement faster. */
  smoothing?: number;
  minVisibility?: number;
}

type Point = ReturnType<typeof imagePoint>;

interface Anchor {
  feet: [Point | null, Point | null];
  hips: Point | null;
  legLength: number;
  shoulderWidth: number;
  /** Shoulder-centre to hip-centre length in the image: the ruler for stance. */
  torso: number;
  /** Ankle span over shoulder span while standing, or null when it can't be judged. */
  width: number | null;
}

export class RepDetector {
  private phase: RepPhase = 'waiting';
  private smoothed: number | null = null;
  private reps = 0;
  private repStart = 0;
  private lowest = Infinity;
  private lowestFrame: PoseFrame | null = null;
  private lastTopAt = 0;
  private lastTopFrame: PoseFrame | null = null;
  private start: Anchor | null = null;
  /** Recent standing frames, for a steady starting anchor. */
  private topFrames: PoseFrame[] = [];
  /** Per-frame drift during the current rep (feet or hips), judged by a percentile to ignore jitter. */
  private drifts: number[] = [];
  /** Stance seen on each bottom frame of the current rep. */
  private stanceVotes = { square: 0, staggered: 0 };
  /** When the legs got back above the top line during this rep (waiting for the torso to follow). */
  private legsUpAt: number | null = null;
  /** Tallest recent hip-to-knee vertical drop in the image, i.e. the thigh while standing. */
  private thighReference = 0;
  /** Recent upright metric values; the person's standing angle is a high percentile of these. */
  private standingSamples: number[] = [];
  private readonly smoothing: number;
  private readonly minVisibility: number;

  constructor(
    readonly exercise: RepExercise,
    options: RepDetectorOptions = {},
  ) {
    this.smoothing = options.smoothing ?? 0.5;
    this.minVisibility = options.minVisibility ?? DEFAULT_MIN_VISIBILITY;
  }

  /** Counted reps so far. */
  get count(): number {
    return this.reps;
  }

  /** Internal measurements, for tuning tools and test benches. */
  diagnostics(): { standingAngle: number | null; topLine: number; drift: number | null; staggeredShare: number | null } {
    const votes = this.stanceVotes.square + this.stanceVotes.staggered;
    return {
      standingAngle: this.standingAngle,
      topLine: this.topLine(),
      drift: this.drifts.length ? percentile(this.drifts, 0.7) : null,
      staggeredShare: votes ? this.stanceVotes.staggered / votes : null,
    };
  }

  reset(): void {
    this.phase = 'waiting';
    this.smoothed = null;
    this.reps = 0;
    this.lowest = Infinity;
    this.lowestFrame = null;
    this.lastTopFrame = null;
    this.start = null;
    this.thighReference = 0;
    this.standingSamples = [];
    this.topFrames = [];
  }

  /** The person's own standing angle: the 80th percentile of recent upright frames. */
  private get standingAngle(): number | null {
    return this.standingSamples.length < 5 ? null : percentile(this.standingSamples, 0.8);
  }

  /** The angle that counts as standing tall again for this person. */
  private topLine(): number {
    const { top, bottom } = this.exercise.thresholds;
    if (this.standingAngle === null) return top;
    return Math.max(bottom + MIN_HYSTERESIS, Math.min(top, this.standingAngle - STANDING_MARGIN));
  }

  update(frame: PoseFrame): RepUpdate {
    const missing = this.exercise.required.filter((n) => !isVisible(frame, n, this.minVisibility));
    const measured = this.measure(frame);

    if (measured === null) {
      return { metric: this.smoothed, phase: this.phase, missing, usingFallback: false };
    }

    this.smoothed = this.smoothed === null ? measured.value : this.smoothed + this.smoothing * (measured.value - this.smoothed);
    const metric = this.smoothed;
    const upright = this.isStanding(frame);
    if (upright && this.phase !== 'down') {
      this.standingSamples.push(metric);
      if (this.standingSamples.length > STANDING_WINDOW) this.standingSamples.shift();
    }
    const top = this.topLine();
    const { bottom } = this.exercise.thresholds;
    // Reps may only start from a standing position, so lying down or random movement never counts.
    const standing = metric >= top && upright;
    let rep: RepResult | undefined;

    switch (this.phase) {
      case 'waiting':
        if (standing) this.markTop(frame);
        break;
      case 'top':
        if (standing) {
          this.markTop(frame);
        } else if (metric < bottom && this.lastTopFrame) {
          this.phase = 'down';
          this.repStart = this.lastTopAt;
          this.lowest = metric;
          this.lowestFrame = frame;
          this.start = this.steadyAnchor();
          this.drifts = [];
          this.stanceVotes = { square: 0, staggered: 0 };
          this.legsUpAt = null;
        }
        break;
      case 'down':
        this.trackDrift(frame);
        if (metric < bottom) {
          const seen = stance(frame, this.minVisibility, this.start?.torso ?? 0);
          if (seen) this.stanceVotes[seen] += 1;
        }
        if (metric < this.lowest) {
          this.lowest = metric;
          this.lowestFrame = frame;
        }
        if (metric < top) {
          this.legsUpAt = null;
          break;
        }
        // Legs are straight; the torso often comes upright a moment later.
        this.legsUpAt ??= frame.t;
        if (upright || frame.t - this.legsUpAt > FINISH_GRACE_MS) {
          const durationMs = frame.t - this.repStart;
          const tooFast = durationMs < (this.exercise.minRepMs ?? 0);
          const tooSlow = durationMs > (this.exercise.maxRepMs ?? Infinity);
          if (!tooFast && !tooSlow) rep = this.judgeRep(durationMs, upright);
          if (upright) {
            this.markTop(frame);
          } else {
            this.phase = 'waiting';
            this.lastTopFrame = null;
          }
        }
        break;
    }

    return { metric, phase: this.phase, missing, usingFallback: measured.fallback, rep };
  }

  /** In the start position: standing for most exercises, lying for floor ones (push-ups, bridges). */
  private isStanding(frame: PoseFrame): boolean {
    const { upright, lying } = this.exercise;
    if (lying) return isLying(frame, lying.minTilt, this.minVisibility);
    return !upright || isUpright(frame, upright.maxTilt, this.minVisibility);
  }

  private markTop(frame: PoseFrame): void {
    this.phase = 'top';
    this.lastTopAt = frame.t;
    this.lastTopFrame = frame;
    this.topFrames.push(frame);
    if (this.topFrames.length > ANCHOR_FRAMES) this.topFrames.shift();
  }

  private judgeRep(durationMs: number, endedStanding: boolean): RepResult {
    const noRep: string[] = [];
    const fixes: string[] = [];
    const faults: Fault[] = [];
    const { depth, stance: stanceRule } = this.exercise;
    const frame = this.lowestFrame;

    if (this.exercise.plantedFeet !== false && this.cameraMoved()) noRep.push('The camera moved — keep the phone still');
    if (!endedStanding) noRep.push(this.exercise.lying ? 'Stay down in position for the whole rep' : 'Finish each rep standing tall');

    const width = this.exercise.width;
    const spread = this.start?.width ?? null;
    if (width && spread !== null) {
      if (width.noRepBelow !== undefined && spread < width.noRepBelow) noRep.push(width.noRepCue ?? width.cue);
      else if (spread < width.min) fixes.push(width.cue);
    }

    const votes = this.stanceVotes.square + this.stanceVotes.staggered;
    if (stanceRule && votes > 0) {
      const staggered = this.stanceVotes.staggered / votes >= STAGGERED_VOTE;
      if ((staggered ? 'staggered' : 'square') !== stanceRule.expect) noRep.push(stanceRule.cue);
    }

    if (depth) {
      if (depth.noRepAbove !== undefined && this.lowest > depth.noRepAbove) noRep.push(depth.noRepCue ?? depth.cue);
      else if (this.lowest > depth.target) fixes.push(depth.cue);
    }

    if (frame) {
      for (const check of this.exercise.checks ?? []) {
        const severity = gradeCheck(check.id, frame, check.warn, check.fail, this.minVisibility);
        if (!severity) continue;
        faults.push({ id: check.id, cue: severity === 'fail' ? (check.failCue ?? check.cue) : check.cue, severity });
        (severity === 'fail' ? noRep : fixes).push(severity === 'fail' ? (check.failCue ?? check.cue) : check.cue);
      }
    }

    const counted = noRep.length === 0;
    if (counted) this.reps += 1;
    return {
      count: this.reps,
      counted,
      verdict: !counted ? 'no-rep' : fixes.length > 0 ? 'fix' : 'good',
      cues: counted ? fixes : noRep,
      bottom: this.lowest,
      depthOk: depth ? this.lowest <= depth.target : null,
      faults,
      durationMs,
    };
  }

  /** Where the feet, hips and body scale were when the rep started. */
  private anchor(frame: PoseFrame): Anchor {
    const seen = (n: PointName) => (isVisible(frame, n, this.minVisibility) ? imagePoint(frame, n) : null);
    const lh = seen('leftHip');
    const rh = seen('rightHip');
    const la = seen('leftAnkle');
    const ra = seen('rightAnkle');
    const ls = seen('leftShoulder');
    const rs = seen('rightShoulder');
    const hips = lh && rh ? midpoint(lh, rh) : (lh ?? rh);
    const shoulders = ls && rs ? midpoint(ls, rs) : null;
    const legs = [lh && la ? distance2d(lh, la) : 0, rh && ra ? distance2d(rh, ra) : 0].filter((d) => d > 0);
    return {
      feet: [la, ra],
      hips,
      legLength: legs.length ? legs.reduce((a, b) => a + b, 0) / legs.length : 0,
      shoulderWidth: ls && rs ? distance2d(ls, rs) : 0,
      torso: shoulders && lh && rh ? distance2d(shoulders, midpoint(lh, rh)) : 0,
      width: stanceWidth(frame, this.minVisibility),
    };
  }

  /** Starting anchor from the median of recent standing frames. */
  private steadyAnchor(): Anchor {
    const anchors = this.topFrames.map((f) => this.anchor(f));
    const med = (pts: (Point | null)[]): Point | null => {
      const seen = pts.filter((p): p is Point => p !== null);
      if (seen.length === 0) return null;
      return { x: percentile(seen.map((p) => p.x), 0.5), y: percentile(seen.map((p) => p.y), 0.5), z: 0 };
    };
    const num = (xs: number[]) => (xs.filter((x) => x > 0).length ? percentile(xs.filter((x) => x > 0), 0.5) : 0);
    const widths = anchors.map((a) => a.width).filter((w): w is number => w !== null);
    return {
      feet: [med(anchors.map((a) => a.feet[0])), med(anchors.map((a) => a.feet[1]))],
      hips: med(anchors.map((a) => a.hips)),
      legLength: num(anchors.map((a) => a.legLength)),
      shoulderWidth: num(anchors.map((a) => a.shoulderWidth)),
      torso: num(anchors.map((a) => a.torso)),
      // Judged only when most standing frames could see it, so a few stray frames can't decide.
      width: widths.length * 2 >= anchors.length && widths.length > 0 ? percentile(widths, 0.5) : null,
    };
  }

  /**
   * How far the body's base moved this frame, relative to its size: the less-moved foot over leg
   * length, or with the feet hidden, sideways hip drift over shoulder width.
   */
  private trackDrift(frame: PoseFrame): void {
    const ref = this.start;
    if (!ref) return;
    const now = this.anchor(frame);
    const [a0, a1] = ref.feet;
    const [b0, b1] = now.feet;
    if (a0 && a1 && b0 && b1 && ref.legLength > 0) {
      this.drifts.push(Math.min(distance2d(a0, b0), distance2d(a1, b1)) / ref.legLength / MAX_FOOT_DRIFT);
    } else if (ref.hips && now.hips && ref.shoulderWidth > 0) {
      this.drifts.push(Math.abs(now.hips.x - ref.hips.x) / ref.shoulderWidth / MAX_HIP_DRIFT);
    }
  }

  /** The base drifted past its limit for most of the rep: the phone (or the person) moved. */
  private cameraMoved(): boolean {
    return this.drifts.length > 0 && percentile(this.drifts, 0.7) > 1;
  }

  private measure(frame: PoseFrame): { value: number; fallback: boolean } | null {
    const { joint, fallback, invert } = this.exercise.metric;
    const thighDrop = fallback === 'thigh-drop' ? this.trackThighDrop(frame) : null;

    const angle = pick(jointAngles(frame, joint, this.minVisibility), this.exercise.metric.pick);
    if (angle !== null) {
      return { value: invert ? 180 - angle : angle, fallback: false };
    }

    if (thighDrop !== null && this.thighReference > 0) {
      // The thigh's vertical extent shrinks with cos(fold) whichever way the camera faces:
      // full height when standing (180), near zero at parallel depth (90).
      const fold = Math.acos(Math.min(1, thighDrop / this.thighReference)) * RAD_TO_DEG;
      return { value: 180 - fold, fallback: true };
    }
    return null;
  }

  /** Returns the current hip-to-knee vertical drop and keeps the standing reference up to date. */
  private trackThighDrop(frame: PoseFrame): number | null {
    const drops = SIDES.filter((s) => isVisible(frame, `${s}Hip`, this.minVisibility) && isVisible(frame, `${s}Knee`, this.minVisibility))
      .map((s) => imagePoint(frame, `${s}Knee`).y - imagePoint(frame, `${s}Hip`).y);
    const mean = pick(drops);
    if (mean === null) return null;
    const drop = Math.max(0, mean);
    this.thighReference = Math.max(drop, this.thighReference * THIGH_REFERENCE_DECAY);
    return drop;
  }
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1) + 0.5))]!;
}
