const ACTIVE_HIT_DISCARD_RULES = new Map([
  ['down-slash', { count: 1 }],
  ['spike', { count: 3 }],
  ['trip', { count: 2 }],
  ['sweeping-strike', { count: 1, centerOnly: true }],
]);

const PASSIVE_BLOCK_DISCARD = new Map([['sweeping-strike', 1]]);
const PASSIVE_START_DISCARD = new Map();
const PASSIVE_DISCARD_IMMUNE = new Set(['spike']);
const PASSIVE_CONVERT_KBF = new Set(['trip']);

const normalizeActionLabel = (action) => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const isActionActive = (action) => normalizeActionLabel(action).toUpperCase() !== 'E';

export const getActiveHitDiscardRule = (cardId) => (cardId ? ACTIVE_HIT_DISCARD_RULES.get(cardId) ?? null : null);

export const getPassiveBlockDiscardCount = (passiveCardId) =>
  passiveCardId ? PASSIVE_BLOCK_DISCARD.get(passiveCardId) ?? 0 : 0;

export const getPassiveStartDiscardCount = (passiveCardId) =>
  passiveCardId ? PASSIVE_START_DISCARD.get(passiveCardId) ?? 0 : 0;

export const isDiscardImmune = (entry) => {
  const passiveCardId = entry?.passiveCardId;
  if (!passiveCardId || !PASSIVE_DISCARD_IMMUNE.has(passiveCardId)) return false;
  return isActionActive(entry?.action);
};

export const shouldConvertKbfToDiscard = (entry) => {
  const passiveCardId = entry?.passiveCardId;
  if (!passiveCardId || !PASSIVE_CONVERT_KBF.has(passiveCardId)) return false;
  return isActionActive(entry?.action);
};

export const isCenterAttackPath = (path) => !/[LRB]/i.test(path ?? '');
