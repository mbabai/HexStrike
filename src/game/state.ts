import { CharacterState, GameState, HexCoord } from '../types';
import { getCharacterName } from './characters';
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

const STARTING_CHARACTERS: Array<Omit<CharacterState, 'userId' | 'username' | 'characterId' | 'characterName'>> = [
  { position: { q: 2, r: 0 }, facing: 'left' },
  { position: { q: -2, r: 0 }, facing: 'right' },
];
const DEFAULT_BEAT_COUNT = 1;
const DEFAULT_ACTION = 'E';

export const createInitialGameState = async (
  players: Array<{ userId: string; username: string; characterId: CharacterState['characterId'] }> = [],
): Promise<GameState> => {
  const { LAND_HEXES } = await loadSharedHex();
  const roster = players.slice(0, STARTING_CHARACTERS.length);
  const beats = Array.from({ length: roster.length ? DEFAULT_BEAT_COUNT : 0 }, () =>
    roster.map((player) => ({ username: player.username, action: DEFAULT_ACTION })),
  );
  return {
    public: {
      land: LAND_HEXES.map((tile) => ({ q: tile.q, r: tile.r })),
      beats,
      characters: roster.map((player, index) => ({
        userId: player.userId,
        username: player.username,
        characterId: player.characterId,
        characterName: getCharacterName(player.characterId),
        ...STARTING_CHARACTERS[index],
      })),
    },
    secret: {},
  };
};
