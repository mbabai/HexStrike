import { loadCardCatalog as loadCatalog } from '../shared/cardCatalog.js';

const shuffle = (list, rng) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const buildCardLookup = (catalog) => {
  const map = new Map();
  if (Array.isArray(catalog?.movement)) {
    catalog.movement.forEach((card) => map.set(card.id, card));
  }
  if (Array.isArray(catalog?.ability)) {
    catalog.ability.forEach((card) => map.set(card.id, card));
  }
  return map;
};

export const loadCardCatalog = async () => loadCatalog();

export const buildPlayerHand = (catalog, abilityCount = 4, rng = Math.random) => {
  const movement = Array.isArray(catalog?.movement) ? catalog.movement : [];
  const ability = Array.isArray(catalog?.ability) ? catalog.ability : [];
  const selectedAbility = shuffle(ability, rng).slice(0, Math.min(abilityCount, ability.length));
  return {
    movement,
    ability: selectedAbility,
  };
};

export const buildDeckHand = (catalog, deck) => {
  if (!deck) return buildPlayerHand(catalog);
  const lookup = buildCardLookup(catalog);
  const movement = Array.isArray(deck?.movement)
    ? deck.movement.map((cardId) => lookup.get(cardId)).filter(Boolean)
    : [];
  const ability = Array.isArray(deck?.ability)
    ? deck.ability.map((cardId) => lookup.get(cardId)).filter(Boolean)
    : [];
  return { movement, ability };
};
