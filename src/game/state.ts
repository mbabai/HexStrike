import { CharacterState, GameState, HexCoord } from '../types';
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

const STARTING_CHARACTERS: Array<Omit<CharacterState, 'userId' | 'characterId'>> = [
  { position: { q: 2, r: 0 }, facing: 'left' },
  { position: { q: -2, r: 0 }, facing: 'right' },
];

export const createInitialGameState = async (
  players: Array<{ userId: string; characterId: CharacterState['characterId'] }> = [],
): Promise<GameState> => {
  const { LAND_HEXES } = await loadSharedHex();
  return {
    public: {
      land: LAND_HEXES.map((tile) => ({ q: tile.q, r: tile.r })),
      beats: [],
      characters: players.slice(0, STARTING_CHARACTERS.length).map((player, index) => ({
        userId: player.userId,
        characterId: player.characterId,
        ...STARTING_CHARACTERS[index],
      })),
    },
    secret: {},
  };
};
