import { readFile } from 'fs';
import { join } from 'path';
import { CardCatalog, CardDefinition, CardType, DeckDefinition } from '../types';

const CARD_DATA_PATH = join(process.cwd(), 'public', 'cards', 'cards.json');

let catalogPromise: Promise<CardCatalog> | null = null;

const readFileUtf8 = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    readFile(path, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      const raw = typeof data === 'string' ? data : data?.toString?.('utf8') ?? '';
      resolve(raw);
    });
  });

const normalizeCard = (card: unknown, type: CardType, index: number): CardDefinition => {
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
  const raw = card as Record<string, unknown>;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `${type}-${index}`;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;
  const actions = Array.isArray(raw.actions)
    ? raw.actions.map((action) => `${action ?? ''}`.trim()).filter(Boolean)
    : [];
  const rotations = typeof raw.rotations === 'string' && raw.rotations.trim() ? raw.rotations.trim() : '*';
  const priority = Number.isFinite(raw.priority) ? Number(raw.priority) : 0;
  const damage = Number.isFinite(raw.damage) ? Number(raw.damage) : 0;
  const kbf = Number.isFinite(raw.kbf) ? Number(raw.kbf) : 0;
  const activeText = typeof raw.activeText === 'string' ? raw.activeText : undefined;
  const passiveText = typeof raw.passiveText === 'string' ? raw.passiveText : undefined;
  return { id, name, type, priority, actions, rotations, damage, kbf, activeText, passiveText };
};

const normalizeDeck = (deck: unknown): DeckDefinition => {
  if (!deck || typeof deck !== 'object') {
    return { movement: [], ability: [] };
  }
  const raw = deck as Record<string, unknown>;
  const movement = Array.isArray(raw.movement)
    ? raw.movement.map((cardId) => `${cardId ?? ''}`.trim()).filter(Boolean)
    : [];
  const ability = Array.isArray(raw.ability)
    ? raw.ability.map((cardId) => `${cardId ?? ''}`.trim()).filter(Boolean)
    : [];
  if (!movement.length && !ability.length) {
    return { movement: [], ability: [] };
  }
  return { movement, ability };
};

export const loadCardCatalog = async (): Promise<CardCatalog> => {
  if (!catalogPromise) {
    catalogPromise = readFileUtf8(CARD_DATA_PATH).then((raw) => {
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
        decks: decks.map((deck) => normalizeDeck(deck)),
        cardsById,
      };
    });
  }
  return catalogPromise;
};
