import { initMenu } from './menu.js';
import { initQueue } from './queue.js';
import { initGame } from './game.js';
import { initPresence } from './presence.js';
import { initDecks } from './decks.js';
import { initReplays } from './replays.js';

async function initLobby() {
  initMenu();
  try {
    await initDecks();
  } catch (err) {
    console.error('Failed to initialize decks', err);
  }
  initQueue();
  initGame();
  initPresence();
  try {
    await initReplays();
  } catch (err) {
    console.error('Failed to initialize replays', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLobby);
} else {
  initLobby();
}
