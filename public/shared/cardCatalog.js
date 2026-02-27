const CARD_DATA_URL = '/public/cards/cards.json';
const ALT_CARD_DATA_URL = '/public/cards/CardsAlternate.json';
const catalogPromiseByUrl = new Map();

const toFiniteNumber = (value, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(`${value ?? ''}`.trim());
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeSubBeat = (subBeat) => {
  if (!subBeat || typeof subBeat !== 'object') return null;
  const hasRange = Number.isFinite(subBeat.start) && Number.isFinite(subBeat.end);
  if (hasRange) {
    return { start: Math.max(1, Math.min(9, Math.round(subBeat.start))), end: Math.max(1, Math.min(9, Math.round(subBeat.end))) };
  }
  const value = toFiniteNumber(subBeat.value, Number.NaN);
  if (!Number.isFinite(value)) return null;
  return { value: Math.max(1, Math.min(9, Math.round(value))) };
};

const deriveLegacyPriorityFromBeats = (beats) => {
  const first = Array.isArray(beats) ? beats[0] : null;
  if (!first || !first.subBeat) return 0;
  const source = Number.isFinite(first.subBeat.value) ? first.subBeat.value : first.subBeat.start;
  const subBeat = Math.max(1, Math.min(9, Math.round(toFiniteNumber(source, 1))));
  return 100 - subBeat * 10;
};

const normalizeBeat = (beat, index) => {
  const action = typeof beat?.action === 'string' && beat.action.trim() ? beat.action.trim() : 'E';
  const textEntries = Array.isArray(beat?.text)
    ? beat.text
        .map((entry) => {
          if (typeof entry === 'string') {
            const text = entry.trim();
            return text ? { text } : null;
          }
          if (!entry || typeof entry !== 'object') return null;
          const text = typeof entry.text === 'string' ? entry.text.trim() : '';
          if (!text) return null;
          const placeholder = typeof entry.placeholder === 'string' && entry.placeholder.trim() ? entry.placeholder.trim() : null;
          return placeholder ? { placeholder, text } : { text };
        })
        .filter(Boolean)
    : [];
  const damage = beat?.damage ?? null;
  const kbf = beat?.kbf ?? null;
  return {
    beat: Number.isFinite(beat?.beat) ? Math.max(1, Math.round(beat.beat)) : index + 1,
    action,
    subBeat: normalizeSubBeat(beat?.subBeat),
    damage,
    kbf,
    text: textEntries,
  };
};

const normalizeCard = (card, type, index) => {
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
      activeText: '',
      passiveText: '',
      triggerText: '',
      cardText: '',
      beats: [],
    };
  }
  const id = typeof card.id === 'string' && card.id.trim() ? card.id.trim() : `${type}-${index}`;
  const name = typeof card.name === 'string' && card.name.trim() ? card.name.trim() : id;
  const actions = Array.isArray(card.actions) ? card.actions.map((action) => `${action}`.trim()).filter(Boolean) : [];
  const beats = Array.isArray(card.beats) ? card.beats.map((beat, beatIndex) => normalizeBeat(beat, beatIndex)) : [];
  const rotations = typeof card.rotations === 'string' && card.rotations.trim() ? card.rotations.trim() : '*';
  const priority = Number.isFinite(card.priority) ? card.priority : 0;
  const damage = card.damage ?? 0;
  const kbf = card.kbf ?? 0;
  const activeText = typeof card.activeText === 'string' ? card.activeText.trim() : '';
  const passiveText = typeof card.passiveText === 'string' ? card.passiveText.trim() : '';
  const triggerText = typeof card.triggerText === 'string' ? card.triggerText.trim() : '';
  const cardText = typeof card.cardText === 'string' ? card.cardText.trim() : '';
  return { id, name, type, priority, actions, rotations, damage, kbf, activeText, passiveText, triggerText, cardText, beats };
};

const normalizeAlternateCard = (card, type, index) => {
  const normalized = normalizeCard(card, type, index);
  const beats = Array.isArray(normalized.beats) ? normalized.beats : [];
  const actions = beats.map((beat) => `${beat.action ?? ''}`.trim()).filter(Boolean);
  const attackBeats = beats.filter((beat) => beat.damage !== null || beat.kbf !== null);
  const firstAttack = attackBeats[0] || null;
  const damage = card?.damage ?? (firstAttack?.damage ?? 0);
  const kbf = card?.kbf ?? (firstAttack?.kbf ?? 0);
  const priority = Number.isFinite(card?.priority) ? Number(card.priority) : deriveLegacyPriorityFromBeats(beats);
  return {
    ...normalized,
    priority,
    damage,
    kbf,
    actions,
    activeText: normalized.activeText || normalized.cardText || '',
  };
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

const loadCatalogByUrl = async (url, options = {}) => {
  const { alternate = false } = options;
  const cacheKey = `${url}::${alternate ? 'alt' : 'base'}`;
  if (!catalogPromiseByUrl.has(cacheKey)) {
    const promise = fetch(url, { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load cards (${url}): ${response.status}`);
      }
      const data = await response.json();
      const movement = Array.isArray(data?.movement) ? data.movement : [];
      const ability = Array.isArray(data?.ability) ? data.ability : [];
      const decks = Array.isArray(data?.decks) ? data.decks : [];
      const normalize = alternate ? normalizeAlternateCard : normalizeCard;
      return {
        movement: movement.map((card, index) => normalize(card, 'movement', index)),
        ability: ability.map((card, index) => normalize(card, 'ability', index)),
        decks: decks.map((deck, index) => normalizeDeck(deck, index)),
      };
    });
    catalogPromiseByUrl.set(cacheKey, promise);
  }
  return catalogPromiseByUrl.get(cacheKey);
};

export const loadCardCatalog = async () => loadCatalogByUrl(CARD_DATA_URL, { alternate: false });

export const loadAlternateCardCatalog = async () =>
  loadCatalogByUrl(ALT_CARD_DATA_URL, { alternate: true });
