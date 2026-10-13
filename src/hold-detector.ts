import { CHECKS } from './checks.js';
import type { HoldExercise, HoldTarget } from './definitions.js';
import { DEFAULT_MIN_VISIBILITY, distance2d, imagePoint, isVisible, midpoint } from './geometry.js';
import type { PointName } from './landmarks.js';
import { jointAngles, pick, torsoTilt } from './measures.js';
import type { Fault } from './rep-detector.js';
import type { PoseFrame } from './types.js';

export interface HoldUpdate {
  /** True while the pose is being held (timer running). */
  holding: boolean;
  /** Total time held so far, in milliseconds. */
  heldMs: number;
  /** True on the single frame where the hold reaches the target time. */
  completed: boolean;
  /** Cues for targets that are currently not met. */
  offTarget: string[];
  /** Specific corrections from the exercise's checks. */
  faults: Fault[];
  /** Hip sway over the last second relative to torso length (lower is steadier), or null. */
  wobble: number | null;
  missing: PointName[];
}

export interface HoldDetectorOptions {
  minVisibility?: number;
  /** The pose must be met this long before the timer starts. */
  settleMs?: number;
  /** Brief slips shorter than this don't stop the timer. */
  graceMs?: number;
}

const WOBBLE_WINDOW_MS = 1000;

export class HoldDetector {
  private holding = false;
  private heldMs = 0;
  private done = false;
  private inPoseSince: number | null = null;
  private outOfPoseSince: number | null = null;
  private lastT: number | null = null;
  private hipTrail: { t: number; x: number; y: number }[] = [];
  private readonly minVisibility: number;
  private readonly settleMs: number;
  private readonly graceMs: number;

  constructor(
    readonly exercise: HoldExercise,
    options: HoldDetectorOptions = {},
  ) {
    this.minVisibility = options.minVisibility ?? DEFAULT_MIN_VISIBILITY;
    this.settleMs = options.settleMs ?? 300;
    this.graceMs = options.graceMs ?? 600;
  }

  reset(): void {
    this.holding = false;
    this.heldMs = 0;
    this.done = false;
    this.inPoseSince = null;
    this.outOfPoseSince = null;
    this.lastT = null;
    this.hipTrail = [];
  }

  update(frame: PoseFrame): HoldUpdate {
    const missing = this.exercise.required.filter((n) => !isVisible(frame, n, this.minVisibility));
    const offTarget = this.exercise.targets.filter((t) => !this.meets(frame, t)).map((t) => t.cue);
    const faults: Fault[] = (this.exercise.checks ?? [])
      .filter((c) => CHECKS[c.id](frame, c.params ?? {}, this.minVisibility) === true)
      .map((c) => ({ id: c.id, cue: c.cue }));
    const inPose = missing.length === 0 && offTarget.length === 0;
    const dt = this.lastT === null ? 0 : frame.t - this.lastT;
    this.lastT = frame.t;

    if (inPose) {
      this.outOfPoseSince = null;
      this.inPoseSince ??= frame.t;
      if (!this.holding && frame.t - this.inPoseSince >= this.settleMs) this.holding = true;
    } else {
      this.inPoseSince = null;
      this.outOfPoseSince ??= frame.t;
      if (this.holding && frame.t - this.outOfPoseSince > this.graceMs) this.holding = false;
    }

    if (this.holding) this.heldMs += dt;
    const completed = !this.done && this.heldMs >= this.exercise.targetSeconds * 1000;
    if (completed) this.done = true;

    return {
      holding: this.holding,
      heldMs: this.heldMs,
      completed,
      offTarget,
      faults,
      wobble: this.trackWobble(frame),
      missing,
    };
  }

  private meets(frame: PoseFrame, target: HoldTarget): boolean {
    const value =
      target.measure === 'torso-tilt'
        ? torsoTilt(frame, this.minVisibility)
        : pick(jointAngles(frame, target.joint, this.minVisibility), target.pick);
    return value !== null && Math.abs(value - target.angle) <= target.tolerance;
  }

  private trackWobble(frame: PoseFrame): number | null {
    const names: PointName[] = ['leftHip', 'rightHip', 'leftShoulder', 'rightShoulder'];
    if (!names.every((n) => isVisible(frame, n, this.minVisibility))) return null;
    const hips = midpoint(imagePoint(frame, 'leftHip'), imagePoint(frame, 'rightHip'));
    const torso = distance2d(hips, midpoint(imagePoint(frame, 'leftShoulder'), imagePoint(frame, 'rightShoulder')));
    this.hipTrail.push({ t: frame.t, x: hips.x, y: hips.y });
    this.hipTrail = this.hipTrail.filter((p) => frame.t - p.t <= WOBBLE_WINDOW_MS);
    if (this.hipTrail.length < 5 || torso === 0) return null;
    const mx = this.hipTrail.reduce((s, p) => s + p.x, 0) / this.hipTrail.length;
    const my = this.hipTrail.reduce((s, p) => s + p.y, 0) / this.hipTrail.length;
    const rms = Math.sqrt(this.hipTrail.reduce((s, p) => s + (p.x - mx) ** 2 + (p.y - my) ** 2, 0) / this.hipTrail.length);
    return rms / torso;
  }
}
