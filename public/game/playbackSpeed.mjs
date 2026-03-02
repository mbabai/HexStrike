const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeDegrees = (value) => {
  const normalized = ((value % 360) + 360) % 360;
  return Number.isFinite(normalized) ? normalized : 0;
};

const shortestAngleDelta = (fromDegrees, toDegrees) => {
  const from = normalizeDegrees(fromDegrees);
  const to = normalizeDegrees(toDegrees);
  let delta = to - from;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
};

const getStepProgressByChannel = (stepProgress, playbackSpeed) => {
  // Playback speed controls beat-to-beat auto-advance timing in game.js.
  // Keep per-step channel progress stable so speed changes mid-beat do not rewind/teleport animations.
  const clamped = clamp(stepProgress, 0, 1);
  void playbackSpeed;
  return {
    movement: clamped,
    rotation: clamped,
    attack: clamped,
  };
};

const getInterpolatedFacing = (fromFacing, toFacing, progress) => {
  if (!Number.isFinite(fromFacing) || !Number.isFinite(toFacing)) return toFacing;
  const delta = shortestAngleDelta(fromFacing, toFacing);
  return normalizeDegrees(fromFacing + delta * clamp(progress, 0, 1));
};

export {
  getInterpolatedFacing,
  getStepProgressByChannel,
  normalizeDegrees,
  shortestAngleDelta,
};
