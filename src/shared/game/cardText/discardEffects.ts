import type { BeatEntry } from '../../../types';
import { getDiscardSpec, type HitDiscardRule } from './discardSpecs';

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
  return label !== 'E';
};

export const getActiveHitDiscardRule = (cardId: string | undefined | null): HitDiscardRule | null =>
  getDiscardSpec(cardId)?.activeHitDiscard ?? null;

export const getPassiveBlockDiscardCount = (passiveCardId: string | undefined | null): number =>
  getDiscardSpec(passiveCardId)?.passiveBlockDiscardCount ?? 0;

export const getPassiveStartDiscardCount = (passiveCardId: string | undefined | null): number =>
  getDiscardSpec(passiveCardId)?.passiveStartDiscardCount ?? 0;

export const isDiscardImmune = (entry: BeatEntry | null | undefined): boolean => {
  const spec = getDiscardSpec(entry?.passiveCardId);
  if (!spec?.discardImmuneWhileActive) return false;
  const action = entry?.action;
  if (spec.discardImmuneOnDamageIcon) {
    return isActionActive(action);
  }
  const label = normalizeActionLabel(action).toUpperCase();
  return Boolean(label && label !== 'E' && label !== 'DAMAGEICON');
};

export const shouldConvertKbfToDiscard = (entry: BeatEntry | null | undefined): boolean => {
  const spec = getDiscardSpec(entry?.passiveCardId);
  if (!spec?.convertKbfToDiscardWhileActive) return false;
  const action = entry?.action;
  if (spec.convertKbfToDiscardOnDamageIcon) {
    return isActionActive(action);
  }
  const label = normalizeActionLabel(action).toUpperCase();
  return Boolean(label && label !== 'E' && label !== 'DAMAGEICON');
};

export const isCenterAttackPath = (path: string): boolean => !/[LRB]/i.test(path ?? '');
