import { getOrCreateUserId } from './storage.js';

export function initPresence() {
  const userId = getOrCreateUserId();
  const source = new EventSource(`/events?userId=${encodeURIComponent(userId)}`);

  window.addEventListener('beforeunload', () => {
    source.close();
  });
}
