export const getDiscardStatus = ({
  requiredMovement = 0,
  requiredAbility = 0,
  selectedMovement = 0,
  selectedAbility = 0,
} = {}) => {
  const safeRequiredMovement = Math.max(0, Math.floor(requiredMovement || 0));
  const safeRequiredAbility = Math.max(0, Math.floor(requiredAbility || 0));
  const safeSelectedMovement = Math.max(0, Math.floor(selectedMovement || 0));
  const safeSelectedAbility = Math.max(0, Math.floor(selectedAbility || 0));
  const movementRemaining = Math.max(0, safeRequiredMovement - safeSelectedMovement);
  const abilityRemaining = Math.max(0, safeRequiredAbility - safeSelectedAbility);
  return {
    requiredMovement: safeRequiredMovement,
    requiredAbility: safeRequiredAbility,
    selectedMovement: safeSelectedMovement,
    selectedAbility: safeSelectedAbility,
    movementRemaining,
    abilityRemaining,
    needsMovement: safeRequiredMovement > 0 && movementRemaining > 0,
    needsAbility: safeRequiredAbility > 0 && abilityRemaining > 0,
    complete: movementRemaining === 0 && abilityRemaining === 0,
  };
};

export const getDiscardCounts = (pending, playerCards, maxHandSize = 4) => {
  const abilityHandCount = Array.isArray(playerCards?.abilityHand) ? playerCards.abilityHand.length : 0;
  const movementHandCount = Array.isArray(playerCards?.movementHand) ? playerCards.movementHand.length : 0;
  const rawCount = Number.isFinite(pending?.discardCount) ? Math.max(0, pending.discardCount) : 0;
  const abilityCount = Number.isFinite(pending?.discardAbilityCount) && pending.discardAbilityCount >= 0
    ? Math.min(pending.discardAbilityCount, abilityHandCount)
    : Math.min(rawCount, abilityHandCount);
  const movementCount = Number.isFinite(pending?.discardMovementCount) && pending.discardMovementCount >= 0
    ? Math.min(pending.discardMovementCount, movementHandCount)
    : Math.max(0, movementHandCount - Math.min(abilityHandCount - abilityCount, maxHandSize));
  return { ability: abilityCount, movement: movementCount, total: rawCount };
};

export const formatDiscardPrompt = (status) => {
  if (!status) return 'Discard: 0 movement, 0 ability';
  return `Discard: ${status.movementRemaining} movement, ${status.abilityRemaining} ability`;
};
