export interface Landmark {
  x: number;
  y: number;
  z: number;
  /** 0..1 confidence that the point is visible in the image. */
  visibility?: number;
}

export interface PoseFrame {
  /** Timestamp in milliseconds. */
  t: number;
  /** Normalized image landmarks (0..1) in MediaPipe Pose order (33 points). */
  landmarks: readonly Landmark[];
  /** Optional metric 3D landmarks (MediaPipe world landmarks). Used for joint angles when present. */
  world?: readonly Landmark[];
  /** Image width divided by height, so normalized x and y distances are comparable. Defaults to 1. */
  aspect?: number;
}
