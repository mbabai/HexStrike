import { getPassiveModifierSpec } from './passiveModifierSpecs';

type PassiveCardEntry = {
  passiveCardId?: string | null;
  action?: string | null;
};

const DAMAGE_ICON_ACTION = 'DAMAGEICON';

const normalizeActionLabel = (action: string | null | undefined): string => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const isActionActiveForPassiveModifiers = (action: string | null | undefined): boolean => {
  const label = normalizeActionLabel(action).toUpperCase();
  if (!label) return false;
  return label !== 'E';
};

const isActionActiveForThrowImmunity = (action: string | null | undefined): boolean => {
  const label = normalizeActionLabel(action).toUpperCase();
  if (!label) return false;
  return label !== 'E' && label !== DAMAGE_ICON_ACTION;
};

export const isThrowImmune = (entry: PassiveCardEntry | null | undefined): boolean => {
  const spec = getPassiveModifierSpec(entry?.passiveCardId);
  if (!spec?.throwImmuneWhileActive) return false;
  const action = entry?.action;
  if (spec.throwImmuneOnDamageIcon) {
    return isActionActiveForPassiveModifiers(action);
  }
  return isActionActiveForThrowImmunity(action);
};

export const getPassiveKbfReduction = (entry: PassiveCardEntry | null | undefined): number => {
  const spec = getPassiveModifierSpec(entry?.passiveCardId);
  const reduction = spec?.kbfReductionWhileActive ?? 0;
  if (!reduction) return 0;
  const action = entry?.action;
  if (spec?.kbfReductionOnDamageIcon) {
    return isActionActiveForPassiveModifiers(action) ? reduction : 0;
  }
  return isActionActiveForThrowImmunity(action) ? reduction : 0;
};
