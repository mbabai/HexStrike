import { BeatEntry } from '../../types';

type HitDiscardRule = {
  count: number;
  centerOnly?: boolean;
};

const ACTIVE_HIT_DISCARD_RULES = new Map<string, HitDiscardRule>([
  ['down-slash', { count: 1 }],
  ['spike', { count: 3 }],
  ['trip', { count: 2 }],
  ['sweeping-strike', { count: 1, centerOnly: true }],
]);

const PASSIVE_BLOCK_DISCARD = new Map<string, number>([['sweeping-strike', 1]]);
const PASSIVE_START_DISCARD = new Map<string, number>();
const PASSIVE_DISCARD_IMMUNE = new Set<string>(['spike']);
const PASSIVE_CONVERT_KBF = new Set<string>(['trip']);

const normalizeActionLabel = (action: string | undefined): string => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const isActionActive = (action: string | undefined): boolean => normalizeActionLabel(action).toUpperCase() !== 'E';

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
