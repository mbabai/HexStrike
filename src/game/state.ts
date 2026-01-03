import { getCharacterName } from './characters';
import { buildDefaultLandHexes, getTerrain } from './hexGrid';
import { CharacterId, GameStateDoc } from '../types';

const STARTING_CHARACTERS = [
  { position: { q: 2, r: 0 }, facing: 0 },
  { position: { q: -2, r: 0 }, facing: 180 },
];

const DEFAULT_BEAT_COUNT = 1;
const DEFAULT_ACTION = 'E';

export const createInitialGameState = async (
  players: Array<{ userId: string; username: string; characterId: CharacterId }> = [],
): Promise<GameStateDoc> => {
  const roster = players.slice(0, STARTING_CHARACTERS.length);
  const characters = roster.map((player, index) => ({
    userId: player.userId,
    username: player.username,
    characterId: player.characterId,
    characterName: getCharacterName(player.characterId),
    position: { ...STARTING_CHARACTERS[index].position },
    facing: STARTING_CHARACTERS[index].facing,
  }));
  const land = buildDefaultLandHexes();
  const beats = Array.from({ length: characters.length ? DEFAULT_BEAT_COUNT : 0 }, () =>
    characters.map((character) => ({
      username: character.username,
      action: DEFAULT_ACTION,
      rotation: '',
      priority: 0,
      damage: 0,
      location: { q: character.position.q, r: character.position.r },
      terrain: getTerrain(character.position),
      facing: character.facing,
      calculated: false,
    })),
  );

  return {
    public: {
      land,
      beats,
      timeline: beats,
      characters,
      pendingActions: undefined,
      customInteractions: [],
      matchOutcome: undefined,
    },
    secret: {},
  };
};
