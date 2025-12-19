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
  const characters = roster.map((player, index) => ({
    userId: player.userId,
    username: player.username,
    characterId: player.characterId,
    characterName: getCharacterName(player.characterId),
    ...STARTING_CHARACTERS[index],
  }));
  const beats = Array.from({ length: characters.length ? DEFAULT_BEAT_COUNT : 0 }, () =>
    characters.map((character) => ({
      username: character.username,
      action: DEFAULT_ACTION,
      damage: 0,
      location: { q: character.position.q, r: character.position.r },
    })),
  );
  return {
    public: {
      land: LAND_HEXES.map((tile) => ({ q: tile.q, r: tile.r })),
      beats,
      characters,
    },
    secret: {},
  };
};
