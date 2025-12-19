import { GAME_CONFIG } from './game/config.js';
import { bindControls } from './game/controls.js';
import { createRenderer } from './game/renderer.js';
import { createTimeIndicatorModel } from './game/timeIndicatorModel.js';
import { createTimeIndicatorViewModel } from './game/timeIndicatorViewModel.js';
import { applyMomentum, centerView, createPointerState, createViewState } from './game/viewState.js';
import { getOrCreateUserId } from './storage.js';
import { getTimelineMaxIndex } from './game/beatTimeline.js';
import { buildRotationWheel } from './game/rotationWheel.js';

const buildActionSet = (actions, rotation, priority) =>
  actions.map((action, index) => ({
    action,
    rotation: index === 0 ? rotation : '',
    priority,
  }));

export function initGame() {
  const gameArea = document.getElementById('gameArea');
  const canvas = document.getElementById('gameCanvas');
  const menuMatch = document.querySelector('.menu-match');
  const actionConfigs = [
    { id: 'actionMove', label: 'move', actions: ['W', 'm', 'W'], priority: 30 },
    { id: 'actionAttack', label: 'attack', actions: ['W', 'a-La-Ra', 'W', 'W'], priority: 90 },
    { id: 'actionBlock', label: 'block', actions: ['W', 'b-Lb-Rb', 'b-Lb-Rb'], priority: 99 },
    { id: 'actionCharge', label: 'charge', actions: ['W', 'c', 'W', 'W', 'W'], priority: 75 },
    { id: 'actionJump', label: 'jump', actions: ['2j', 'W', 'W', 'W'], priority: 20 },
  ];
  const actionButtons = actionConfigs.map((config) => ({
    ...config,
    element: document.getElementById(config.id),
  }));
  const rotationWheel = document.getElementById('rotationWheel');

  if (!gameArea || !canvas) return;

  const timeIndicatorModel = createTimeIndicatorModel();
  const timeIndicatorViewModel = createTimeIndicatorViewModel(timeIndicatorModel);
  const renderer = createRenderer(canvas, GAME_CONFIG);
  if (!renderer) return;

  const viewState = createViewState();
  const pointerState = createPointerState();
  let hasCentered = false;
  let lastTime = performance.now();
  let gameState = null;
  let gameId = null;
  let usernameById = new Map();
  let selectedRotation = null;

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
        const facing = character.facing ? ` facing=${character.facing}` : '';
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

  const updateActionButtonsEnabled = () => {
    const enabled = Boolean(gameId) && selectedRotation !== null;
    actionButtons.forEach((button) => {
      if (button.element) button.element.disabled = !enabled;
    });
  };

  const sendActionSet = async (actionList) => {
    if (!gameId) {
      console.warn('No active game to send action set');
      return;
    }
    const userId = getOrCreateUserId();
    await fetch('/api/v1/game/action-set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, gameId, actionList }),
    });
  };

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
    updateActionButtonsEnabled();
    updateTimeIndicatorMax(gameState);
    console.log(formatGameLog(gameState, usernameById));
  });

  buildRotationWheel(rotationWheel, (rotation) => {
    selectedRotation = rotation;
    updateActionButtonsEnabled();
  });

  const bindActionButton = (button) => {
    if (!button.element) return;
    button.element.addEventListener('click', async () => {
      try {
        if (selectedRotation === null) return;
        await sendActionSet(buildActionSet(button.actions, selectedRotation, button.priority));
      } catch (err) {
        console.error(`Failed to send ${button.label} action set`, err);
      }
    });
  };

  actionButtons.forEach(bindActionButton);

  updateActionButtonsEnabled();
  bindControls(canvas, viewState, pointerState, GAME_CONFIG, timeIndicatorViewModel);

  const tick = (now) => {
    const dt = Math.max(0, now - lastTime);
    lastTime = now;

    applyMomentum(viewState, dt, GAME_CONFIG);
    timeIndicatorViewModel.update(now);

    if (!gameArea.hidden) {
      renderer.draw(viewState, gameState, timeIndicatorViewModel);
    }

    requestAnimationFrame(tick);
  };

  resize();
  requestAnimationFrame(tick);
}
