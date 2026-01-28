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
import {
  getCharacterFirstEIndex,
  getCharactersAtEarliestE,
  getTimelineEarliestEIndex,
  getTimelineResolvedIndex,
  getTimelineStopIndex,
} from './game/beatTimeline.js';
import { loadCardCatalog } from './shared/cardCatalog.js';
import { AXIAL_DIRECTIONS, axialToPixel, getHexSize } from './shared/hex.mjs';
import { getOrCreateUserId } from './storage.js';

const HOLD_INITIAL_DELAY = 320;
const HOLD_REPEAT_DELAY = 90;
const LOG_PREFIX = '[hexstrike]';
const COMBO_ACTION = 'CO';

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

const buildActorKeys = (interaction, characters) => {
  const keys = new Set();
  const actorId = interaction?.actorUserId;
  if (actorId) keys.add(actorId);
  const actor = Array.isArray(characters)
    ? characters.find((character) => character.userId === actorId || character.username === actorId)
    : null;
  if (actor?.userId) keys.add(actor.userId);
  if (actor?.username) keys.add(actor.username);
  return keys;
};

const hasComboEntryForInteraction = (interaction, beats, characters) => {
  if (!interaction || interaction.type !== 'combo') return false;
  const beatIndex = Number.isFinite(interaction.beatIndex) ? Math.round(interaction.beatIndex) : null;
  if (beatIndex === null || beatIndex < 0) return false;
  const beat = beats?.[beatIndex];
  if (!Array.isArray(beat)) return false;
  const actorKeys = buildActorKeys(interaction, characters);
  const entry = beat.find((beatEntry) => {
    const key = beatEntry?.username ?? beatEntry?.userId ?? beatEntry?.userID;
    return actorKeys.has(key);
  });
  if (!entry) return false;
  return normalizeActionLabel(entry.action).toUpperCase() === COMBO_ACTION;
};

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
  const comboAccept = document.getElementById('comboAccept');
  const comboDecline = document.getElementById('comboDecline');
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

  const getPendingInteractionForUser = () => {
    const interactions = gameState?.state?.public?.customInteractions ?? [];
    const beats = gameState?.state?.public?.beats ?? [];
    const characters = gameState?.state?.public?.characters ?? [];
    const resolvedIndex = getTimelineResolvedIndex(beats);
    const pending = interactions.filter((interaction) => {
      if (interaction?.status !== 'pending' || interaction?.actorUserId !== localUserId) return false;
      const beatIndex = Number.isFinite(interaction?.beatIndex) ? Math.round(interaction.beatIndex) : null;
      if (beatIndex != null && resolvedIndex >= 0 && beatIndex <= resolvedIndex) return false;
      return true;
    });
    if (!pending.length) return null;
    const pendingThrows = pending.filter((interaction) => interaction?.type === 'throw');
    if (pendingThrows.length) {
      pendingThrows.sort((a, b) => (a?.beatIndex ?? 0) - (b?.beatIndex ?? 0));
      return pendingThrows[0] ?? null;
    }
    const filtered = pending.filter(
      (interaction) => interaction?.type !== 'combo' || hasComboEntryForInteraction(interaction, beats, characters),
    );
    if (!filtered.length) return null;
    filtered.sort((a, b) => (a?.beatIndex ?? 0) - (b?.beatIndex ?? 0));
    return filtered[0] ?? null;
  };

  const getPendingThrowInteraction = () => {
    const pending = getPendingInteractionForUser();
    return pending?.type === 'throw' ? pending : null;
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
      interactionSubmitInFlight = false;
      setThrowButtonsEnabled(false);
      setComboButtonsEnabled(false);
      setModalVisibility(throwModal, false);
      setModalVisibility(comboModal, false);
      return;
    }
    const pending = getPendingInteractionForUser();
    const shouldShow = Boolean(pending && gameState?.id);
    interactionOverlay.hidden = !shouldShow;
    interactionOverlay.setAttribute('aria-hidden', (!shouldShow).toString());
    if (!shouldShow) {
      pendingInteractionId = null;
      pendingInteractionType = null;
      interactionSubmitInFlight = false;
      setThrowButtonsEnabled(false);
      setComboButtonsEnabled(false);
      setModalVisibility(throwModal, false);
      setModalVisibility(comboModal, false);
      return;
    }
    if (pendingInteractionId !== pending.id || pendingInteractionType !== pending.type) {
      interactionSubmitInFlight = false;
    }
    pendingInteractionId = pending.id;
    pendingInteractionType = pending.type;
    if (pending.type === 'throw') {
      setModalVisibility(throwModal, true);
      setModalVisibility(comboModal, false);
      setThrowButtonsEnabled(!interactionSubmitInFlight);
      setComboButtonsEnabled(false);
      applyThrowLayout(pending);
      return;
    }
    if (pending.type === 'combo') {
      setModalVisibility(comboModal, true);
      setModalVisibility(throwModal, false);
      setComboButtonsEnabled(!interactionSubmitInFlight);
      setThrowButtonsEnabled(false);
      return;
    }
    setModalVisibility(throwModal, false);
    setModalVisibility(comboModal, false);
    setThrowButtonsEnabled(false);
    setComboButtonsEnabled(false);
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
    const exhaustedIds = Array.isArray(playerCards.discardPile) ? playerCards.discardPile : [];
    const movementCards = movementIds.map((id) => cardLookup.get(id)).filter(Boolean);
    const abilityCards = abilityIds.map((id) => cardLookup.get(id)).filter(Boolean);
    const nextKey = `${movementIds.join(',')}|${abilityIds.join(',')}`;
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

  const handleComboSubmit = async (continueCombo) => {
    if (!gameState?.id || !pendingInteractionId || interactionSubmitInFlight) return;
    if (pendingInteractionType !== 'combo') return;
    if (getMatchOutcome(gameState?.state?.public)) return;
    interactionSubmitInFlight = true;
    setComboButtonsEnabled(false);
    console.log(`${LOG_PREFIX} interaction:submit`, {
      userId: localUserId,
      gameId: gameState.id,
      interactionId: pendingInteractionId,
      continueCombo,
    });
    try {
      const response = await fetch('/api/v1/game/interaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: localUserId,
          gameId: gameState.id,
          interactionId: pendingInteractionId,
          continueCombo: Boolean(continueCombo),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.error ? `${payload.error}` : 'Failed to resolve combo.';
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
      console.error('Failed to resolve combo', err);
      const message = err instanceof Error ? err.message : 'Failed to resolve combo.';
      window.alert(message);
    } finally {
      interactionSubmitInFlight = false;
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
  const tooltip = createTimelineTooltip({
    gameArea,
    canvas,
    viewState,
    timeIndicatorViewModel,
  });

  applyThrowLayout(null);
  setThrowButtonsEnabled(false);
  setComboButtonsEnabled(false);
  throwButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.dir);
      handleThrowSubmit(index);
    });
  });
  if (comboAccept) {
    comboAccept.addEventListener('click', () => {
      void handleComboSubmit(true);
    });
  }
  if (comboDecline) {
    comboDecline.addEventListener('click', () => {
      void handleComboSubmit(false);
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
    interactionSubmitInFlight = false;
    gameOverInFlight = false;
    didInitTimelinePosition = false;
    pendingActionPreview.clear();
    lastComboKey = null;
    lastComboRequired = false;
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
    })
    .catch((err) => {
      console.warn('Failed to load card catalog for timeline tooltips', err);
    });

  bindControls(canvas, viewState, pointerState, undefined, timeIndicatorViewModel, gameArea);

  canvas.addEventListener('pointermove', (event) => tooltip.update(event));
  canvas.addEventListener('pointerleave', () => tooltip.hide());
  canvas.addEventListener('pointerdown', () => tooltip.hide());

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
    renderer.draw(viewState, gameState, timeIndicatorViewModel, scene, localUserId, pendingPreview);
    requestAnimationFrame(renderFrame);
  };

  requestAnimationFrame(renderFrame);
};
