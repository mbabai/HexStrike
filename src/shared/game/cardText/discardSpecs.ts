export interface HitDiscardRule {
  count: number;
  centerOnly?: boolean;
}

export interface DiscardSpec {
  cardId: string;
  activeHitDiscard?: HitDiscardRule;
  passiveBlockDiscardCount?: number;
  passiveStartDiscardCount?: number;
  discardImmuneWhileActive?: boolean;
  discardImmuneOnDamageIcon?: boolean;
  convertKbfToDiscardWhileActive?: boolean;
  convertKbfToDiscardOnDamageIcon?: boolean;
}

const DISCARD_SPECS: DiscardSpec[] = [
  { cardId: 'down-slash', activeHitDiscard: { count: 1 } },
  { cardId: 'spike', activeHitDiscard: { count: 3 }, discardImmuneWhileActive: true, discardImmuneOnDamageIcon: true },
  {
    cardId: 'sweeping-strike',
    activeHitDiscard: { count: 2 },
    convertKbfToDiscardWhileActive: true,
    convertKbfToDiscardOnDamageIcon: true,
  },
  { cardId: 'trip', activeHitDiscard: { count: 1, centerOnly: true }, passiveBlockDiscardCount: 1 },
];

const DISCARD_SPEC_BY_CARD_ID = new Map<string, DiscardSpec>(DISCARD_SPECS.map((spec) => [spec.cardId, spec]));

export const getDiscardSpec = (cardId: string | null | undefined): DiscardSpec | null => {
  const normalizedId = `${cardId ?? ''}`.trim();
  if (!normalizedId) return null;
  return DISCARD_SPEC_BY_CARD_ID.get(normalizedId) ?? null;
};

