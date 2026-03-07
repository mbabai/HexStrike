import type { BeatEntry } from '../../../types';
import { getDiscardSpec, type HitDiscardRule } from './discardSpecs';
import { isRefreshActionLabel, normalizeActionLabel } from '../actionSymbols';

const isActionActive = (action: string | undefined): boolean => {
  const label = normalizeActionLabel(action).toUpperCase();
  if (!label) return false;
  return !isRefreshActionLabel(label);
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
  return Boolean(label && !isRefreshActionLabel(label) && label !== 'DAMAGEICON');
};

export const shouldConvertKbfToDiscard = (entry: BeatEntry | null | undefined): boolean => {
  const spec = getDiscardSpec(entry?.passiveCardId);
  if (!spec?.convertKbfToDiscardWhileActive) return false;
  const action = entry?.action;
  if (spec.convertKbfToDiscardOnDamageIcon) {
    return isActionActive(action);
  }
  const label = normalizeActionLabel(action).toUpperCase();
  return Boolean(label && !isRefreshActionLabel(label) && label !== 'DAMAGEICON');
};

export const isCenterAttackPath = (path: string): boolean => !/[LRB]/i.test(path ?? '');
