import { buildRotationWheel, ROTATION_LABELS } from './rotationWheel.js';

const ACTION_ICON_FALLBACK = 'empty';
const ROTATION_ICON_FALLBACK = 'rotStar';
const PRIORITY_ICON_URL = '/public/images/priority.webp';
const DAMAGE_ICON_URL = '/public/images/DamageIcon.png';
const KNOCKBACK_ICON_URL = '/public/images/KnockBackIcon.png';

const buildActionSet = (actions, rotation, priority) =>
  actions.map((action, index) => ({
    action,
    rotation: index === 0 ? rotation : '',
    priority,
  }));

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

const buildActionIconUrl = (action) => {
  const key = `${action ?? ''}`.trim();
  const name = key ? key : ACTION_ICON_FALLBACK;
  return `/public/images/${name}.png`;
};

const buildRotationIconUrl = (rotation) => {
  const key = `${rotation ?? ''}`.trim();
  if (!key || key === '*') return `/public/images/${ROTATION_ICON_FALLBACK}.png`;
  return `/public/images/rot${key}.png`;
};

const buildStatBadge = (type, value, iconUrl) => {
  const stat = document.createElement('span');
  stat.className = `action-card-stat action-card-stat-${type}`;
  stat.style.backgroundImage = `url('${iconUrl}')`;
  stat.setAttribute('aria-label', `${type} ${value}`);
  stat.title = `${type.toUpperCase()} ${value}`;
  const text = document.createElement('span');
  text.className = 'action-card-stat-value';
  text.textContent = `${value ?? 0}`;
  stat.appendChild(text);
  return stat;
};

