import { applyActiveMovementCardText } from './activeMovement.js';
import { applyPassiveAbilityCardText } from './passiveAbility.js';
import { applyPassiveMovementCardText } from './passiveMovement.js';

export const applyActiveCardTextEffects = (actionList, activeCard, rotationLabel) => {
  if (!activeCard) return actionList;
  if (activeCard.type === 'movement') {
    return applyActiveMovementCardText(actionList, activeCard, rotationLabel);
  }
  return actionList;
};

export const applyPassiveCardTextEffects = (actionList, activeCard, passiveCard, rotationLabel) => {
  if (!passiveCard) return actionList;
  if (passiveCard.type === 'movement') {
    return applyPassiveMovementCardText(actionList, activeCard, passiveCard, rotationLabel);
  }
  if (passiveCard.type === 'ability') {
    return applyPassiveAbilityCardText(actionList, activeCard, passiveCard, rotationLabel);
  }
  return actionList;
};
