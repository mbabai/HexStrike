const SPECIAL_MARKERS = new Set(['X1', 'X2', 'F']);
const ROTATION_LABELS = ['0', 'R1', 'R2', '3', 'L2', 'L1'];
const TIMING_ORDER = ['early', 'mid', 'late'];

const toFiniteNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(`${value ?? ''}`.trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const getRotationMagnitude = (label) => {
  const value = `${label ?? ''}`.trim().toUpperCase();
  if (value === '0') return 0;
  if (value === '3') return 3;
  if (value.startsWith('L') || value.startsWith('R')) {
    const amount = Number(value.slice(1));
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
};

const buildAllowedRotationSet = (restriction) => {
  const trimmed = `${restriction ?? ''}`.trim();
  if (!trimmed || trimmed === '*') return null;
  const [minRaw, maxRaw] = trimmed.split('-');
  const min = Number(minRaw);
  const max = Number(maxRaw);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const allowed = new Set();
  ROTATION_LABELS.forEach((label) => {
    const magnitude = getRotationMagnitude(label);
    if (magnitude === null) return;
    if (magnitude >= min && magnitude <= max) {
      allowed.add(label);
    }
  });
  return allowed;
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
  if (isRefreshActionLabel(last)) {
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

export const getCardRecoveryFrames = (card) => {
  const beats = getActionBeats(card);
  let waits = 0;
  for (let index = beats.length - 1; index >= 0; index -= 1) {
    if (normalizeActionLabel(beats[index]).toUpperCase() !== 'W') break;
    waits += 1;
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

export const getCardPriorityValue = (card) => toFiniteNumber(card?.priority);

export const getCardTimingSortValue = (card) => {
  const timings = Array.isArray(card?.timings) ? card.timings : [];
  let best = TIMING_ORDER.length;
  timings.forEach((timing) => {
    if (!Array.isArray(timing)) return;
    TIMING_ORDER.forEach((phase, index) => {
      if (timing.includes(phase)) {
        best = Math.min(best, index);
      }
    });
  });
  return best;
};

export const getCardRotationOptionCount = (card) => {
  const allowed = buildAllowedRotationSet(card?.rotations);
  return allowed ? allowed.size : ROTATION_LABELS.length;
};
import { isRefreshActionLabel } from './actionSymbols.js';
