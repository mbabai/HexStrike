import { CardType } from '../types';

export type HandTriggerKind = 'attack-hit' | 'projectile-hit' | 'knockback-abyss' | 'hit';
export type HandTriggerEffect = 'burning-strike' | 'sinking-shot' | 'vengeance' | 'iron-will';

export interface HandTriggerDefinition {
  cardId: string;
  cardType: CardType;
  trigger: HandTriggerKind;
  effect: HandTriggerEffect;
  discardCount: number;
}

export const HAND_TRIGGER_DEFINITIONS: HandTriggerDefinition[] = [
  {
    cardId: 'burning-strike',
    cardType: 'ability',
    trigger: 'attack-hit',
    effect: 'burning-strike',
    discardCount: 1,
  },
  {
    cardId: 'sinking-shot',
    cardType: 'ability',
    trigger: 'projectile-hit',
    effect: 'sinking-shot',
    discardCount: 1,
  },
  {
    cardId: 'vengeance',
    cardType: 'ability',
    trigger: 'knockback-abyss',
    effect: 'vengeance',
    discardCount: 1,
  },
  {
    cardId: 'iron-will',
    cardType: 'ability',
    trigger: 'hit',
    effect: 'iron-will',
    discardCount: 1,
  },
];

export const HAND_TRIGGER_BY_ID = new Map<string, HandTriggerDefinition>(
  HAND_TRIGGER_DEFINITIONS.map((definition) => [definition.cardId, definition]),
);

export const HAND_TRIGGER_CARD_IDS = new Set(HAND_TRIGGER_DEFINITIONS.map((definition) => definition.cardId));

export const getHandTriggerDefinition = (cardId?: string | null) =>
  cardId ? HAND_TRIGGER_BY_ID.get(cardId) ?? null : null;
