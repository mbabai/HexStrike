import { buildCardElement, fitAllCardText } from '../shared/cardRenderer.js';
import { buildRotationWheel, ROTATION_LABELS } from './rotationWheel.js';

const LOG_PREFIX = '[actionHud]';
const log = (...args) => console.log(LOG_PREFIX, ...args);
const DEBUG_HOVER = false;

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
      setComboMode: () => {},
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
    comboMode: false,
    comboEligibleIds: new Set(),
    exhaustedCards: new Set(),
    hidden: false,
    hoveredCardId: null,
    lastVisible: null,
    lastLocked: null,
    hasDealtCards: false,
  };

  const debugOverlay = (() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return null;
    const isDevHost = ['localhost', '127.0.0.1'].includes(window.location?.hostname ?? '');
    if (!DEBUG_HOVER && !isDevHost) return null;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const overlay = document.createElementNS(SVG_NS, 'svg');
    overlay.setAttribute('class', 'action-hover-debug');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.position = 'fixed';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '50';
    overlay.style.display = DEBUG_HOVER ? 'block' : 'none';
    document.body.appendChild(overlay);

    const quadForElement = (element) => {
      if (typeof element.getBoxQuads === 'function') {
        const quads = element.getBoxQuads({ box: 'border' });
        if (quads && quads.length) return quads[0];
      }
      const rect = element.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      return {
        p1: { x: rect.left, y: rect.top },
        p2: { x: rect.right, y: rect.top },
        p3: { x: rect.right, y: rect.bottom },
        p4: { x: rect.left, y: rect.bottom },
      };
    };

    const halfQuadPoints = (quad) => {
      const midTop = {
        x: quad.p1.x + (quad.p2.x - quad.p1.x) * 0.5,
        y: quad.p1.y + (quad.p2.y - quad.p1.y) * 0.5,
      };
      const midBottom = {
        x: quad.p4.x + (quad.p3.x - quad.p4.x) * 0.5,
        y: quad.p4.y + (quad.p3.y - quad.p4.y) * 0.5,
      };
      return [quad.p1, midTop, midBottom, quad.p4];
    };

    const rightTopQuadPoints = (quad, heightFactor = 0.6) => {
      const midTop = {
        x: quad.p1.x + (quad.p2.x - quad.p1.x) * 0.5,
        y: quad.p1.y + (quad.p2.y - quad.p1.y) * 0.5,
      };
      const midBottom = {
        x: quad.p4.x + (quad.p3.x - quad.p4.x) * 0.5,
        y: quad.p4.y + (quad.p3.y - quad.p4.y) * 0.5,
      };
      const topRight = quad.p2;
      const bottomRight = {
        x: quad.p2.x + (quad.p3.x - quad.p2.x) * heightFactor,
        y: quad.p2.y + (quad.p3.y - quad.p2.y) * heightFactor,
      };
      const bottomLeft = {
        x: midTop.x + (midBottom.x - midTop.x) * heightFactor,
        y: midTop.y + (midBottom.y - midTop.y) * heightFactor,
      };
      return [midTop, topRight, bottomRight, bottomLeft];
    };

    const mouse = document.createElementNS(SVG_NS, 'circle');
    mouse.setAttribute('r', '10');
    mouse.setAttribute('fill', 'rgba(255, 255, 255, 0.12)');
    mouse.setAttribute('stroke', 'rgba(255, 255, 255, 0.9)');
    mouse.setAttribute('stroke-width', '2');
    overlay.appendChild(mouse);

    const render = (elements, hoveredId, pointer) => {
      if (!elements) return;
      const existing = new Map();
      overlay.querySelectorAll('polygon').forEach((poly) => {
        existing.set(poly.dataset.cardId, poly);
      });
      const cards = [];
      let rightmostIndex = -1;
      let rightmostX = -Infinity;
      elements.forEach((element) => {
        const cardId = element?.dataset?.cardId;
        if (!cardId) return;
        const quad = quadForElement(element);
        if (!quad) return;
        const maxX = Math.max(quad.p1.x, quad.p2.x, quad.p3.x, quad.p4.x);
        const index = cards.length;
        cards.push({ element, cardId, quad });
        if (maxX > rightmostX) {
          rightmostX = maxX;
          rightmostIndex = index;
        }
      });
      if (rightmostIndex >= 0 && cards[rightmostIndex]) {
        cards[rightmostIndex].isRightmost = true;
      }
      const keep = new Set();
      cards.forEach((card) => {
        const basePoints = (card.isRightmost ? [card.quad.p1, card.quad.p2, card.quad.p3, card.quad.p4] : halfQuadPoints(card.quad))
          .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
          .join(' ');
        let poly = existing.get(card.cardId);
        if (!poly) {
          poly = document.createElementNS(SVG_NS, 'polygon');
          poly.dataset.cardId = card.cardId;
          overlay.appendChild(poly);
        }
        poly.setAttribute('points', basePoints);
        const isHovered = hoveredId && card.cardId === hoveredId;
        poly.setAttribute('fill', isHovered ? 'rgba(255, 215, 0, 0.18)' : 'rgba(255, 0, 0, 0.14)');
        poly.setAttribute('stroke', isHovered ? 'rgba(255, 215, 0, 0.9)' : 'rgba(255, 0, 0, 0.6)');
        poly.setAttribute('stroke-width', isHovered ? '2' : '1');
        keep.add(card.cardId);
        if (isHovered && !card.isRightmost) {
          const extraPoints = rightTopQuadPoints(card.quad)
            .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
            .join(' ');
          let extra = existing.get(`${card.cardId}::right`);
          if (!extra) {
            extra = document.createElementNS(SVG_NS, 'polygon');
            extra.dataset.cardId = `${card.cardId}::right`;
            overlay.appendChild(extra);
          }
          extra.setAttribute('points', extraPoints);
          extra.setAttribute('fill', isHovered ? 'rgba(255, 215, 0, 0.12)' : 'rgba(255, 0, 0, 0.1)');
          extra.setAttribute('stroke', isHovered ? 'rgba(255, 215, 0, 0.8)' : 'rgba(255, 0, 0, 0.5)');
          extra.setAttribute('stroke-width', isHovered ? '2' : '1');
          keep.add(`${card.cardId}::right`);
        }
      });
      existing.forEach((poly, cardId) => {
        if (!keep.has(cardId)) {
          poly.remove();
        }
      });
      if (pointer) {
        mouse.setAttribute('cx', pointer.x.toFixed(1));
        mouse.setAttribute('cy', pointer.y.toFixed(1));
        mouse.setAttribute('visibility', 'visible');
      } else {
        mouse.setAttribute('visibility', 'hidden');
      }
    };

    const clear = () => {
      overlay.querySelectorAll('polygon').forEach((poly) => poly.remove());
      mouse.setAttribute('visibility', 'hidden');
    };

    const setEnabled = (enabled) => {
      overlay.style.display = enabled ? 'block' : 'none';
      if (!enabled) clear();
    };

    return { render, clear, setEnabled, isDevHost };
  })();

  if (debugOverlay?.isDevHost) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = 'Debug';
    toggle.style.position = 'fixed';
    toggle.style.left = '0';
    toggle.style.top = '0';
    toggle.style.padding = '6px 10px';
    toggle.style.fontSize = '12px';
    toggle.style.fontWeight = '600';
    toggle.style.letterSpacing = '0.08em';
    toggle.style.textTransform = 'uppercase';
    toggle.style.border = '1px solid rgba(255,255,255,0.25)';
    toggle.style.borderTop = 'none';
    toggle.style.borderLeft = 'none';
    toggle.style.borderRadius = '0 0 6px 0';
    toggle.style.background = 'rgba(10, 18, 22, 0.85)';
    toggle.style.color = '#f5f0e6';
    toggle.style.zIndex = '60';
    toggle.style.cursor = 'pointer';
    let enabled = false;
    debugOverlay.setEnabled(enabled);
    toggle.addEventListener('click', () => {
      enabled = !enabled;
      toggle.textContent = enabled ? 'Debug On' : 'Debug Off';
      debugOverlay.setEnabled(enabled);
    });
    toggle.textContent = 'Debug Off';
    document.body.appendChild(toggle);
  }

  const wheel = buildRotationWheel(rotationWheel, (rotation) => {
    if (state.locked) return;
    state.selectedRotation = rotation;
    log('rotation', rotation);
    updateSubmitState();
  });

  const rotationCenter = rotationWheel?.querySelector?.('.rotation-center') ?? null;
  const rotationCenterLabel = rotationCenter ? rotationCenter.querySelector('text') : null;
  if (rotationCenter) {
    rotationCenter.setAttribute('role', 'button');
    rotationCenter.setAttribute('tabindex', '0');
    rotationCenter.setAttribute('focusable', 'true');
    rotationCenter.setAttribute('aria-label', 'Submit action');
    rotationCenter.setAttribute('aria-disabled', 'true');
  }

  const getCard = (cardId) => state.cardsById.get(cardId) || null;

  const getActiveCard = () => getCard(state.slots.active);
  const getPassiveCard = () => getCard(state.slots.passive);

  const prefersReducedMotion =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  const LERP_DURATION_MS = 220;
  const DEAL_DURATION_MS = 260;
  const FLIP_REVEAL_DELAY_MS = 80;

  const getHandCardsInOrder = () => {
    const movementCards = Array.from(movementHand.querySelectorAll('.action-card'));
    const abilityCards = Array.from(abilityHand.querySelectorAll('.action-card'));
    return [...movementCards, ...abilityCards];
  };

  const applyFanLayout = (cards) => {
    if (!cards?.length) return;
    const count = cards.length;
    const mid = (count - 1) / 2;
    cards.forEach((element, index) => {
      const offset = count <= 1 ? 0 : (index - mid) / (mid || 1);
      const shift = index - mid;
      const curve = count <= 1 ? 0 : 1 - Math.abs(offset);
      element.style.setProperty('--fan-offset', offset.toFixed(3));
      element.style.setProperty('--fan-shift', shift.toFixed(3));
      element.style.setProperty('--fan-curve', curve.toFixed(3));
      element.style.setProperty('--fan-scale', '1');
      element.style.setProperty('--fan-z', `${2 + index}`);
      element.dataset.fanOffset = `${offset}`;
      element.dataset.fanShift = `${shift}`;
      element.dataset.fanCurve = `${curve}`;
    });
  };

  const refreshHandLayouts = () => {
    applyFanLayout(getHandCardsInOrder());
  };

  const isRectValid = (rect) => rect && rect.width > 0 && rect.height > 0;

  const animateGhostBetween = (ghost, fromRect, toRect, options = {}) => {
    const { duration = LERP_DURATION_MS, easing = 'cubic-bezier(0.22, 0.61, 0.36, 1)', removeOnFinish = true, onComplete } =
      options;
    if (!ghost || !isRectValid(fromRect) || !isRectValid(toRect) || prefersReducedMotion) {
      if (ghost && ghost.remove) ghost.remove();
      if (onComplete) onComplete();
      return;
    }
    const fromCenter = {
      x: fromRect.left + fromRect.width / 2,
      y: fromRect.top + fromRect.height / 2,
    };
    const toCenter = {
      x: toRect.left + toRect.width / 2,
      y: toRect.top + toRect.height / 2,
    };
    const dx = toCenter.x - fromCenter.x;
    const dy = toCenter.y - fromCenter.y;
    const scaleX = toRect.width / fromRect.width;
    const scaleY = toRect.height / fromRect.height;
    ghost.style.left = `${fromRect.left}px`;
    ghost.style.top = `${fromRect.top}px`;
    ghost.style.width = `${fromRect.width}px`;
    ghost.style.height = `${fromRect.height}px`;
    ghost.style.transformOrigin = 'center center';
    document.body.appendChild(ghost);
    const animation = ghost.animate(
      [
        { transform: 'translate3d(0, 0, 0) scale(1, 1)' },
        { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scaleX}, ${scaleY})` },
      ],
      { duration, easing, fill: 'forwards' },
    );
    const finish = () => {
      if (removeOnFinish && ghost.remove) ghost.remove();
      if (onComplete) onComplete();
    };
    animation.onfinish = finish;
    animation.oncancel = finish;
  };

  const createCardGhost = (cardElement) => {
    const ghost = cardElement.cloneNode(true);
    ghost.classList.add('action-card-ghost');
    ghost.classList.remove('is-hovered', 'is-dragging', 'is-animating', 'is-drawn');
    ghost.style.zIndex = '30';
    ghost.removeAttribute('id');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.draggable = false;
    if (ghost instanceof HTMLButtonElement) {
      ghost.disabled = true;
      ghost.tabIndex = -1;
    }
    return ghost;
  };

  const animateCardTravel = (cardElement, fromRect, toRect) => {
    const ghost = createCardGhost(cardElement);
    animateGhostBetween(ghost, fromRect, toRect, {
      duration: LERP_DURATION_MS,
      onComplete: () => {
        cardElement.classList.remove('is-animating');
      },
    });
  };

  const animateDealCard = (card, type) => {
    if (!card?.element) return;
    if (prefersReducedMotion) {
      card.element.classList.remove('is-drawn');
      return;
    }
    const targetRect = card.element.getBoundingClientRect();
    if (!isRectValid(targetRect)) {
      card.element.classList.remove('is-drawn');
      return;
    }
    const drawGhost = document.createElement('div');
    drawGhost.className = 'action-card-draw';
    drawGhost.style.width = `${targetRect.width}px`;
    drawGhost.style.height = `${targetRect.height}px`;
    drawGhost.style.zIndex = '30';
    const startX =
      type === 'movement' ? -targetRect.width * 1.2 : window.innerWidth + targetRect.width * 1.2;
    const startY = targetRect.top + targetRect.height * 0.1;
    const fromRect = {
      left: startX,
      top: startY,
      width: targetRect.width,
      height: targetRect.height,
    };
    animateGhostBetween(drawGhost, fromRect, targetRect, {
      duration: DEAL_DURATION_MS,
      removeOnFinish: false,
      onComplete: () => {
        if (!drawGhost.isConnected) {
          card.element.classList.remove('is-drawn');
          return;
        }
        drawGhost.classList.add('is-flipping');
        window.setTimeout(() => {
          card.element.classList.remove('is-drawn');
        }, FLIP_REVEAL_DELAY_MS);
        drawGhost.addEventListener(
          'animationend',
          () => {
            if (drawGhost.remove) drawGhost.remove();
          },
          { once: true },
        );
      },
    });
  };

  const setCardDraggable = (card, enabled) => {
    if (!card?.element) return;
    const isEnabled = Boolean(enabled) && !card.exhausted;
    card.element.draggable = isEnabled;
    card.element.classList.toggle('is-disabled', !enabled);
    card.element.classList.toggle('is-exhausted', Boolean(card.exhausted));
  };

  const clearHoverForCard = (cardId) => {
    if (!cardId || state.hoveredCardId !== cardId) return;
    const card = getCard(cardId);
    if (card?.element) {
      card.element.classList.remove('is-hovered');
    }
    state.hoveredCardId = null;
  };

  const setHoveredCard = (cardId) => {
    const nextId = cardId && getCard(cardId) ? cardId : null;
    if (state.hoveredCardId === nextId) return;
    if (state.hoveredCardId) {
      const previous = getCard(state.hoveredCardId);
      if (previous?.element) {
        previous.element.classList.remove('is-hovered');
      }
    }
    state.hoveredCardId = nextId;
    if (state.hoveredCardId) {
      const next = getCard(state.hoveredCardId);
      if (next?.element) {
        next.element.classList.add('is-hovered');
      }
    }
  };

  const updateSlotState = (slotName) => {
    const slot = slotName === 'active' ? activeSlot : passiveSlot;
    const isOccupied = Boolean(state.slots[slotName]);
    slot.classList.toggle('is-occupied', isOccupied);
  };

  const ensureSlotLabel = (slot, text) => {
    if (!slot) return;
    let label = slot.querySelector('.action-slot-label');
    if (!label) {
      label = document.createElement('span');
      label.className = 'action-slot-label';
      slot.appendChild(label);
    }
    label.textContent = text;
  };

  const updateComboEligibility = () => {
    state.cardsById.forEach((card) => {
      if (!card?.element) return;
      const isEligible = state.comboMode && state.comboEligibleIds.has(card.id);
      card.element.classList.toggle('is-combo-eligible', isEligible);
    });
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
      clearHoverForCard(cardId);
      const fromRect = card.element?.getBoundingClientRect?.();
      card.element?.classList.add('is-animating');
      insertCardIntoHand(card);
      refreshHandLayouts();
      const toRect = card.element?.getBoundingClientRect?.();
      if (isRectValid(fromRect) && isRectValid(toRect)) {
        animateCardTravel(card.element, fromRect, toRect);
      } else if (card.element) {
        card.element.classList.remove('is-animating');
      }
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
    const comboValid = !state.comboMode || (activeCard && state.comboEligibleIds.has(activeCard.id));
    const canSubmit =
      state.turnActive &&
      !state.locked &&
      Boolean(activeCard && passiveCard) &&
      hasActionList &&
      comboValid &&
      isRotationAllowed(state.selectedRotation);
    submitButton.hidden = true;
    submitButton.disabled = !canSubmit;
    rotationWheel?.classList?.toggle('is-submit-ready', canSubmit);
    if (rotationCenter) {
      rotationCenter.setAttribute('aria-disabled', canSubmit ? 'false' : 'true');
      rotationCenter.setAttribute('tabindex', canSubmit ? '0' : '-1');
    }
    if (rotationCenterLabel) {
      rotationCenterLabel.textContent = canSubmit ? 'submit' : 'rotation';
    }
  };

  const assignCardToSlot = (slotName, cardId) => {
    if (state.locked) return;
    const card = getCard(cardId);
    if (!card || card.exhausted) return;
    if (slotName === 'active' && state.comboMode && !state.comboEligibleIds.has(cardId)) {
      returnCardToHand(cardId);
      return;
    }
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
    const fromRect = card.element?.getBoundingClientRect?.();
    clearHoverForCard(cardId);
    const toRect = slot.getBoundingClientRect();
    card.element?.classList.add('is-animating');
    slot.appendChild(card.element);
    refreshHandLayouts();
    if (isRectValid(fromRect) && isRectValid(toRect)) {
      animateCardTravel(card.element, fromRect, toRect);
    } else if (card.element) {
      card.element.classList.remove('is-animating');
    }
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

  const bindHands = () => {
    const getHoverPadding = () => {
      const raw = getComputedStyle(root).getPropertyValue('--action-hand-hover-padding');
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : 80;
    };

    const findCardUnderPointer = (event) => {
      const cards = getHandCardsInOrder();
      if (!cards.length) return null;
      const hoverPadding = getHoverPadding();
      const getQuad = (element) => {
        if (typeof element.getBoxQuads === 'function') {
          const quads = element.getBoxQuads({ box: 'border' });
          if (quads && quads.length) return quads[0];
        }
        const rect = element.getBoundingClientRect();
        if (!isRectValid(rect)) return null;
        return {
          p1: { x: rect.left, y: rect.top },
          p2: { x: rect.right, y: rect.top },
          p3: { x: rect.right, y: rect.bottom },
          p4: { x: rect.left, y: rect.bottom },
        };
      };
      const resolveAxes = (quad) => {
        const p1 = quad.p1;
        const vWidth = { x: quad.p2.x - quad.p1.x, y: quad.p2.y - quad.p1.y };
        const vHeight = { x: quad.p4.x - quad.p1.x, y: quad.p4.y - quad.p1.y };
        const det = vWidth.x * vHeight.y - vWidth.y * vHeight.x;
        if (!det) return null;
        return {
          origin: p1,
          vWidth,
          vHeight,
          widthLen: Math.hypot(vWidth.x, vWidth.y),
          heightLen: Math.hypot(vHeight.x, vHeight.y),
          det,
        };
      };
      const cardData = [];
      let rightmostIndex = -1;
      let rightmostX = -Infinity;
      cards.forEach((element) => {
        const quad = getQuad(element);
        if (!quad) return;
        const maxX = Math.max(quad.p1.x, quad.p2.x, quad.p3.x, quad.p4.x);
        const index = cardData.length;
        cardData.push({ element, quad });
        if (maxX > rightmostX) {
          rightmostX = maxX;
          rightmostIndex = index;
        }
      });
      if (!cardData.length) return null;
      if (rightmostIndex >= 0 && cardData[rightmostIndex]) {
        cardData[rightmostIndex].isRightmost = true;
      }
      const padPixels = Math.min(hoverPadding, 4);
      const candidates = [];
      cardData.forEach((card) => {
        const axes = resolveAxes(card.quad);
        if (!axes) return;
        const dx = event.clientX - axes.origin.x;
        const dy = event.clientY - axes.origin.y;
        const u = (dx * axes.vHeight.y - dy * axes.vHeight.x) / axes.det;
        const v = (-dx * axes.vWidth.y + dy * axes.vWidth.x) / axes.det;
        const padU = axes.widthLen ? padPixels / axes.widthLen : 0;
        const padV = axes.heightLen ? padPixels / axes.heightLen : 0;
        const inFull = card.isRightmost && u >= -padU && u <= 1 + padU && v >= -padV && v <= 1 + padV;
        const inLeftHalf = u >= -padU && u <= 0.5 + padU && v >= -padV && v <= 1 + padV;
        const inRightTop =
          !card.isRightmost &&
          card.element?.dataset?.cardId === state.hoveredCardId &&
          u >= 0.5 - padU &&
          u <= 1 + padU &&
          v >= -padV &&
          v <= 0.6 + padV;
        if (!inFull && !inLeftHalf && !inRightTop) return;
        const uCenter = inFull ? 0.5 : inRightTop ? 0.75 : 0.25;
        const center = {
          x: axes.origin.x + axes.vWidth.x * uCenter + axes.vHeight.x * 0.5,
          y: axes.origin.y + axes.vWidth.y * uCenter + axes.vHeight.y * 0.5,
        };
        candidates.push({ element: card.element, center });
      });
      if (!candidates.length) return null;
      const currentId = state.hoveredCardId;
      if (currentId) {
        const match = candidates.find((candidate) => candidate.element.dataset.cardId === currentId);
        if (match) return match.element;
      }
      let closest = null;
      let minDistance = Number.POSITIVE_INFINITY;
      candidates.forEach(({ element, center }) => {
        const distance = Math.abs(event.clientX - center.x) + Math.abs(event.clientY - center.y) * 0.2;
        if (distance >= minDistance) return;
        minDistance = distance;
        closest = element;
      });
      return closest;
    };

    window.addEventListener('pointermove', (event) => {
      const element = findCardUnderPointer(event);
      const cardId = element?.dataset.cardId ?? null;
      setHoveredCard(cardId);
      if (debugOverlay && debugOverlay.setEnabled) {
        debugOverlay.render(getHandCardsInOrder(), cardId, { x: event.clientX, y: event.clientY });
      }
    });

    window.addEventListener('blur', () => {
      setHoveredCard(null);
      debugOverlay?.clear();
    });

    const bindHandDrop = (hand) => {
      hand.addEventListener('dragover', (event) => {
        if (state.locked || !state.draggingCardId) return;
        event.preventDefault();
      });
      hand.addEventListener('drop', (event) => {
        if (state.locked || !state.draggingCardId) return;
        event.preventDefault();
        returnCardToHand(state.draggingCardId);
        state.draggingCardId = null;
      });
    };

    bindHandDrop(movementHand);
    bindHandDrop(abilityHand);
  };

  const setCards = (movementCards, abilityCards, options = {}) => {
    const previousMovement = new Set();
    const previousAbility = new Set();
    state.cardsById.forEach((card) => {
      if (!card) return;
      if (card.type === 'movement') {
        previousMovement.add(card.id);
      } else if (card.type === 'ability') {
        previousAbility.add(card.id);
      }
    });
    const shouldAnimateDeals = state.hasDealtCards && !state.hidden;
    const pendingDeals = [];
    state.cardsById.clear();
    movementHand.innerHTML = '';
    abilityHand.innerHTML = '';
    activeSlot.querySelectorAll('.action-card').forEach((card) => card.remove());
    passiveSlot.querySelectorAll('.action-card').forEach((card) => card.remove());
    ensureSlotLabel(activeSlot, 'Active');
    ensureSlotLabel(passiveSlot, 'Passive');
    state.hoveredCardId = null;
    state.slots.active = null;
    state.slots.passive = null;
    updateSlotState('active');
    updateSlotState('passive');
    state.selectedRotation = null;
    wheel.clear();
    state.exhaustedCards = new Set();

    const attachCard = (card, index, container, type) => {
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
      if (shouldAnimateDeals) {
        const wasKnown = type === 'movement' ? previousMovement.has(card.id) : previousAbility.has(card.id);
        if (!wasKnown) {
          element.classList.add('is-drawn');
          pendingDeals.push(record);
        }
      }
      container.appendChild(element);
    };

    const movementList = Array.isArray(movementCards) ? movementCards : [];
    const abilityList = Array.isArray(abilityCards) ? abilityCards : [];
    movementList.forEach((card, index) => attachCard(card, index, movementHand, 'movement'));
    abilityList.forEach((card, index) => attachCard(card, index, abilityHand, 'ability'));

    refreshHandLayouts();
    updateRotationRestriction();
    updateSubmitState();
    if (debugOverlay && debugOverlay.setEnabled) {
      debugOverlay.render(getHandCardsInOrder(), state.hoveredCardId);
    }
    if (options.exhaustedCardIds) {
      setExhaustedCards(options.exhaustedCardIds);
    }
    log('set-cards', {
      movement: movementList.length,
      ability: abilityList.length,
      exhausted: options.exhaustedCardIds ? options.exhaustedCardIds.length : 0,
    });
    updateComboEligibility();
    state.hasDealtCards = true;
    requestAnimationFrame(() => {
      refreshHandLayouts();
      pendingDeals.forEach((card) => animateDealCard(card, card.type));
      fitAllCardText(root);
      if (debugOverlay && debugOverlay.setEnabled) {
        debugOverlay.render(getHandCardsInOrder(), state.hoveredCardId);
      }
    });
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

  const setComboMode = (enabled, eligibleIds = []) => {
    state.comboMode = Boolean(enabled);
    const nextEligible = new Set();
    if (eligibleIds instanceof Set) {
      eligibleIds.forEach((id) => nextEligible.add(id));
    } else if (Array.isArray(eligibleIds)) {
      eligibleIds.forEach((id) => nextEligible.add(id));
    } else if (eligibleIds && typeof eligibleIds[Symbol.iterator] === 'function') {
      for (const id of eligibleIds) {
        nextEligible.add(id);
      }
    }
    state.comboEligibleIds = nextEligible;
    root.classList.toggle('is-combo', state.comboMode);
    updateComboEligibility();
    if (state.comboMode && state.slots.active && !state.comboEligibleIds.has(state.slots.active)) {
      returnCardToHand(state.slots.active);
    }
    updateSubmitState();
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

  const attemptSubmit = () => {
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
  };

  submitButton.addEventListener('click', attemptSubmit);

  if (rotationCenter) {
    rotationCenter.addEventListener('click', () => {
      if (rotationCenter.getAttribute('aria-disabled') === 'true') return;
      attemptSubmit();
    });
    rotationCenter.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (rotationCenter.getAttribute('aria-disabled') === 'true') return;
      attemptSubmit();
    });
  }

  bindSlot(activeSlot, 'active');
  bindSlot(passiveSlot, 'passive');
  bindHands();
  updateRotationRestriction();
  updateSubmitState();

  return {
    setCards,
    setExhaustedCards,
    setHidden,
    setVisible,
    setLocked,
    setComboMode,
    clearSelection,
  };
};
