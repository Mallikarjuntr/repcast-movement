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
  /** What the coach says when this fault shows up. */
  cue: string;
  params?: Record<string, number>;
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
  /** The rep is deep enough when the lowest angle reaches `target` or below. */
  depth?: { target: number; cue: string };
  /** Faster than this is treated as noise, not a rep. */
  minRepMs?: number;
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
