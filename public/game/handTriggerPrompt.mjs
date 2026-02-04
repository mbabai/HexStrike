import { extractHandTriggerText } from './handTriggerText.mjs';
import { getDiscardStatus, formatDiscardPrompt } from './discardUi.mjs';

const setModalVisibility = (modal, visible) => {
  if (!modal) return;
  const isVisible = Boolean(visible);
  modal.hidden = !isVisible;
  modal.style.display = isVisible ? '' : 'none';
};

export const createHandTriggerPrompt = ({
  movementHand,
  abilityHand,
  modal,
  discardModal,
  discardCopy,
  title,
  copy,
  acceptButton,
  declineButton,
  maxHandSize = 4,
  getCardById,
  onSubmit,
} = {}) => {
  const state = {
    pending: null,
    playerCards: null,
    triggerCardId: null,
    triggerCardType: null,
    required: { movement: 0, ability: 0 },
    selection: { movement: new Set(), ability: new Set() },
    lastKey: null,
    useConfirmed: false,
    pendingId: null,
    submitLockedId: null,
    inFlight: false,
  };

  const resetSelection = () => {
    state.selection.movement.clear();
    state.selection.ability.clear();
  };

  const clearHighlights = () => {
    if (movementHand) {
      movementHand.querySelectorAll('.action-card').forEach((card) => {
        card.classList.remove('is-reveal-pending', 'is-discard-selected', 'is-discard-pending');
      });
    }
    if (abilityHand) {
      abilityHand.querySelectorAll('.action-card').forEach((card) => {
        card.classList.remove('is-reveal-pending', 'is-discard-selected', 'is-discard-pending');
      });
    }
  };

  const getCardType = (cardId, cardDef, playerCards) => {
    if (cardDef?.type) return cardDef.type;
    const inAbility = Array.isArray(playerCards?.abilityHand) && playerCards.abilityHand.includes(cardId);
    if (inAbility) return 'ability';
    const inMovement = Array.isArray(playerCards?.movementHand) && playerCards.movementHand.includes(cardId);
    if (inMovement) return 'movement';
    return null;
  };

  const clampRequirement = (count, available) => Math.min(Math.max(0, Math.floor(count || 0)), available);

  const computeRequirements = (pending, playerCards, cardType) => {
    const abilityHandCount = Array.isArray(playerCards?.abilityHand) ? playerCards.abilityHand.length : 0;
    const movementHandCount = Array.isArray(playerCards?.movementHand) ? playerCards.movementHand.length : 0;
    let requiredMovement = 0;
    let requiredAbility = 0;
    if (cardType === 'ability') {
      if (Number.isFinite(pending?.discardMovementCount)) {
        requiredMovement = pending.discardMovementCount;
      } else {
        const abilityAfter = Math.max(0, abilityHandCount - 1);
        const targetMovementSize = Math.min(abilityAfter, maxHandSize);
        requiredMovement = Math.max(0, movementHandCount - targetMovementSize);
      }
    } else if (cardType === 'movement') {
      if (Number.isFinite(pending?.discardAbilityCount)) {
        requiredAbility = pending.discardAbilityCount;
      } else {
        requiredAbility = abilityHandCount > 0 ? 1 : 0;
      }
    }
    return {
      movement: clampRequirement(requiredMovement, movementHandCount),
      ability: clampRequirement(requiredAbility, abilityHandCount),
    };
  };

  const pruneSelection = (movementIds, abilityIds) => {
    const movementSet = new Set(movementIds);
    const abilitySet = new Set(abilityIds);
    state.selection.movement.forEach((id) => {
      if (!movementSet.has(id)) state.selection.movement.delete(id);
    });
    state.selection.ability.forEach((id) => {
      if (!abilitySet.has(id)) state.selection.ability.delete(id);
    });
  };

  const autoSelectIfRequired = (movementIds, abilityIds) => {
    if (state.required.movement && state.required.movement >= movementIds.length) {
      state.selection.movement.clear();
      movementIds.forEach((id) => state.selection.movement.add(id));
    }
    if (state.required.ability && state.required.ability >= abilityIds.length) {
      state.selection.ability.clear();
      abilityIds.forEach((id) => state.selection.ability.add(id));
    }
  };

  const isSelectionComplete = () =>
    state.selection.movement.size >= state.required.movement && state.selection.ability.size >= state.required.ability;

  const applyHighlights = () => {
    if (!movementHand && !abilityHand) return;
    const allowGlow = !state.inFlight;
    const allowDiscard = allowGlow && state.useConfirmed;
    const needsMovement =
      allowDiscard && state.required.movement > 0 && state.selection.movement.size < state.required.movement;
    const needsAbility =
      allowDiscard && state.required.ability > 0 && state.selection.ability.size < state.required.ability;
    const triggerId = state.triggerCardId;
    const updateHand = (hand, selectedSet, needsSelection) => {
      if (!hand) return;
      hand.querySelectorAll('.action-card').forEach((card) => {
        const cardId = card.dataset.cardId;
        const isTrigger = Boolean(cardId && cardId === triggerId);
        const isSelected = Boolean(cardId && selectedSet.has(cardId));
        card.classList.toggle('is-reveal-pending', allowGlow && !state.useConfirmed && isTrigger);
        card.classList.toggle('is-discard-selected', allowDiscard && !isTrigger && isSelected);
        card.classList.toggle('is-discard-pending', allowDiscard && needsSelection && !isTrigger && !isSelected);
      });
    };
    updateHand(movementHand, state.selection.movement, needsMovement);
    updateHand(abilityHand, state.selection.ability, needsAbility);
  };

  const sync = ({ pending = null, playerCards = null, inFlight = false } = {}) => {
    state.pending = pending;
    state.playerCards = playerCards;
    state.inFlight = Boolean(inFlight);

    if (!pending || !playerCards) {
      state.triggerCardId = null;
      state.triggerCardType = null;
      state.required.movement = 0;
      state.required.ability = 0;
      state.lastKey = null;
      state.pendingId = null;
      state.useConfirmed = false;
      state.submitLockedId = null;
      resetSelection();
      clearHighlights();
      setModalVisibility(modal, false);
      setModalVisibility(discardModal, false);
      return;
    }

    if (pending.id !== state.pendingId) {
      state.pendingId = pending.id;
      state.useConfirmed = false;
      state.submitLockedId = null;
    }

    const triggerCardId = pending.cardId ?? pending.abilityCardId ?? pending.movementCardId ?? null;
    const card = triggerCardId && getCardById ? getCardById(triggerCardId) : null;
    const cardType = pending?.cardType ?? getCardType(triggerCardId, card, playerCards);
    state.triggerCardId = triggerCardId;
    state.triggerCardType = cardType;
    state.required = computeRequirements(pending, playerCards, cardType);

    const movementIds = Array.isArray(playerCards.movementHand) ? playerCards.movementHand : [];
    const abilityIds = Array.isArray(playerCards.abilityHand) ? playerCards.abilityHand : [];
    const handKey = `${pending.id}|${movementIds.join(',')}|${abilityIds.join(',')}`;
    if (handKey !== state.lastKey) {
      state.lastKey = handKey;
      resetSelection();
    }

    pruneSelection(movementIds, abilityIds);
    autoSelectIfRequired(movementIds, abilityIds);

    const status = getDiscardStatus({
      requiredMovement: state.required.movement,
      requiredAbility: state.required.ability,
      selectedMovement: state.selection.movement.size,
      selectedAbility: state.selection.ability.size,
    });

    if (title) {
      const cardName = card?.name ?? triggerCardId ?? 'Card';
      title.textContent = `Use ${cardName}?`;
    }
    if (copy) {
      const triggerText = card?.activeText ? extractHandTriggerText(card.activeText) : '';
      copy.textContent = triggerText || card?.activeText || '';
    }

    const showTrigger = !state.useConfirmed && !state.inFlight;
    const showDiscard = state.useConfirmed && !state.inFlight && !status.complete;
    setModalVisibility(modal, showTrigger);
    setModalVisibility(discardModal, showDiscard);
    if (discardCopy) {
      discardCopy.textContent = formatDiscardPrompt(status);
    }
    applyHighlights();

    const enableAccept = !state.inFlight && (!state.useConfirmed || status.complete);
    if (acceptButton) {
      acceptButton.disabled = !enableAccept;
      acceptButton.classList.toggle('is-disabled', !enableAccept);
    }
    if (declineButton) {
      declineButton.disabled = Boolean(state.inFlight);
      declineButton.classList.toggle('is-disabled', Boolean(state.inFlight));
    }

    if (state.useConfirmed && status.complete && !state.inFlight && state.submitLockedId !== pending.id) {
      state.submitLockedId = pending.id;
      submit(true);
    }
  };

  const submit = (use) => {
    if (!onSubmit) return;
    if (use && !isSelectionComplete()) return;
    const payload = use
      ? {
          use: true,
          movementCardIds: Array.from(state.selection.movement),
          abilityCardIds: Array.from(state.selection.ability),
        }
      : { use: false };
    onSubmit(payload);
  };

  const confirmUse = () => {
    if (!state.pending || state.inFlight) return;
    if (state.useConfirmed) return;
    state.useConfirmed = true;
    sync({ pending: state.pending, playerCards: state.playerCards, inFlight: state.inFlight });
  };

  const handleCardClick = (type, event) => {
    if (!state.pending || state.inFlight) return;
    const target = event.target;
    const cardElement = target?.closest ? target.closest('.action-card') : null;
    if (!cardElement) return;
    const cardId = cardElement.dataset.cardId;
    if (!cardId) return;
    if (state.triggerCardId && cardId === state.triggerCardId) {
      event.preventDefault();
      event.stopPropagation();
      if (!state.useConfirmed) {
        confirmUse();
        return;
      }
      if (isSelectionComplete()) {
        submit(true);
      }
      return;
    }
    if (!state.useConfirmed) return;
    const required = type === 'movement' ? state.required.movement : state.required.ability;
    if (!required) return;
    event.preventDefault();
    event.stopPropagation();
    const selected = type === 'movement' ? state.selection.movement : state.selection.ability;
    if (selected.has(cardId)) {
      selected.delete(cardId);
    } else if (selected.size < required) {
      selected.add(cardId);
    }
    sync({ pending: state.pending, playerCards: state.playerCards, inFlight: state.inFlight });
  };

  const bindHand = (hand, type) => {
    if (!hand) return;
    hand.addEventListener(
      'click',
      (event) => {
        handleCardClick(type, event);
      },
      true,
    );
  };

  if (acceptButton) {
    acceptButton.addEventListener('click', () => {
      if (!state.useConfirmed) {
        confirmUse();
        return;
      }
      submit(true);
    });
  }
  if (declineButton) {
    declineButton.addEventListener('click', () => submit(false));
  }
  bindHand(movementHand, 'movement');
  bindHand(abilityHand, 'ability');

  return { sync };
};
