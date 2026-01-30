import { ActionListItem, CardDefinition } from '../../types';
import { applyActiveMovementCardText } from './activeMovement';

export const applyActiveCardTextEffects = (
  actionList: ActionListItem[],
  activeCard: CardDefinition | undefined,
  rotationLabel: string,
): ActionListItem[] => {
  if (!activeCard) return actionList;
  if (activeCard.type === 'movement') {
    return applyActiveMovementCardText(actionList, activeCard, rotationLabel);
  }
  return actionList;
};

export const applyPassiveCardTextEffects = (
  actionList: ActionListItem[],
  _activeCard: CardDefinition | undefined,
  _passiveCard: CardDefinition | undefined,
  _rotationLabel: string,
): ActionListItem[] => actionList;
