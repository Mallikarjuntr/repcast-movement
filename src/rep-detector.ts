import { gradeCheck, type CheckId, type Severity } from './checks.js';
import type { RepExercise } from './definitions.js';
import { CLEAR_SPLIT, feetAnchor, feetFrame, feetOut, footPattern, SPLIT, STEP, type FeetAnchor, type FeetFrame } from './footwork.js';
import type { FootKey } from './definitions.js';
import { DEFAULT_MIN_VISIBILITY, distance2d, imagePoint, isVisible, midpoint } from './geometry.js';
import { SIDES, type PointName } from './landmarks.js';
import { isLying, isUpright, jointAngles, pick, stance, stanceWidth } from './measures.js';
import type { PoseFrame } from './types.js';

/** Per-frame decay of the standing thigh reference, so it adapts if the person moves nearer or farther. */
const THIGH_REFERENCE_DECAY = 0.9995;
const RAD_TO_DEG = 180 / Math.PI;
/** If both feet move more than this fraction of leg length during one rep, the camera (or person) moved. */
const MAX_FOOT_DRIFT = 0.3;
/**
 * Without visible feet: hip drift sideways, as a fraction of torso length. (It was shoulder width,
 * which shrinks to almost nothing side-on, so a few pixels of hip sway read as the camera moving.)
 */
const MAX_HIP_DRIFT = 0.6;
/**
 * People stand with different knee straightness (and the lite pose model under-reads straight legs),
 * so "back at the top" is set this far below the person's own standing angle.
 */
const STANDING_MARGIN = 10;
/** Upright frames remembered to learn the standing angle (about 5 s at 15–19 fps). */
const STANDING_WINDOW = 90;
/** Standing frames averaged for the feet's starting position, so one jittery frame can't skew it. */
const ANCHOR_FRAMES = 4;
/** Standing time looked back over for where the feet started a rep. */
const FEET_ANCHOR_MS = 1500;
/** After the legs straighten, how long the torso may take to come upright before the rep is judged. */
const FINISH_GRACE_MS = 1200;
/** Share of bottom frames showing a lunge stance that makes the rep a lunge (lunge evidence is the reliable kind). */
const STAGGERED_VOTE = 0.35;
/**
 * And at least this many such frames: side-on no frame votes "square", so without it one stray frame
 * made a whole squat a lunge.
 */
const MIN_STAGGERED_FRAMES = 3;
/** When a planted move's base drifts (see cameraMoved): the person or the phone moved. */
export const MOVED_CUE = 'You moved off your spot — stay in one place for each rep, and keep the phone still';
/** Frame gap the smoothing factor is given for (15 frames a second). */
const REFERENCE_FRAME_MS = 1000 / 15;
/** Keep at least this gap between the top and bottom lines, so wobbles never count. */
const MIN_HYSTERESIS = 12;
/** How far a person's own standing angle may pull the top line below the definition's. */
const MAX_TOP_DROP = 30;

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
  /** What the feet did at the bottom of the rep (medians), or null when the ankles weren't seen. */
  feet: FeetSummary | null;
}

/** Footwork over the bottom of a rep: medians of the per-frame measures (see FeetFrame). */
export interface FeetSummary {
  step: number;
  still: number;
  ahead: number;
  across: number | null;
  out: [number, number] | null;
  /** How far one foot stood in front of the other before the rep (split stance), over leg length. */
  split: number;
  /** Bottom frames that saw both ankles. */
  frames: number;
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
  /** A longer run of standing frames for where the feet started (people step out before they bend). */
  private feetFramesAtTop: PoseFrame[] = [];
  /** Per-frame drift during the current rep (feet or hips), judged by a percentile to ignore jitter. */
  private drifts: number[] = [];
  /** Stance seen on each bottom frame of the current rep. */
  private stanceVotes = { square: 0, staggered: 0 };
  /** Where the feet stood when the rep started, and what they did on each bottom frame. */
  private feetStart: FeetAnchor | null = null;
  private feetFrames: FeetFrame[] = [];
  /** When the legs got back above the top line during this rep (waiting for the torso to follow). */
  private legsUpAt: number | null = null;
  /** Tallest recent hip-to-knee vertical drop in the image, i.e. the thigh while standing. */
  private thighReference = 0;
  /** Recent upright metric values; the person's standing angle is a high percentile of these. */
  private standingSamples: number[] = [];
  private readonly smoothing: number;
  private readonly minVisibility: number;
  private lastT: number | null = null;

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
  diagnostics(): { standingAngle: number | null; topLine: number; drift: number | null; staggeredShare: number | null; feet: FeetSummary | null } {
    const votes = this.stanceVotes.square + this.stanceVotes.staggered;
    return {
      standingAngle: this.standingAngle,
      topLine: this.topLine(),
      drift: this.drifts.length ? percentile(this.drifts, 0.7) : null,
      staggeredShare: votes ? this.stanceVotes.staggered / votes : null,
      feet: this.feetSummary(),
    };
  }

