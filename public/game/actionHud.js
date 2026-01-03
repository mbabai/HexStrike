import { buildCardElement, fitAllCardText } from '../shared/cardRenderer.js';
import { buildRotationWheel, ROTATION_LABELS } from './rotationWheel.js';

const LOG_PREFIX = '[actionHud]';
const log = (...args) => console.log(LOG_PREFIX, ...args);

const getRotationMagnitude = (label) => {
  const value = `${label ?? ''}`.trim().toUpperCase();
  if (value === '0') return 0;
  if (value === '3') return 3;
  if (value.startsWith('L') || value.startsWith('R')) {
    const amount = Number(value.slice(1));
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
};

const buildAllowedRotationSet = (restriction) => {
  const trimmed = `${restriction ?? ''}`.trim();
  if (!trimmed || trimmed === '*') return null;
  const [minRaw, maxRaw] = trimmed.split('-');
  const min = Number(minRaw);
  const max = Number(maxRaw);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const allowed = new Set();
  ROTATION_LABELS.forEach((label) => {
    const magnitude = getRotationMagnitude(label);
    if (magnitude === null) return;
    if (magnitude >= min && magnitude <= max) {
      allowed.add(label);
    }
  });
  return allowed;
};

export const createActionHud = ({
  root,
  movementHand,
  abilityHand,
  activeSlot,
  passiveSlot,
  submitButton,
  rotationWheel,
  onSubmit,
} = {}) => {
  if (!root || !movementHand || !abilityHand || !activeSlot || !passiveSlot || !submitButton || !rotationWheel) {
    return {
      setCards: () => {},
      setExhaustedCards: () => {},
      setHidden: () => {},
      setVisible: () => {},
      setLocked: () => {},
      clearSelection: () => {},
    };
  }

  const state = {
    cardsById: new Map(),
    slots: { active: null, passive: null },
    selectedRotation: null,
    allowedRotations: null,
    locked: false,
    turnActive: false,
    draggingCardId: null,
    exhaustedCards: new Set(),
    hidden: false,
    hoveredCards: {
      movement: null,
      ability: null,
    },
    headerHeight: null,
    lastVisible: null,
    lastLocked: null,
  };

  const wheel = buildRotationWheel(rotationWheel, (rotation) => {
    if (state.locked) return;
    state.selectedRotation = rotation;
    log('rotation', rotation);
    updateSubmitState();
  });

  const getCard = (cardId) => state.cardsById.get(cardId) || null;

  const getActiveCard = () => getCard(state.slots.active);
  const getPassiveCard = () => getCard(state.slots.passive);

  const setCardDraggable = (card, enabled) => {
    if (!card?.element) return;
    const isEnabled = Boolean(enabled) && !card.exhausted;
    card.element.draggable = isEnabled;
    card.element.classList.toggle('is-disabled', !enabled);
    card.element.classList.toggle('is-exhausted', Boolean(card.exhausted));
  };

  const clearHoverForCard = (cardId) => {
    if (!cardId) return;
    Object.entries(state.hoveredCards).forEach(([type, hoveredId]) => {
      if (hoveredId !== cardId) return;
      const card = getCard(cardId);
      if (card?.element) {
        card.element.classList.remove('is-hovered');
      }
      state.hoveredCards[type] = null;
    });
  };

  const updateSlotState = (slotName) => {
    const slot = slotName === 'active' ? activeSlot : passiveSlot;
    const isOccupied = Boolean(state.slots[slotName]);
    slot.classList.toggle('is-occupied', isOccupied);
  };

  const setCardExhausted = (card, exhausted) => {
    if (!card?.element) return;
    card.exhausted = Boolean(exhausted);
    card.element.classList.toggle('is-exhausted', card.exhausted);
    setCardDraggable(card, !state.locked && state.turnActive);
  };

  const insertCardIntoHand = (card) => {
    const container = card.type === 'movement' ? movementHand : abilityHand;
    const siblings = Array.from(container.querySelectorAll('.action-card'));
    const next = siblings.find((element) => {
      const siblingCard = getCard(element.dataset.cardId);
      return siblingCard && siblingCard.order > card.order;
    });
    if (next) {
      container.insertBefore(card.element, next);
    } else {
      container.appendChild(card.element);
    }
  };

  const clearSlot = (slotName) => {
    const cardId = state.slots[slotName];
    if (!cardId) return;
    const card = getCard(cardId);
    if (card) {
      insertCardIntoHand(card);
    }
    state.slots[slotName] = null;
    updateSlotState(slotName);
    log('slot-clear', { slotName, cardId });
  };

  const updateRotationRestriction = () => {
    const activeCard = getActiveCard();
    state.allowedRotations = activeCard ? buildAllowedRotationSet(activeCard.rotations) : null;
    wheel.setAllowedRotations(state.allowedRotations);
  };

  const isRotationAllowed = (rotation) => {
    if (!rotation) return false;
    if (!state.allowedRotations) return true;
    return state.allowedRotations.has(rotation);
  };

  const updateSubmitState = () => {
    const activeCard = getActiveCard();
    const passiveCard = getPassiveCard();
    const hasActionList = Array.isArray(activeCard?.actions) && activeCard.actions.length > 0;
    const canSubmit =
      state.turnActive &&
      !state.locked &&
      Boolean(activeCard && passiveCard) &&
      hasActionList &&
      isRotationAllowed(state.selectedRotation);
    submitButton.hidden = !canSubmit;
    submitButton.disabled = !canSubmit;
  };

  const assignCardToSlot = (slotName, cardId) => {
    if (state.locked) return;
    const card = getCard(cardId);
    if (!card || card.exhausted) return;
    clearHoverForCard(cardId);
    const otherSlot = slotName === 'active' ? 'passive' : 'active';
    const otherCard = getCard(state.slots[otherSlot]);
    if (otherCard && otherCard.type === card.type) {
      clearSlot(otherSlot);
    }
    if (state.slots[slotName]) {
      clearSlot(slotName);
    }
    if (state.slots[otherSlot] === cardId) {
      clearSlot(otherSlot);
    }
    const slot = slotName === 'active' ? activeSlot : passiveSlot;
    slot.appendChild(card.element);
    state.slots[slotName] = cardId;
    updateSlotState(slotName);
    updateRotationRestriction();
    updateSubmitState();
    log('slot-assign', { slotName, cardId });
  };

  const returnCardToHand = (cardId) => {
    if (state.locked) return;
    const card = getCard(cardId);
    if (!card) return;
    clearHoverForCard(cardId);
    if (state.slots.active === cardId) {
      clearSlot('active');
      updateRotationRestriction();
    }
    if (state.slots.passive === cardId) {
      clearSlot('passive');
    }
    updateSubmitState();
    log('return-to-hand', { cardId });
  };

  const chooseSlotForCard = (card) => {
    if (!card) return null;
    const activeCard = getActiveCard();
    const passiveCard = getPassiveCard();

    if (!activeCard) return 'active';

    if (!passiveCard) {
      return activeCard.type === card.type ? 'active' : 'passive';
    }

    if (activeCard.type === card.type) return 'active';
    if (passiveCard.type === card.type) return 'passive';
    return null;
  };

  const handleCardClick = (cardId) => {
    if (state.locked) return;
    const card = getCard(cardId);
    if (!card || card.exhausted) return;

    if (state.slots.active === cardId || state.slots.passive === cardId) {
      returnCardToHand(cardId);
      return;
    }

    if (!state.turnActive) return;

    const slotName = chooseSlotForCard(card);
    if (slotName) {
      assignCardToSlot(slotName, cardId);
    }
  };

  const bindSlot = (slot, slotName) => {
    slot.addEventListener('dragover', (event) => {
      if (state.locked || !state.draggingCardId) return;
      const card = getCard(state.draggingCardId);
      if (!card) return;
      event.preventDefault();
      slot.classList.add('is-hover');
    });
    slot.addEventListener('dragleave', () => {
      slot.classList.remove('is-hover');
    });
    slot.addEventListener('drop', (event) => {
      if (state.locked || !state.draggingCardId) return;
      event.preventDefault();
      slot.classList.remove('is-hover');
      assignCardToSlot(slotName, state.draggingCardId);
      state.draggingCardId = null;
    });
    slot.addEventListener('click', () => {
      if (state.locked) return;
      if (state.slots[slotName]) {
        clearSlot(slotName);
        updateRotationRestriction();
        updateSubmitState();
      }
    });
  };

  const bindHand = (hand, type) => {
    const clearHovered = () => {
      const hoveredId = state.hoveredCards[type];
      if (!hoveredId) return;
      const card = getCard(hoveredId);
      if (card?.element) {
        card.element.classList.remove('is-hovered');
      }
      state.hoveredCards[type] = null;
    };

    const getHeaderHeight = (element) => {
      const raw = getComputedStyle(element).getPropertyValue('--action-card-header-height');
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        if (parsed !== state.headerHeight) {
          state.headerHeight = parsed;
        }
        return parsed;
      }
      const header = element.querySelector('.action-card-header');
      if (header) {
        const height = header.getBoundingClientRect().height;
        if (height !== state.headerHeight) {
          state.headerHeight = height;
        }
        return height;
      }
      return 0;
    };

    const getHoverPadding = () => {
      const raw = getComputedStyle(hand).getPropertyValue('--action-card-hover-shift');
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : 52;
    };

    const findCardUnderHeader = (event) => {
      const handRect = hand.getBoundingClientRect();
      const hoverPadding = getHoverPadding();
      if (event.clientX < handRect.left - hoverPadding || event.clientX > handRect.right + hoverPadding) {
        return null;
      }
      if (event.clientY < handRect.top || event.clientY > handRect.bottom) {
        return null;
      }
      const y = event.clientY - handRect.top;
      const cards = Array.from(hand.querySelectorAll('.action-card'));
      for (const element of cards) {
        const top = element.offsetTop;
        const headerHeight = getHeaderHeight(element);
        if (y >= top && y <= top + headerHeight) {
          return element;
        }
      }
      return null;
    };

    root.addEventListener('pointermove', (event) => {
      const element = findCardUnderHeader(event);
      const cardId = element?.dataset.cardId ?? null;
      if (cardId === state.hoveredCards[type]) return;
      clearHovered();
      if (!cardId) return;
      const card = getCard(cardId);
      if (!card?.element) return;
      card.element.classList.add('is-hovered');
      state.hoveredCards[type] = cardId;
    });

    root.addEventListener('pointerleave', () => {
      clearHovered();
    });

    hand.addEventListener('dragover', (event) => {
      if (state.locked || !state.draggingCardId) return;
      const card = getCard(state.draggingCardId);
      if (!card || card.type !== type) return;
      event.preventDefault();
    });
    hand.addEventListener('drop', (event) => {
      if (state.locked || !state.draggingCardId) return;
      event.preventDefault();
      returnCardToHand(state.draggingCardId);
      state.draggingCardId = null;
    });
  };

  const setCards = (movementCards, abilityCards, options = {}) => {
    state.cardsById.clear();
    movementHand.innerHTML = '';
    abilityHand.innerHTML = '';
    activeSlot.innerHTML = '';
    passiveSlot.innerHTML = '';
    state.hoveredCards.movement = null;
    state.hoveredCards.ability = null;
    state.slots.active = null;
    state.slots.passive = null;
    updateSlotState('active');
    updateSlotState('passive');
    state.selectedRotation = null;
    wheel.clear();
    state.exhaustedCards = new Set();

    const attachCard = (card, index, container) => {
      const element = buildCardElement(card, { asButton: true });
      element.draggable = !state.locked && state.turnActive;
      element.addEventListener('dragstart', (event) => {
        const record = state.cardsById.get(card.id);
        if (state.locked || record?.exhausted) {
          event.preventDefault();
          return;
        }
        state.draggingCardId = card.id;
        element.classList.add('is-dragging');
        event.dataTransfer.setData('text/plain', card.id);
        event.dataTransfer.effectAllowed = 'move';
      });
      element.addEventListener('dragend', () => {
        state.draggingCardId = null;
        element.classList.remove('is-dragging');
      });
      element.addEventListener('click', () => {
        handleCardClick(card.id);
      });

      const record = { ...card, order: index, element, exhausted: false };
      state.cardsById.set(card.id, record);
      container.appendChild(element);
    };

    const movementList = Array.isArray(movementCards) ? movementCards : [];
    const abilityList = Array.isArray(abilityCards) ? abilityCards : [];
    movementList.forEach((card, index) => attachCard(card, index, movementHand));
    abilityList.forEach((card, index) => attachCard(card, index, abilityHand));

    updateRotationRestriction();
    updateSubmitState();
    if (options.exhaustedCardIds) {
      setExhaustedCards(options.exhaustedCardIds);
    }
    log('set-cards', {
      movement: movementList.length,
      ability: abilityList.length,
      exhausted: options.exhaustedCardIds ? options.exhaustedCardIds.length : 0,
    });
    requestAnimationFrame(() => fitAllCardText(root));
  };

  const setExhaustedCards = (cardIds) => {
    const next = new Set(Array.isArray(cardIds) ? cardIds : [...(cardIds || [])]);
    const sameSize = next.size === state.exhaustedCards.size;
    let isSame = sameSize;
    if (sameSize) {
      for (const id of next) {
        if (!state.exhaustedCards.has(id)) {
          isSame = false;
          break;
        }
      }
    }
    if (isSame) return;
    state.exhaustedCards = next;
    state.cardsById.forEach((card) => {
      setCardExhausted(card, next.has(card.id));
    });
    log('set-exhausted', { count: next.size });
  };

  const setVisible = (visible) => {
    state.turnActive = Boolean(visible);
    root.classList.toggle('is-turn', state.turnActive);
    root.hidden = state.hidden;
    state.cardsById.forEach((card) => setCardDraggable(card, !state.locked && state.turnActive));
    updateSubmitState();
    if (state.lastVisible !== state.turnActive) {
      log('visible', state.turnActive);
      state.lastVisible = state.turnActive;
    }
  };

  const setHidden = (hidden) => {
    state.hidden = Boolean(hidden);
    root.hidden = state.hidden;
    log('hidden', state.hidden);
  };

  const setLocked = (locked) => {
    state.locked = Boolean(locked);
    root.classList.toggle('is-locked', state.locked);
    state.cardsById.forEach((card) => setCardDraggable(card, !state.locked && state.turnActive));
    updateSubmitState();
    if (state.lastLocked !== state.locked) {
      log('locked', state.locked);
      state.lastLocked = state.locked;
    }
  };

  const clearSelection = () => {
    clearSlot('active');
    clearSlot('passive');
    state.selectedRotation = null;
    state.draggingCardId = null;
    wheel.clear();
    updateRotationRestriction();
    updateSubmitState();
  };

  submitButton.addEventListener('click', () => {
    const activeCard = getActiveCard();
    const passiveCard = getPassiveCard();
    const rotation = state.selectedRotation;
    const hasActionList = Array.isArray(activeCard?.actions) && activeCard.actions.length > 0;
    if (!activeCard || !passiveCard || !hasActionList || !isRotationAllowed(rotation)) return;
    log('submit', {
      activeCardId: activeCard.id,
      passiveCardId: passiveCard.id,
      rotation,
      activeActions: activeCard.actions?.length ?? 0,
    });
    if (onSubmit) {
      void onSubmit({
        activeCardId: activeCard.id,
        passiveCardId: passiveCard.id,
        rotation,
        activeCard,
        passiveCard,
      });
    }
  });

  bindSlot(activeSlot, 'active');
  bindSlot(passiveSlot, 'passive');
  bindHand(movementHand, 'movement');
  bindHand(abilityHand, 'ability');
  updateRotationRestriction();
  updateSubmitState();

  return {
    setCards,
    setExhaustedCards,
    setHidden,
    setVisible,
    setLocked,
    clearSelection,
  };
};
