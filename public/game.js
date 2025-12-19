import { GAME_CONFIG } from './game/config.js';
import { bindControls } from './game/controls.js';
import { createRenderer } from './game/renderer.js';
import { createTimeIndicatorModel } from './game/timeIndicatorModel.js';
import { createTimeIndicatorViewModel } from './game/timeIndicatorViewModel.js';
import { applyMomentum, centerView, createPointerState, createViewState } from './game/viewState.js';

export function initGame() {
  const gameArea = document.getElementById('gameArea');
  const canvas = document.getElementById('gameCanvas');
  const menuMatch = document.querySelector('.menu-match');

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
  let usernameById = new Map();

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
    console.log(formatGameLog(gameState, usernameById));
  });

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