  reset(): void {
    this.phase = 'waiting';
    this.smoothed = null;
    this.lastT = null;
    this.reps = 0;
    this.lowest = Infinity;
    this.lowestFrame = null;
    this.lastTopFrame = null;
    this.start = null;
    this.thighReference = 0;
    this.standingSamples = [];
    this.topFrames = [];
    this.feetFramesAtTop = [];
  }

  /** The person's own standing angle: the 80th percentile of recent upright frames. */
  private get standingAngle(): number | null {
    return this.standingSamples.length < 5 ? null : percentile(this.standingSamples, 0.8);
  }

  /**
   * The angle that counts as standing tall again for this person: a little under their own standing
   * angle, never above the definition's, and at most MAX_TOP_DROP below it.
   */
  private topLine(): number {
    const { top } = this.exercise.thresholds;
    if (this.standingAngle === null) return top;
    return Math.max(top - MAX_TOP_DROP, Math.min(top, this.standingAngle - STANDING_MARGIN));
  }

  /**
   * Below this a rep starts. It moves down with the top line, keeping the gap that stops wobbles
   * counting: seen side-on, straight legs can read ~150°, and a fixed bottom line of 148° (half
   * squats) left no room, so no rep ever started.
   */
  private bottomLine(): number {
    return Math.min(this.exercise.thresholds.bottom, this.topLine() - MIN_HYSTERESIS);
  }

  update(frame: PoseFrame): RepUpdate {
    const missing = this.exercise.required.filter((n) => !isVisible(frame, n, this.minVisibility));
    const measured = this.measure(frame);

    if (measured === null) {
      return { metric: this.smoothed, phase: this.phase, missing, usingFallback: false };
    }

    // The smoothing was tuned at 15 frames a second. On a slower phone (7 fps) the frames are
    // further apart, so each one counts for more; otherwise the smoothed angle lags behind a fast
    // move like a jumping jack and the rep never reaches the bottom line. Faster phones are unchanged.
    const gap = this.lastT === null ? REFERENCE_FRAME_MS : Math.min(500, Math.max(1, frame.t - this.lastT));
    this.lastT = frame.t;
    const alpha = Math.max(this.smoothing, 1 - (1 - this.smoothing) ** (gap / REFERENCE_FRAME_MS));
    this.smoothed = this.smoothed === null ? measured.value : this.smoothed + alpha * (measured.value - this.smoothed);
    const metric = this.smoothed;
    const upright = this.isStanding(frame);
    if (upright && this.phase !== 'down') {
      this.standingSamples.push(metric);
      if (this.standingSamples.length > STANDING_WINDOW) this.standingSamples.shift();
    }
    const top = this.topLine();
    const bottom = this.bottomLine();
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
          this.feetStart = feetAnchor(this.feetFramesAtTop, this.minVisibility);
          this.feetFrames = [];
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
          const feet = this.feetStart ? feetFrame(this.feetStart, frame, this.minVisibility) : null;
          if (feet) this.feetFrames.push(feet);
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
    this.feetFramesAtTop.push(frame);
    while (this.feetFramesAtTop.length > 1 && frame.t - this.feetFramesAtTop[0]!.t > FEET_ANCHOR_MS) this.feetFramesAtTop.shift();
  }

