import { GAME_CONFIG } from './game/config.js';
import { bindControls } from './game/controls.js';
import { createRenderer } from './game/renderer.js';
import { createTimeIndicatorModel } from './game/timeIndicatorModel.js';
import { createTimeIndicatorViewModel } from './game/timeIndicatorViewModel.js';
import { applyMomentum, centerView, createPointerState, createViewState } from './game/viewState.js';
import { getOrCreateUserId } from './storage.js';
import {
  getBeatEntryForCharacter,
  getCharacterFirstEIndex,
  getTimelineMaxIndex,
  isCharacterAtEarliestE,
} from './game/beatTimeline.js';
import { createTimelinePlayback } from './game/timelinePlayback.js';
import { loadCardCatalog } from './game/cards.js';
import { createActionHud } from './game/actionHud.js';
import { findDistanceLoss, findMovementLoss, resolveMatchEndState } from './game/matchEndRules.js';
import { getSelectedDeck } from './deckStore.js';
import { LAND_HEXES } from './shared/hex.mjs';

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
  const gameOverOverlay = document.getElementById('gameOverOverlay');
  const gameOverMessage = document.getElementById('gameOverMessage');
  const gameOverDone = document.getElementById('gameOverDone');

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
  let cardCatalog = null;
  let deckState = null;
  let pendingUse = null;
  let pendingRefreshIndex = null;
  let lastRefreshIndex = null;
  let landLookup = new Set();
  let lastGameId = null;
  let gameOverActive = false;
  let gameOverState = null;
  let gameOverModalShown = false;
  let matchEndSent = false;
  let matchEnded = null;

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

  const buildDeckState = async () => {
    if (!cardCatalog) return null;
    const lookup = buildCardLookup(cardCatalog);
    const selectedDeck = await getSelectedDeck(localUserId);
    const movementIds = Array.isArray(selectedDeck?.movement)
      ? selectedDeck.movement
      : Array.isArray(cardCatalog?.movement)
        ? cardCatalog.movement.map((card) => card.id)
        : [];
    const abilityIds = Array.isArray(selectedDeck?.ability)
      ? selectedDeck.ability
      : Array.isArray(cardCatalog?.ability)
        ? cardCatalog.ability.map((card) => card.id)
        : [];
    const movement = movementIds.map((cardId) => lookup.get(cardId)).filter(Boolean);
    const abilityCards = abilityIds.map((cardId) => lookup.get(cardId)).filter(Boolean);
    const abilityHand = abilityCards.slice(0, 4);
    const abilityDeck = abilityCards.slice(4);
    return {
      movement,
      abilityHand,
      abilityDeck,
      exhaustedMovementIds: new Set(),
      exhaustedAbilityIds: new Set(),
    };
  };

  const getExhaustedCardIds = () => {
    if (!deckState) return new Set();
    const ids = new Set();
    deckState.exhaustedMovementIds.forEach((id) => ids.add(id));
    deckState.exhaustedAbilityIds.forEach((id) => ids.add(id));
    return ids;
  };

  const renderHand = () => {
    if (!deckState) return;
    actionHud.setCards(deckState.movement, deckState.abilityHand, {
      exhaustedCardIds: getExhaustedCardIds(),
    });
  };

  const resetHandState = async () => {
    deckState = await buildDeckState();
    pendingUse = null;
    pendingRefreshIndex = null;
    lastRefreshIndex = null;
    renderHand();
  };

  loadCardCatalog()
    .then((catalog) => {
      cardCatalog = catalog;
      return resetHandState();
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

  const buildLandLookup = (land) => {
    const tiles = Array.isArray(land) && land.length ? land : LAND_HEXES;
    return new Set(tiles.map((tile) => `${tile.q},${tile.r}`));
  };

  const isOnLand = (location) => {
    if (!location) return false;
    return landLookup.has(`${location.q},${location.r}`);
  };

  const drawAbilityCards = () => {
    if (!deckState) return;
    while (deckState.abilityHand.length < 4 && deckState.abilityDeck.length) {
      const next = deckState.abilityDeck.shift();
      if (next) deckState.abilityHand.push(next);
    }
  };

  const getCharacterLabel = (character) => character?.username || usernameById.get(character?.userId) || character?.userId;

  const getWinnerLabel = (winners) => {
    if (!Array.isArray(winners) || !winners.length) return 'No winner';
    return winners.map(getCharacterLabel).join(', ');
  };

  const setGameOverState = (state) => {
    if (!state || gameOverState) return;
    gameOverState = state;
    gameOverActive = true;
    if (gameArea) {
      gameArea.classList.add('is-game-over');
    }
    actionHud.setHidden(true);
    actionHud.setLocked(true);
    actionHud.setVisible(false);
    const winnerLabels = Array.isArray(state.winners) ? state.winners.map(getCharacterLabel) : [];
    console.log('[game:over]', {
      reason: state.reason ?? 'unknown',
      beatIndex: state.beatIndex,
      losers: Array.from(state.losers ?? []),
      winners: winnerLabels,
      detail: state.detail ?? null,
    });
  };

  const buildGameOverMessage = () => {
    if (matchEnded?.winnerId) {
      const winner = matchEnded.players?.find((player) => player.userId === matchEnded.winnerId);
      const winnerLabel = winner?.username || matchEnded.winnerId;
      return matchEnded.winnerId === localUserId ? 'You win.' : `You lose. Winner: ${winnerLabel}.`;
    }
    if (!gameOverState) return 'Game over.';
    const winners = gameOverState.winners ?? [];
    const winnerLabel = getWinnerLabel(winners);
    if (gameOverState.losers?.has(localUserId)) {
      return `You lose. Winner: ${winnerLabel}.`;
    }
    if (winners.some((winner) => winner.userId === localUserId)) {
      return 'You win.';
    }
    return `Game over. Winner: ${winnerLabel}.`;
  };

  const showGameOver = (message) => {
    if (!gameOverOverlay || !gameOverMessage) return;
    gameOverModalShown = true;
    gameOverMessage.textContent = message;
    gameOverOverlay.hidden = false;
    timeIndicatorViewModel.setPlaying(false);
  };

  const sendMatchEnd = async (winnerId) => {
    if (!gameState?.matchId || matchEndSent) return;
    if (matchEnded && matchEnded.id === gameState.matchId) return;
    matchEndSent = true;
    try {
      await fetch(`/api/v1/match/${gameState.matchId}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winnerId }),
      });
    } catch (err) {
      matchEndSent = false;
      console.error('Failed to end match', err);
    }
  };


  const computeGameOverState = () => {
    if (gameOverState || !gameState?.state?.public?.characters?.length) return;
    const beats = gameState?.state?.public?.beats ?? [];
    const characters = gameState?.state?.public?.characters ?? [];
    const land = gameState?.state?.public?.land?.length ? gameState.state.public.land : LAND_HEXES;
    const maxIndex = Math.max(0, beats.length - 1);

    const distanceLoss = findDistanceLoss(beats, characters, land, maxIndex);
    if (distanceLoss) distanceLoss.reason = 'distance';
    const movementLoss = findMovementLoss({
      beats,
      characters,
      land,
      deckState,
      localUserId,
      pendingActions: gameState?.state?.public?.pendingActions,
      optimisticLock,
    });
    if (movementLoss) movementLoss.reason = 'no-movement-abyss';

    let result = null;
    if (distanceLoss && movementLoss) {
      if (distanceLoss.beatIndex < movementLoss.beatIndex) {
        result = distanceLoss;
      } else if (movementLoss.beatIndex < distanceLoss.beatIndex) {
        result = movementLoss;
      } else {
        const combined = new Set([...distanceLoss.loserIds, ...movementLoss.loserIds]);
        result = { beatIndex: distanceLoss.beatIndex, loserIds: combined };
      }
    } else {
      result = distanceLoss || movementLoss;
    }

    if (!result) return;

    const winners = characters.filter((character) => !result.loserIds.has(character.userId));
    setGameOverState({
      beatIndex: result.beatIndex,
      losers: result.loserIds,
      winners,
      reason: result.reason,
      detail: result.detail,
    });
    const winnerId = winners.length === 1 ? winners[0].userId : undefined;
    void sendMatchEnd(winnerId);
  };

  const maybeShowGameOverModal = () => {
    if (!gameOverState || gameOverModalShown) return;
    const current = timeIndicatorViewModel.value ?? 0;
    if (current < gameOverState.beatIndex) return;
    if (timeIndicatorViewModel.isPlaying && current > gameOverState.beatIndex) {
      timeIndicatorModel.setValue(gameOverState.beatIndex);
    }
    showGameOver(buildGameOverMessage());
  };

  const getRefreshOffset = (actionList) => {
    if (!Array.isArray(actionList) || !actionList.length) return null;
    for (let i = actionList.length - 1; i >= 0; i -= 1) {
      if (actionList[i]?.action === 'E') return i;
    }
    return Math.max(0, actionList.length - 1);
  };

  const resolvePendingRefresh = (onLand) => {
    if (!deckState || !pendingUse) return;
    const usedAbilityIndex = deckState.abilityHand.findIndex((card) => card.id === pendingUse.abilityCardId);
    if (usedAbilityIndex !== -1) {
      const [usedAbility] = deckState.abilityHand.splice(usedAbilityIndex, 1);
      if (usedAbility) deckState.abilityDeck.push(usedAbility);
    }
    deckState.exhaustedAbilityIds.delete(pendingUse.abilityCardId);
    if (onLand) {
      deckState.exhaustedMovementIds.clear();
      drawAbilityCards();
    }
    pendingUse = null;
    pendingRefreshIndex = null;
    renderHand();
  };

  const markPendingUse = (movementCardId, abilityCardId, refreshIndex) => {
    if (!deckState) return;
    const movementWasExhausted = deckState.exhaustedMovementIds.has(movementCardId);
    const abilityWasExhausted = deckState.exhaustedAbilityIds.has(abilityCardId);
    deckState.exhaustedMovementIds.add(movementCardId);
    deckState.exhaustedAbilityIds.add(abilityCardId);
    pendingUse = { movementCardId, abilityCardId, movementWasExhausted, abilityWasExhausted };
    pendingRefreshIndex = refreshIndex;
    actionHud.setExhaustedCards(getExhaustedCardIds());
  };

  const maybeResolveRefresh = () => {
    if (!pendingUse || pendingRefreshIndex === null) return;
    const indicatorValue = timeIndicatorViewModel.value;
    if (indicatorValue !== pendingRefreshIndex) return;
    if (lastRefreshIndex === indicatorValue) return;
    const beats = gameState?.state?.public?.beats ?? [];
    const characters = gameState?.state?.public?.characters ?? [];
    const localCharacter = getLocalCharacter(characters);
    const beat = beats[indicatorValue] ?? [];
    const entry = getBeatEntryForCharacter(beat, localCharacter);
    if (entry?.action !== 'E') return;
    const location = entry?.location ?? localCharacter?.position ?? null;
    lastRefreshIndex = indicatorValue;
    resolvePendingRefresh(isOnLand(location));
  };

  const rollbackPendingUse = () => {
    if (!deckState || !pendingUse) return;
    if (!pendingUse.movementWasExhausted) {
      deckState.exhaustedMovementIds.delete(pendingUse.movementCardId);
    }
    if (!pendingUse.abilityWasExhausted) {
      deckState.exhaustedAbilityIds.delete(pendingUse.abilityCardId);
    }
    pendingUse = null;
    pendingRefreshIndex = null;
    actionHud.setExhaustedCards(getExhaustedCardIds());
  };

  const updateActionHudState = () => {
    if (gameOverActive) {
      actionHud.setHidden(true);
      actionHud.setVisible(false);
      actionHud.setLocked(true);
      return;
    }
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

  const maybeAutoAdvanceTimeline = () => {
    if (!timeIndicatorViewModel.isPlaying) return false;
    if (timeIndicatorViewModel.isHolding) return false;
    const max = timeIndicatorViewModel.max;
    if (typeof max !== 'number') return false;
    if ((timeIndicatorViewModel.value ?? 0) >= max) return false;
    const status = timelinePlayback.getStatus?.();
    if (!status || !status.isComplete) return false;
    timeIndicatorViewModel.step(1);
    return true;
  };

  async function sendActionSet(actionList, meta = {}) {
    if (!gameId) {
      console.warn('No active game to send action set');
      return;
    }
    const response = await fetch('/api/v1/game/action-set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: localUserId, gameId, actionList, ...meta }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const message = payload?.error ? `${payload.error}` : `Action set rejected (${response.status})`;
      throw new Error(message);
    }
  }

  async function submitAction(payload) {
    if (gameOverActive) return;
    const actionList = Array.isArray(payload) ? payload : payload?.actionList;
    if (!Array.isArray(actionList) || !actionList.length) return;
    const beats = gameState?.state?.public?.beats ?? [];
    const characters = gameState?.state?.public?.characters ?? [];
    const localCharacter = getLocalCharacter(characters);
    if (!isCharacterAtEarliestE(beats, characters, localCharacter)) return;
    const earliestIndex = getTimelineMaxIndex(beats, characters);
    optimisticBeatIndex = earliestIndex;
    optimisticLock = true;
    actionHud.setLocked(true);
    const activeCard = Array.isArray(payload) ? null : payload?.activeCard;
    const passiveCard = Array.isArray(payload) ? null : payload?.passiveCard;
    const movementCard = activeCard?.type === 'movement' ? activeCard : passiveCard?.type === 'movement' ? passiveCard : null;
    const abilityCard = activeCard?.type === 'ability' ? activeCard : passiveCard?.type === 'ability' ? passiveCard : null;
    const refreshOffset = getRefreshOffset(actionList);
    if (movementCard && abilityCard && refreshOffset !== null) {
      markPendingUse(movementCard.id, abilityCard.id, earliestIndex + refreshOffset);
    }
    try {
      const rotation = actionList[0]?.rotation ?? '';
      await sendActionSet(actionList, {
        activeCardId: activeCard?.id,
        passiveCardId: passiveCard?.id,
        rotation,
      });
    } catch (err) {
      optimisticLock = false;
      actionHud.setLocked(false);
      rollbackPendingUse();
      console.error('Failed to submit action set', err);
    }
  }

  window.addEventListener('resize', resize);
  window.addEventListener('hexstrike:match', showGameArea);
  window.addEventListener('hexstrike:game', showGameArea);
  window.addEventListener('hexstrike:deck-selected', () => {
    void resetHandState();
  });
  window.addEventListener('hexstrike:decks-updated', () => {
    void resetHandState();
  });
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
    landLookup = buildLandLookup(gameState?.state?.public?.land);
    if (gameId && gameId !== lastGameId) {
      lastGameId = gameId;
      gameOverActive = false;
      gameOverState = null;
      gameOverModalShown = false;
      matchEndSent = false;
      matchEnded = null;
      if (gameOverOverlay) {
        gameOverOverlay.hidden = true;
      }
      if (gameArea) {
        gameArea.classList.remove('is-game-over');
      }
      actionHud.setHidden(false);
      void resetHandState();
    }
    updateTimeIndicatorMax(gameState);
    updateActionHudState();
    console.log(formatGameLog(gameState, usernameById));
    if (matchEnded && matchEnded.id === gameState?.matchId && !gameOverState) {
      const beats = gameState?.state?.public?.beats ?? [];
      const characters = gameState?.state?.public?.characters ?? [];
      const land = gameState?.state?.public?.land?.length ? gameState.state.public.land : LAND_HEXES;
      const resolved = resolveMatchEndState(matchEnded, beats, characters, land);
      setGameOverState(resolved);
    }
  });
  window.addEventListener('hexstrike:match-ended', (event) => {
    const match = event.detail;
    if (!match || match.id !== gameState?.matchId) return;
    matchEnded = match;
    if (!gameOverState) {
      const beats = gameState?.state?.public?.beats ?? [];
      const characters = gameState?.state?.public?.characters ?? [];
      const land = gameState?.state?.public?.land?.length ? gameState.state.public.land : LAND_HEXES;
      const resolved = resolveMatchEndState(match, beats, characters, land);
      setGameOverState(resolved);
    }
  });

  if (gameOverDone) {
    gameOverDone.addEventListener('click', () => {
      if (gameArea) gameArea.hidden = true;
      if (menuMatch) menuMatch.hidden = false;
      window.location.href = '/';
    });
  }

  updateActionHudState();
  bindControls(canvas, viewState, pointerState, GAME_CONFIG, timeIndicatorViewModel, gameArea);

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
    maybeResolveRefresh();

    if (!gameArea.hidden) {
      timelinePlayback.update(now, gameState, timeIndicatorViewModel.value ?? 0);
      if (maybeAutoAdvanceTimeline()) {
        lastIndicatorValue = timeIndicatorViewModel.value;
        updateActionHudState();
        timelinePlayback.update(now, gameState, timeIndicatorViewModel.value ?? 0);
      }
      renderer.draw(viewState, gameState, timeIndicatorViewModel, timelinePlayback.getScene(), localUserId);
    }

    if (!gameOverState) {
      computeGameOverState();
    }
    maybeShowGameOverModal();

    requestAnimationFrame(tick);
  };

  resize();
  requestAnimationFrame(tick);
}
