import { getOrCreateUserId, getSelectedDeckId, getPreferredServerUsername } from './storage.js';
import { getSelectedDeck } from './deckStore.js';

const QUICKPLAY_QUEUE = 'quickplayQueue';
const RANKED_QUEUE = 'rankedQueue';
const BOT_HARD_QUEUE = 'botHardQueue';
const BOT_MEDIUM_QUEUE = 'botMediumQueue';
const BOT_EASY_QUEUE = 'botEasyQueue';
const KNOWN_QUEUES = new Set([
  QUICKPLAY_QUEUE,
  RANKED_QUEUE,
  BOT_HARD_QUEUE,
  BOT_MEDIUM_QUEUE,
  BOT_EASY_QUEUE,
]);
const SEARCHING_LABEL = 'Searching...';

export function initQueue() {
  const findGameButton = document.getElementById('findGame');
  const queueSelect = document.getElementById('queueSelect');
  let searchInterval = null;
  let searchStart = 0;
  let isSearching = false;
  let activeQueue = QUICKPLAY_QUEUE;

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

  const joinQueue = async (queueName) => {
    const userId = getOrCreateUserId();
    const username = getPreferredServerUsername();
    const selectedDeck = await getSelectedDeck(userId);
    const characterId = selectedDeck?.characterId;
    const deck = selectedDeck
      ? {
          movement: Array.isArray(selectedDeck.movement) ? selectedDeck.movement : [],
          ability: Array.isArray(selectedDeck.ability) ? selectedDeck.ability : [],
        }
      : null;
    const response = await fetch('/api/v1/lobby/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, username, queue: queueName, characterId, deck }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const message = payload?.error ? `${payload.error}` : 'Failed to join queue.';
      throw new Error(message);
    }
  };

  const isDeckComplete = (deck) =>
    Boolean(deck?.characterId) &&
    Array.isArray(deck?.movement) &&
    deck.movement.length === 4 &&
    Array.isArray(deck?.ability) &&
    deck.ability.length === 12;

  const leaveQueue = async (queueName) => {
    const userId = getOrCreateUserId();
    await fetch('/api/v1/lobby/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, queue: queueName }),
    });
  };

  window.addEventListener('hexstrike:match', () => {
    if (isSearching) {
      setSearchingState(false);
      activeQueue = QUICKPLAY_QUEUE;
    }
  });

  if (findGameButton) {
    findGameButton.addEventListener('click', async () => {
      if (findGameButton.disabled) return;
      if (isSearching) {
        setSearchingState(false);
        try {
          await leaveQueue(activeQueue);
        } catch (err) {
          console.error('Failed to leave queue', err);
        }
        activeQueue = QUICKPLAY_QUEUE;
        return;
      }

      const userId = getOrCreateUserId();
      const selectedDeck = await getSelectedDeck(userId);
      if (!isDeckComplete(selectedDeck)) {
        window.alert('Deck incomplete');
        return;
      }

      const requestedQueue = `${queueSelect?.value ?? QUICKPLAY_QUEUE}`;
      activeQueue = KNOWN_QUEUES.has(requestedQueue) ? requestedQueue : QUICKPLAY_QUEUE;
      setSearchingState(true);
      try {
        await joinQueue(activeQueue);
      } catch (err) {
        console.error('Failed to join queue', err);
        const message = err instanceof Error ? err.message : 'Failed to join queue.';
        window.alert(message);
        setSearchingState(false);
        activeQueue = QUICKPLAY_QUEUE;
      }
    });
  }

  window.addEventListener('hexstrike:deck-selected', updateFindGameAvailability);
  window.addEventListener('hexstrike:decks-updated', updateFindGameAvailability);
  updateFindGameAvailability();
}
