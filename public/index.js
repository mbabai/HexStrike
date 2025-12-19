import { initMenu } from './menu.js';
import { initQueue } from './queue.js';

function initLobby() {
  initMenu();
  initQueue();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLobby);
} else {
  initLobby();
}
