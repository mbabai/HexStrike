export interface PreActionSpec {
  cardId: string;
  passiveStartAdrenalineDelta?: number;
  passiveStartSelfDamage?: number;
}

const PRE_ACTION_SPECS: PreActionSpec[] = [
  { cardId: 'advance', passiveStartAdrenalineDelta: 1 },
  { cardId: 'backflip', passiveStartAdrenalineDelta: -1 },
  { cardId: 'dash', passiveStartAdrenalineDelta: 1 },
  { cardId: 'jump', passiveStartAdrenalineDelta: 1 },
  { cardId: 'step', passiveStartAdrenalineDelta: -1 },
  { cardId: 'sinking-shot', passiveStartAdrenalineDelta: 1, passiveStartSelfDamage: 2 },
];

const PRE_ACTION_SPEC_BY_CARD_ID = new Map<string, PreActionSpec>(
  PRE_ACTION_SPECS.map((spec) => [spec.cardId, spec]),
);

export const getPreActionSpec = (cardId: string | null | undefined): PreActionSpec | null => {
  const normalizedId = `${cardId ?? ''}`.trim();
  if (!normalizedId) return null;
  return PRE_ACTION_SPEC_BY_CARD_ID.get(normalizedId) ?? null;
};

export const getPassiveStartAdrenalineDelta = (cardId: string | null | undefined): number =>
  getPreActionSpec(cardId)?.passiveStartAdrenalineDelta ?? 0;

export const getPassiveStartSelfDamage = (cardId: string | null | undefined): number =>
  getPreActionSpec(cardId)?.passiveStartSelfDamage ?? 0;

