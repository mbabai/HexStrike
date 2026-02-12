import { loadCardCatalog } from './shared/cardCatalog.js';
import { getOrCreateUserId, getSelectedDeckId, getStoredCustomDecks, setStoredCustomDecks } from './storage.js';

const LEGACY_DECK_STORAGE_PREFIX = 'hexstrikeDecks:';
const LEGACY_DECK_STORAGE_VERSION_PREFIX = 'hexstrikeDecksVersion:';
const LEGACY_DECK_STORAGE_VERSION = 2;
let baseDecksPromise = null;

const getLegacyDeckStorageKey = (userId) => `${LEGACY_DECK_STORAGE_PREFIX}${userId}`;
const getLegacyDeckStorageVersionKey = (userId) => `${LEGACY_DECK_STORAGE_VERSION_PREFIX}${userId}`;

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

const readLegacyDeckStorageVersion = (userId) => {
  if (!userId) return null;
  const raw = localStorage.getItem(getLegacyDeckStorageVersionKey(userId));
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const readLegacyStoredDecks = (userId) => {
  if (!userId) return null;
  const storageVersion = readLegacyDeckStorageVersion(userId);
  if (storageVersion !== LEGACY_DECK_STORAGE_VERSION) return null;
  const raw = localStorage.getItem(getLegacyDeckStorageKey(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((deck, index) => normalizeDeckDefinition(deck, index));
  } catch (err) {
    console.warn('Failed to parse legacy deck storage', err);
    return null;
  }
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

const mergeBaseAndCustomDecks = (baseDecks, customDecks) => {
  const baseById = new Map(baseDecks.map((deck) => [deck.id, deck]));
  const merged = [...baseDecks];
  customDecks.forEach((deck) => {
    if (deck.isBase) return;
    if (baseById.has(deck.id)) return;
    merged.push(deck);
  });
  return merged;
};

const loadStoredCustomDecks = (userId) => {
  const cookieDecks = getStoredCustomDecks();
  if (Array.isArray(cookieDecks)) {
    return cookieDecks.map((deck, index) => normalizeDeckDefinition({ ...deck, isBase: false }, index));
  }

  const legacyDecks = readLegacyStoredDecks(userId);
  if (!Array.isArray(legacyDecks)) {
    return [];
  }
  const customDecks = legacyDecks
    .filter((deck) => !deck.isBase)
    .map((deck, index) => normalizeDeckDefinition({ ...deck, isBase: false }, index));
  setStoredCustomDecks(customDecks);
  return customDecks;
};

export const loadUserDecks = async (userId = getOrCreateUserId()) => {
  const baseDecks = await loadBaseDecks();
  const customDecks = loadStoredCustomDecks(userId);
  return mergeBaseAndCustomDecks(baseDecks, customDecks);
};

export const saveUserDecks = (userId, decks) => {
  const normalized = Array.isArray(decks) ? decks.map((deck, index) => normalizeDeckDefinition(deck, index)) : [];
  const customDecks = normalized
    .filter((deck) => !deck.isBase)
    .map((deck, index) => normalizeDeckDefinition({ ...deck, isBase: false }, index));
  setStoredCustomDecks(customDecks);
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
