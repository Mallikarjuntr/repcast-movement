import { CHECKS, type CheckId } from './checks.js';
import type { RepExercise } from './definitions.js';
import { DEFAULT_MIN_VISIBILITY, imagePoint, isVisible } from './geometry.js';
import { SIDES, type PointName } from './landmarks.js';
import { jointAngles, pick } from './measures.js';
import type { PoseFrame } from './types.js';

/** Per-frame decay of the standing thigh reference, so it adapts if the person moves nearer or farther. */
const THIGH_REFERENCE_DECAY = 0.9995;
const RAD_TO_DEG = 180 / Math.PI;

/** `waiting`: not yet seen standing tall. `top`: between reps. `down`: inside a rep. */
export type RepPhase = 'waiting' | 'top' | 'down';

export interface Fault {
  id: CheckId;
  cue: string;
}

export interface RepResult {
  /** Total reps so far, including this one. */
  count: number;
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
  /** Present only on the frame that completes a rep. */
  rep?: RepResult;
}

export interface RepDetectorOptions {
  /** Exponential smoothing factor, 0..1. Higher follows movement faster. */
  smoothing?: number;
  minVisibility?: number;
}

export class RepDetector {
  private phase: RepPhase = 'waiting';
  private smoothed: number | null = null;
  private reps = 0;
  private repStart = 0;
  private lowest = Infinity;
  private lowestFrame: PoseFrame | null = null;
  private lastTopAt = 0;
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

  get count(): number {
    return this.reps;
  }

  reset(): void {
    this.phase = 'waiting';
    this.smoothed = null;
    this.reps = 0;
    this.lowest = Infinity;
    this.lowestFrame = null;
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
    let rep: RepResult | undefined;

    switch (this.phase) {
      case 'waiting':
        if (metric >= top) {
          this.phase = 'top';
          this.lastTopAt = frame.t;
        }
        break;
      case 'top':
        if (metric >= top) {
          this.lastTopAt = frame.t;
        } else if (metric < bottom) {
          this.phase = 'down';
          this.repStart = this.lastTopAt;
          this.lowest = metric;
          this.lowestFrame = frame;
        }
        break;
      case 'down':
        if (metric < this.lowest) {
          this.lowest = metric;
          this.lowestFrame = frame;
        }
        if (metric >= top) {
          this.phase = 'top';
          this.lastTopAt = frame.t;
          const durationMs = frame.t - this.repStart;
          if (durationMs >= (this.exercise.minRepMs ?? 0)) {
            rep = this.completeRep(durationMs);
          }
        }
        break;
    }

    return { metric, phase: this.phase, missing, usingFallback: measured.fallback, rep };
  }

  private completeRep(durationMs: number): RepResult {
    this.reps += 1;
    const depth = this.exercise.depth;
    const faults: Fault[] = [];
    const frame = this.lowestFrame;
    if (frame) {
      for (const check of this.exercise.checks ?? []) {
        if (CHECKS[check.id](frame, check.params ?? {}, this.minVisibility) === true) {
          faults.push({ id: check.id, cue: check.cue });
        }
      }
    }
    return {
      count: this.reps,
      bottom: this.lowest,
      depthOk: depth ? this.lowest <= depth.target : null,
      faults,
      durationMs,
    };
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
