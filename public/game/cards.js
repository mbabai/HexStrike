const CARD_DATA_URL = '/public/game/cards.json';

const normalizeCard = (card, type, index) => {
  if (!card || typeof card !== 'object') {
    return { id: `${type}-${index}`, name: `${type}-${index}`, type, priority: 0, actions: [], rotations: '*' };
  }
  const id = typeof card.id === 'string' && card.id.trim() ? card.id.trim() : `${type}-${index}`;
  const name = typeof card.name === 'string' && card.name.trim() ? card.name.trim() : id;
  const actions = Array.isArray(card.actions) ? card.actions.map((action) => `${action}`.trim()) : [];
  const rotations = typeof card.rotations === 'string' && card.rotations.trim() ? card.rotations.trim() : '*';
  const priority = Number.isFinite(card.priority) ? card.priority : 0;
  const damage = Number.isFinite(card.damage) ? card.damage : 0;
  const kbf = Number.isFinite(card.kbf) ? card.kbf : 0;
  return { id, name, type, priority, actions, rotations, damage, kbf };
};

const shuffle = (list, rng) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

export const loadCardCatalog = async () => {
  const response = await fetch(CARD_DATA_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load cards: ${response.status}`);
  }
  const data = await response.json();
  const movement = Array.isArray(data?.movement) ? data.movement : [];
  const ability = Array.isArray(data?.ability) ? data.ability : [];
  return {
    movement: movement.map((card, index) => normalizeCard(card, 'movement', index)),
    ability: ability.map((card, index) => normalizeCard(card, 'ability', index)),
  };
};

export const buildPlayerHand = (catalog, abilityCount = 4, rng = Math.random) => {
  const movement = Array.isArray(catalog?.movement) ? catalog.movement : [];
  const ability = Array.isArray(catalog?.ability) ? catalog.ability : [];
  const selectedAbility = shuffle(ability, rng).slice(0, Math.min(abilityCount, ability.length));
  return {
    movement,
    ability: selectedAbility,
  };
};
