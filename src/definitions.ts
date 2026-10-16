import type { CheckId } from './checks.js';
import type { PointName } from './landmarks.js';
import type { Pick } from './measures.js';

/**
 * Measurable joints: knee (hip-knee-ankle), hip (shoulder-hip-knee), elbow (shoulder-elbow-wrist),
 * shoulder (hip-shoulder-elbow, i.e. how far the arm is raised) and body (shoulder-hip-ankle, a straight body line).
 */
export type JointName = 'knee' | 'hip' | 'elbow' | 'shoulder' | 'body';

export interface CheckConfig {
  id: CheckId;
  /** What the coach says when the fault is fixable. */
  cue: string;
  /** Beyond this the fault is called out (direction depends on the check). */
  warn: number;
  /** Beyond this the rep doesn't count. Omit for checks that never cost a rep. */
  fail?: number;
  /** What the coach says when the rep doesn't count because of this fault. */
  failCue?: string;
}

/**
 * A repeated movement where a joint angle drops during the rep and returns at the end
 * (squat, lunge, push-up). Plain data: new exercises need no new code.
 */
export interface RepExercise {
  id: string;
  name: string;
  type: 'rep';
  metric: {
    joint: JointName;
    /** How to combine the left and right sides. Defaults to the mean. */
    pick?: Pick;
    /** Use 180 minus the angle, for movements where the angle grows during the rep (arm raises). */
    invert?: boolean;
    /**
     * When the ankles are out of frame, estimate the knee angle from how far the hip has dropped
     * toward knee height, compared with standing. Works from any viewing angle.
     */
    fallback?: 'thigh-drop';
  };
  /** The rep starts below `bottom` and completes back above `top` (degrees). The gap prevents double counts. */
  thresholds: { top: number; bottom: number };
  /** Deep enough at `target` or below; above `noRepAbove` the rep doesn't count. */
  depth?: { target: number; cue: string; noRepAbove?: number; noRepCue?: string };
  /** Faster than this is noise, not a rep (ignored silently). */
  minRepMs?: number;
  /** Slower than this isn't one rep (ignored silently). */
  maxRepMs?: number;
  /**
   * The person must be standing (torso within `maxTilt` degrees of upright, head above hips above knees)
   * before a rep can start. Stops people lying down, sitting or random movement from counting.
   */
  upright?: { maxTilt: number };
  /**
   * The person must be lying down (torso at least `minTilt` degrees from upright in the image) for a
   * rep to start, as in push-ups and glute bridges. Filmed side-on with the phone on the floor.
   */
  lying?: { minTilt: number };
  /**
   * Feet stay planted during a rep (default true). When planted, both feet moving means the camera
   * or person moved, so the rep doesn't count. Set false for stepping moves like forward lunges.
   */
  plantedFeet?: boolean;
  /** Foot stance expected at the bottom: feet side by side (squat) or one forward (lunge). */
  stance?: { expect: 'square' | 'staggered'; cue: string };
  /**
   * How wide the feet must be, as ankle span over shoulder span while standing at the start of the
   * rep (see `stanceWidth`). Below `min` the coach asks for wider feet; below `noRepBelow` the rep
   * doesn't count. Not judged side-on or with the feet out of view.
   */
  width?: { min: number; cue: string; noRepBelow?: number; noRepCue?: string };
  checks?: CheckConfig[];
  /** Points that must be visible to follow this exercise at all. */
  required: PointName[];
}

/** One condition a held pose must meet, e.g. "standing knee straight" or "torso horizontal". */
export type HoldTarget =
  | { measure: 'joint'; joint: JointName; pick?: Pick; angle: number; tolerance: number; cue: string }
  | { measure: 'torso-tilt'; angle: number; tolerance: number; cue: string };

/**
 * A static pose held over time (plank, yoga asanas, balance tests). The hold counts while every
 * target is within tolerance; checks add specific corrections.
 */
export interface HoldExercise {
  id: string;
  name: string;
  type: 'hold';
  targets: HoldTarget[];
  checks?: CheckConfig[];
  /** Seconds to hold for a complete set. */
  targetSeconds: number;
  required: PointName[];
}

export type ExerciseDefinition = RepExercise | HoldExercise;
