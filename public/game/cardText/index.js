import { applyActiveMovementCardText } from './activeMovement.js';

export const applyActiveCardTextEffects = (actionList, activeCard, rotationLabel) => {
  if (!activeCard) return actionList;
  if (activeCard.type === 'movement') {
    return applyActiveMovementCardText(actionList, activeCard, rotationLabel);
  }
  return actionList;
};

export const applyPassiveCardTextEffects = (actionList, _activeCard, _passiveCard, _rotationLabel) => actionList;
