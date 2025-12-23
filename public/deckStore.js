import { loadCardCatalog } from './shared/cardCatalog.js';
import { getOrCreateUserId, getSelectedDeckId } from './storage.js';

const DECK_STORAGE_PREFIX = 'hexstrikeDecks:';
let baseDecksPromise = null;

const getDeckStorageKey = (userId) => `${DECK_STORAGE_PREFIX}${userId}`;

const normalizeDeckDefinition = (deck, index) => {
  if (!deck || typeof deck !== 'object') {
    return {
      id: `deck-${index}`,
      name: `Deck ${index + 1}`,
      characterId: '',
      movement: [],
      ability: [],
      isBase: false,
    };
  }
  const id = typeof deck.id === 'string' && deck.id.trim() ? deck.id.trim() : `deck-${index}`;
  const name = typeof deck.name === 'string' && deck.name.trim() ? deck.name.trim() : id;
  const characterId = typeof deck.characterId === 'string' ? deck.characterId.trim() : '';
  const movement = Array.isArray(deck.movement)
    ? deck.movement.map((cardId) => `${cardId}`.trim()).filter(Boolean)
    : [];
  const ability = Array.isArray(deck.ability)
    ? deck.ability.map((cardId) => `${cardId}`.trim()).filter(Boolean)
    : [];
  const isBase = Boolean(deck.isBase);
  return { id, name, characterId, movement, ability, isBase };
};

const readStoredDecks = (userId) => {
  if (!userId) return null;
  const raw = localStorage.getItem(getDeckStorageKey(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((deck, index) => normalizeDeckDefinition(deck, index));
  } catch (err) {
    console.warn('Failed to parse deck storage', err);
    return null;
  }
};

const writeStoredDecks = (userId, decks) => {
  if (!userId) return;
  localStorage.setItem(getDeckStorageKey(userId), JSON.stringify(decks));
};

const loadBaseDecks = async () => {
  if (!baseDecksPromise) {
    baseDecksPromise = loadCardCatalog().then((catalog) => {
      const decks = Array.isArray(catalog?.decks) ? catalog.decks : [];
      return decks.map((deck, index) => normalizeDeckDefinition({ ...deck, isBase: true }, index));
    });
  }
  return baseDecksPromise;
};

export const loadUserDecks = async (userId = getOrCreateUserId()) => {
  const stored = readStoredDecks(userId);
  if (stored !== null) return stored;
  const baseDecks = await loadBaseDecks();
  writeStoredDecks(userId, baseDecks);
  return baseDecks;
};

export const saveUserDecks = (userId, decks) => {
  const normalized = Array.isArray(decks) ? decks.map((deck, index) => normalizeDeckDefinition(deck, index)) : [];
  writeStoredDecks(userId, normalized);
  return normalized;
};

export const getSelectedDeck = async (userId = getOrCreateUserId()) => {
  const deckId = getSelectedDeckId();
  if (!deckId) return null;
  const decks = await loadUserDecks(userId);
  return decks.find((deck) => deck.id === deckId) || null;
};

export const createDeckId = () => {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `deck-${Math.random().toString(16).slice(2)}-${Date.now()}`;
};
