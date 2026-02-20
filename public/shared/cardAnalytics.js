const SPECIAL_MARKERS = new Set(['X1', 'X2', 'F']);

const toFiniteNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(`${value ?? ''}`.trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeActionLabel = (action) => {
  const raw = `${action ?? ''}`.trim();
  if (!raw) return '';
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw.slice(1, -1).trim();
  }
  return raw;
};

const getActionBeats = (card) => {
  const actions = Array.isArray(card?.actions) ? card.actions.map((action) => `${action}`.trim()).filter(Boolean) : [];
  if (!actions.length) return [];
  const last = actions[actions.length - 1];
  if (last.toUpperCase() === 'E') {
    return actions.slice(0, -1);
  }
  return actions;
};

const splitActionTokens = (action) => {
  const normalized = normalizeActionLabel(action);
  if (!normalized) return [];
  return normalized
    .split('-')
    .map((token) => `${token}`.trim().replace(/^\[+|\]+$/g, ''))
    .filter(Boolean);
};

export const getCardActionTokens = (card) =>
  getActionBeats(card).flatMap((action) => splitActionTokens(action));

export const getCardTotalBeats = (card) => getActionBeats(card).length;

export const getCardWaitBeats = (card) =>
  getActionBeats(card).filter((action) => normalizeActionLabel(action).toUpperCase() === 'W').length;

export const getCardFramesToFirstAction = (card) => {
  const beats = getActionBeats(card);
  let waits = 0;
  for (const action of beats) {
    if (normalizeActionLabel(action).toUpperCase() === 'W') {
      waits += 1;
      continue;
    }
    break;
  }
  return waits;
};

export const cardHasAttackOrCharge = (card) =>
  getCardActionTokens(card).some((token) => {
    const lowered = token.toLowerCase();
    return lowered.endsWith('a') || lowered.endsWith('c');
  });

export const cardHasBlock = (card) =>
  getCardActionTokens(card).some((token) => token.toLowerCase().endsWith('b'));

export const cardHasSpecialMarker = (card) => {
  const actionHasMarker = getCardActionTokens(card).some((token) => SPECIAL_MARKERS.has(token.toUpperCase()));
  if (actionHasMarker) return true;
  const text = `${card?.activeText ?? ''} ${card?.passiveText ?? ''}`;
  return /\{(?:X1|X2|F)\}/i.test(text);
};

export const cardHasThrowText = (card) => {
  const text = `${card?.activeText ?? ''} ${card?.passiveText ?? ''}`;
  return /\bthrow\b/i.test(text);
};

export const isAbilityAttackCard = (card) => card?.type === 'ability' && cardHasAttackOrCharge(card);

export const isAbilityDefenseCard = (card) => card?.type === 'ability' && cardHasBlock(card);

export const isAbilitySpecialCard = (card) =>
  card?.type === 'ability' &&
  !cardHasAttackOrCharge(card) &&
  !cardHasBlock(card) &&
  cardHasSpecialMarker(card);

export const getCardDamageValue = (card) => toFiniteNumber(card?.damage);

export const getCardKbfValue = (card) => toFiniteNumber(card?.kbf);
