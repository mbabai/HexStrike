import { CharacterId } from '../types';

export const CHARACTER_IDS: CharacterId[] = ['murelious', 'monkey-queen'];

export const CHARACTER_NAMES: Record<CharacterId, string> = {
  murelious: 'Murelious',
  'monkey-queen': 'Monkey Queen',
};

export const getCharacterName = (characterId: CharacterId) => CHARACTER_NAMES[characterId] ?? characterId;
