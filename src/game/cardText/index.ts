import { ActionListItem, CardDefinition } from '../../types';
import { applyActiveMovementCardText } from './activeMovement';
import { applyPassiveMovementCardText } from './passiveMovement';

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
  activeCard: CardDefinition | undefined,
  passiveCard: CardDefinition | undefined,
  rotationLabel: string,
): ActionListItem[] => {
  if (!passiveCard) return actionList;
  if (passiveCard.type === 'movement') {
    return applyPassiveMovementCardText(actionList, activeCard, passiveCard, rotationLabel);
  }
  return actionList;
};
