const SQRT3 = Math.sqrt(3);

export const COORDINATE_SYSTEM = 'axial';
export const HEX_ORIENTATION = 'pointy';

export const AXIAL_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export const LAND_HEXES_2P = [
  { q: -2, r: 1 },
  { q: -1, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: -1 },
  { q: 0, r: 0 },
  { q: 0, r: 1 },
  { q: 1, r: -1 },
  { q: 1, r: 0 },
  { q: 1, r: 1 },
  { q: -2, r: 0 },
  { q: 2, r: 0 },
  { q: 2, r: -1 },
];

export const LAND_HEXES_3P = [
  ...LAND_HEXES_2P,
  { q: 1, r: -3 },
  { q: 2, r: -3 },
  { q: 0, r: -2 },
  { q: 1, r: -2 },
  { q: 2, r: -2 },
];

export const LAND_HEXES_4P = [
  ...LAND_HEXES_3P,
  { q: -2, r: 2 },
  { q: -1, r: 2 },
  { q: 0, r: 2 },
  { q: -2, r: 3 },
  { q: -1, r: 3 },
];

export const LAND_HEXES = LAND_HEXES_2P;

export const getLandHexesForPlayerCount = (playerCount) => {
  const count = Number(playerCount);
  if (Number.isFinite(count) && count >= 4) {
    return LAND_HEXES_4P.map((hex) => ({ q: hex.q, r: hex.r }));
  }
  if (Number.isFinite(count) && count >= 3) {
    return LAND_HEXES_3P.map((hex) => ({ q: hex.q, r: hex.r }));
  }
  return LAND_HEXES_2P.map((hex) => ({ q: hex.q, r: hex.r }));
};

export const getHexSize = (viewportWidth, factor) => viewportWidth / factor;

export const axialToPixel = (q, r, size) => ({
  x: size * SQRT3 * (q + r / 2),
  y: size * 1.5 * r,
});

export const getWorldBounds = (viewport, viewState) => ({
  minX: -viewState.offset.x / viewState.scale,
  maxX: (viewport.width - viewState.offset.x) / viewState.scale,
  minY: -viewState.offset.y / viewState.scale,
  maxY: (viewport.height - viewState.offset.y) / viewState.scale,
});

export const getRowRange = (bounds, size, padding) => ({
  rMin: Math.floor((bounds.minY - size) / (1.5 * size)) - padding,
  rMax: Math.ceil((bounds.maxY + size) / (1.5 * size)) + padding,
});

export const getColumnRange = (bounds, size, padding, r) => ({
  qMin: Math.floor(bounds.minX / (SQRT3 * size) - r / 2) - padding,
  qMax: Math.ceil(bounds.maxX / (SQRT3 * size) - r / 2) + padding,
});
