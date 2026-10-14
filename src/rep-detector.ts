import { gradeCheck, type CheckId, type Severity } from './checks.js';
import type { RepExercise } from './definitions.js';
import { DEFAULT_MIN_VISIBILITY, distance2d, imagePoint, isVisible, midpoint } from './geometry.js';
import { SIDES, type PointName } from './landmarks.js';
import { isUpright, jointAngles, pick, stance } from './measures.js';
import type { PoseFrame } from './types.js';

/** Per-frame decay of the standing thigh reference, so it adapts if the person moves nearer or farther. */
const THIGH_REFERENCE_DECAY = 0.9995;
const RAD_TO_DEG = 180 / Math.PI;
/** If both feet move more than this fraction of leg length during one rep, the camera (or person) moved. */
const MAX_FOOT_DRIFT = 0.3;
/** Without visible feet: hip drift sideways, as a fraction of shoulder width. */
const MAX_HIP_DRIFT = 0.8;
/** Apparent body size change during one rep (zoom, walking towards the phone). */
const MAX_SCALE_CHANGE = 1.35;

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
  private footDrift: [number, number] = [0, 0];
  private hipDrift = 0;
  private scaleChange = 1;
  /** Tallest recent hip-to-knee vertical drop in the image, i.e. the thigh while standing. */
  private thighReference = 0;
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

  reset(): void {
    this.phase = 'waiting';
    this.smoothed = null;
    this.reps = 0;
    this.lowest = Infinity;
    this.lowestFrame = null;
    this.lastTopFrame = null;
    this.start = null;
    this.thighReference = 0;
  }

  update(frame: PoseFrame): RepUpdate {
    const missing = this.exercise.required.filter((n) => !isVisible(frame, n, this.minVisibility));
    const measured = this.measure(frame);

    if (measured === null) {
      return { metric: this.smoothed, phase: this.phase, missing, usingFallback: false };
    }

    this.smoothed = this.smoothed === null ? measured.value : this.smoothed + this.smoothing * (measured.value - this.smoothed);
    const metric = this.smoothed;
    const { top, bottom } = this.exercise.thresholds;
    // Reps may only start from a standing position, so lying down or random movement never counts.
    const standing = metric >= top && this.isStanding(frame);
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
          this.start = this.anchor(this.lastTopFrame);
          this.footDrift = [0, 0];
          this.hipDrift = 0;
          this.scaleChange = 1;
        }
        break;
      case 'down':
        this.trackDrift(frame);
        if (metric < this.lowest) {
          this.lowest = metric;
          this.lowestFrame = frame;
        }
        if (metric >= top) {
          const durationMs = frame.t - this.repStart;
          const tooFast = durationMs < (this.exercise.minRepMs ?? 0);
          const tooSlow = durationMs > (this.exercise.maxRepMs ?? Infinity);
          if (!tooFast && !tooSlow) rep = this.judgeRep(durationMs, this.isStanding(frame));
          if (this.isStanding(frame)) {
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

  private isStanding(frame: PoseFrame): boolean {
    const upright = this.exercise.upright;
    return !upright || isUpright(frame, upright.maxTilt, this.minVisibility);
  }

  private markTop(frame: PoseFrame): void {
    this.phase = 'top';
    this.lastTopAt = frame.t;
    this.lastTopFrame = frame;
  }

  private judgeRep(durationMs: number, endedStanding: boolean): RepResult {
    const noRep: string[] = [];
    const fixes: string[] = [];
    const faults: Fault[] = [];
    const { depth, stance: stanceRule } = this.exercise;
    const frame = this.lowestFrame;

    if (this.cameraMoved()) noRep.push('The camera moved — keep the phone still');
    if (!endedStanding) noRep.push('Finish each rep standing tall');

    if (stanceRule && frame) {
      const seen = stance(frame, this.minVisibility);
      if (seen !== null && seen !== stanceRule.expect) noRep.push(stanceRule.cue);
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
    const legs = [lh && la ? distance2d(lh, la) : 0, rh && ra ? distance2d(rh, ra) : 0].filter((d) => d > 0);
    return {
      feet: [la, ra],
      hips,
      legLength: legs.length ? legs.reduce((a, b) => a + b, 0) / legs.length : 0,
      shoulderWidth: ls && rs ? distance2d(ls, rs) : 0,
    };
  }

  private trackDrift(frame: PoseFrame): void {
    if (!this.start) return;
    const now = this.anchor(frame);
    const ref = this.start;
    for (const i of [0, 1] as const) {
      const a = ref.feet[i];
      const b = now.feet[i];
      if (a && b) this.footDrift[i] = Math.max(this.footDrift[i], distance2d(a, b));
    }
    if (ref.hips && now.hips) this.hipDrift = Math.max(this.hipDrift, Math.abs(now.hips.x - ref.hips.x));
    if (ref.shoulderWidth > 0 && now.shoulderWidth > 0) {
      const ratio = now.shoulderWidth / ref.shoulderWidth;
      this.scaleChange = Math.max(this.scaleChange, ratio, 1 / ratio);
    }
  }

  /** Both feet moving (or, with feet hidden, the hips sliding sideways) means the phone or person moved. */
  private cameraMoved(): boolean {
    const ref = this.start;
    if (!ref) return false;
    if (this.scaleChange > MAX_SCALE_CHANGE) return true;
    const bothFeet = ref.feet[0] && ref.feet[1] && ref.legLength > 0;
    if (bothFeet) return Math.min(this.footDrift[0], this.footDrift[1]) / ref.legLength > MAX_FOOT_DRIFT;
    return ref.shoulderWidth > 0 && this.hipDrift / ref.shoulderWidth > MAX_HIP_DRIFT;
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
