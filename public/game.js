import { createActionHud } from './game/actionHud.js';
import { createRenderer } from './game/renderer.js';
import { createViewState, createPointerState, centerView, applyMomentum } from './game/viewState.js';
import { bindControls } from './game/controls.js';
import { createTimelinePlayback } from './game/timelinePlayback.js';
import { createTimelineTooltip } from './game/timelineTooltip.js';
import { GAME_CONFIG } from './game/config.js';
import { createGameOverView } from './game/gameOverView.js';
import { getMatchOutcome } from './game/matchEndRules.js';
import { createPendingActionPreview } from './game/pendingActionPreview.js';
import { selectPendingInteraction } from './game/interactionState.mjs';
import {
  getCharacterFirstEIndex,
  getCharactersAtEarliestE,
  getLastEntryForCharacter,
  getTimelineEarliestEIndex,
  getTimelineResolvedIndex,
  getTimelineStopIndex,
} from './game/beatTimeline.js';
import { loadCardCatalog } from './shared/cardCatalog.js';
import { createDiscardPrompt } from './game/discardPrompt.mjs';
import { createDrawPrompt } from './game/drawPrompt.mjs';
import { createHandTriggerPrompt } from './game/handTriggerPrompt.mjs';
import { axialToPixel, getHexSize } from './shared/hex.mjs';
import {
  HAVEN_PLATFORM_INTERACTION_TYPE,
  buildHavenHighlightState as buildHavenInteractionHighlightState,
  getHavenHoverKeyFromPointer,
  getPendingHavenInteraction as getPendingHavenInteractionType,
  normalizeHexCoord as normalizeHavenHexCoord,
  resolveHavenTargetFromPointer as resolveHavenPointerTarget,
} from './game/havenInteraction.mjs';
import { getOrCreateUserId } from './storage.js';

