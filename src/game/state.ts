import { getCharacterName } from './characters';
import { buildLandHexesForPlayerCount, getTerrain } from './hexGrid';
import { createInitialFfaState } from './ffaState';
import { CharacterId, GameStateDoc } from '../types';

const STARTING_CHARACTERS_2P = [
  { position: { q: 2, r: 0 }, facing: 0 },
  { position: { q: -2, r: 0 }, facing: 180 },
];

const STARTING_CHARACTERS_3P = [
  { position: { q: 2, r: 0 }, facing: 0 },
  { position: { q: 1, r: -3 }, facing: 240 },
  { position: { q: -2, r: 1 }, facing: 120 },
];

const STARTING_CHARACTERS_4P = [
  { position: { q: 1, r: 1 }, facing: 300 },
  { position: { q: 2, r: -2 }, facing: 60 },
  { position: { q: 0, r: -2 }, facing: 120 },
  { position: { q: -2, r: 2 }, facing: 240 },
];

const getStartingCharacters = (playerCount: number) => {
  if (playerCount >= 4) return STARTING_CHARACTERS_4P;
  if (playerCount >= 3) return STARTING_CHARACTERS_3P;
  return STARTING_CHARACTERS_2P;
};

const DEFAULT_BEAT_COUNT = 1;
const DEFAULT_ACTION = 'E';

export const createInitialGameState = async (
  players: Array<{ userId: string; username: string; characterId: CharacterId }> = [],
): Promise<GameStateDoc> => {
  const startingCharacters = getStartingCharacters(players.length);
  const roster = players.slice(0, startingCharacters.length);
  const characters = roster.map((player, index) => ({
    userId: player.userId,
    username: player.username,
    characterId: player.characterId,
    characterName: getCharacterName(player.characterId),
    position: { ...startingCharacters[index].position },
    facing: startingCharacters[index].facing,
  }));
  const baselineCharacters = characters.map((character) => ({
    ...character,
    position: { q: character.position.q, r: character.position.r },
    facing: character.facing,
    damage: 0,
  }));
  const land = buildLandHexesForPlayerCount(characters.length);
  const ffa = createInitialFfaState(characters);
  const beats = Array.from({ length: characters.length ? DEFAULT_BEAT_COUNT : 0 }, () =>
    characters.map((character) => ({
      username: character.username,
      action: DEFAULT_ACTION,
      rotation: '',
      priority: 0,
      damage: 0,
      location: { q: character.position.q, r: character.position.r },
      terrain: getTerrain(character.position, land),
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
      startingCharacters: baselineCharacters,
      boardTokens: [],
      pendingActions: undefined,
      customInteractions: [],
      matchOutcome: undefined,
      ffa,
    },
    secret: {},
  };
};
