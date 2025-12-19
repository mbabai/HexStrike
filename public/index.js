import { initMenu } from './menu.js';
import { initQueue } from './queue.js';
import { initPresence } from './presence.js';

function initLobby() {
  initMenu();
  initQueue();
  initPresence();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLobby);
} else {
  initLobby();
}
