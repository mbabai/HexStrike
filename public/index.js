import { initMenu } from './menu.js';
import { initQueue } from './queue.js';
import { initGame } from './game.js';
import { initPresence } from './presence.js';

function initLobby() {
  initMenu();
  initQueue();
  initGame();
  initPresence();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLobby);
} else {
  initLobby();
}
