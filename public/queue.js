import {
  getOrCreateUserId,
  getPreferredServerUsername,
  getQueuePreference,
  getSelectedDeckId,
  setQueuePreference,
} from './storage.js';
import { getSelectedDeck } from './deckStore.js';

const TUTORIAL_QUEUE = 'tutorialQueue';
const QUICKPLAY_QUEUE = 'quickplayQueue';
const RANKED_QUEUE = 'rankedQueue';
const BOT_HARD_QUEUE = 'botHardQueue';
const BOT_MEDIUM_QUEUE = 'botMediumQueue';
const BOT_EASY_QUEUE = 'botEasyQueue';
const KNOWN_QUEUES = new Set([
  TUTORIAL_QUEUE,
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
  let activeQueue = TUTORIAL_QUEUE;

  const isTutorialQueue = (queueName) => queueName === TUTORIAL_QUEUE;

  const getRequestedQueue = () => {
    const raw = `${queueSelect?.value ?? TUTORIAL_QUEUE}`.trim();
    return KNOWN_QUEUES.has(raw) ? raw : TUTORIAL_QUEUE;
  };

  const updateFindGameAvailability = () => {
    if (!findGameButton) return;
    const selectedQueue = getRequestedQueue();
    const allowsMissingDeck = isTutorialQueue(selectedQueue);
    const hasDeck = Boolean(getSelectedDeckId());
    const canSearch = hasDeck || allowsMissingDeck || isSearching;
    findGameButton.disabled = !canSearch;
    findGameButton.classList.toggle('btn-primary', hasDeck || allowsMissingDeck);
    findGameButton.classList.toggle('is-disabled', !hasDeck && !allowsMissingDeck && !isSearching);
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
    const isTutorial = isTutorialQueue(queueName);
    const selectedDeck = isTutorial ? null : await getSelectedDeck(userId);
    const characterId = selectedDeck?.characterId;
    const deck = selectedDeck
      ? {
          movement: Array.isArray(selectedDeck.movement) ? selectedDeck.movement : [],
          ability: Array.isArray(selectedDeck.ability) ? selectedDeck.ability : [],
        }
      : null;
    const payload = {
      userId,
      username,
      queue: queueName,
      ...(isTutorial ? {} : { characterId, deck }),
    };
    const response = await fetch('/api/v1/lobby/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
      activeQueue = getRequestedQueue();
    }
  });
  window.addEventListener('hexstrike:game', () => {
    if (isSearching) {
      setSearchingState(false);
      activeQueue = getRequestedQueue();
    }
  });

  if (queueSelect) {
    const storedQueue = `${getQueuePreference() ?? ''}`.trim();
    const initialQueue = KNOWN_QUEUES.has(storedQueue) ? storedQueue : TUTORIAL_QUEUE;
    queueSelect.value = initialQueue;
    activeQueue = initialQueue;
    setQueuePreference(initialQueue);
    queueSelect.addEventListener('change', () => {
      const selectedQueue = getRequestedQueue();
      activeQueue = selectedQueue;
      setQueuePreference(selectedQueue);
      updateFindGameAvailability();
    });
  }

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
        activeQueue = getRequestedQueue();
        return;
      }

      const requestedQueue = getRequestedQueue();
      if (!isTutorialQueue(requestedQueue)) {
        const userId = getOrCreateUserId();
        const selectedDeck = await getSelectedDeck(userId);
        if (!isDeckComplete(selectedDeck)) {
          window.alert('Deck incomplete');
          return;
        }
      }

      activeQueue = requestedQueue;
      setQueuePreference(activeQueue);
      setSearchingState(true);
      try {
        await joinQueue(activeQueue);
      } catch (err) {
        console.error('Failed to join queue', err);
        const message = err instanceof Error ? err.message : 'Failed to join queue.';
        window.alert(message);
        setSearchingState(false);
        activeQueue = getRequestedQueue();
      }
    });
  }

  window.addEventListener('hexstrike:deck-selected', updateFindGameAvailability);
  window.addEventListener('hexstrike:decks-updated', updateFindGameAvailability);
  updateFindGameAvailability();
}
