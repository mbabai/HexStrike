import { getOrCreateUserId, getSelectedDeckId } from './storage.js';
import { getSelectedDeck } from './deckStore.js';

const QUICKPLAY_QUEUE = 'quickplayQueue';
const SEARCHING_LABEL = 'Searching...';

export function initQueue() {
  const findGameButton = document.getElementById('findGame');
  const queueSelect = document.getElementById('queueSelect');
  let searchInterval = null;
  let searchStart = 0;
  let isSearching = false;

  const updateFindGameAvailability = () => {
    if (!findGameButton) return;
    const hasDeck = Boolean(getSelectedDeckId());
    const canSearch = hasDeck || isSearching;
    findGameButton.disabled = !canSearch;
    findGameButton.classList.toggle('btn-primary', hasDeck);
    findGameButton.classList.toggle('is-disabled', !hasDeck && !isSearching);
  };

  const updateSearchLabel = () => {
    if (!findGameButton) return;
    const elapsed = Math.max(0, Date.now() - searchStart);
    const totalSeconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const clock = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    findGameButton.textContent = `${SEARCHING_LABEL} ${clock}`;
  };

  const setSearchingState = (nextState) => {
    if (!findGameButton) return;
    isSearching = nextState;
    findGameButton.classList.toggle('btn-queueing', nextState);
    if (nextState) {
      searchStart = Date.now();
      updateSearchLabel();
      searchInterval = window.setInterval(updateSearchLabel, 1000);
    } else {
      if (searchInterval) {
        window.clearInterval(searchInterval);
        searchInterval = null;
      }
      findGameButton.textContent = 'Find Game';
    }
    updateFindGameAvailability();
  };

  const joinQuickplayQueue = async () => {
    const userId = getOrCreateUserId();
    const selectedDeck = await getSelectedDeck(userId);
    const characterId = selectedDeck?.characterId;
    await fetch('/api/v1/lobby/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, queue: QUICKPLAY_QUEUE, characterId }),
    });
  };

  const leaveQuickplayQueue = async () => {
    const userId = getOrCreateUserId();
    await fetch('/api/v1/lobby/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, queue: QUICKPLAY_QUEUE }),
    });
  };

  const alertQuickplayOnly = () => {
    window.alert('comming soon, please try quickplay');
  };

  window.addEventListener('hexstrike:match', () => {
    if (isSearching) {
      setSearchingState(false);
    }
  });

  if (findGameButton) {
    findGameButton.addEventListener('click', async () => {
      if (findGameButton.disabled) return;
      if (isSearching) {
        setSearchingState(false);
        try {
          await leaveQuickplayQueue();
        } catch (err) {
          console.error('Failed to leave quickplay queue', err);
        }
        return;
      }

      if (!queueSelect || queueSelect.value !== QUICKPLAY_QUEUE) {
        alertQuickplayOnly();
        return;
      }

      setSearchingState(true);
      try {
        await joinQuickplayQueue();
      } catch (err) {
        console.error('Failed to join quickplay queue', err);
        setSearchingState(false);
      }
    });
  }

  window.addEventListener('hexstrike:deck-selected', updateFindGameAvailability);
  window.addEventListener('hexstrike:decks-updated', updateFindGameAvailability);
  updateFindGameAvailability();
}
