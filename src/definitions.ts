import type { CheckId } from './checks.js';
import type { PointName } from './landmarks.js';

/** Joints whose angle can drive a rep: hip-knee-ankle, shoulder-hip-knee, shoulder-elbow-wrist. */
export type JointName = 'knee' | 'hip' | 'elbow';

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

export type ExerciseDefinition = RepExercise;
