const setModalVisibility = (modal, visible) => {
  if (!modal) return;
  const isVisible = Boolean(visible);
  modal.hidden = !isVisible;
  modal.style.display = isVisible ? '' : 'none';
};

const formatDrawPrompt = ({ required = 0, selected = 0 } = {}) => {
  const needed = Math.max(0, Math.floor(required || 0));
  const picked = Math.max(0, Math.floor(selected || 0));
  if (needed === 0) return 'Draw: 0 movement';
  const remaining = Math.max(0, needed - picked);
  const suffix = remaining === 1 ? 'card' : 'cards';
  return `Draw: select ${remaining} movement ${suffix}`;
};

export const createDrawPrompt = ({
  movementHand,
  drawModal,
  drawCopy,
  maxHandSize = 4,
  onSubmit,
} = {}) => {
  const state = {
    pending: null,
    playerCards: null,
    required: 0,
    selection: new Set(),
    available: new Set(),
    lastKey: null,
    submitLockedId: null,
    inFlight: false,
  };

  const resetSelection = () => {
    state.selection.clear();
  };

  const clearHighlights = () => {
    if (!movementHand) return;
    movementHand.querySelectorAll('.action-card').forEach((card) => {
      card.classList.remove('is-draw-pending', 'is-draw-selected');
    });
  };

  const computeRequired = (pending, playerCards) => {
    if (Number.isFinite(pending?.drawMovementCount)) {
      return Math.max(0, Math.floor(pending.drawMovementCount));
    }
    const abilityHandCount = Array.isArray(playerCards?.abilityHand) ? playerCards.abilityHand.length : 0;
    const abilityDeckCount = Array.isArray(playerCards?.deck) ? playerCards.deck.length : 0;
    const drawCount = Number.isFinite(pending?.drawCount) ? Math.max(0, Math.floor(pending.drawCount)) : 0;
    const actualDraw = Math.min(drawCount, abilityDeckCount);
    const abilityAfter = abilityHandCount + actualDraw;
    const targetMovementSize = Math.min(abilityAfter, maxHandSize);
    const movementHandCount = Array.isArray(playerCards?.movementHand) ? playerCards.movementHand.length : 0;
    return Math.max(0, targetMovementSize - movementHandCount);
  };

  const pruneSelection = () => {
    state.selection.forEach((id) => {
      if (!state.available.has(id)) state.selection.delete(id);
    });
  };

  const autoSelectIfRequired = () => {
    if (state.required && state.required >= state.available.size) {
      state.selection.clear();
      state.available.forEach((id) => state.selection.add(id));
    }
  };

  const applyHighlights = () => {
    if (!movementHand) return;
    const allowGlow = !state.inFlight && state.required > 0;
    const needsSelection = allowGlow && state.selection.size < state.required;
    movementHand.querySelectorAll('.action-card').forEach((card) => {
      const cardId = card.dataset.cardId;
      const isAvailable = Boolean(cardId && state.available.has(cardId));
      if (!isAvailable) {
        card.classList.remove('is-draw-pending', 'is-draw-selected');
        return;
      }
      const isSelected = Boolean(cardId && state.selection.has(cardId));
      card.classList.toggle('is-draw-selected', isSelected);
      card.classList.toggle('is-draw-pending', needsSelection && !isSelected);
    });
  };

  const sync = ({ pending = null, playerCards = null, inFlight = false } = {}) => {
    state.pending = pending;
    state.playerCards = playerCards;
    state.inFlight = Boolean(inFlight);

    if (!pending || !playerCards) {
      state.required = 0;
      state.available = new Set();
      state.lastKey = null;
      state.submitLockedId = null;
      resetSelection();
      clearHighlights();
      setModalVisibility(drawModal, false);
      return;
    }

    state.required = computeRequired(pending, playerCards);
    const availableIds = Array.isArray(playerCards?.discardPile) ? playerCards.discardPile : [];
    state.available = new Set(availableIds.map((id) => `${id}`));
    const handKey = `${pending.id}|${state.required}|${availableIds.join(',')}`;
    if (handKey !== state.lastKey) {
      state.lastKey = handKey;
      state.submitLockedId = null;
      resetSelection();
    }

    pruneSelection();
    autoSelectIfRequired();

    const remaining = Math.max(0, state.required - state.selection.size);
    const complete = remaining === 0;

    if (drawCopy) {
      drawCopy.textContent = formatDrawPrompt({ required: state.required, selected: state.selection.size });
    }

    const shouldShow = !state.inFlight && state.required > 0 && !complete;
    setModalVisibility(drawModal, shouldShow);

    if (complete) {
      clearHighlights();
      if (!state.inFlight && state.submitLockedId !== pending.id) {
        state.submitLockedId = pending.id;
        if (onSubmit) {
          onSubmit({ movementCardIds: Array.from(state.selection) });
        }
      }
      return;
    }

    applyHighlights();
  };

  const handleCardClick = (event) => {
    if (!state.pending || state.inFlight) return;
    if (!state.required) return;
    const target = event.target;
    const cardElement = target?.closest ? target.closest('.action-card') : null;
    if (!cardElement) return;
    const cardId = cardElement.dataset.cardId;
    if (!cardId || !state.available.has(cardId)) return;
    event.preventDefault();
    event.stopPropagation();
    if (state.selection.has(cardId)) {
      state.selection.delete(cardId);
    } else if (state.selection.size < state.required) {
      state.selection.add(cardId);
    }
    sync({ pending: state.pending, playerCards: state.playerCards, inFlight: state.inFlight });
  };

  if (movementHand) {
    movementHand.addEventListener('click', handleCardClick, true);
  }

  return { sync };
};
