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

export const LAND_HEXES = [
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
