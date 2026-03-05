import { buildCardElement, fitAllCardText } from '../shared/cardRenderer.js';
import { buildRotationWheel, ROTATION_LABELS } from './rotationWheel.js';
import { createDebugLogger } from './debugFlags.mjs';

const LOG_PREFIX = '[actionHud]';
const log = createDebugLogger(LOG_PREFIX);
const DEBUG_HOVER = false;
const WHIRLWIND_CARD_ID = 'whirlwind';
const WHIRLWIND_MIN_DAMAGE = 12;
const ACTION_CARD_BASE_WIDTH = 240;
const ACTION_CARD_BASE_HEIGHT = 336;
const ACTION_CARD_ACTIONS_LEFT = 6;
const ACTION_CARD_ACTION_WIDTH = 44.7678;
const ACTION_CARD_ACTIONS_TOP = 7;
const ACTION_CARD_ACTION_HEIGHT = 39.501;
const PLAY_BEAT_POINTER_ICON_CENTER_Y = 0.65;
const PLAY_MODAL_WIDTH = 210;
const PLAY_MODAL_HEIGHT = 297;
const PLAY_ACTIVE_LEFT_RATIO = 0.2288;
const PLAY_ACTIVE_TOP_RATIO = 0.3249;
const PLAY_ACTIVE_WIDTH_RATIO = 0.5429;
const PLAY_ACTIVE_HEIGHT_RATIO = 0.5558;
const PLAY_CARD_SCALE_MULTIPLIER = 1.1;
const PLAY_BEAT_SLOT_COUNT = 6;
const POINTER_DRAG_START_DISTANCE = 6;
const MIN_ADRENALINE = 0;
const MAX_ADRENALINE = 10;

const buildPlayBeatPointers = () => {
  const activeLeft = PLAY_MODAL_WIDTH * PLAY_ACTIVE_LEFT_RATIO;
  const activeTop = PLAY_MODAL_HEIGHT * PLAY_ACTIVE_TOP_RATIO;
  const activeWidth = PLAY_MODAL_WIDTH * PLAY_ACTIVE_WIDTH_RATIO;
  const activeHeight = PLAY_MODAL_HEIGHT * PLAY_ACTIVE_HEIGHT_RATIO;
  const cardScale = (activeWidth / ACTION_CARD_BASE_WIDTH) * PLAY_CARD_SCALE_MULTIPLIER;
  const cardWidth = ACTION_CARD_BASE_WIDTH * cardScale;
  const cardHeight = ACTION_CARD_BASE_HEIGHT * cardScale;
  const cardLeft = activeLeft + (activeWidth - cardWidth) / 2;
  const cardTop = activeTop + activeHeight - cardHeight;
  const iconColumnXRatio = (ACTION_CARD_ACTIONS_LEFT + ACTION_CARD_ACTION_WIDTH * 0.32) / ACTION_CARD_BASE_WIDTH;
  const iconTopRatio =
    (ACTION_CARD_ACTIONS_TOP + ACTION_CARD_ACTION_HEIGHT * PLAY_BEAT_POINTER_ICON_CENTER_Y) / ACTION_CARD_BASE_HEIGHT;
  const iconStepRatio = ACTION_CARD_ACTION_HEIGHT / ACTION_CARD_BASE_HEIGHT;
  return Array.from({ length: PLAY_BEAT_SLOT_COUNT }, (_, index) => ({
    x: (cardLeft + cardWidth * iconColumnXRatio) / PLAY_MODAL_WIDTH,
    y: (cardTop + cardHeight * (iconTopRatio + iconStepRatio * index)) / PLAY_MODAL_HEIGHT,
  }));
};

const PLAY_BEAT_POINTERS = buildPlayBeatPointers();

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

