import { HexCoord } from '../types';

const LAND_ROWS = [
  { r: 0, qMin: -2, qMax: 2 },
  { r: 1, qMin: -2, qMax: 1 },
  { r: -1, qMin: -1, qMax: 2 },
];

export const isLandHex = (coord: HexCoord): boolean => {
  if (!coord) return false;
  const q = Number(coord.q);
  const r = Number(coord.r);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return false;
  const row = LAND_ROWS.find((candidate) => candidate.r === Math.round(r));
  if (!row) return false;
  const roundedQ = Math.round(q);
  return roundedQ >= row.qMin && roundedQ <= row.qMax;
};

export const getTerrain = (coord: HexCoord): 'land' | 'abyss' => (isLandHex(coord) ? 'land' : 'abyss');

export const buildDefaultLandHexes = (): HexCoord[] => {
  const tiles: HexCoord[] = [];
  LAND_ROWS.forEach((row) => {
    for (let q = row.qMin; q <= row.qMax; q += 1) {
      tiles.push({ q, r: row.r });
    }
  });
  return tiles;
};

export const DEFAULT_LAND_HEXES = buildDefaultLandHexes();
