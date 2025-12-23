import { CharacterId } from '../types';

export const CHARACTER_IDS: CharacterId[] = [
  'murelious',
  'strylan',
  'monkey-queen',
  'ryathan',
  'zenytha',
  'aumandetta',
];

export const CHARACTER_NAMES: Record<CharacterId, string> = {
  murelious: 'Murelious',
  strylan: 'Strylan',
  'monkey-queen': 'Monkey Queen',
  ryathan: 'Ryathan',
  zenytha: 'Zenytha',
  aumandetta: 'Aumandetta',
};

export const getCharacterName = (characterId: CharacterId) => CHARACTER_NAMES[characterId] ?? characterId;
