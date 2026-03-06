import type { CardDefinition } from '../../types';

export type ThrowRole = 'active' | 'passive';
export type ThrowConditionId = 'grappling-hook-land-start-adjacent-target';
export type ThrowMode = 'always' | 'keyword' | 'conditional';

export interface ThrowSpec {
  cardId: string;
  role: ThrowRole;
  mode: ThrowMode;
  actionListInteraction: 'always' | 'never';
  conditionId?: ThrowConditionId;
}

export const THROW_KEYWORD_REGEX = /\bthrow\b/i;

const THROW_SPECS: ThrowSpec[] = [
  { cardId: 'hip-throw', role: 'active', mode: 'always', actionListInteraction: 'always' },
  { cardId: 'tackle', role: 'active', mode: 'always', actionListInteraction: 'always' },
  { cardId: 'leap', role: 'passive', mode: 'always', actionListInteraction: 'always' },
  {
    cardId: 'grappling-hook',
    role: 'active',
    mode: 'conditional',
    actionListInteraction: 'never',
    conditionId: 'grappling-hook-land-start-adjacent-target',
  },
];

const THROW_SPEC_BY_KEY = new Map<string, ThrowSpec>(
  THROW_SPECS.map((spec) => [`${spec.role}:${spec.cardId}`, spec]),
);

const normalizeText = (value: unknown): string => `${value ?? ''}`.trim();

const getKeywordSource = (card: Pick<CardDefinition, 'activeText' | 'passiveText'>, role: ThrowRole): string => {
  if (role === 'active') {
    return `${card.activeText ?? ''}\n${card.passiveText ?? ''}`;
  }
  return `${card.passiveText ?? ''}`;
};

export const getThrowSpec = (
  cardId: string | null | undefined,
  role: ThrowRole,
): ThrowSpec | null => {
  const normalizedId = normalizeText(cardId);
  if (!normalizedId) return null;
  return THROW_SPEC_BY_KEY.get(`${role}:${normalizedId}`) ?? null;
};

export const cardHasThrowKeyword = (
  card: Pick<CardDefinition, 'activeText' | 'passiveText'> | null | undefined,
  role: ThrowRole,
): boolean => {
  if (!card) return false;
  return THROW_KEYWORD_REGEX.test(getKeywordSource(card, role));
};

export const cardProvidesThrowInteraction = (
  card: Pick<CardDefinition, 'id' | 'activeText' | 'passiveText'> | null | undefined,
  role: ThrowRole,
): boolean => {
  const spec = getThrowSpec(card?.id, role);
  if (spec) {
    return spec.actionListInteraction === 'always';
  }
  return cardHasThrowKeyword(card, role);
};

export const cardCanResolveThrow = (
  card: Pick<CardDefinition, 'id' | 'activeText' | 'passiveText'> | null | undefined,
  role: ThrowRole,
): boolean => {
  const spec = getThrowSpec(card?.id, role);
  if (spec) return true;
  return cardHasThrowKeyword(card, role);
};

