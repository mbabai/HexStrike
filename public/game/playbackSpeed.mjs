const ATTACK_SPEED_SCALE_FACTOR = 0.5;

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

const getSafePlaybackSpeed = (value) =>
  Number.isFinite(value) && value > 0 ? Math.max(0.01, value) : 1;

const getAttackSpeedScale = (playbackSpeed) => 1 + (playbackSpeed - 1) * ATTACK_SPEED_SCALE_FACTOR;

const getStepProgressByChannel = (stepProgress, playbackSpeed) => {
  const safeSpeed = getSafePlaybackSpeed(playbackSpeed);
  return {
    movement: clamp(stepProgress * safeSpeed, 0, 1),
    rotation: clamp(stepProgress * safeSpeed, 0, 1),
    attack: clamp(stepProgress * getAttackSpeedScale(safeSpeed), 0, 1),
  };
};

const getInterpolatedFacing = (fromFacing, toFacing, progress) => {
  if (!Number.isFinite(fromFacing) || !Number.isFinite(toFacing)) return toFacing;
  const delta = shortestAngleDelta(fromFacing, toFacing);
  return normalizeDegrees(fromFacing + delta * clamp(progress, 0, 1));
};

export {
  ATTACK_SPEED_SCALE_FACTOR,
  getAttackSpeedScale,
  getInterpolatedFacing,
  getSafePlaybackSpeed,
  getStepProgressByChannel,
  normalizeDegrees,
  shortestAngleDelta,
};
