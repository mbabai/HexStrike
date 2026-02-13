import { getLocalOutcomeLabel } from './matchEndRules.js';

export const createGameOverView = ({
  gameArea,
  overlay,
  message,
  button,
  shareButton,
  saveButton,
  onContinue,
  onShare,
  onSaveReplay,
} = {}) => {
  const secondaryButton = shareButton || saveButton || null;
  const onSecondaryAction = onShare || onSaveReplay;

  if (button && typeof onContinue === 'function') {
    button.addEventListener('click', () => onContinue());
  }
  if (secondaryButton && typeof onSecondaryAction === 'function') {
    secondaryButton.addEventListener('click', () => onSecondaryAction());
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

  const normalizeStatus = (value) => {
    if (value && typeof value === 'object') {
      return {
        continueInFlight: Boolean(value.continueInFlight),
        shareInFlight: Boolean(value.shareInFlight || value.saveInFlight),
      };
    }
    return {
      continueInFlight: Boolean(value),
      shareInFlight: false,
    };
  };

  const update = (outcome, localUserId, status = false) => {
    const isGameOver = Boolean(outcome);
    if (gameArea) {
      gameArea.classList.toggle('is-game-over', isGameOver);
    }
    if (!overlay || !message || !button) return;
    const normalizedStatus = normalizeStatus(status);
    setHidden(!isGameOver);
    if (!isGameOver) {
      button.disabled = false;
      if (secondaryButton) {
        secondaryButton.disabled = false;
      }
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
    button.disabled = normalizedStatus.continueInFlight;
    if (secondaryButton) {
      secondaryButton.disabled = normalizedStatus.shareInFlight;
    }
  };

  const hide = () => {
    if (gameArea) {
      gameArea.classList.remove('is-game-over');
    }
    setHidden(true);
    if (button) {
      button.disabled = false;
    }
    if (secondaryButton) {
      secondaryButton.disabled = false;
    }
  };

  return { update, hide };
};