const HOLD_INITIAL_DELAY = 320;
const HOLD_REPEAT_DELAY = 90;
const LOG_PREFIX = '[hexstrike]';
const COMBO_ACTION = 'CO';
const GUARD_CONTINUE_INTERACTION_TYPE = 'guard-continue';
const REWIND_RETURN_INTERACTION_TYPE = 'rewind-return';
const MAX_HAND_SIZE = 4;
const AXIAL_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeActionLabel = (value) => {
  const trimmed = `${value ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const cardHasCombo = (card) =>
  Array.isArray(card?.actions) && card.actions.some((action) => normalizeActionLabel(action).toUpperCase() === COMBO_ACTION);

const buildCardLookup = (catalog) => {
  const lookup = new Map();
  if (Array.isArray(catalog?.movement)) {
    catalog.movement.forEach((card) => lookup.set(card.id, card));
  }
  if (Array.isArray(catalog?.ability)) {
    catalog.ability.forEach((card) => lookup.set(card.id, card));
  }
  return lookup;
};

const buildTimelineSummary = (gameState) => {
  const beats = gameState?.state?.public?.beats ?? [];
  const characters = gameState?.state?.public?.characters ?? [];
  if (!beats.length || !characters.length) {
    return { length: beats.length, trailingAllE: 0, perCharacter: [] };
  }
  const perCharacter = characters.map((character) => {
    const firstE = getCharacterFirstEIndex(beats, character);
    let lastNonE = -1;
    for (let i = beats.length - 1; i >= 0; i -= 1) {
      const entry = beats[i]?.find((beatEntry) => {
        const key = beatEntry?.username ?? beatEntry?.userId ?? beatEntry?.userID;
        return key === character.userId || key === character.username;
      });
      if (entry && entry.action !== 'E') {
        lastNonE = i;
        break;
      }
    }
    return {
      userId: character.userId,
      username: character.username,
      firstE,
      lastNonE,
    };
  });

  let trailingAllE = 0;
  for (let i = beats.length - 1; i >= 0; i -= 1) {
    const isAllE = characters.every((character) => {
      const entry = beats[i]?.find((beatEntry) => {
        const key = beatEntry?.username ?? beatEntry?.userId ?? beatEntry?.userID;
        return key === character.userId || key === character.username;
      });
      if (!entry) return true;
      return entry.action === 'E';
    });
    if (!isAllE) break;
    trailingAllE += 1;
  }

  return {
    length: beats.length,
    trailingAllE,
    perCharacter,
  };
};

const createTimeIndicatorViewModel = ({ getMaxIndex }) => {
  let holdState = null;
  const viewModel = {
    value: 0,
    isPlaying: true,
    isHolding: false,
    canStep(direction) {
      const maxIndex = getMaxIndex();
      const next = viewModel.value + direction;
      return next >= 0 && next <= maxIndex;
    },
    setValue(nextValue) {
      const maxIndex = getMaxIndex();
      viewModel.value = clamp(nextValue, 0, maxIndex);
    },
    step(direction) {
      if (!viewModel.canStep(direction)) return false;
      viewModel.setValue(viewModel.value + direction);
      return true;
    },
    press(direction, now, pointerId) {
      if (!viewModel.canStep(direction)) return false;
      viewModel.isPlaying = false;
      viewModel.step(direction);
      holdState = {
        direction,
        pointerId,
        lastTick: now,
        delay: HOLD_INITIAL_DELAY,
      };
      viewModel.isHolding = true;
      return true;
    },
    release(pointerId) {
      if (!holdState) return;
      if (pointerId == null || holdState.pointerId === pointerId) {
        holdState = null;
        viewModel.isHolding = false;
      }
    },
    updateHold(now) {
      if (!holdState) return;
      const elapsed = now - holdState.lastTick;
      if (elapsed < holdState.delay) return;
      const steps = Math.max(1, Math.floor(elapsed / holdState.delay));
      for (let i = 0; i < steps; i += 1) {
        if (!viewModel.step(holdState.direction)) {
          holdState = null;
          viewModel.isHolding = false;
          return;
        }
      }
      holdState.lastTick = now;
      holdState.delay = HOLD_REPEAT_DELAY;
    },
    togglePlaying() {
      viewModel.isPlaying = !viewModel.isPlaying;
    },
  };
  return viewModel;
};

export const initGame = () => {
  const gameArea = document.getElementById('gameArea');
  const canvas = document.getElementById('gameCanvas');
  if (!gameArea || !(canvas instanceof HTMLCanvasElement)) return;
  const menuShell = document.getElementById('menuShell');
  const actionHudRoot = document.getElementById('actionHud');
  const movementHand = document.getElementById('movementHand');
  const abilityHand = document.getElementById('abilityHand');
  const activeSlot = document.getElementById('activeSlot');
  const passiveSlot = document.getElementById('passiveSlot');
  const submitButton = document.getElementById('actionSubmit');
  const rotationWheel = document.getElementById('rotationWheel');
  const interactionOverlay = document.getElementById('interactionOverlay');
  const throwModal = document.getElementById('throwModal');
  const throwButtons = throwModal ? Array.from(throwModal.querySelectorAll('.throw-arrow')) : [];
  const comboModal = document.getElementById('comboModal');
  const comboEyebrow = comboModal?.querySelector('.combo-modal-eyebrow') ?? null;
  const comboTitle = document.getElementById('comboModalTitle');
  const comboCopy = comboModal?.querySelector('.combo-modal-copy') ?? null;
  const comboAccept = document.getElementById('comboAccept');
  const comboDecline = document.getElementById('comboDecline');
  const handTriggerModal = document.getElementById('handTriggerModal');
  const handTriggerTitle = document.getElementById('handTriggerTitle');
  const handTriggerCopy = document.getElementById('handTriggerCopy');
  const handTriggerAccept = document.getElementById('handTriggerAccept');
  const handTriggerDecline = document.getElementById('handTriggerDecline');
  const discardModal = document.getElementById('discardModal');
  const discardCopy = document.getElementById('discardModalCopy');
  const drawModal = document.getElementById('drawModal');
  const drawCopy = document.getElementById('drawModalCopy');
  const gameOverOverlay = document.getElementById('gameOverOverlay');
  const gameOverMessage = document.getElementById('gameOverMessage');
  const gameOverDone = document.getElementById('gameOverDone');

  const renderer = createRenderer(canvas);
  if (!renderer) return;

  const viewState = createViewState();
  const pointerState = createPointerState();
  const timelinePlayback = createTimelinePlayback();
  const localUserId = getOrCreateUserId();
  let gameState = null;
  let lastFrame = null;
  let cardCatalog = null;
  let cardLookup = new Map();
  let lastHudKey = null;
  let lastTurnActive = false;
  let actionSubmitInFlight = false;
  let lastHudStateKey = null;
  let interactionSubmitInFlight = false;
  let pendingInteractionId = null;
  let pendingInteractionType = null;
  let gameOverInFlight = false;
  let didInitTimelinePosition = false;
  let lastComboKey = null;
  let lastComboRequired = false;
  let discardPrompt = null;
  let drawPrompt = null;
  let handTriggerPrompt = null;
  let havenHoverKey = null;
  const pendingActionPreview = createPendingActionPreview();

  const getMaxIndex = () => {
    const beats = gameState?.state?.public?.beats ?? [];
    const characters = gameState?.state?.public?.characters ?? [];
    const interactions = gameState?.state?.public?.customInteractions ?? [];
    if (!beats.length || !characters.length) return 0;
    return getTimelineStopIndex(beats, characters, interactions);
  };

  const timeIndicatorViewModel = createTimeIndicatorViewModel({ getMaxIndex });
  let actionHud = null;

  const getThrowAngle = (direction) => {
    const vector = axialToPixel(direction.q, direction.r, 1);
    return Math.atan2(vector.x, -vector.y);
  };

  const throwAngles = AXIAL_DIRECTIONS.map((direction) => getThrowAngle(direction));

  const setThrowButtonsEnabled = (enabled) => {
    throwButtons.forEach((button) => {
      button.disabled = !enabled;
      button.classList.toggle('is-disabled', !enabled);
    });
  };

  const setModalVisibility = (modal, visible) => {
    if (!modal) return;
    const isVisible = Boolean(visible);
    modal.hidden = !isVisible;
    modal.style.display = isVisible ? '' : 'none';
  };

  const setComboButtonsEnabled = (enabled) => {
    [comboAccept, comboDecline].forEach((button) => {
      if (!button) return;
      button.disabled = !enabled;
      button.classList.toggle('is-disabled', !enabled);
    });
  };

  const setChoiceModalContent = (interactionType) => {
    const isGuard = interactionType === GUARD_CONTINUE_INTERACTION_TYPE;
    const isRewind = interactionType === REWIND_RETURN_INTERACTION_TYPE;
    if (comboEyebrow) {
      comboEyebrow.textContent = isGuard ? 'Guard' : isRewind ? 'Focus' : 'Combo';
    }
    if (comboTitle) {
      comboTitle.textContent = isGuard
        ? 'Continue Guard?'
        : isRewind
          ? 'Return To Rewind Anchor?'
          : 'Continue Combo?';
    }
    if (comboCopy) {
      comboCopy.textContent = isGuard
        ? "Choose Yes to continue Guard and force a discard of 1 on Guard's E frame."
        : isRewind
          ? 'Choose Yes to end Rewind focus and return to your anchored hex.'
          : 'Your hit opens a combo window. Continue with another combo card?';
    }
  };

  const getPendingInteractionForUser = () => {
    const interactions = gameState?.state?.public?.customInteractions ?? [];
    const beats = gameState?.state?.public?.beats ?? [];
    const characters = gameState?.state?.public?.characters ?? [];
    const resolvedIndex = getTimelineResolvedIndex(beats);
    return selectPendingInteraction({
      interactions,
      beats,
      characters,
      localUserId,
      resolvedIndex,
    });
  };

  const getPendingThrowInteraction = () => {
    const pending = getPendingInteractionForUser();
    return pending?.type === 'throw' ? pending : null;
  };

  const getPendingHavenInteraction = () => getPendingHavenInteractionType(getPendingInteractionForUser());

  const getSceneCharacters = () => timelinePlayback.getScene()?.characters ?? gameState?.state?.public?.characters ?? [];

  const buildHavenHighlightState = (now) => {
    return buildHavenInteractionHighlightState({
      pending: getPendingHavenInteraction(),
      sceneCharacters: getSceneCharacters(),
      interactionSubmitInFlight,
      hoverKey: havenHoverKey,
      now,
    });
  };

  const clearHavenHover = () => {
    havenHoverKey = null;
  };

  const updateHavenHoverFromPointer = (event) => {
    const pending = getPendingHavenInteraction();
    if (!pending || interactionSubmitInFlight) {
      clearHavenHover();
      return;
    }
    havenHoverKey = getHavenHoverKeyFromPointer({
      event,
      pending,
      sceneCharacters: getSceneCharacters(),
      localUserId,
      canvas,
      viewState,
      viewportWidth: renderer.viewport.width,
      hexSizeFactor: GAME_CONFIG.hexSizeFactor,
    });
  };

  const getThrowAnchor = (pending) => {
    if (!pending || !interactionOverlay) return null;
    const sceneCharacters = timelinePlayback.getScene()?.characters ?? gameState?.state?.public?.characters ?? [];
    const target = sceneCharacters.find((character) => character.userId === pending.targetUserId);
    if (!target) return null;
    const size = getHexSize(renderer.viewport.width || canvas.clientWidth || 1, GAME_CONFIG.hexSizeFactor);
    const base = axialToPixel(target.position.q, target.position.r, size);
    const renderOffset = target.renderOffset ?? null;
    const offsetX = renderOffset ? renderOffset.x * size : 0;
    const offsetY = renderOffset ? renderOffset.y * size : 0;
    const worldX = base.x + offsetX;
    const worldY = base.y + offsetY;
    const screenX = viewState.offset.x + worldX * viewState.scale;
    const screenY = viewState.offset.y + worldY * viewState.scale;
    const overlayRect = interactionOverlay.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return {
      x: canvasRect.left - overlayRect.left + screenX,
      y: canvasRect.top - overlayRect.top + screenY,
      hexRadius: size * viewState.scale,
    };
  };

  const applyThrowLayout = (pending) => {
    if (!throwModal || !throwButtons.length) return;
    const bounds = gameArea.getBoundingClientRect();
    const anchor = getThrowAnchor(pending);
    const anchorX = anchor ? anchor.x : bounds.width / 2;
    const anchorY = anchor ? anchor.y : bounds.height / 2;
    const hexRadius = anchor?.hexRadius ?? Math.max(18, Math.min(bounds.width, bounds.height) * 0.06);
    const hexWidth = Math.sqrt(3) * hexRadius;
    const hexHeight = hexRadius * 2;
    const radius = clamp(hexHeight * 0.75, 40, 170);
    const centerSize = clamp(hexRadius * 0.35, 10, 24);
    const arrowWidth = clamp(hexWidth * 0.4, 18, 96);
    const arrowHeight = clamp(hexHeight * 0.55, 26, 120);
    throwModal.style.left = `${anchorX}px`;
    throwModal.style.top = `${anchorY}px`;
    throwModal.style.setProperty('--throw-width', `${arrowWidth}px`);
    throwModal.style.setProperty('--throw-height', `${arrowHeight}px`);
    throwModal.style.setProperty('--throw-center-size', `${centerSize}px`);
    throwButtons.forEach((button) => {
      const index = Number(button.dataset.dir);
      if (!Number.isFinite(index) || index < 0 || index >= throwAngles.length) return;
      const angle = throwAngles[index];
      const offsetX = Math.sin(angle) * radius;
      const offsetY = -Math.cos(angle) * radius;
      button.style.setProperty('--offset-x', `${offsetX}px`);
      button.style.setProperty('--offset-y', `${offsetY}px`);
      button.style.setProperty('--angle', `${(angle * 180) / Math.PI}deg`);
    });
  };

  const refreshInteractionOverlay = () => {
    if (!interactionOverlay) return;
    const outcome = getMatchOutcome(gameState?.state?.public);
    if (outcome) {
      interactionOverlay.hidden = true;
      interactionOverlay.setAttribute('aria-hidden', 'true');
      pendingInteractionId = null;
      pendingInteractionType = null;
      clearHavenHover();
      interactionSubmitInFlight = false;
      setThrowButtonsEnabled(false);
      setComboButtonsEnabled(false);
      discardPrompt?.sync();
      drawPrompt?.sync();
      handTriggerPrompt?.sync();
      setModalVisibility(throwModal, false);
      setModalVisibility(comboModal, false);
      setModalVisibility(handTriggerModal, false);
      setModalVisibility(discardModal, false);
      setModalVisibility(drawModal, false);
      return;
    }
    const pending = getPendingInteractionForUser();
    const shouldShow = Boolean(pending && gameState?.id);
    interactionOverlay.hidden = !shouldShow;
    interactionOverlay.setAttribute('aria-hidden', (!shouldShow).toString());
    if (!shouldShow) {
      pendingInteractionId = null;
      pendingInteractionType = null;
      clearHavenHover();
      interactionSubmitInFlight = false;
      setThrowButtonsEnabled(false);
      setComboButtonsEnabled(false);
      discardPrompt?.sync();
      drawPrompt?.sync();
      handTriggerPrompt?.sync();
      setModalVisibility(throwModal, false);
      setModalVisibility(comboModal, false);
      setModalVisibility(handTriggerModal, false);
      setModalVisibility(discardModal, false);
      setModalVisibility(drawModal, false);
      return;
    }
    if (pendingInteractionId !== pending.id || pendingInteractionType !== pending.type) {
      interactionSubmitInFlight = false;
    }
    pendingInteractionId = pending.id;
    pendingInteractionType = pending.type;
    const playerCards = gameState?.state?.player?.cards ?? null;
    if (pending.type === 'throw') {
      clearHavenHover();
      setModalVisibility(throwModal, true);
      setModalVisibility(comboModal, false);
      setModalVisibility(handTriggerModal, false);
      setModalVisibility(discardModal, false);
      setModalVisibility(drawModal, false);
      setThrowButtonsEnabled(!interactionSubmitInFlight);
      setComboButtonsEnabled(false);
      discardPrompt?.sync();
      drawPrompt?.sync();
      handTriggerPrompt?.sync();
      applyThrowLayout(pending);
      return;
    }
    if (
      pending.type === 'combo' ||
      pending.type === GUARD_CONTINUE_INTERACTION_TYPE ||
      pending.type === REWIND_RETURN_INTERACTION_TYPE
    ) {
      clearHavenHover();
      setChoiceModalContent(pending.type);
      setModalVisibility(comboModal, true);
      setModalVisibility(throwModal, false);
      setModalVisibility(handTriggerModal, false);
      setModalVisibility(discardModal, false);
      setModalVisibility(drawModal, false);
      setComboButtonsEnabled(!interactionSubmitInFlight);
      setThrowButtonsEnabled(false);
      discardPrompt?.sync();
      drawPrompt?.sync();
      handTriggerPrompt?.sync();
      return;
    }
    if (pending.type === 'hand-trigger') {
      clearHavenHover();
      setModalVisibility(throwModal, false);
      setModalVisibility(comboModal, false);
      setModalVisibility(drawModal, false);
      setThrowButtonsEnabled(false);
      setComboButtonsEnabled(false);
      discardPrompt?.sync();
      drawPrompt?.sync();
      handTriggerPrompt?.sync({ pending, playerCards, inFlight: interactionSubmitInFlight });
      return;
    }
    if (pending.type === 'discard') {
      clearHavenHover();
      setModalVisibility(throwModal, false);
      setModalVisibility(comboModal, false);
      setModalVisibility(handTriggerModal, false);
      setModalVisibility(drawModal, false);
      setThrowButtonsEnabled(false);
      setComboButtonsEnabled(false);
      handTriggerPrompt?.sync();
      discardPrompt?.sync({ pending, playerCards, inFlight: interactionSubmitInFlight });
      drawPrompt?.sync();
      return;
    }
    if (pending.type === 'draw') {
      clearHavenHover();
      setModalVisibility(throwModal, false);
      setModalVisibility(comboModal, false);
      setModalVisibility(handTriggerModal, false);
      setModalVisibility(discardModal, false);
      setThrowButtonsEnabled(false);
      setComboButtonsEnabled(false);
      handTriggerPrompt?.sync();
      discardPrompt?.sync();
      drawPrompt?.sync({ pending, playerCards, inFlight: interactionSubmitInFlight });
      return;
    }
    if (pending.type === HAVEN_PLATFORM_INTERACTION_TYPE) {
      setModalVisibility(throwModal, false);
      setModalVisibility(comboModal, false);
      setModalVisibility(handTriggerModal, false);
      setModalVisibility(discardModal, false);
      setModalVisibility(drawModal, false);
      setThrowButtonsEnabled(false);
      setComboButtonsEnabled(false);
      discardPrompt?.sync();
      drawPrompt?.sync();
      handTriggerPrompt?.sync();
      return;
    }
    setModalVisibility(throwModal, false);
    setModalVisibility(comboModal, false);
    setModalVisibility(handTriggerModal, false);
    setModalVisibility(discardModal, false);
    setModalVisibility(drawModal, false);
    setThrowButtonsEnabled(false);
    setComboButtonsEnabled(false);
    clearHavenHover();
    discardPrompt?.sync();
    drawPrompt?.sync();
    handTriggerPrompt?.sync();
  };

  const gameOverView = createGameOverView({
    gameArea,
    overlay: gameOverOverlay,
    message: gameOverMessage,
    button: gameOverDone,
    onContinue: () => {
      void handleGameOverDone();
    },
  });

  const refreshGameOver = () => {
    const outcome = getMatchOutcome(gameState?.state?.public);
    gameOverView.update(outcome, localUserId, gameOverInFlight);
  };

  const refreshActionHud = () => {
    if (!actionHud) return;
    const outcome = getMatchOutcome(gameState?.state?.public);
    if (outcome) {
      actionHud.setVisible(false);
      actionHud.setLocked(true);
      actionHud.setHidden(true);
      return;
    }
    if (!gameState || !cardCatalog) {
      if (lastHudKey !== null) {
        actionHud.setCards([], []);
        lastHudKey = null;
      }
      if (lastHudStateKey !== null) {
        console.log(`${LOG_PREFIX} hud`, { visible: false, locked: true, reason: 'missing-state' });
        lastHudStateKey = null;
      }
      actionHud.setVisible(false);
      actionHud.setLocked(true);
      return;
    }

    const playerCards = gameState?.state?.player?.cards;
    if (!playerCards) {
      if (lastHudKey !== null) {
        actionHud.setCards([], []);
        lastHudKey = null;
      }
      if (lastHudStateKey !== null) {
        console.log(`${LOG_PREFIX} hud`, { visible: false, locked: true, reason: 'missing-player-cards' });
        lastHudStateKey = null;
      }
      actionHud.setVisible(false);
      actionHud.setLocked(true);
      return;
    }

    const movementIds = Array.isArray(playerCards.movementHand) ? playerCards.movementHand : [];
    const abilityIds = Array.isArray(playerCards.abilityHand) ? playerCards.abilityHand : [];
    const movementDeckIds = Array.isArray(playerCards.movementDeck) ? playerCards.movementDeck : movementIds;
    const exhaustedIds = Array.isArray(playerCards.discardPile) ? playerCards.discardPile : [];
    const movementCards = movementDeckIds.map((id) => cardLookup.get(id)).filter(Boolean);
    const abilityCards = abilityIds.map((id) => cardLookup.get(id)).filter(Boolean);
    const nextKey = `${movementDeckIds.join(',')}|${abilityIds.join(',')}`;
    if (nextKey !== lastHudKey) {
      actionHud.setCards(movementCards, abilityCards, { exhaustedCardIds: exhaustedIds });
      lastHudKey = nextKey;
    } else {
      actionHud.setExhaustedCards(exhaustedIds);
    }

    const publicState = gameState?.state?.public;
    const beats = publicState?.beats ?? [];
    const characters = publicState?.characters ?? [];
    const earliestIndex =
      beats.length && characters.length ? getTimelineEarliestEIndex(beats, characters) : 0;
    const atBatCharacters =
      beats.length && characters.length ? getCharactersAtEarliestE(beats, characters) : [];
    const isLocalAtBat = atBatCharacters.some((character) => character.userId === localUserId);
    const isAtEarliest = timeIndicatorViewModel.value === earliestIndex;
    const interactions = publicState?.customInteractions ?? [];
    const hasPendingInteraction = interactions.some((interaction) => interaction?.status === 'pending');
    const pendingActions = publicState?.pendingActions;
    let locked = actionSubmitInFlight || hasPendingInteraction;
    if (pendingActions && Array.isArray(pendingActions.requiredUserIds)) {
      const isRequired = pendingActions.requiredUserIds.includes(localUserId);
      const submitted = Array.isArray(pendingActions.submittedUserIds)
        ? pendingActions.submittedUserIds.includes(localUserId)
        : false;
      if (isRequired && submitted) {
        locked = true;
      }
      }
      const isTurn = isLocalAtBat && isAtEarliest && !hasPendingInteraction;
      const localCharacter = characters.find((candidate) => candidate.userId === localUserId);
      const resolvedIndex = beats.length ? getTimelineResolvedIndex(beats) : -1;
      const localEntry =
        localCharacter && resolvedIndex >= 0
          ? getLastEntryForCharacter(beats, localCharacter, resolvedIndex)
          : null;
      const localDamage = Number.isFinite(localEntry?.damage)
        ? Math.round(localEntry.damage)
        : localCharacter?.damage ?? 0;
      actionHud.setPlayerDamage?.(localDamage);
      const localFirstE = localCharacter ? getCharacterFirstEIndex(beats, localCharacter) : null;
      const comboInteraction =
        localFirstE !== null
        ? interactions.find(
            (interaction) =>
              interaction?.status === 'resolved' &&
              interaction?.type === 'combo' &&
              interaction?.actorUserId === localUserId &&
              interaction?.beatIndex === localFirstE &&
              Boolean(interaction?.resolution?.continue),
          )
        : null;
    const comboRequired = Boolean(comboInteraction && isTurn);
    const comboEligibleIds = new Set();
    if (comboRequired) {
      const exhaustedSet = new Set(exhaustedIds);
      movementCards.forEach((card) => {
        if (!card || exhaustedSet.has(card.id)) return;
        if (cardHasCombo(card)) comboEligibleIds.add(card.id);
      });
      abilityCards.forEach((card) => {
        if (!card) return;
        if (cardHasCombo(card)) comboEligibleIds.add(card.id);
      });
    }
    actionHud.setVisible(isTurn);
    actionHud.setLocked(locked);
    const comboKey = comboRequired ? `on:${Array.from(comboEligibleIds).join(',')}` : 'off';
    if (comboKey !== lastComboKey) {
      if (comboRequired && !lastComboRequired) {
        actionHud.clearSelection();
      }
      actionHud.setComboMode(comboRequired, comboEligibleIds);
      lastComboKey = comboKey;
      lastComboRequired = comboRequired;
    }
    const hudStateKey = `${isTurn}|${locked}|${earliestIndex}|${timeIndicatorViewModel.value}`;
    if (hudStateKey !== lastHudStateKey) {
      console.log(`${LOG_PREFIX} hud`, {
        visible: isTurn,
        locked,
        earliestIndex,
        timelineIndex: timeIndicatorViewModel.value,
        pendingActions,
        hasPendingInteraction,
        atBatUserIds: atBatCharacters.map((character) => character.userId),
      });
      lastHudStateKey = hudStateKey;
    }
    if (lastTurnActive && !isTurn) {
      actionHud.clearSelection();
    }
    lastTurnActive = isTurn;
  };

  const handleActionSubmit = async ({ activeCardId, passiveCardId, rotation, activeCard }) => {
    if (!gameState?.id || actionSubmitInFlight) return;
    if (getMatchOutcome(gameState?.state?.public)) return;
    actionSubmitInFlight = true;
    if (actionHud) actionHud.setLocked(true);
    const previewCard = activeCard ?? cardLookup.get(activeCardId);
    pendingActionPreview.setFromCard(previewCard, cardLookup.get(passiveCardId), rotation);
    const beats = gameState?.state?.public?.beats ?? [];
    const characters = gameState?.state?.public?.characters ?? [];
    console.log(`${LOG_PREFIX} action:set submit`, {
      userId: localUserId,
      gameId: gameState.id,
      activeCardId,
      passiveCardId,
      rotation,
      earliestIndex: getTimelineEarliestEIndex(beats, characters),
      timelineIndex: timeIndicatorViewModel.value,
    });
    try {
      const response = await fetch('/api/v1/game/action-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: localUserId,
          gameId: gameState.id,
          activeCardId,
          passiveCardId,
          rotation,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.error ? `${payload.error}` : 'Failed to submit action set.';
        console.warn(`${LOG_PREFIX} action:set rejected`, {
          status: response.status,
          error: payload?.error,
          code: payload?.code,
        });
        throw new Error(message);
      }
      console.log(`${LOG_PREFIX} action:set ack`, { status: response.status, gameId: gameState.id });
      if (actionHud) actionHud.clearSelection();
    } catch (err) {
      console.error('Failed to submit action set', err);
      const message = err instanceof Error ? err.message : 'Failed to submit action set.';
      window.alert(message);
      pendingActionPreview.clear();
    } finally {
      actionSubmitInFlight = false;
      refreshActionHud();
    }
  };

  const handleThrowSubmit = async (directionIndex) => {
    if (!gameState?.id || !pendingInteractionId || interactionSubmitInFlight) return;
    if (pendingInteractionType && pendingInteractionType !== 'throw') return;
    if (getMatchOutcome(gameState?.state?.public)) return;
    if (!Number.isFinite(directionIndex) || directionIndex < 0 || directionIndex > 5) return;
    interactionSubmitInFlight = true;
    setThrowButtonsEnabled(false);
    console.log(`${LOG_PREFIX} interaction:submit`, {
      userId: localUserId,
      gameId: gameState.id,
      interactionId: pendingInteractionId,
      directionIndex,
    });
    try {
      const response = await fetch('/api/v1/game/interaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: localUserId,
          gameId: gameState.id,
          interactionId: pendingInteractionId,
          directionIndex,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.error ? `${payload.error}` : 'Failed to resolve throw.';
        console.warn(`${LOG_PREFIX} interaction:rejected`, {
          status: response.status,
          error: payload?.error,
          code: payload?.code,
        });
        throw new Error(message);
      }
      console.log(`${LOG_PREFIX} interaction:ack`, {
        status: response.status,
        interactionId: pendingInteractionId,
      });
    } catch (err) {
      console.error('Failed to resolve throw', err);
      const message = err instanceof Error ? err.message : 'Failed to resolve throw.';
      window.alert(message);
    } finally {
      interactionSubmitInFlight = false;
      refreshInteractionOverlay();
    }
  };

  const handleChoiceSubmit = async (continueChoice) => {
    if (!gameState?.id || !pendingInteractionId || interactionSubmitInFlight) return;
    const isCombo = pendingInteractionType === 'combo';
    const isGuard = pendingInteractionType === GUARD_CONTINUE_INTERACTION_TYPE;
    const isRewind = pendingInteractionType === REWIND_RETURN_INTERACTION_TYPE;
    if (!isCombo && !isGuard && !isRewind) return;
    if (getMatchOutcome(gameState?.state?.public)) return;
    interactionSubmitInFlight = true;
    setComboButtonsEnabled(false);
    console.log(`${LOG_PREFIX} interaction:submit`, {
      userId: localUserId,
      gameId: gameState.id,
      interactionId: pendingInteractionId,
      continueChoice,
      interactionType: pendingInteractionType,
    });
    try {
      const shouldContinue = Boolean(continueChoice);
      const response = await fetch('/api/v1/game/interaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: localUserId,
          gameId: gameState.id,
          interactionId: pendingInteractionId,
          continue: shouldContinue,
          continueCombo: isCombo ? shouldContinue : undefined,
          continueGuard: isGuard ? shouldContinue : undefined,
          returnToAnchor: isRewind ? shouldContinue : undefined,
          rewindReturn: isRewind ? shouldContinue : undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.error
          ? `${payload.error}`
          : isGuard
            ? 'Failed to resolve guard choice.'
            : isRewind
              ? 'Failed to resolve rewind choice.'
              : 'Failed to resolve combo.';
        console.warn(`${LOG_PREFIX} interaction:rejected`, {
          status: response.status,
          error: payload?.error,
          code: payload?.code,
        });
        throw new Error(message);
      }
      console.log(`${LOG_PREFIX} interaction:ack`, {
        status: response.status,
        interactionId: pendingInteractionId,
      });
    } catch (err) {
      console.error('Failed to resolve interaction choice', err);
      const message = err instanceof Error
        ? err.message
        : isGuard
          ? 'Failed to resolve guard choice.'
          : isRewind
            ? 'Failed to resolve rewind choice.'
            : 'Failed to resolve combo.';
      window.alert(message);
    } finally {
      interactionSubmitInFlight = false;
      refreshInteractionOverlay();
    }
  };

  const handleHandTriggerSubmit = async ({ use = false, movementCardIds = [], abilityCardIds = [] } = {}) => {
    if (!gameState?.id || !pendingInteractionId || interactionSubmitInFlight) return;
    if (pendingInteractionType !== 'hand-trigger') return;
    if (getMatchOutcome(gameState?.state?.public)) return;
    interactionSubmitInFlight = true;
    console.log(`${LOG_PREFIX} interaction:submit`, {
      userId: localUserId,
      gameId: gameState.id,
      interactionId: pendingInteractionId,
      use,
      movementCardIds,
      abilityCardIds,
    });
    try {
      const response = await fetch('/api/v1/game/interaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: localUserId,
          gameId: gameState.id,
          interactionId: pendingInteractionId,
          use: Boolean(use),
          movementCardIds,
          abilityCardIds,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.error ? `${payload.error}` : 'Failed to resolve hand trigger.';
        console.warn(`${LOG_PREFIX} interaction:rejected`, {
          status: response.status,
          error: payload?.error,
          code: payload?.code,
        });
        throw new Error(message);
      }
      console.log(`${LOG_PREFIX} interaction:ack`, {
        status: response.status,
        interactionId: pendingInteractionId,
      });
    } catch (err) {
      console.error('Failed to resolve hand trigger', err);
      const message = err instanceof Error ? err.message : 'Failed to resolve hand trigger.';
      window.alert(message);
    } finally {
      interactionSubmitInFlight = false;
      refreshInteractionOverlay();
    }
  };

  const handleDiscardSubmit = async ({ abilityCardIds = [], movementCardIds = [] } = {}) => {
    if (!gameState?.id || !pendingInteractionId || interactionSubmitInFlight) return;
    if (pendingInteractionType !== 'discard') return;
    if (getMatchOutcome(gameState?.state?.public)) return;
    interactionSubmitInFlight = true;
    console.log(`${LOG_PREFIX} interaction:submit`, {
      userId: localUserId,
      gameId: gameState.id,
      interactionId: pendingInteractionId,
      abilityCardIds,
      movementCardIds,
    });
    try {
      const response = await fetch('/api/v1/game/interaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: localUserId,
          gameId: gameState.id,
          interactionId: pendingInteractionId,
          abilityCardIds,
          movementCardIds,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.error ? `${payload.error}` : 'Failed to resolve discard.';
        console.warn(`${LOG_PREFIX} interaction:rejected`, {
          status: response.status,
          error: payload?.error,
          code: payload?.code,
        });
        throw new Error(message);
      }
      console.log(`${LOG_PREFIX} interaction:ack`, {
        status: response.status,
        interactionId: pendingInteractionId,
      });
    } catch (err) {
      console.error('Failed to resolve discard', err);
      const message = err instanceof Error ? err.message : 'Failed to resolve discard.';
      window.alert(message);
    } finally {
      interactionSubmitInFlight = false;
      refreshInteractionOverlay();
    }
  };

  const handleDrawSubmit = async ({ movementCardIds = [] } = {}) => {
    if (!gameState?.id || !pendingInteractionId || interactionSubmitInFlight) return;
    if (pendingInteractionType !== 'draw') return;
    if (getMatchOutcome(gameState?.state?.public)) return;
    interactionSubmitInFlight = true;
    console.log(`${LOG_PREFIX} interaction:submit`, {
      userId: localUserId,
      gameId: gameState.id,
      interactionId: pendingInteractionId,
      movementCardIds,
    });
    try {
      const response = await fetch('/api/v1/game/interaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: localUserId,
          gameId: gameState.id,
          interactionId: pendingInteractionId,
          movementCardIds,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.error ? `${payload.error}` : 'Failed to resolve draw.';
        console.warn(`${LOG_PREFIX} interaction:rejected`, {
          status: response.status,
          error: payload?.error,
          code: payload?.code,
        });
        throw new Error(message);
      }
      console.log(`${LOG_PREFIX} interaction:ack`, {
        status: response.status,
        interactionId: pendingInteractionId,
      });
    } catch (err) {
      console.error('Failed to resolve draw', err);
      const message = err instanceof Error ? err.message : 'Failed to resolve draw.';
      window.alert(message);
    } finally {
      interactionSubmitInFlight = false;
      refreshInteractionOverlay();
    }
  };

  const handleHavenPlatformSubmit = async (targetHex) => {
    if (!gameState?.id || !pendingInteractionId || interactionSubmitInFlight) return;
    if (pendingInteractionType !== HAVEN_PLATFORM_INTERACTION_TYPE) return;
    if (getMatchOutcome(gameState?.state?.public)) return;
    const target = normalizeHavenHexCoord(targetHex);
    if (!target) return;
    interactionSubmitInFlight = true;
    console.log(`${LOG_PREFIX} interaction:submit`, {
      userId: localUserId,
      gameId: gameState.id,
      interactionId: pendingInteractionId,
      targetHex: target,
    });
    try {
      const response = await fetch('/api/v1/game/interaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: localUserId,
          gameId: gameState.id,
          interactionId: pendingInteractionId,
          targetHex: target,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.error ? `${payload.error}` : 'Failed to place ethereal platform.';
        console.warn(`${LOG_PREFIX} interaction:rejected`, {
          status: response.status,
          error: payload?.error,
          code: payload?.code,
        });
        throw new Error(message);
      }
      console.log(`${LOG_PREFIX} interaction:ack`, {
        status: response.status,
        interactionId: pendingInteractionId,
      });
    } catch (err) {
      console.error('Failed to resolve Haven platform', err);
      const message = err instanceof Error ? err.message : 'Failed to place ethereal platform.';
      window.alert(message);
    } finally {
      interactionSubmitInFlight = false;
      clearHavenHover();
      refreshInteractionOverlay();
    }
  };

  const handleGameOverDone = async () => {
    const outcome = getMatchOutcome(gameState?.state?.public);
    if (!outcome || !gameState?.matchId || gameOverInFlight) return;
    gameOverInFlight = true;
    refreshGameOver();
    try {
      const response = await fetch(`/api/v1/match/${gameState.matchId}/exit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: localUserId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.error ? `${payload.error}` : 'Failed to leave match.';
        throw new Error(message);
      }
      window.dispatchEvent(new CustomEvent('hexstrike:match-ended', { detail: { matchId: gameState.matchId } }));
    } catch (err) {
      console.error('Failed to leave match', err);
      const message = err instanceof Error ? err.message : 'Failed to leave match.';
      window.alert(message);
      gameOverInFlight = false;
      refreshGameOver();
    }
  };

  actionHud = createActionHud({
    root: actionHudRoot,
    movementHand,
    abilityHand,
    activeSlot,
    passiveSlot,
    submitButton,
    rotationWheel,
    onSubmit: handleActionSubmit,
  });
  discardPrompt = createDiscardPrompt({
    movementHand,
    abilityHand,
    discardModal,
    discardCopy,
    maxHandSize: MAX_HAND_SIZE,
    onSubmit: (payload) => {
      void handleDiscardSubmit(payload);
    },
  });
  drawPrompt = createDrawPrompt({
    movementHand,
    drawModal,
    drawCopy,
    maxHandSize: MAX_HAND_SIZE,
    onSubmit: (payload) => {
      void handleDrawSubmit(payload);
    },
  });
  handTriggerPrompt = createHandTriggerPrompt({
    movementHand,
    abilityHand,
    modal: handTriggerModal,
    discardModal,
    discardCopy,
    title: handTriggerTitle,
    copy: handTriggerCopy,
    acceptButton: handTriggerAccept,
    declineButton: handTriggerDecline,
    maxHandSize: MAX_HAND_SIZE,
    getCardById: (id) => cardLookup.get(id),
    onSubmit: (payload) => {
      void handleHandTriggerSubmit(payload);
    },
  });
  const tooltip = createTimelineTooltip({
    gameArea,
    canvas,
    viewState,
    timeIndicatorViewModel,
    getScene: () => timelinePlayback.getScene(),
  });

  applyThrowLayout(null);
  setThrowButtonsEnabled(false);
  setComboButtonsEnabled(false);
  handTriggerPrompt?.sync();
  throwButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.dir);
      handleThrowSubmit(index);
    });
  });
  if (comboAccept) {
    comboAccept.addEventListener('click', () => {
      void handleChoiceSubmit(true);
    });
  }
  if (comboDecline) {
    comboDecline.addEventListener('click', () => {
      void handleChoiceSubmit(false);
    });
  }
  const clampTimeline = () => {
    timeIndicatorViewModel.setValue(timeIndicatorViewModel.value);
    refreshActionHud();
    refreshInteractionOverlay();
  };

  const showGame = () => {
    gameArea.hidden = false;
    if (menuShell) menuShell.hidden = true;
    timeIndicatorViewModel.isPlaying = true;
    if (actionHud) actionHud.setHidden(false);
    renderer.resize();
    centerView(viewState, renderer.viewport);
    applyThrowLayout(getPendingThrowInteraction());
    refreshActionHud();
    refreshInteractionOverlay();
    refreshGameOver();
  };

  const hideGame = () => {
    gameArea.hidden = true;
    if (menuShell) menuShell.hidden = false;
    timeIndicatorViewModel.isPlaying = false;
    timeIndicatorViewModel.setValue(0);
    gameState = null;
    tooltip.setGameState(null);
    lastHudKey = null;
    lastTurnActive = false;
    pendingInteractionId = null;
    pendingInteractionType = null;
    clearHavenHover();
    interactionSubmitInFlight = false;
    gameOverInFlight = false;
    didInitTimelinePosition = false;
    pendingActionPreview.clear();
    lastComboKey = null;
    lastComboRequired = false;
    discardPrompt?.sync();
    drawPrompt?.sync();
    handTriggerPrompt?.sync();
    if (actionHud) {
      actionHud.clearSelection();
      actionHud.setCards([], []);
      actionHud.setComboMode(false, []);
      actionHud.setHidden(true);
    }
    if (interactionOverlay) {
      interactionOverlay.hidden = true;
      interactionOverlay.setAttribute('aria-hidden', 'true');
    }
    gameOverView.hide();
  };

  const setGameState = (nextState) => {
    gameState = nextState;
    tooltip.setGameState(nextState);
    pendingActionPreview.syncWithState(nextState, localUserId);
    if (!gameState) {
      didInitTimelinePosition = false;
      clearHavenHover();
    }
    if (!didInitTimelinePosition && gameState) {
      const beats = gameState?.state?.public?.beats ?? [];
      const characters = gameState?.state?.public?.characters ?? [];
      const interactions = gameState?.state?.public?.customInteractions ?? [];
      const stopIndex = getTimelineStopIndex(beats, characters, interactions);
      timeIndicatorViewModel.setValue(stopIndex);
      didInitTimelinePosition = true;
    }
    clampTimeline();
    refreshActionHud();
    refreshInteractionOverlay();
    refreshGameOver();
  };

  loadCardCatalog()
    .then((catalog) => {
      cardCatalog = catalog;
      cardLookup = buildCardLookup(catalog);
      tooltip.setCardCatalog(catalog);
      refreshActionHud();
      refreshInteractionOverlay();
    })
    .catch((err) => {
      console.warn('Failed to load card catalog for timeline tooltips', err);
    });

  bindControls(canvas, viewState, pointerState, undefined, timeIndicatorViewModel, gameArea);

  canvas.addEventListener('pointermove', (event) => {
    tooltip.update(event);
    updateHavenHoverFromPointer(event);
  });
  canvas.addEventListener('pointerleave', () => {
    tooltip.hide();
    clearHavenHover();
  });
  canvas.addEventListener('pointerdown', (event) => {
    const pending = getPendingHavenInteraction();
    if (
      event.button === 0 &&
      pending &&
      pendingInteractionId &&
      pendingInteractionType === HAVEN_PLATFORM_INTERACTION_TYPE &&
      !interactionSubmitInFlight
    ) {
      const targetHex = resolveHavenPointerTarget({
        event,
        pending,
        sceneCharacters: getSceneCharacters(),
        localUserId,
        canvas,
        viewState,
        viewportWidth: renderer.viewport.width,
        hexSizeFactor: GAME_CONFIG.hexSizeFactor,
      });
      if (targetHex) {
        event.preventDefault();
        event.stopPropagation();
        void handleHavenPlatformSubmit(targetHex);
        return;
      }
    }
    tooltip.hide();
  });

  window.addEventListener('resize', () => {
    if (gameArea.hidden) return;
    renderer.resize();
    applyThrowLayout(getPendingThrowInteraction());
  });

  window.addEventListener('hexstrike:match', showGame);
  window.addEventListener('hexstrike:match-ended', hideGame);
  window.addEventListener('hexstrike:game', (event) => {
    setGameState(event.detail);
    const beats = event.detail?.state?.public?.beats ?? [];
    const characters = event.detail?.state?.public?.characters ?? [];
    const summary = buildTimelineSummary(event.detail);
    console.log(`${LOG_PREFIX} game:update`, {
      gameId: event.detail?.id,
      beats: beats.length,
      characters: characters.length,
      earliestIndex: getTimelineEarliestEIndex(beats, characters),
      stopIndex: getTimelineStopIndex(
        beats,
        characters,
        event.detail?.state?.public?.customInteractions ?? [],
      ),
      pendingActions: event.detail?.state?.public?.pendingActions ?? null,
      interactions: event.detail?.state?.public?.customInteractions ?? [],
      summary,
    });
  });

  const renderFrame = (now) => {
    const dt = lastFrame ? Math.min(48, now - lastFrame) : 16;
    lastFrame = now;
    timeIndicatorViewModel.updateHold(now);
    applyMomentum(viewState, dt);
    timelinePlayback.update(now, gameState, timeIndicatorViewModel.value);
    const status = timelinePlayback.getStatus();
    if (timeIndicatorViewModel.isPlaying && status.isComplete) {
      timeIndicatorViewModel.step(1);
    }
    refreshActionHud();
    refreshInteractionOverlay();
    refreshGameOver();
    const scene = timelinePlayback.getScene();
    const pendingPreview = pendingActionPreview.getTimelinePreview(gameState, localUserId);
    const interactionHighlightState = buildHavenHighlightState(now);
    renderer.draw(
      viewState,
      gameState,
      timeIndicatorViewModel,
      scene,
      localUserId,
      pendingPreview,
      interactionHighlightState,
    );
    requestAnimationFrame(renderFrame);
  };

  requestAnimationFrame(renderFrame);
};