  private judgeRep(durationMs: number, endedStanding: boolean): RepResult {
    const noRep: string[] = [];
    const fixes: string[] = [];
    const faults: Fault[] = [];
    const { depth, stance: stanceRule } = this.exercise;
    const frame = this.lowestFrame;

    // Usually the person moved (walking about, coming closer to the phone), sometimes the phone: say both.
    if (this.exercise.plantedFeet !== false && this.cameraMoved()) noRep.push(MOVED_CUE);
    if (!endedStanding) noRep.push(this.exercise.lying ? 'Stay down in position for the whole rep' : 'Finish each rep standing tall');

    const width = this.exercise.width;
    const spread = this.start?.width ?? null;
    if (width && spread !== null) {
      if (width.noRepBelow !== undefined && spread < width.noRepBelow) noRep.push(width.noRepCue ?? width.cue);
      else if (spread < width.min) fixes.push(width.cue);
    }

    const votes = this.stanceVotes.square + this.stanceVotes.staggered;
    const kneesStaggered = votes > 0 ? this.stanceVotes.staggered >= MIN_STAGGERED_FRAMES && this.stanceVotes.staggered / votes >= STAGGERED_VOTE : null;
    const feet = this.feetSummary();
    const pattern = footPattern(feet);
    const footRule = this.exercise.footwork;
    if (footRule && feet && pattern === 'shifted') {
      // The whole body moved: not a step, so neither a lunge nor a squat can be told. Planted moves
      // already say "stay on your spot" through the drift check above.
    } else if (footRule && feet) {
      // The feet are the better witness: a foot that stepped settles lunge against squat. Planted
      // feet are a split stance if they started one in front of the other; for split squats the
      // knee heights may say so too (facing the camera the split is foreshortened), but squats only
      // trust the feet, as the knee gap misread real squats as lunges. A step whose direction isn't
      // clear is still a step: a lunge of some kind, never a squat or split squat.
      // Squat sets only call a lunge when a foot stepped: the split-stance reading is unreliable at an
      // angle (planted sumo squats at 45° read 0.44–0.46, squats and goblet squats up to 0.32).
      const split = footRule.expect !== 'squat' && (feet.split >= SPLIT || kneesStaggered === true);
      const stepped = pattern === 'unknown' && feet.step >= STEP;
      // Feet that already stood clearly split didn't step into a lunge: in a squat set that was a
      // split squat (side-on, its feet seem to move as the legs cross in the picture).
      const splitCue = footRule.expect === 'squat' && feet.split >= CLEAR_SPLIT ? footRule.splitCue : undefined;
      const seen: FootKey | null = pattern === 'planted' ? (split ? 'planted' : 'squat') : pattern === 'unknown' || pattern === 'shifted' ? null : pattern;
      if (seen) {
        const ok = seen === footRule.expect || (footRule.expect === 'back' && seen === 'across') || (footRule.expect === 'across' && seen === 'back' && feet.across === null);
        const cue = seen === 'squat' ? footRule.cues[seen] : (splitCue ?? footRule.cues[seen]);
        if (!ok && cue) noRep.push(cue);
      } else if (stepped && (footRule.expect === 'squat' || footRule.expect === 'planted')) {
        const cue = splitCue ?? footRule.cues.forward ?? footRule.cues.back;
        if (cue) noRep.push(cue);
      }
    } else if (stanceRule && kneesStaggered !== null && footRule?.expect !== 'squat') {
      // Only lunges fall back to the knee heights when the feet can't be seen. Squats don't: with
      // half the body in view (feet cut off) the knee gap called real squats lunges.
      if ((kneesStaggered ? 'staggered' : 'square') !== stanceRule.expect) noRep.push(stanceRule.cue);
    }

    const jacks = this.exercise.feetOut;
    const out = jacks ? feetOut(feet) : null;
    if (jacks && out !== null && out !== jacks.expect) {
      const cue = jacks.cues[out];
      if (cue) noRep.push(cue);
    }

    if (depth) {
      if (depth.noRepAbove !== undefined && this.lowest > depth.noRepAbove) noRep.push(depth.noRepCue ?? depth.cue);
      else if (depth.noRepBelow !== undefined && this.lowest < depth.noRepBelow) noRep.push(depth.tooDeepCue ?? depth.cue);
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
      feet: this.feetSummary(),
    };
  }

  private feetSummary(): FeetSummary | null {
    const all = this.feetFrames;
    if (all.length === 0) return null;
    const mid = (xs: number[]) => percentile(xs, 0.5);
    const across = all.map((f) => f.across).filter((x): x is number => x !== null);
    const out = all.map((f) => f.out).filter((x): x is [number, number] => x !== null);
    return {
      step: mid(all.map((f) => f.step)),
      still: mid(all.map((f) => f.still)),
      ahead: mid(all.map((f) => f.ahead)),
      across: across.length * 2 >= all.length ? mid(across) : null,
      out: out.length * 2 >= all.length ? [mid(out.map((o) => o[0])), mid(out.map((o) => o[1]))] : null,
      split: this.feetStart?.split ?? 0,
      frames: all.length,
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
      torso: num(anchors.map((a) => a.torso)),
      // Judged only when most standing frames could see it, so a few stray frames can't decide.
      width: widths.length * 2 >= anchors.length && widths.length > 0 ? percentile(widths, 0.5) : null,
    };
  }

  /**
   * How far the body's base moved this frame, relative to its size: the less-moved foot over leg
   * length, or with the feet hidden, sideways hip drift over torso length.
   */
  private trackDrift(frame: PoseFrame): void {
    const ref = this.start;
    if (!ref) return;
    const now = this.anchor(frame);
    const [a0, a1] = ref.feet;
    const [b0, b1] = now.feet;
    if (a0 && a1 && b0 && b1 && ref.legLength > 0) {
      // Facing the camera, the pose model sometimes swaps the left and right ankles for a frame; a
      // swap isn't movement, so each foot is matched to whichever starting foot is nearer.
      const moved = Math.min(distance2d(a0, b0), distance2d(a1, b1), distance2d(a0, b1), distance2d(a1, b0));
      this.drifts.push(moved / ref.legLength / MAX_FOOT_DRIFT);
    } else if (ref.hips && now.hips && ref.torso > 0) {
      this.drifts.push(Math.abs(now.hips.x - ref.hips.x) / ref.torso / MAX_HIP_DRIFT);
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
