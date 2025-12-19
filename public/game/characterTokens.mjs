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
  const direction = facing === 'left' ? -1 : 1;
  return {
    tip: { x: x + direction * metrics.arrow.tip, y },
    baseTop: { x: x + direction * metrics.arrow.base, y: y - metrics.arrow.wing },
    baseBottom: { x: x + direction * metrics.arrow.base, y: y + metrics.arrow.wing },
  };
};
