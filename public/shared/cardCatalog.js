const CARD_DATA_URL = '/public/cards/cards.json';
let catalogPromise = null;

const normalizeCard = (card, type, index) => {
  if (!card || typeof card !== 'object') {
    return { id: `${type}-${index}`, name: `${type}-${index}`, type, priority: 0, actions: [], rotations: '*' };
  }
  const id = typeof card.id === 'string' && card.id.trim() ? card.id.trim() : `${type}-${index}`;
  const name = typeof card.name === 'string' && card.name.trim() ? card.name.trim() : id;
  const actions = Array.isArray(card.actions) ? card.actions.map((action) => `${action}`.trim()).filter(Boolean) : [];
  const rotations = typeof card.rotations === 'string' && card.rotations.trim() ? card.rotations.trim() : '*';
  const priority = Number.isFinite(card.priority) ? card.priority : 0;
  const damage = card.damage ?? 0;
  const kbf = card.kbf ?? 0;
  const activeText = typeof card.activeText === 'string' ? card.activeText.trim() : '';
  const passiveText = typeof card.passiveText === 'string' ? card.passiveText.trim() : '';
  return { id, name, type, priority, actions, rotations, damage, kbf, activeText, passiveText };
};

const normalizeDeck = (deck, index) => {
  if (!deck || typeof deck !== 'object') {
    return { id: `deck-${index}`, name: `Deck ${index + 1}`, characterId: '', movement: [], ability: [] };
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
  return { id, name, characterId, movement, ability };
};

export const loadCardCatalog = async () => {
  if (!catalogPromise) {
    catalogPromise = fetch(CARD_DATA_URL, { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load cards: ${response.status}`);
      }
      const data = await response.json();
      const movement = Array.isArray(data?.movement) ? data.movement : [];
      const ability = Array.isArray(data?.ability) ? data.ability : [];
      const decks = Array.isArray(data?.decks) ? data.decks : [];
      return {
        movement: movement.map((card, index) => normalizeCard(card, 'movement', index)),
        ability: ability.map((card, index) => normalizeCard(card, 'ability', index)),
        decks: decks.map((deck, index) => normalizeDeck(deck, index)),
      };
    });
  }
  return catalogPromise;
};
