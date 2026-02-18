import { HexCoord } from '../types';

const coordKey = (coord: HexCoord | null | undefined): string | null => {
  if (!coord) return null;
  const q = Number(coord.q);
  const r = Number(coord.r);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  return `${Math.round(q)},${Math.round(r)}`;
};

export const LAND_HEXES_2P: HexCoord[] = [
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

export const LAND_HEXES_3P: HexCoord[] = [
  ...LAND_HEXES_2P,
  { q: 1, r: -3 },
  { q: 2, r: -3 },
  { q: 0, r: -2 },
  { q: 1, r: -2 },
  { q: 2, r: -2 },
];

export const LAND_HEXES_4P: HexCoord[] = [
  ...LAND_HEXES_3P,
  { q: -2, r: 2 },
  { q: -1, r: 2 },
  { q: 0, r: 2 },
  { q: -2, r: 3 },
  { q: -1, r: 3 },
];

const cloneLand = (land: HexCoord[]): HexCoord[] => land.map((hex) => ({ q: hex.q, r: hex.r }));

export const buildLandHexesForPlayerCount = (playerCount: number): HexCoord[] => {
  if (playerCount >= 4) return cloneLand(LAND_HEXES_4P);
  if (playerCount >= 3) return cloneLand(LAND_HEXES_3P);
  return cloneLand(LAND_HEXES_2P);
};

export const isLandHex = (
  coord: HexCoord,
  land: HexCoord[] = LAND_HEXES_2P,
): boolean => {
  const key = coordKey(coord);
  if (!key) return false;
  return land.some((tile) => coordKey(tile) === key);
};

export const getTerrain = (
  coord: HexCoord,
  land: HexCoord[] = LAND_HEXES_2P,
): 'land' | 'abyss' => (isLandHex(coord, land) ? 'land' : 'abyss');

export const buildDefaultLandHexes = (): HexCoord[] => cloneLand(LAND_HEXES_2P);

export const DEFAULT_LAND_HEXES = buildDefaultLandHexes();
