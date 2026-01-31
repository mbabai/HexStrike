import { getDiscardCounts, getDiscardStatus, formatDiscardPrompt } from './discardUi.mjs';

const setModalVisibility = (modal, visible) => {
  if (!modal) return;
  const isVisible = Boolean(visible);
  modal.hidden = !isVisible;
  modal.style.display = isVisible ? '' : 'none';
};

export const createDiscardPrompt = ({
  movementHand,
  abilityHand,
  discardModal,
  discardCopy,
  maxHandSize = 4,
  onSubmit,
} = {}) => {
  const state = {
    pending: null,
    playerCards: null,
    selection: { movement: new Set(), ability: new Set() },
    required: { movement: 0, ability: 0 },
    lastHandKey: null,
    lastRequirementKey: null,
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
        card.classList.remove('is-discard-selected', 'is-discard-pending');
      });
    }
    if (abilityHand) {
      abilityHand.querySelectorAll('.action-card').forEach((card) => {
        card.classList.remove('is-discard-selected', 'is-discard-pending');
      });
    }
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

  const applyHighlights = (status) => {
    if (!movementHand || !abilityHand) return;
    const allowGlow = !state.inFlight && !status.complete;
    const highlightMovement = allowGlow && status.needsMovement;
    const highlightAbility = allowGlow && status.needsAbility;
    const updateHand = (hand, selectedSet, showPulse) => {
      hand.querySelectorAll('.action-card').forEach((card) => {
        const cardId = card.dataset.cardId;
        const isSelected = Boolean(cardId && selectedSet.has(cardId));
        card.classList.toggle('is-discard-selected', allowGlow && isSelected);
        card.classList.toggle('is-discard-pending', showPulse && !isSelected);
      });
    };
    updateHand(movementHand, state.selection.movement, highlightMovement);
    updateHand(abilityHand, state.selection.ability, highlightAbility);
  };

  const sync = ({ pending = null, playerCards = null, inFlight = false } = {}) => {
    state.pending = pending;
    state.playerCards = playerCards;
    state.inFlight = Boolean(inFlight);

    if (!pending || !playerCards) {
      state.required.ability = 0;
      state.required.movement = 0;
      state.lastHandKey = null;
      state.lastRequirementKey = null;
      state.submitLockedId = null;
      resetSelection();
      clearHighlights();
      setModalVisibility(discardModal, false);
      return;
    }

    const counts = getDiscardCounts(pending, playerCards, maxHandSize);
    state.required.ability = counts.ability;
    state.required.movement = counts.movement;

    const movementIds = Array.isArray(playerCards.movementHand) ? playerCards.movementHand : [];
    const abilityIds = Array.isArray(playerCards.abilityHand) ? playerCards.abilityHand : [];
    const handKey = `${movementIds.join(',')}|${abilityIds.join(',')}`;
    const requirementKey = `${pending.id}|${counts.ability}|${counts.movement}`;
    if (handKey !== state.lastHandKey || requirementKey !== state.lastRequirementKey) {
      state.lastHandKey = handKey;
      state.lastRequirementKey = requirementKey;
      state.submitLockedId = null;
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

    if (discardCopy) {
      discardCopy.textContent = formatDiscardPrompt(status);
    }

    const shouldShow = !state.inFlight && !status.complete;
    setModalVisibility(discardModal, shouldShow);

    if (status.complete) {
      clearHighlights();
      if (!state.inFlight && state.submitLockedId !== pending.id) {
        state.submitLockedId = pending.id;
        if (onSubmit) {
          onSubmit({
            abilityCardIds: Array.from(state.selection.ability),
            movementCardIds: Array.from(state.selection.movement),
          });
        }
      }
      return;
    }

    applyHighlights(status);
  };

  const handleCardClick = (type, event) => {
    if (!state.pending || state.inFlight) return;
    const required = type === 'movement' ? state.required.movement : state.required.ability;
    if (!required) return;
    const target = event.target;
    const cardElement = target?.closest ? target.closest('.action-card') : null;
    if (!cardElement) return;
    const cardId = cardElement.dataset.cardId;
    if (!cardId) return;
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

  bindHand(movementHand, 'movement');
  bindHand(abilityHand, 'ability');

  return { sync };
};
