export const CHARACTER_IMAGE_SOURCES = {
  murelious: '/public/images/Murelious.png',
  'monkey-queen': '/public/images/MonkeyQueen.png',
};

export const CHARACTER_TOKEN_STYLE = {
  radiusFactor: 0.68,
  borderFactor: 0.12,
  arrowTipFactor: 1.55,
  arrowBaseFactor: 1.05,
  arrowWingFactor: 0.3,
};

export const getCharacterTokenMetrics = (size) => {
  const radius = size * CHARACTER_TOKEN_STYLE.radiusFactor;
  const borderWidth = Math.max(1.5, radius * CHARACTER_TOKEN_STYLE.borderFactor);
  const arrow = {
    tip: radius * CHARACTER_TOKEN_STYLE.arrowTipFactor - borderWidth,
    base: radius * CHARACTER_TOKEN_STYLE.arrowBaseFactor - borderWidth,
    wing: radius * CHARACTER_TOKEN_STYLE.arrowWingFactor,
  };
  return { radius, borderWidth, arrow };
};

export const getFacingArrowPoints = (x, y, metrics, facing) => {
  const safeFacing = Number.isFinite(facing) ? facing : 0;
  const angle = (safeFacing * Math.PI) / 180;
  const basePoints = {
    tip: { x: x - metrics.arrow.tip, y },
    baseTop: { x: x - metrics.arrow.base, y: y - metrics.arrow.wing },
    baseBottom: { x: x - metrics.arrow.base, y: y + metrics.arrow.wing },
  };
  const rotate = (point) => {
    const dx = point.x - x;
    const dy = point.y - y;
    return {
      x: x + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: y + dx * Math.sin(angle) + dy * Math.cos(angle),
    };
  };
  return {
    tip: rotate(basePoints.tip),
    baseTop: rotate(basePoints.baseTop),
    baseBottom: rotate(basePoints.baseBottom),
  };
};
