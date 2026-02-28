const THROW_IMMUNE_PASSIVE_CARD_IDS = new Set(['hip-throw', 'tackle']);
const PASSIVE_KBF_REDUCTION = new Map([['iron-will', 1]]);
const DAMAGE_ICON_ACTION = 'DAMAGEICON';

const normalizeActionLabel = (action) => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const isActionActive = (action) => {
  const label = normalizeActionLabel(action).toUpperCase();
  if (!label) return false;
  return label !== 'E' && label !== DAMAGE_ICON_ACTION;
};

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
