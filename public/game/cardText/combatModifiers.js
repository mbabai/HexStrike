const THROW_IMMUNE_PASSIVE_CARD_IDS = new Set(['hip-throw', 'tackle']);
const PASSIVE_KBF_REDUCTION = new Map([['iron-will', 1]]);

const normalizeActionLabel = (action) => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const isActionActive = (action) => normalizeActionLabel(action).toUpperCase() !== 'E';

export const isThrowImmune = (entry) => {
  const passiveCardId = entry?.passiveCardId ?? '';
  if (!passiveCardId || !THROW_IMMUNE_PASSIVE_CARD_IDS.has(passiveCardId)) return false;
  return isActionActive(entry?.action);
};

export const getPassiveKbfReduction = (entry) => {
  const passiveCardId = entry?.passiveCardId ?? '';
  if (!passiveCardId) return 0;
  const reduction = PASSIVE_KBF_REDUCTION.get(passiveCardId) ?? 0;
  return reduction && isActionActive(entry?.action) ? reduction : 0;
};
