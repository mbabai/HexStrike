import { BeatEntry } from '../../types';

type HitDiscardRule = {
  count: number;
  centerOnly?: boolean;
};

const ACTIVE_HIT_DISCARD_RULES = new Map<string, HitDiscardRule>([
  ['down-slash', { count: 1 }],
  ['spike', { count: 3 }],
  ['sweeping-strike', { count: 2 }],
  ['trip', { count: 1, centerOnly: true }],
]);

const PASSIVE_BLOCK_DISCARD = new Map<string, number>([['trip', 1]]);
const PASSIVE_START_DISCARD = new Map<string, number>();
const PASSIVE_DISCARD_IMMUNE = new Set<string>(['spike']);
const PASSIVE_CONVERT_KBF = new Set<string>(['sweeping-strike']);
const DAMAGE_ICON_ACTION = 'DAMAGEICON';

const normalizeActionLabel = (action: string | undefined): string => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const isActionActive = (action: string | undefined): boolean => {
  const label = normalizeActionLabel(action).toUpperCase();
  if (!label) return false;
  return label !== 'E' && label !== DAMAGE_ICON_ACTION;
};

export const getActiveHitDiscardRule = (cardId: string | undefined | null): HitDiscardRule | null =>
  cardId ? ACTIVE_HIT_DISCARD_RULES.get(cardId) ?? null : null;

export const getPassiveBlockDiscardCount = (passiveCardId: string | undefined | null): number =>
  passiveCardId ? PASSIVE_BLOCK_DISCARD.get(passiveCardId) ?? 0 : 0;

export const getPassiveStartDiscardCount = (passiveCardId: string | undefined | null): number =>
  passiveCardId ? PASSIVE_START_DISCARD.get(passiveCardId) ?? 0 : 0;

export const isDiscardImmune = (entry: BeatEntry | null | undefined): boolean => {
  const passiveCardId = entry?.passiveCardId;
  if (!passiveCardId || !PASSIVE_DISCARD_IMMUNE.has(passiveCardId)) return false;
  return isActionActive(entry?.action);
};

export const shouldConvertKbfToDiscard = (entry: BeatEntry | null | undefined): boolean => {
  const passiveCardId = entry?.passiveCardId;
  if (!passiveCardId || !PASSIVE_CONVERT_KBF.has(passiveCardId)) return false;
  return isActionActive(entry?.action);
};

export const isCenterAttackPath = (path: string): boolean => !/[LRB]/i.test(path ?? '');
