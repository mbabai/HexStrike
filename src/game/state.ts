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
const DEFAULT_BEAT_COUNT = 10;
const DEFAULT_ACTION = 'E';

export const createInitialGameState = async (
  players: Array<{ userId: string; characterId: CharacterState['characterId'] }> = [],
): Promise<GameState> => {
  const { LAND_HEXES } = await loadSharedHex();
  const roster = players.slice(0, STARTING_CHARACTERS.length);
  const beats = Array.from({ length: roster.length ? DEFAULT_BEAT_COUNT : 0 }, () =>
    roster.map((player) => ({ userId: player.userId, action: DEFAULT_ACTION })),
  );
  return {
    public: {
      land: LAND_HEXES.map((tile) => ({ q: tile.q, r: tile.r })),
      beats,
      characters: roster.map((player, index) => ({
        userId: player.userId,
        characterId: player.characterId,
        ...STARTING_CHARACTERS[index],
      })),
    },
    secret: {},
  };
};
