import { GAME_CONFIG } from './game/config.js';
import { bindControls } from './game/controls.js';
import { createRenderer } from './game/renderer.js';
import { createTimeIndicatorModel } from './game/timeIndicatorModel.js';
import { createTimeIndicatorViewModel } from './game/timeIndicatorViewModel.js';
import { applyMomentum, centerView, createPointerState, createViewState } from './game/viewState.js';
import { getOrCreateUserId } from './storage.js';
import { getTimelineMaxIndex, isCharacterAtEarliestE } from './game/beatTimeline.js';
import { createTimelinePlayback } from './game/timelinePlayback.js';
import { loadCardCatalog, buildPlayerHand } from './game/cards.js';
import { createActionHud } from './game/actionHud.js';

export function initGame() {
  const gameArea = document.getElementById('gameArea');
  const canvas = document.getElementById('gameCanvas');
  const menuMatch = document.querySelector('.menu-match');
  const actionHudRoot = document.getElementById('actionHud');
  const movementHand = document.getElementById('movementHand');
  const abilityHand = document.getElementById('abilityHand');
  const activeSlot = document.getElementById('activeSlot');
  const passiveSlot = document.getElementById('passiveSlot');
  const actionSubmit = document.getElementById('actionSubmit');
  const rotationWheel = document.getElementById('rotationWheel');

  if (!gameArea || !canvas) return;

  const timeIndicatorModel = createTimeIndicatorModel();
  const timeIndicatorViewModel = createTimeIndicatorViewModel(timeIndicatorModel);
  const timelinePlayback = createTimelinePlayback();
  const renderer = createRenderer(canvas, GAME_CONFIG);
  if (!renderer) return;

  const viewState = createViewState();
  const pointerState = createPointerState();
  const localUserId = getOrCreateUserId();
  let hasCentered = false;
  let lastTime = performance.now();
  let gameState = null;
  let gameId = null;
  let usernameById = new Map();
  let optimisticLock = false;
  let hasServerPendingForLocal = false;
  let lastIndicatorValue = null;
  let optimisticBeatIndex = null;

  const actionHud = createActionHud({
    root: actionHudRoot,
    movementHand,
    abilityHand,
    activeSlot,
    passiveSlot,
    submitButton: actionSubmit,
    rotationWheel,
    onSubmit: submitAction,
  });

  loadCardCatalog()
    .then((catalog) => {
      const hand = buildPlayerHand(catalog);
      actionHud.setCards(hand.movement, hand.ability);
    })
    .catch((err) => {
      console.error('Failed to load card catalog', err);
    });

  const formatGameLog = (game, nameMap) => {
    const characters = game?.state?.public?.characters || [];
    const beats = game?.state?.public?.beats || [];
    const lines = ['[game:update] Player locations:'];
    if (!characters.length) {
      lines.push('- (none)');
    } else {
      characters.forEach((character) => {
        const name = nameMap.get(character.userId) || character.userId;
        const characterLabel = character.characterName || character.characterId || 'unknown';
        const position = character.position ? `q=${character.position.q} r=${character.position.r}` : 'unknown position';
        const facing = Number.isFinite(character.facing) ? ` facing=${character.facing}` : '';
        lines.push(`- ${name} [${characterLabel}]: ${position}${facing}`);
      });
    }
    lines.push('[game:update] Beats:');
    lines.push(JSON.stringify(beats, null, 2));
    return lines.join('\n');
  };

  const resize = () => {
    renderer.resize();
    if (!hasCentered && renderer.viewport.width && renderer.viewport.height) {
      centerView(viewState, renderer.viewport);
      hasCentered = true;
    }
  };

  const showGameArea = () => {
    if (!gameArea.hidden) return;
    gameArea.hidden = false;
    if (menuMatch) menuMatch.hidden = true;
    requestAnimationFrame(resize);
  };

  const updateTimeIndicatorMax = (state) => {
    const beats = state?.state?.public?.beats ?? [];
    const characters = state?.state?.public?.characters ?? [];
    const maxIndex = getTimelineMaxIndex(beats, characters);
    timeIndicatorModel.setMax(maxIndex);
  };

  const getLocalCharacter = (characters) =>
    characters.find((character) => character.userId === localUserId) || null;

  const updateActionHudState = () => {
    const beats = gameState?.state?.public?.beats ?? [];
    const characters = gameState?.state?.public?.characters ?? [];
    const localCharacter = getLocalCharacter(characters);
    const earliestIndex = getTimelineMaxIndex(beats, characters);
    const isAtBat = isCharacterAtEarliestE(beats, characters, localCharacter);
    const isViewingEarliest = timeIndicatorViewModel.value === earliestIndex;
    const pending = gameState?.state?.public?.pendingActions ?? null;
    const serverLocked = Boolean(pending?.submittedUserIds?.includes(localUserId));

    if (serverLocked) {
      hasServerPendingForLocal = true;
      optimisticLock = false;
      optimisticBeatIndex = null;
    }

    const shouldLock = serverLocked || optimisticLock;
    const shouldShow = Boolean(gameId) && isAtBat && isViewingEarliest;
    actionHud.setVisible(shouldShow);
    actionHud.setLocked(shouldLock);

    if (optimisticLock && !serverLocked && optimisticBeatIndex !== null && earliestIndex !== optimisticBeatIndex) {
      optimisticLock = false;
      optimisticBeatIndex = null;
      actionHud.setLocked(false);
      actionHud.clearSelection();
    }

    if (hasServerPendingForLocal && !serverLocked && !optimisticLock) {
      actionHud.clearSelection();
      hasServerPendingForLocal = false;
    }
  };

  async function sendActionSet(actionList) {
    if (!gameId) {
      console.warn('No active game to send action set');
      return;
    }
    const response = await fetch('/api/v1/game/action-set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: localUserId, gameId, actionList }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const message = payload?.error ? `${payload.error}` : `Action set rejected (${response.status})`;
      throw new Error(message);
    }
  }

  async function submitAction(actionList) {
    if (!Array.isArray(actionList) || !actionList.length) return;
    const beats = gameState?.state?.public?.beats ?? [];
    const characters = gameState?.state?.public?.characters ?? [];
    const localCharacter = getLocalCharacter(characters);
    if (!isCharacterAtEarliestE(beats, characters, localCharacter)) return;
    optimisticBeatIndex = getTimelineMaxIndex(beats, characters);
    optimisticLock = true;
    actionHud.setLocked(true);
    try {
      await sendActionSet(actionList);
    } catch (err) {
      optimisticLock = false;
      actionHud.setLocked(false);
      console.error('Failed to submit action set', err);
    }
  }

  window.addEventListener('resize', resize);
  window.addEventListener('hexstrike:match', showGameArea);
  window.addEventListener('hexstrike:game', showGameArea);
  window.addEventListener('hexstrike:match', (event) => {
    const match = event.detail;
    usernameById = new Map();
    if (match?.players) {
      match.players.forEach((player) => {
        usernameById.set(player.userId, player.username);
      });
    }
  });
  window.addEventListener('hexstrike:game', (event) => {
    gameState = event.detail;
    gameId = gameState?.id || null;
    updateTimeIndicatorMax(gameState);
    updateActionHudState();
    console.log(formatGameLog(gameState, usernameById));
  });

  updateActionHudState();
  bindControls(canvas, viewState, pointerState, GAME_CONFIG, timeIndicatorViewModel);

  const tick = (now) => {
    const dt = Math.max(0, now - lastTime);
    lastTime = now;

    applyMomentum(viewState, dt, GAME_CONFIG);
    timeIndicatorViewModel.update(now);
    const indicatorValue = timeIndicatorViewModel.value;
    if (indicatorValue !== lastIndicatorValue) {
      lastIndicatorValue = indicatorValue;
      updateActionHudState();
    }

    if (!gameArea.hidden) {
      timelinePlayback.update(now, gameState, timeIndicatorViewModel.value ?? 0);
      renderer.draw(viewState, gameState, timeIndicatorViewModel, timelinePlayback.getScene(), localUserId);
    }

    requestAnimationFrame(tick);
  };

  resize();
  requestAnimationFrame(tick);
}
