import { GAME_CONFIG } from './game/config.js';
import { bindControls } from './game/controls.js';
import { createRenderer } from './game/renderer.js';
import { applyMomentum, centerView, createPointerState, createViewState } from './game/viewState.js';

export function initGame() {
  const gameArea = document.getElementById('gameArea');
  const canvas = document.getElementById('gameCanvas');
  const menuMatch = document.querySelector('.menu-match');

  if (!gameArea || !canvas) return;

  const renderer = createRenderer(canvas, GAME_CONFIG);
  if (!renderer) return;

  const viewState = createViewState();
  const pointerState = createPointerState();
  let hasCentered = false;
  let lastTime = performance.now();
  let gameState = null;

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
  window.addEventListener('hexstrike:game', (event) => {
    gameState = event.detail;
  });

  bindControls(canvas, viewState, pointerState, GAME_CONFIG);

  const tick = (now) => {
    const dt = Math.max(0, now - lastTime);
    lastTime = now;

    applyMomentum(viewState, dt, GAME_CONFIG);

    if (!gameArea.hidden) {
      renderer.draw(viewState, gameState);
    }

    requestAnimationFrame(tick);
  };

  resize();
  requestAnimationFrame(tick);
}
