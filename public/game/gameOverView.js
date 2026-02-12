import { getLocalOutcomeLabel } from './matchEndRules.js';

export const createGameOverView = ({ gameArea, overlay, message, button, onContinue } = {}) => {
  if (button && typeof onContinue === 'function') {
    button.addEventListener('click', () => onContinue());
  }

  const setHidden = (hidden) => {
    if (overlay) {
      overlay.hidden = hidden;
      overlay.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    }
    if (hidden && message) {
      message.textContent = '';
    }
  };

  const update = (outcome, localUserId, inFlight = false) => {
    const isGameOver = Boolean(outcome);
    if (gameArea) {
      gameArea.classList.toggle('is-game-over', isGameOver);
    }
    if (!overlay || !message || !button) return;
    setHidden(!isGameOver);
    if (!isGameOver) {
      button.disabled = false;
      return;
    }
    const localOutcome = getLocalOutcomeLabel(outcome, localUserId);
    message.textContent =
      localOutcome === 'win'
        ? 'You win!'
        : localOutcome === 'lose'
          ? 'You lose'
          : localOutcome === 'draw'
            ? 'Draw agreed.'
            : 'Game over.';
    button.disabled = Boolean(inFlight);
  };

  const hide = () => {
    if (gameArea) {
      gameArea.classList.remove('is-game-over');
    }
    setHidden(true);
    if (button) {
      button.disabled = false;
    }
  };

  return { update, hide };
};