const getElementQuad = (element) => {
  if (!element) return null;
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

const resolveQuadAxes = (quad) => {
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

export const createActionHud = ({
  root,
  movementHand,
  abilityHand,
  activeSlot,
  passiveSlot,
  submitButton,
  rotationWheel,
  adrenalineMeterTrack,
  adrenalineMeterFill,
  adrenalineMeterKnob,
  adrenalineMeterValue,
  onSubmit,
  onRotationChange,
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
      setPlayerDamage: () => {},
      setPlayModalBeatPointer: () => {},
      setPlayedPreviewCards: () => {},
      setPlayedPreviewRotation: () => {},
      setAdrenalinePool: () => {},
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
    dragSourceSlot: null,
    lastDragClientX: null,
    lastDragClientY: null,
    comboMode: false,
    comboEligibleIds: new Set(),
    exhaustedCards: new Set(),
    hidden: false,
    hoveredCardId: null,
    lastVisible: null,
    lastLocked: null,
    hasDealtCards: false,
    playerDamage: 0,
    playedPreviewCards: { active: null, passive: null },
    playedPreviewElements: { active: null, passive: null },
    playedPreviewIds: { active: null, passive: null },
    suppressClickCardId: null,
    adrenalinePool: MIN_ADRENALINE,
    submittedAdrenaline: MIN_ADRENALINE,
  };
  const activeSlotContainer = activeSlot?.closest?.('.action-slot-active') ?? null;
  const passiveSlotContainer = passiveSlot?.closest?.('.action-slot-passive') ?? null;
  const emitRotationChange = () => {
    if (typeof onRotationChange === 'function') {
      onRotationChange(state.selectedRotation);
    }
  };
  let suppressProgrammaticRotation = false;
  const pointerDrag = {
    active: false,
    cardId: null,
    pointerId: null,
    offsetX: 0,
    offsetY: 0,
    pendingCardId: null,
    pendingPointerId: null,
    pendingStartX: 0,
    pendingStartY: 0,
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
        const quad = getElementQuad(element);
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
    if (suppressProgrammaticRotation) return;
    if (state.locked) return;
    state.selectedRotation = rotation;
    emitRotationChange();
    log('rotation', rotation);
    updateSubmitState();
  });

  const getCard = (cardId) => state.cardsById.get(cardId) || null;
  const setDraggingCardId = (cardId) => {
    state.draggingCardId = cardId || null;
    root.classList.toggle('is-card-dragging', Boolean(state.draggingCardId));
  };

  const getActiveCard = () => getCard(state.slots.active);
  const getPassiveCard = () => getCard(state.slots.passive);

  const prefersReducedMotion =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  const LERP_DURATION_MS = 220;
  const PASSIVE_SLOT_LERP_DURATION_MS = 420;
  const DEAL_DURATION_MS = 520;
  const actionCenter = rotationWheel?.closest?.('.action-center') ?? null;
  const modalShell = actionCenter?.querySelector?.('.play-modal-shell') ?? actionCenter;
  const playModalBeatPointer = modalShell?.querySelector?.('.play-modal-beat-pointer') ?? null;
  const resolvedAdrenalineTrack =
    adrenalineMeterTrack ?? actionCenter?.querySelector?.('#adrenalineMeterTrack') ?? null;
  const resolvedAdrenalineFill =
    adrenalineMeterFill ?? actionCenter?.querySelector?.('#adrenalineMeterFill') ?? null;
  const resolvedAdrenalineKnob =
    adrenalineMeterKnob ?? actionCenter?.querySelector?.('#adrenalineMeterKnob') ?? null;
  const resolvedAdrenalineValue =
    adrenalineMeterValue ?? actionCenter?.querySelector?.('#adrenalineMeterValue') ?? null;
  const adrenalineDrag = {
    active: false,
    pointerId: null,
  };
  const clampAdrenaline = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return MIN_ADRENALINE;
    const rounded = Math.round(parsed);
    return Math.max(MIN_ADRENALINE, Math.min(MAX_ADRENALINE, rounded));
  };
  const getMaxSubmittedAdrenaline = () => clampAdrenaline(state.adrenalinePool);
  const clampSubmittedAdrenaline = (value) =>
    Math.max(MIN_ADRENALINE, Math.min(getMaxSubmittedAdrenaline(), clampAdrenaline(value)));
  const canAdjustAdrenaline = () => state.turnActive && !state.locked;
  const updateAdrenalineUi = () => {
    const poolRatio = clampAdrenaline(state.adrenalinePool) / MAX_ADRENALINE;
    const submittedRatio = clampSubmittedAdrenaline(state.submittedAdrenaline) / MAX_ADRENALINE;
    if (resolvedAdrenalineFill) {
      resolvedAdrenalineFill.style.setProperty('--adrenaline-fill-percent', `${(poolRatio * 100).toFixed(3)}%`);
      resolvedAdrenalineFill.style.height = `${(poolRatio * 100).toFixed(3)}%`;
    }
    if (resolvedAdrenalineKnob) {
      resolvedAdrenalineKnob.style.setProperty('--adrenaline-submit-ratio', submittedRatio.toString());
      resolvedAdrenalineKnob.setAttribute('aria-label', `Submitted adrenaline: ${state.submittedAdrenaline}`);
      resolvedAdrenalineKnob.disabled = !canAdjustAdrenaline();
    }
    if (resolvedAdrenalineValue) {
      resolvedAdrenalineValue.textContent = `${state.submittedAdrenaline}`;
    }
  };
  const setSubmittedAdrenaline = (value) => {
    state.submittedAdrenaline = clampSubmittedAdrenaline(value);
    updateAdrenalineUi();
  };
  const setAdrenalinePool = (value) => {
    state.adrenalinePool = clampAdrenaline(value);
    state.submittedAdrenaline = clampSubmittedAdrenaline(state.submittedAdrenaline);
    updateAdrenalineUi();
  };
  const getAdrenalineFromClientY = (clientY) => {
    if (!resolvedAdrenalineTrack || !Number.isFinite(clientY)) return MIN_ADRENALINE;
    const rect = resolvedAdrenalineTrack.getBoundingClientRect();
    if (!rect || rect.height <= 0) return MIN_ADRENALINE;
    const ratio = (rect.bottom - clientY) / rect.height;
    return clampSubmittedAdrenaline(ratio * MAX_ADRENALINE);
  };
  const beginAdrenalineDrag = (event) => {
    if (!canAdjustAdrenaline()) return;
    if (typeof PointerEvent !== 'undefined' && !(event instanceof PointerEvent)) return;
    adrenalineDrag.active = true;
    adrenalineDrag.pointerId = event.pointerId;
    setSubmittedAdrenaline(getAdrenalineFromClientY(event.clientY));
    const target = event.currentTarget;
    if (target && typeof target.setPointerCapture === 'function') {
      target.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
  };
  const updateAdrenalineDrag = (event) => {
    if (!adrenalineDrag.active || adrenalineDrag.pointerId !== event.pointerId) return;
    setSubmittedAdrenaline(getAdrenalineFromClientY(event.clientY));
  };
  const endAdrenalineDrag = (event) => {
    if (!adrenalineDrag.active || adrenalineDrag.pointerId !== event.pointerId) return;
    adrenalineDrag.active = false;
    adrenalineDrag.pointerId = null;
  };
  const MIN_ACTION_CARD_SCALE = 0.3;
  const SCALE_SAFETY = 1.06;
  const PASSIVE_STAGE_OFFSET = 12;

  const getHandCardsInOrder = () => {
    const movementCards = Array.from(movementHand.querySelectorAll('.action-card'));
    const abilityCards = Array.from(abilityHand.querySelectorAll('.action-card'));
    return [...movementCards, ...abilityCards];
  };

  const isRectValid = (rect) => rect && rect.width > 0 && rect.height > 0;

  const clearSlotHoverState = () => {
    activeSlot.classList.remove('is-hover');
    passiveSlot.classList.remove('is-hover');
  };

  const getSlotForCardId = (cardId) => {
    if (!cardId) return null;
    if (state.slots.active === cardId) return 'active';
    if (state.slots.passive === cardId) return 'passive';
    return null;
  };

  const getSlotNameAtPoint = (clientX, clientY) => {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    const isPointInside = (element) => {
      const rect = element?.getBoundingClientRect?.();
      if (!isRectValid(rect)) return false;
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    };
    if (isPointInside(activeSlot)) return 'active';
    if (isPointInside(passiveSlot)) return 'passive';
    return null;
  };

  const isPointInsideElement = (element, clientX, clientY) => {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
    const rect = element?.getBoundingClientRect?.();
    if (!isRectValid(rect)) return false;
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  };

  const beginCardDrag = (cardId) => {
    state.dragSourceSlot = getSlotForCardId(cardId);
    state.lastDragClientX = null;
    state.lastDragClientY = null;
    setDraggingCardId(cardId);
  };

  const endCardDrag = () => {
    setDraggingCardId(null);
    state.dragSourceSlot = null;
    state.lastDragClientX = null;
    state.lastDragClientY = null;
    clearSlotHoverState();
  };

  const updateLastDragPoint = (event) => {
    if (!event) return;
    const nextX = Number(event.clientX);
    const nextY = Number(event.clientY);
    if (Number.isFinite(nextX)) state.lastDragClientX = nextX;
    if (Number.isFinite(nextY)) state.lastDragClientY = nextY;
  };

  const clearPendingPointerDrag = () => {
    pointerDrag.pendingCardId = null;
    pointerDrag.pendingPointerId = null;
    pointerDrag.pendingStartX = 0;
    pointerDrag.pendingStartY = 0;
  };

  const resetPointerDrag = () => {
    pointerDrag.active = false;
    pointerDrag.cardId = null;
    pointerDrag.pointerId = null;
    pointerDrag.offsetX = 0;
    pointerDrag.offsetY = 0;
    clearPendingPointerDrag();
  };

  const clearPointerDragStyles = (element) => {
    if (!element) return;
    element.style.position = '';
    element.style.left = '';
    element.style.top = '';
    element.style.right = '';
    element.style.bottom = '';
    element.style.width = '';
    element.style.height = '';
    element.style.margin = '';
    element.style.transform = '';
    element.style.transition = '';
    element.style.zIndex = '';
    element.style.pointerEvents = '';
  };

  const updateSlotHoverFromPoint = (clientX, clientY) => {
    const slotName = getSlotNameAtPoint(clientX, clientY);
    activeSlot.classList.toggle('is-hover', slotName === 'active');
    passiveSlot.classList.toggle('is-hover', slotName === 'passive');
    return slotName;
  };

  const positionPointerDraggedCard = (clientX, clientY) => {
    if (!pointerDrag.active || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    const card = getCard(pointerDrag.cardId);
    if (!card?.element) return;
    const left = clientX - pointerDrag.offsetX;
    const top = clientY - pointerDrag.offsetY;
    card.element.style.left = `${left}px`;
    card.element.style.top = `${top}px`;
    updateSlotHoverFromPoint(clientX, clientY);
  };

  const restoreDraggedCardToHand = (cardId, fromRectOverride = null) => {
    const card = getCard(cardId);
    if (!card?.element) return;
    const fromRect =
      isRectValid(fromRectOverride) ? fromRectOverride : card.element?.getBoundingClientRect?.();
    card.element.classList.add('is-animating');
    insertCardIntoHand(card);
    clearPointerDragStyles(card.element);
    refreshHandLayouts();
    const toRect = card.element?.getBoundingClientRect?.();
    if (isRectValid(fromRect) && isRectValid(toRect)) {
      animateCardTravel(card.element, fromRect, toRect);
    } else {
      card.element.classList.remove('is-animating');
    }
  };

  const startPointerDrag = (cardId, pointerId, clientX, clientY) => {
    const card = getCard(cardId);
    if (!card?.element) return false;
    const rect = card.element.getBoundingClientRect();
    if (!isRectValid(rect)) return false;
    beginCardDrag(cardId);
    pointerDrag.active = true;
    pointerDrag.cardId = cardId;
    pointerDrag.pointerId = pointerId;
    pointerDrag.offsetX = clientX - rect.left;
    pointerDrag.offsetY = clientY - rect.top;
    clearPendingPointerDrag();
    clearHoverForCard(cardId);
    card.element.classList.add('is-dragging', 'is-pointer-dragging');
    card.element.style.position = 'fixed';
    card.element.style.left = `${rect.left}px`;
    card.element.style.top = `${rect.top}px`;
    card.element.style.width = `${rect.width}px`;
    card.element.style.height = `${rect.height}px`;
    card.element.style.margin = '0';
    card.element.style.transform = 'none';
    card.element.style.transition = 'none';
    card.element.style.zIndex = '120';
    card.element.style.pointerEvents = 'none';
    document.body.appendChild(card.element);
    positionPointerDraggedCard(clientX, clientY);
    return true;
  };

  const queuePointerDrag = (cardId, event) => {
    pointerDrag.pendingCardId = cardId;
    pointerDrag.pendingPointerId = event.pointerId;
    pointerDrag.pendingStartX = Number(event.clientX);
    pointerDrag.pendingStartY = Number(event.clientY);
  };

  const maybeStartPointerDrag = (event) => {
    if (!pointerDrag.pendingCardId || pointerDrag.pendingPointerId !== event.pointerId) return false;
    const deltaX = Number(event.clientX) - pointerDrag.pendingStartX;
    const deltaY = Number(event.clientY) - pointerDrag.pendingStartY;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < POINTER_DRAG_START_DISTANCE) return false;
    const card = getCard(pointerDrag.pendingCardId);
    if (!card || card.exhausted || state.locked || !state.turnActive) {
      clearPendingPointerDrag();
      return false;
    }
    return startPointerDrag(pointerDrag.pendingCardId, event.pointerId, event.clientX, event.clientY);
  };

  const finishPointerDrag = (event = null, { cancelled = false } = {}) => {
    if (!pointerDrag.active) {
      clearPendingPointerDrag();
      return false;
    }
    const cardId = pointerDrag.cardId;
    const card = getCard(cardId);
    const clientX = Number.isFinite(Number(event?.clientX)) ? Number(event.clientX) : state.lastDragClientX;
    const clientY = Number.isFinite(Number(event?.clientY)) ? Number(event.clientY) : state.lastDragClientY;
    const fromRect = card?.element?.getBoundingClientRect?.() ?? null;
    if (!card?.element) {
      resetPointerDrag();
      endCardDrag();
      return true;
    }
    card.element.classList.remove('is-dragging', 'is-pointer-dragging');
    const slotName = !cancelled ? getSlotNameAtPoint(clientX, clientY) : null;
    const overModal = !cancelled && isPointInsideElement(modalShell, clientX, clientY);
    if (slotName) {
      clearPointerDragStyles(card.element);
      assignCardToSlot(slotName, cardId, { fromRectOverride: fromRect });
    } else if (overModal) {
      clearPointerDragStyles(card.element);
      const fallbackSlot = chooseSlotForCard(card);
      if (fallbackSlot) {
        assignCardToSlot(fallbackSlot, cardId, { fromRectOverride: fromRect });
      } else if (state.dragSourceSlot) {
        clearPointerDragStyles(card.element);
        returnCardToHand(cardId, { fromRectOverride: fromRect });
      } else {
        restoreDraggedCardToHand(cardId, fromRect);
      }
    } else if (state.dragSourceSlot) {
      clearPointerDragStyles(card.element);
      returnCardToHand(cardId, { fromRectOverride: fromRect });
    } else {
      restoreDraggedCardToHand(cardId, fromRect);
    }
    state.suppressClickCardId = cardId;
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        if (state.suppressClickCardId === cardId) {
          state.suppressClickCardId = null;
        }
      });
    }
    resetPointerDrag();
    endCardDrag();
    return true;
  };

  const cancelPointerDrag = (event = null) => {
    if (pointerDrag.active) {
      return finishPointerDrag(event, { cancelled: true });
    }
    clearPendingPointerDrag();
    return false;
  };

  const createGhostLayer = (selectorClass, className) => {
    const existing = root.querySelector(`.${selectorClass}`);
    if (existing) return existing;
    const layer = document.createElement('div');
    layer.className = className;
    return layer;
  };

  const ghostLayerUnder = createGhostLayer(
    'action-hud-ghost-layer-under',
    'action-hud-ghost-layer action-hud-ghost-layer-under',
  );
  const ghostLayerOver = createGhostLayer(
    'action-hud-ghost-layer-over',
    'action-hud-ghost-layer action-hud-ghost-layer-over',
  );
  if (actionCenter) {
    if (!ghostLayerUnder.parentElement) {
      root.insertBefore(ghostLayerUnder, actionCenter);
    }
    if (!ghostLayerOver.parentElement) {
      actionCenter.appendChild(ghostLayerOver);
    }
  }

  const getCssNumber = (styles, name, fallback) => {
    const raw = styles.getPropertyValue(name);
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
  };

  const measureHandBounds = (cards) => {
    if (!cards?.length) return null;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    cards.forEach((card) => {
      const rect = card?.getBoundingClientRect?.();
      if (!isRectValid(rect)) return;
      minX = Math.min(minX, rect.left);
      maxX = Math.max(maxX, rect.right);
    });
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
    return { minX, maxX };
  };

  const updateResponsiveSizing = (cards = null, cardCountOverride = null) => {
    if (typeof window === 'undefined') return;
    const rootRect = root.getBoundingClientRect();
    if (!isRectValid(rootRect)) return;
    const styles = getComputedStyle(root);
    const baseScale = getCssNumber(styles, '--action-card-scale-base', getCssNumber(styles, '--action-card-scale', 0.67));
    const handWidthBase = getCssNumber(styles, '--action-hand-width-base', getCssNumber(styles, '--action-hand-width', 0));
    const handCardScale = getCssNumber(styles, '--action-hand-card-scale', 0.7);
    const fanGapFactor = getCssNumber(styles, '--action-hand-fan-gap-factor', 0.32);
    const baseCardWidth = getCssNumber(styles, '--action-card-base-width', 240);
    const gap = getCssNumber(styles, '--action-hand-modal-gap', 18);
    const actionCenterRect = actionCenter?.getBoundingClientRect?.();
    const modalRect = modalShell?.getBoundingClientRect?.();
    const boundaryRect = isRectValid(modalRect) ? modalRect : actionCenterRect;
    const rightEdge = boundaryRect ? boundaryRect.left - gap : rootRect.right - gap;
    const maxHandWidth = Math.max(0, rightEdge - rootRect.left);
    const baseHandWidth = handWidthBase > 0 ? handWidthBase : maxHandWidth;
    const targetHandWidth = Math.max(0, Math.min(baseHandWidth, maxHandWidth));
    if (boundaryRect && Number.isFinite(boundaryRect.left)) {
      const handRight = Math.max(0, rootRect.right - boundaryRect.left + gap);
      root.style.setProperty('--action-hand-right', `${handRight}px`);
    }
    if (Number.isFinite(targetHandWidth)) {
      root.style.setProperty('--action-hand-width', `${targetHandWidth}px`);
    }
    const cardCount = Math.max(1, cardCountOverride ?? cards?.length ?? getHandCardsInOrder().length ?? 1);
    const spanFactor = handCardScale + Math.max(0, cardCount - 1) * fanGapFactor;
    const targetWidth = Number.isFinite(targetHandWidth) ? targetHandWidth : baseHandWidth || rootRect.width;
    if (!targetWidth || !spanFactor || !baseCardWidth) {
      root.style.setProperty('--action-card-scale', `${Math.max(MIN_ACTION_CARD_SCALE, baseScale)}`);
      return;
    }
    const desiredScale = targetWidth / (baseCardWidth * spanFactor * SCALE_SAFETY);
    let nextScale = Math.max(MIN_ACTION_CARD_SCALE, Math.min(baseScale, desiredScale));
    root.style.setProperty('--action-card-scale', nextScale.toFixed(3));

    const measuredCards = cards ?? getHandCardsInOrder();
    if (!measuredCards.length) return;
    const availableWidth = Math.max(0, rightEdge - rootRect.left);
    if (!availableWidth) return;
    for (let i = 0; i < 3; i += 1) {
      const bounds = measureHandBounds(measuredCards);
      if (!bounds) break;
      if (bounds.minX >= rootRect.left && bounds.maxX <= rightEdge) break;
      const actualWidth = bounds.maxX - bounds.minX;
      if (!actualWidth) break;
      const ratio = availableWidth / actualWidth;
      const adjustedScale = Math.max(MIN_ACTION_CARD_SCALE, Math.min(nextScale, nextScale * ratio * 0.98));
      if (Math.abs(adjustedScale - nextScale) < 0.001) break;
      nextScale = adjustedScale;
      root.style.setProperty('--action-card-scale', nextScale.toFixed(3));
    }
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
    const cards = getHandCardsInOrder();
    updateResponsiveSizing(cards, cards.length);
    applyFanLayout(cards);
    updateResponsiveSizing(cards, cards.length);
  };
  const scheduleLayoutRefresh = (() => {
    let raf = null;
    return () => {
      if (typeof window === 'undefined') return;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = null;
        refreshHandLayouts();
        fitAllCardText(root);
      });
    };
  })();

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

  const createCardGhost = (cardElement, extraClasses = []) => {
    const ghost = cardElement.cloneNode(true);
    ghost.classList.add('action-card-ghost');
    if (Array.isArray(extraClasses) && extraClasses.length) {
      ghost.classList.add(...extraClasses);
    }
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

  const toLocalRect = (rect, layerRect) => ({
    left: rect.left - layerRect.left,
    top: rect.top - layerRect.top,
    width: rect.width,
    height: rect.height,
  });

  const getTransformToRect = (fromRect, toRect) => {
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
    return `translate3d(${dx}px, ${dy}px, 0) scale(${scaleX}, ${scaleY})`;
  };

  const animateGhostPathInLayer = (ghost, layer, fromRect, stageRect, toRect, options = {}) => {
    const { duration = PASSIVE_SLOT_LERP_DURATION_MS, easing = 'cubic-bezier(0.25, 0.9, 0.2, 1)', onComplete } = options;
    if (!ghost || !layer || !isRectValid(fromRect) || !isRectValid(toRect) || prefersReducedMotion) {
      if (ghost && ghost.remove) ghost.remove();
      if (onComplete) onComplete();
      return;
    }
    const layerRect = layer.getBoundingClientRect();
    if (!isRectValid(layerRect)) {
      ghost.remove();
      if (onComplete) onComplete();
      return;
    }
    const fromLocal = toLocalRect(fromRect, layerRect);
    const toLocal = toLocalRect(toRect, layerRect);
    const stageLocal =
      stageRect && isRectValid(stageRect)
        ? toLocalRect(stageRect, layerRect)
        : {
            left: fromLocal.left + (toLocal.left - fromLocal.left) * 0.45,
            top: fromLocal.top + (toLocal.top - fromLocal.top) * 0.45,
            width: fromLocal.width,
            height: fromLocal.height,
          };
    ghost.style.left = `${fromLocal.left}px`;
    ghost.style.top = `${fromLocal.top}px`;
    ghost.style.width = `${fromLocal.width}px`;
    ghost.style.height = `${fromLocal.height}px`;
    ghost.style.position = 'absolute';
    ghost.style.transformOrigin = 'center center';
    layer.appendChild(ghost);
    const animation = ghost.animate(
      [
        { transform: 'translate3d(0, 0, 0) scale(1, 1)', offset: 0 },
        { transform: getTransformToRect(fromLocal, stageLocal), offset: 0.42 },
        { transform: getTransformToRect(fromLocal, toLocal), offset: 1 },
      ],
      { duration, easing, fill: 'forwards' },
    );
    const finish = () => {
      ghost.remove();
      if (onComplete) onComplete();
    };
    animation.onfinish = finish;
    animation.oncancel = finish;
  };

  const animatePassiveCardTravel = (cardElement, fromRect, toRect) => {
    const modalRect = modalShell?.getBoundingClientRect?.();
    if (!isRectValid(modalRect) || !ghostLayerUnder || !ghostLayerOver) {
      animateCardTravel(cardElement, fromRect, toRect);
      return;
    }
    const stageRect = {
      left: modalRect.right + PASSIVE_STAGE_OFFSET,
      top: modalRect.bottom - fromRect.height,
      width: fromRect.width,
      height: fromRect.height,
    };
    const passiveWindowRect = passiveSlot.getBoundingClientRect();
    const overRect = ghostLayerOver.getBoundingClientRect();
    if (!isRectValid(passiveWindowRect) || !isRectValid(overRect)) {
      animateCardTravel(cardElement, fromRect, toRect);
      return;
    }
    const passiveWindow = document.createElement('div');
    passiveWindow.className = 'action-passive-window-mask';
    passiveWindow.style.left = `${passiveWindowRect.left - overRect.left}px`;
    passiveWindow.style.top = `${passiveWindowRect.top - overRect.top}px`;
    passiveWindow.style.width = `${passiveWindowRect.width}px`;
    passiveWindow.style.height = `${passiveWindowRect.height}px`;
    ghostLayerOver.appendChild(passiveWindow);

    const underGhost = createCardGhost(cardElement, ['is-passive-under']);
    underGhost.style.zIndex = 'auto';
    const revealGhost = createCardGhost(cardElement, ['is-passive-reveal']);
    revealGhost.style.zIndex = 'auto';

    let finishedCount = 0;
    const handleFinish = () => {
      finishedCount += 1;
      if (finishedCount < 2) return;
      passiveWindow.remove();
      cardElement.classList.remove('is-animating');
    };

    animateGhostPathInLayer(underGhost, ghostLayerUnder, fromRect, stageRect, toRect, {
      duration: PASSIVE_SLOT_LERP_DURATION_MS,
      onComplete: handleFinish,
    });
    animateGhostPathInLayer(revealGhost, passiveWindow, fromRect, stageRect, toRect, {
      duration: PASSIVE_SLOT_LERP_DURATION_MS,
      onComplete: handleFinish,
    });
  };

  const animateCardTravel = (cardElement, fromRect, toRect, options = {}) => {
    const { mode = 'default' } = options;
    if (mode === 'passive-slotting') {
      animatePassiveCardTravel(cardElement, fromRect, toRect);
      return;
    }
    const ghost = createCardGhost(cardElement);
    animateGhostBetween(ghost, fromRect, toRect, {
      duration: LERP_DURATION_MS,
      onComplete: () => {
        cardElement.classList.remove('is-animating');
      },
    });
  };

  const animateDealCard = (card, type) =>
    new Promise((resolve) => {
      if (!card?.element) {
        resolve();
        return;
      }
      if (prefersReducedMotion) {
        card.element.classList.remove('is-drawn');
        resolve();
        return;
      }
      const targetRect = card.element.getBoundingClientRect();
      if (!isRectValid(targetRect)) {
        card.element.classList.remove('is-drawn');
        resolve();
        return;
      }
      const computed = getComputedStyle(card.element);
      const baseWidth = Number.parseFloat(computed.width);
      const baseHeight = Number.parseFloat(computed.height);
      const ghostWidth =
        Number.isFinite(baseWidth) && baseWidth > 0 ? baseWidth : targetRect.width;
      const ghostHeight =
        Number.isFinite(baseHeight) && baseHeight > 0 ? baseHeight : targetRect.height;
      const startX =
        type === 'movement' ? -ghostWidth * 1.2 : window.innerWidth + ghostWidth * 1.2;
      const startY = targetRect.top + targetRect.height * 0.1;
      const fromRect = {
        left: startX,
        top: startY,
        width: ghostWidth,
        height: ghostHeight,
      };
      const drawGhost = createCardGhost(card.element);
      drawGhost.classList.add('action-card-deal');
      drawGhost.style.width = `${ghostWidth}px`;
      drawGhost.style.height = `${ghostHeight}px`;
      animateGhostBetween(drawGhost, fromRect, targetRect, {
        duration: DEAL_DURATION_MS,
        removeOnFinish: false,
        onComplete: () => {
          card.element.classList.remove('is-drawn');
          if (drawGhost.remove) drawGhost.remove();
          resolve();
        },
      });
    });

  const animatePendingDeals = (pendingDeals) => {
    if (!pendingDeals?.length) return;
    let chain = Promise.resolve();
    pendingDeals.forEach((card) => {
      chain = chain.then(() => animateDealCard(card, card.type));
    });
  };

  const setCardDraggable = (card, enabled) => {
    if (!card?.element) return;
    const isEnabled = Boolean(enabled) && !card.exhausted;
    card.element.draggable = false;
    card.element.classList.toggle('is-disabled', !isEnabled);
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

  const clearPlayedPreviewElement = (slotName) => {
    const element = state.playedPreviewElements[slotName];
    if (element?.parentElement) {
      element.remove();
    }
    state.playedPreviewElements[slotName] = null;
    state.playedPreviewIds[slotName] = null;
  };

  const ensurePlayedPreviewElement = (slotName) => {
    const card = state.playedPreviewCards[slotName];
    if (!card) {
      clearPlayedPreviewElement(slotName);
      return null;
    }
    const previewClassName = `${card?.previewClassName ?? ''}`.trim();
    const previewKey = `${card.id}|${previewClassName}`;
    if (state.playedPreviewIds[slotName] === previewKey && state.playedPreviewElements[slotName]) {
      return state.playedPreviewElements[slotName];
    }
    clearPlayedPreviewElement(slotName);
    const className = `is-played-preview${previewClassName ? ` ${previewClassName}` : ''}`;
    const element = buildCardElement(card, { className });
    state.playedPreviewElements[slotName] = element;
    state.playedPreviewIds[slotName] = previewKey;
    fitAllCardText(element);
    return element;
  };

  const renderPlayedPreviewSlot = (slotName) => {
    const slot = slotName === 'active' ? activeSlot : passiveSlot;
    const hasSelection = Boolean(state.slots[slotName]);
    const shouldShow = !state.turnActive && !hasSelection && Boolean(state.playedPreviewCards[slotName]);
    if (!shouldShow) {
      clearPlayedPreviewElement(slotName);
      slot.classList.remove('is-played-preview');
      return false;
    }
    const preview = ensurePlayedPreviewElement(slotName);
    if (!preview) {
      slot.classList.remove('is-played-preview');
      return false;
    }
    if (preview.parentElement !== slot) {
      slot.appendChild(preview);
    }
    slot.classList.add('is-played-preview');
    return true;
  };

  const updateSlotState = () => {
    const activePreview = renderPlayedPreviewSlot('active');
    const passivePreview = renderPlayedPreviewSlot('passive');
    const isStunnedPreview =
      activePreview && `${state.playedPreviewCards.active?.previewClassName ?? ''}`.split(' ').includes('is-stun-card');
    const activeOccupied = Boolean(state.slots.active) || activePreview;
    const passiveOccupied = Boolean(state.slots.passive) || passivePreview;
    activeSlot.classList.toggle('is-occupied', activeOccupied);
    passiveSlot.classList.toggle('is-occupied', passiveOccupied);
    activeSlot.classList.toggle('is-stunned', isStunnedPreview);
    activeSlotContainer?.classList?.toggle('is-stunned', isStunnedPreview);
    passiveSlotContainer?.classList?.toggle('is-stunned', false);
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

  const clearSlot = (slotName, options = {}) => {
    const cardId = state.slots[slotName];
    if (!cardId) return;
    const card = getCard(cardId);
    const fromRectOverride = options?.fromRectOverride ?? null;
    if (card) {
      clearHoverForCard(cardId);
      const fromRect =
        isRectValid(fromRectOverride) ? fromRectOverride : card.element?.getBoundingClientRect?.();
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
    updateSlotState();
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
    submitButton.hidden = !state.turnActive;
    submitButton.disabled = !canSubmit;
    rotationWheel?.classList?.toggle('is-submit-ready', canSubmit);
  };

  const shakeCard = (card) => {
    if (!card?.element || prefersReducedMotion) return;
    card.element.classList.remove('is-shaking');
    void card.element.offsetWidth;
    card.element.classList.add('is-shaking');
    card.element.addEventListener(
      'animationend',
      () => {
        card.element?.classList?.remove('is-shaking');
      },
      { once: true },
    );
  };

  const assignCardToSlot = (slotName, cardId, options = {}) => {
    if (state.locked) return;
    const card = getCard(cardId);
    const fromRectOverride = options?.fromRectOverride ?? null;
    if (!card || card.exhausted) return;
    if (slotName === 'active' && card.id === WHIRLWIND_CARD_ID && state.playerDamage < WHIRLWIND_MIN_DAMAGE) {
      shakeCard(card);
      return;
    }
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
    const fromRect =
      isRectValid(fromRectOverride) ? fromRectOverride : card.element?.getBoundingClientRect?.();
    clearHoverForCard(cardId);
    card.element?.classList.add('is-animating');
    slot.appendChild(card.element);
    refreshHandLayouts();
    const toRect = card.element?.getBoundingClientRect?.() ?? slot.getBoundingClientRect();
    if (isRectValid(fromRect) && isRectValid(toRect)) {
      animateCardTravel(card.element, fromRect, toRect, {
        mode: slotName === 'passive' ? 'passive-slotting' : 'default',
      });
    } else if (card.element) {
      card.element.classList.remove('is-animating');
    }
    state.slots[slotName] = cardId;
    updateSlotState();
    updateRotationRestriction();
    updateSubmitState();
    log('slot-assign', { slotName, cardId });
  };

  const returnCardToHand = (cardId, options = {}) => {
    if (state.locked) return;
    const card = getCard(cardId);
    const fromRectOverride = options?.fromRectOverride ?? null;
    if (!card) return;
    clearHoverForCard(cardId);
    if (state.slots.active === cardId) {
      clearSlot('active', { fromRectOverride });
      updateRotationRestriction();
    }
    if (state.slots.passive === cardId) {
      clearSlot('passive', { fromRectOverride });
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
    const isPrimaryPointer = (event) => event.pointerType !== 'mouse' || event.button === 0;

    const getHoverPadding = () => {
      const raw = getComputedStyle(root).getPropertyValue('--action-hand-hover-padding');
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : 80;
    };

    const findCardUnderPointer = (event) => {
      const cards = getHandCardsInOrder();
      if (!cards.length) return null;
      const hoverPadding = getHoverPadding();
      const cardData = [];
      let rightmostIndex = -1;
      let rightmostX = -Infinity;
      cards.forEach((element) => {
        const quad = getElementQuad(element);
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
        const axes = resolveQuadAxes(card.quad);
        if (!axes) return;
        const dx = event.clientX - axes.origin.x;
        const dy = event.clientY - axes.origin.y;
        const u = (dx * axes.vHeight.y - dy * axes.vHeight.x) / axes.det;
        const v = (-dx * axes.vWidth.y + dy * axes.vWidth.x) / axes.det;
        const padU = axes.widthLen ? padPixels / axes.widthLen : 0;
        const padV = axes.heightLen ? padPixels / axes.heightLen : 0;
        const inFull = card.isRightmost && u >= -padU && u <= 1 + padU && v >= -padV && v <= 1 + padV;
        const inLeftHalf = u >= -padU && u <= 0.5 + padU && v >= -padV && v <= 1 + padV;
        const isHoveredCard = card.element?.dataset?.cardId === state.hoveredCardId;
        const inHoveredBounds = isHoveredCard && u >= -padU && u <= 1 + padU && v >= -padV && v <= 1 + padV;
        const inPrimaryBounds = inFull || inLeftHalf;
        const inHoverExtension = !inPrimaryBounds && inHoveredBounds;
        if (!inPrimaryBounds && !inHoverExtension) return;
        const uCenter = inFull || inHoveredBounds ? 0.5 : 0.25;
        const center = {
          x: axes.origin.x + axes.vWidth.x * uCenter + axes.vHeight.x * 0.5,
          y: axes.origin.y + axes.vWidth.y * uCenter + axes.vHeight.y * 0.5,
        };
        candidates.push({ element: card.element, center, inPrimaryBounds });
      });
      if (!candidates.length) return null;
      const primaryCandidates = candidates.filter((candidate) => candidate.inPrimaryBounds);
      const activeCandidates = primaryCandidates.length ? primaryCandidates : candidates;
      const currentId = state.hoveredCardId;
      const currentCandidate = currentId
        ? activeCandidates.find((candidate) => candidate.element.dataset.cardId === currentId)
        : null;
      if (!primaryCandidates.length && currentCandidate) {
        return currentCandidate.element;
      }
      const getDistance = (candidate) =>
        Math.abs(event.clientX - candidate.center.x) + Math.abs(event.clientY - candidate.center.y) * 0.2;
      let closest = null;
      let minDistance = Number.POSITIVE_INFINITY;
      activeCandidates.forEach((candidate) => {
        const distance = getDistance(candidate);
        if (distance >= minDistance) return;
        minDistance = distance;
        closest = candidate;
      });
      if (currentId) {
        if (currentCandidate && closest && currentCandidate !== closest) {
          const currentDistance = getDistance(currentCandidate);
          const hysteresis = 8;
          if (currentDistance <= minDistance + hysteresis) {
            return currentCandidate.element;
          }
        }
      }
      return closest?.element ?? null;
    };

    const findCardFromPointerDown = (event) => {
      const targetElement = event.target instanceof Element ? event.target.closest('.action-card') : null;
      const targetCardId = `${targetElement?.dataset?.cardId ?? ''}`.trim();
      const targetCard = targetCardId ? getCard(targetCardId) : null;
      if (targetCard) {
        return targetCard;
      }
      const inHands =
        isPointInsideElement(movementHand, event.clientX, event.clientY) ||
        isPointInsideElement(abilityHand, event.clientX, event.clientY);
      if (inHands) {
        const handCardId = `${findCardUnderPointer(event)?.dataset?.cardId ?? ''}`.trim();
        const handCard = handCardId ? getCard(handCardId) : null;
        if (handCard) {
          return handCard;
        }
      }
      const slotName = getSlotNameAtPoint(event.clientX, event.clientY);
      if (slotName && state.slots[slotName]) {
        return getCard(state.slots[slotName]);
      }
      return null;
    };

    window.addEventListener('pointerdown', (event) => {
      updateLastDragPoint(event);
      if (!isPrimaryPointer(event)) return;
      if (pointerDrag.active || state.locked || !state.turnActive) return;
      const card = findCardFromPointerDown(event);
      if (!card || card.exhausted) return;
      queuePointerDrag(card.id, event);
    });

    window.addEventListener('pointermove', (event) => {
      updateLastDragPoint(event);
      const hasActiveDrag = pointerDrag.active;
      if (hasActiveDrag) {
        if (pointerDrag.pointerId === event.pointerId) {
          positionPointerDraggedCard(event.clientX, event.clientY);
        }
        return;
      }
      maybeStartPointerDrag(event);
      if (pointerDrag.active) {
        return;
      }
      const element = findCardUnderPointer(event);
      const cardId = element?.dataset.cardId ?? null;
      setHoveredCard(cardId);
      if (debugOverlay && debugOverlay.setEnabled) {
        debugOverlay.render(getHandCardsInOrder(), cardId, { x: event.clientX, y: event.clientY });
      }
    });

    const onPointerEnd = (event) => {
      updateLastDragPoint(event);
      if (pointerDrag.active) {
        if (event?.pointerId === pointerDrag.pointerId) {
          finishPointerDrag(event);
        }
        return;
      }
      if (pointerDrag.pendingPointerId === event?.pointerId) {
        clearPendingPointerDrag();
      }
    };

    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);

    window.addEventListener('blur', () => {
      setHoveredCard(null);
      cancelPointerDrag();
      debugOverlay?.clear();
    });
    window.addEventListener(
      'dragstart',
      (event) => {
        if (!(event.target instanceof Element)) return;
        if (event.target.closest('.action-card')) {
          event.preventDefault();
        }
      },
      true,
    );
    window.addEventListener(
      'drop',
      (event) => {
        if (!(event.target instanceof Element)) return;
        if (event.target.closest('.action-card')) {
          event.preventDefault();
        }
      },
      true,
    );
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') {
          cancelPointerDrag();
        }
      });
    }
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
    state.playedPreviewElements.active = null;
    state.playedPreviewElements.passive = null;
    state.playedPreviewIds.active = null;
    state.playedPreviewIds.passive = null;
    state.hoveredCardId = null;
    endCardDrag();
    state.slots.active = null;
    state.slots.passive = null;
    updateSlotState();
    state.selectedRotation = null;
    wheel.clear();
    if (state.locked) {
      emitRotationChange();
    }
    state.exhaustedCards = new Set();

    const attachCard = (card, index, container, type) => {
      const element = buildCardElement(card, { asButton: true });
      element.draggable = false;
      element.querySelectorAll('img').forEach((image) => {
        image.draggable = false;
      });
      element.addEventListener('dragstart', (event) => {
        event.preventDefault();
      });
      element.addEventListener('click', (event) => {
        if (state.suppressClickCardId === card.id) {
          state.suppressClickCardId = null;
          event.preventDefault();
          return;
        }
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
      animatePendingDeals(pendingDeals);
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
    const wasTurnActive = state.turnActive;
    state.turnActive = Boolean(visible);
    root.classList.toggle('is-turn', state.turnActive);
    if (!state.turnActive) {
      cancelPointerDrag();
      endCardDrag();
      adrenalineDrag.active = false;
      adrenalineDrag.pointerId = null;
    }
    root.hidden = state.hidden;
    if (state.turnActive && !wasTurnActive) {
      suppressProgrammaticRotation = true;
      wheel.clear();
      suppressProgrammaticRotation = false;
      state.selectedRotation = null;
      emitRotationChange();
      setSubmittedAdrenaline(MIN_ADRENALINE);
    }
    state.cardsById.forEach((card) => setCardDraggable(card, !state.locked && state.turnActive));
    updateSlotState();
    updateSubmitState();
    updateAdrenalineUi();
    if (state.turnActive) {
      scheduleLayoutRefresh();
    }
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
    const nextLocked = Boolean(locked);
    if (nextLocked && !state.locked) {
      cancelPointerDrag();
      endCardDrag();
      adrenalineDrag.active = false;
      adrenalineDrag.pointerId = null;
    }
    state.locked = nextLocked;
    root.classList.toggle('is-locked', state.locked);
    state.cardsById.forEach((card) => setCardDraggable(card, !state.locked && state.turnActive));
    updateSubmitState();
    updateAdrenalineUi();
    if (state.lastLocked !== state.locked) {
      log('locked', state.locked);
      state.lastLocked = state.locked;
    }
  };

  const clearSelection = () => {
    clearSlot('active');
    clearSlot('passive');
    state.selectedRotation = null;
    cancelPointerDrag();
    endCardDrag();
    wheel.clear();
    if (state.locked) {
      emitRotationChange();
    }
    updateRotationRestriction();
    updateSubmitState();
  };

  const attemptSubmit = () => {
    const activeCard = getActiveCard();
    const passiveCard = getPassiveCard();
    const rotation = state.selectedRotation;
    const adrenaline = clampSubmittedAdrenaline(state.submittedAdrenaline);
    const hasActionList = Array.isArray(activeCard?.actions) && activeCard.actions.length > 0;
    if (!activeCard || !passiveCard || !hasActionList || !isRotationAllowed(rotation)) return;
    log('submit', {
      activeCardId: activeCard.id,
      passiveCardId: passiveCard.id,
      rotation,
      adrenaline,
      activeActions: activeCard.actions?.length ?? 0,
    });
    if (onSubmit) {
      void onSubmit({
        activeCardId: activeCard.id,
        passiveCardId: passiveCard.id,
        rotation,
        adrenaline,
        activeCard,
        passiveCard,
      });
    }
    setSubmittedAdrenaline(MIN_ADRENALINE);
  };

  submitButton.addEventListener('click', attemptSubmit);

  if (resolvedAdrenalineTrack && resolvedAdrenalineKnob) {
    resolvedAdrenalineTrack.addEventListener('pointerdown', beginAdrenalineDrag);
    resolvedAdrenalineKnob.addEventListener('pointerdown', beginAdrenalineDrag);
    resolvedAdrenalineKnob.addEventListener('keydown', (event) => {
      if (!canAdjustAdrenaline()) return;
      if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
        event.preventDefault();
        setSubmittedAdrenaline(state.submittedAdrenaline + 1);
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
        event.preventDefault();
        setSubmittedAdrenaline(state.submittedAdrenaline - 1);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        setSubmittedAdrenaline(MIN_ADRENALINE);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        setSubmittedAdrenaline(MAX_ADRENALINE);
      }
    });
    window.addEventListener('pointermove', updateAdrenalineDrag);
    window.addEventListener('pointerup', endAdrenalineDrag);
    window.addEventListener('pointercancel', endAdrenalineDrag);
  }

  bindSlot(activeSlot, 'active');
  bindSlot(passiveSlot, 'passive');
  bindHands();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', scheduleLayoutRefresh);
  }
  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(() => {
      scheduleLayoutRefresh();
    });
    resizeObserver.observe(root);
    if (actionCenter) {
      resizeObserver.observe(actionCenter);
    }
    if (modalShell) {
      resizeObserver.observe(modalShell);
    }
  }
  updateRotationRestriction();
  updateSubmitState();
  updateAdrenalineUi();

  const setPlayerDamage = (damage) => {
    const next = Number.isFinite(damage) ? Math.max(0, Math.floor(damage)) : 0;
    state.playerDamage = next;
  };

  const setPlayedPreviewCards = (activeCard, passiveCard) => {
    const nextActive = activeCard && typeof activeCard === 'object' ? activeCard : null;
    const nextPassive = passiveCard && typeof passiveCard === 'object' ? passiveCard : null;
    const activeChanged =
      `${state.playedPreviewCards.active?.id ?? ''}|${state.playedPreviewCards.active?.previewClassName ?? ''}` !==
      `${nextActive?.id ?? ''}|${nextActive?.previewClassName ?? ''}`;
    const passiveChanged =
      `${state.playedPreviewCards.passive?.id ?? ''}|${state.playedPreviewCards.passive?.previewClassName ?? ''}` !==
      `${nextPassive?.id ?? ''}|${nextPassive?.previewClassName ?? ''}`;
    if (!activeChanged && !passiveChanged) return;
    state.playedPreviewCards.active = nextActive;
    state.playedPreviewCards.passive = nextPassive;
    updateSlotState();
  };

  const setPlayedPreviewRotation = (rotation) => {
    if (state.turnActive) return;
    const nextRotation =
      typeof rotation === 'string' && rotation.trim()
        ? rotation.trim().toUpperCase()
        : null;
    const currentRotation = wheel.getValue?.() ?? null;
    if ((currentRotation ?? null) === (nextRotation ?? null)) return;
    suppressProgrammaticRotation = true;
    if (nextRotation) {
      wheel.setValue(nextRotation);
    } else {
      wheel.clear();
    }
    suppressProgrammaticRotation = false;
  };

  const setPlayModalBeatPointer = (slotIndex) => {
    if (!playModalBeatPointer) return;
    const hasVisibleActiveCard = !state.turnActive && Boolean(state.playedPreviewCards.active);
    if (!hasVisibleActiveCard) {
      playModalBeatPointer.hidden = true;
      return;
    }
    if (!Number.isFinite(slotIndex)) {
      playModalBeatPointer.hidden = true;
      return;
    }
    const clamped = Math.max(0, Math.min(PLAY_BEAT_POINTERS.length - 1, Math.round(slotIndex)));
    const marker = PLAY_BEAT_POINTERS[clamped];
    if (!marker) {
      playModalBeatPointer.hidden = true;
      return;
    }
    playModalBeatPointer.style.setProperty('--play-beat-x', `${(marker.x * 100).toFixed(3)}%`);
    playModalBeatPointer.style.setProperty('--play-beat-y', `${(marker.y * 100).toFixed(3)}%`);
    playModalBeatPointer.hidden = false;
  };

  return {
    setCards,
    setExhaustedCards,
    setHidden,
    setVisible,
    setLocked,
    setComboMode,
    clearSelection,
    setPlayerDamage,
    setPlayModalBeatPointer,
    setPlayedPreviewCards,
    setPlayedPreviewRotation,
    setAdrenalinePool,
  };
};
