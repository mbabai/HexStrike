import { loadCardCatalog } from './shared/cardCatalog.js';
import { getOrCreateUserId, getSelectedDeckId } from './storage.js';

const DECK_STORAGE_PREFIX = 'hexstrikeDecks:';
const DECK_STORAGE_VERSION_PREFIX = 'hexstrikeDecksVersion:';
const DECK_STORAGE_VERSION = 2;
let baseDecksPromise = null;

const getDeckStorageKey = (userId) => `${DECK_STORAGE_PREFIX}${userId}`;
const getDeckStorageVersionKey = (userId) => `${DECK_STORAGE_VERSION_PREFIX}${userId}`;

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

const readDeckStorageVersion = (userId) => {
  if (!userId) return null;
  const raw = localStorage.getItem(getDeckStorageVersionKey(userId));
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const writeDeckStorageVersion = (userId) => {
  if (!userId) return;
  localStorage.setItem(getDeckStorageVersionKey(userId), `${DECK_STORAGE_VERSION}`);
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

const mergeBaseDecks = (storedDecks, baseDecks) => {
  if (!Array.isArray(storedDecks)) return baseDecks;
  const baseById = new Map(baseDecks.map((deck) => [deck.id, deck]));
  const merged = [];
  storedDecks.forEach((deck) => {
    const base = baseById.get(deck.id);
    if (base) {
      merged.push({ ...base, isBase: true });
      baseById.delete(deck.id);
      return;
    }
    if (deck.isBase) {
      return;
    }
    merged.push(deck);
  });
  baseById.forEach((deck) => {
    merged.push(deck);
  });
  return merged;
};

const areArraysEqual = (a, b) => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const areDecksEqual = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.characterId === b.characterId &&
    Boolean(a.isBase) === Boolean(b.isBase) &&
    areArraysEqual(a.movement, b.movement) &&
    areArraysEqual(a.ability, b.ability)
  );
};

const areDeckListsEqual = (a, b) => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!areDecksEqual(a[i], b[i])) return false;
  }
  return true;
};

export const loadUserDecks = async (userId = getOrCreateUserId()) => {
  const baseDecks = await loadBaseDecks();
  const storageVersion = readDeckStorageVersion(userId);
  if (storageVersion !== DECK_STORAGE_VERSION) {
    writeStoredDecks(userId, baseDecks);
    writeDeckStorageVersion(userId);
    return baseDecks;
  }

  const stored = readStoredDecks(userId);
  if (stored !== null) {
    const merged = mergeBaseDecks(stored, baseDecks);
    if (!areDeckListsEqual(merged, stored)) {
      writeStoredDecks(userId, merged);
      writeDeckStorageVersion(userId);
      return merged;
    }
    return stored;
  }
  writeStoredDecks(userId, baseDecks);
  writeDeckStorageVersion(userId);
  return baseDecks;
};

export const saveUserDecks = (userId, decks) => {
  const normalized = Array.isArray(decks) ? decks.map((deck, index) => normalizeDeckDefinition(deck, index)) : [];
  writeStoredDecks(userId, normalized);
  writeDeckStorageVersion(userId);
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
