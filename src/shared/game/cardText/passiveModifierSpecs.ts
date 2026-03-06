export interface PassiveModifierSpec {
  cardId: string;
  throwImmuneWhileActive?: boolean;
  throwImmuneOnDamageIcon?: boolean;
  kbfReductionWhileActive?: number;
  kbfReductionOnDamageIcon?: boolean;
}

const PASSIVE_MODIFIER_SPECS: PassiveModifierSpec[] = [
  {
    cardId: 'hip-throw',
    throwImmuneWhileActive: true,
    throwImmuneOnDamageIcon: false,
  },
  {
    cardId: 'tackle',
    throwImmuneWhileActive: true,
    throwImmuneOnDamageIcon: false,
  },
  {
    cardId: 'iron-will',
    kbfReductionWhileActive: 1,
    kbfReductionOnDamageIcon: true,
  },
];

const PASSIVE_MODIFIER_SPEC_BY_CARD_ID = new Map<string, PassiveModifierSpec>(
  PASSIVE_MODIFIER_SPECS.map((spec) => [spec.cardId, spec]),
);

export const getPassiveModifierSpec = (
  passiveCardId: string | null | undefined,
): PassiveModifierSpec | null => {
  const normalizedId = `${passiveCardId ?? ''}`.trim();
  if (!normalizedId) return null;
  return PASSIVE_MODIFIER_SPEC_BY_CARD_ID.get(normalizedId) ?? null;
};

