import { readFile } from 'fs/promises';
import { join } from 'path';

export type CardType = 'movement' | 'ability';

export interface CardDefinition {
  id: string;
  name: string;
  type: CardType;
  priority: number;
  actions: string[];
  rotations: string;
  damage: number;
  kbf: number;
}

export interface DeckDefinition {
  movement: string[];
  ability: string[];
}

export interface CardCatalog {
  movement: CardDefinition[];
  ability: CardDefinition[];
  decks: DeckDefinition[];
  cardsById: Map<string, CardDefinition>;
}

const CARD_DATA_PATH = join(process.cwd(), 'public', 'cards', 'cards.json');
let catalogPromise: Promise<CardCatalog> | null = null;

const normalizeCard = (card: any, type: CardType, index: number): CardDefinition => {
  if (!card || typeof card !== 'object') {
    return {
      id: `${type}-${index}`,
      name: `${type}-${index}`,
      type,
      priority: 0,
      actions: [],
      rotations: '*',
      damage: 0,
      kbf: 0,
    };
  }
  const id = typeof card.id === 'string' && card.id.trim() ? card.id.trim() : `${type}-${index}`;
  const name = typeof card.name === 'string' && card.name.trim() ? card.name.trim() : id;
  const actions = Array.isArray(card.actions)
    ? card.actions.map((action: unknown) => `${action ?? ''}`.trim()).filter(Boolean)
    : [];
  const rotations = typeof card.rotations === 'string' && card.rotations.trim() ? card.rotations.trim() : '*';
  const priority = Number.isFinite(card.priority) ? card.priority : 0;
  const damage = Number.isFinite(card.damage) ? card.damage : 0;
  const kbf = Number.isFinite(card.kbf) ? card.kbf : 0;
  return { id, name, type, priority, actions, rotations, damage, kbf };
};

const normalizeDeck = (deck: any, index: number): DeckDefinition => {
  if (!deck || typeof deck !== 'object') {
    return { movement: [], ability: [] };
  }
  const movement = Array.isArray(deck.movement)
    ? deck.movement.map((cardId: unknown) => `${cardId ?? ''}`.trim()).filter(Boolean)
    : [];
  const ability = Array.isArray(deck.ability)
    ? deck.ability.map((cardId: unknown) => `${cardId ?? ''}`.trim()).filter(Boolean)
    : [];
  if (!movement.length && !ability.length) {
    return { movement: [], ability: [] };
  }
  return { movement, ability };
};

export const loadCardCatalog = async (): Promise<CardCatalog> => {
  if (!catalogPromise) {
    catalogPromise = readFile(CARD_DATA_PATH, 'utf8').then((raw) => {
      const data = JSON.parse(raw);
      const movement = Array.isArray(data?.movement) ? data.movement : [];
      const ability = Array.isArray(data?.ability) ? data.ability : [];
      const decks = Array.isArray(data?.decks) ? data.decks : [];
      const movementCards = movement.map((card, index) => normalizeCard(card, 'movement', index));
      const abilityCards = ability.map((card, index) => normalizeCard(card, 'ability', index));
      const cardsById = new Map<string, CardDefinition>();
      movementCards.forEach((card) => cardsById.set(card.id, card));
      abilityCards.forEach((card) => cardsById.set(card.id, card));
      return {
        movement: movementCards,
        ability: abilityCards,
        decks: decks.map((deck, index) => normalizeDeck(deck, index)),
        cardsById,
      };
    });
  }
  return catalogPromise;
};
