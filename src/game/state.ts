import { GameState, HexCoord } from '../types';
import { join } from 'path';
import { pathToFileURL } from 'url';

type SharedHexModule = {
  LAND_HEXES: HexCoord[];
};

let sharedHexPromise: Promise<SharedHexModule> | null = null;
const dynamicImport = new Function('specifier', 'return import(specifier);') as (
  specifier: string,
) => Promise<SharedHexModule>;

const loadSharedHex = () => {
  if (!sharedHexPromise) {
    const moduleUrl = pathToFileURL(join(process.cwd(), 'public', 'shared', 'hex.mjs')).href;
    sharedHexPromise = dynamicImport(moduleUrl);
  }
  return sharedHexPromise;
};

export const createInitialGameState = async (): Promise<GameState> => {
  const { LAND_HEXES } = await loadSharedHex();
  return {
    public: {
      land: LAND_HEXES.map((tile) => ({ q: tile.q, r: tile.r })),
    },
    secret: {},
  };
};