const buildCardElement = (card) => {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'action-card';
  element.dataset.cardId = card.id;
  element.dataset.cardType = card.type;

  const header = document.createElement('div');
  header.className = 'action-card-header';

  const title = document.createElement('span');
  title.className = 'action-card-title';
  title.textContent = card.name;
  title.title = card.name;
  header.appendChild(title);

  const badgeRow = document.createElement('div');
  badgeRow.className = 'action-card-badges';

  const rotationBadge = document.createElement('span');
  rotationBadge.className = 'action-card-badge action-card-rotation';
  rotationBadge.style.backgroundImage = `url('${buildRotationIconUrl(card.rotations)}')`;
  rotationBadge.setAttribute('aria-label', `Rotation ${card.rotations ?? '*'}`);
  rotationBadge.title = `${card.rotations ?? '*'}`;
  badgeRow.appendChild(rotationBadge);

  const priorityBadge = document.createElement('span');
  priorityBadge.className = 'action-card-badge action-card-priority';
  priorityBadge.style.backgroundImage = `url('${PRIORITY_ICON_URL}')`;
  priorityBadge.title = `Priority ${card.priority ?? 0}`;
  const priorityValue = document.createElement('span');
  priorityValue.className = 'action-card-priority-value';
  priorityValue.textContent = `${card.priority ?? 0}`;
  priorityBadge.appendChild(priorityValue);
  badgeRow.appendChild(priorityBadge);

  header.appendChild(badgeRow);

  const body = document.createElement('div');
  body.className = 'action-card-body';

  const actions = document.createElement('div');
  actions.className = 'action-card-actions';
  const actionList = Array.isArray(card.actions) ? [...card.actions] : [];
  const lastAction = actionList[actionList.length - 1];
  if (lastAction !== 'E') {
    actionList.push('E');
  }
  actionList.forEach((action) => {
    const icon = document.createElement('span');
    icon.className = 'action-card-action';
    const label = `${action ?? ''}`.trim() || ACTION_ICON_FALLBACK;
    icon.style.backgroundImage = `url('${buildActionIconUrl(label)}')`;
    icon.setAttribute('aria-label', label);
    icon.title = label;
    actions.appendChild(icon);
  });

  const surface = document.createElement('div');
  surface.className = 'action-card-surface';

  body.appendChild(actions);
  body.appendChild(surface);

  if (card.type === 'ability') {
    const stats = document.createElement('div');
    stats.className = 'action-card-stats';
    stats.appendChild(buildStatBadge('damage', card.damage ?? 0, DAMAGE_ICON_URL));
    stats.appendChild(buildStatBadge('kbf', card.kbf ?? 0, KNOCKBACK_ICON_URL));
    body.appendChild(stats);
  }

  element.appendChild(header);
  element.appendChild(body);

  return element;
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
  };

  const wheel = buildRotationWheel(rotationWheel, (rotation) => {
    if (state.locked) return;
    state.selectedRotation = rotation;
    updateSubmitState();
  });

  const getCard = (cardId) => state.cardsById.get(cardId) || null;

  const getActiveCard = () => getCard(state.slots.active);
  const getPassiveCard = () => getCard(state.slots.passive);

  const setCardDraggable = (card, enabled) => {
    if (!card?.element) return;
    card.element.draggable = enabled;
    card.element.classList.toggle('is-disabled', !enabled);
  };

  const updateSlotState = (slotName) => {
    const slot = slotName === 'active' ? activeSlot : passiveSlot;
    const isOccupied = Boolean(state.slots[slotName]);
    slot.classList.toggle('is-occupied', isOccupied);
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
    if (!card) return;
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
  };

  const returnCardToHand = (cardId) => {
    if (state.locked) return;
    const card = getCard(cardId);
    if (!card) return;
    if (state.slots.active === cardId) {
      clearSlot('active');
      updateRotationRestriction();
    }
    if (state.slots.passive === cardId) {
      clearSlot('passive');
    }
    updateSubmitState();
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

  const setCards = (movementCards, abilityCards) => {
    state.cardsById.clear();
    movementHand.innerHTML = '';
    abilityHand.innerHTML = '';
    activeSlot.innerHTML = '';
    passiveSlot.innerHTML = '';
    state.slots.active = null;
    state.slots.passive = null;
    updateSlotState('active');
    updateSlotState('passive');
    state.selectedRotation = null;
    wheel.clear();

    const attachCard = (card, index, container) => {
      const element = buildCardElement(card);
      element.draggable = !state.locked && state.turnActive;
      element.addEventListener('dragstart', (event) => {
        if (state.locked) {
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
        if (!state.locked && (state.slots.active === card.id || state.slots.passive === card.id)) {
          returnCardToHand(card.id);
        }
      });

      const record = { ...card, order: index, element };
      state.cardsById.set(card.id, record);
      container.appendChild(element);
    };

    const movementList = Array.isArray(movementCards) ? movementCards : [];
    const abilityList = Array.isArray(abilityCards) ? abilityCards : [];
    movementList.forEach((card, index) => attachCard(card, index, movementHand));
    abilityList.forEach((card, index) => attachCard(card, index, abilityHand));

    updateRotationRestriction();
    updateSubmitState();
  };

  const setVisible = (visible) => {
    state.turnActive = Boolean(visible);
    root.classList.toggle('is-turn', state.turnActive);
    root.hidden = false;
    state.cardsById.forEach((card) => setCardDraggable(card, !state.locked && state.turnActive));
    updateSubmitState();
  };

  const setLocked = (locked) => {
    state.locked = Boolean(locked);
    root.classList.toggle('is-locked', state.locked);
    state.cardsById.forEach((card) => setCardDraggable(card, !state.locked && state.turnActive));
    updateSubmitState();
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
    const hasActionList = Array.isArray(activeCard?.actions) && activeCard.actions.length > 0;
    if (!activeCard || !hasActionList || !isRotationAllowed(state.selectedRotation) || !getPassiveCard()) return;
    const actionList = buildActionSet(activeCard.actions, state.selectedRotation, activeCard.priority);
    if (onSubmit) {
      void onSubmit(actionList);
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
    setVisible,
    setLocked,
    clearSelection,
  };
};
