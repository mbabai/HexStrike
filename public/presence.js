import { getOrCreateUserId } from './storage.js';

export function initPresence() {
  const userId = getOrCreateUserId();
  const source = new EventSource(`/events?userId=${encodeURIComponent(userId)}`);

  const dispatch = (type, payload) => {
    window.dispatchEvent(new CustomEvent(type, { detail: payload }));
  };

  source.addEventListener('message', (event) => {
    if (!event.data) return;
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'match:created') {
        dispatch('hexstrike:match', data.payload);
      }
      if (data.type === 'game:update') {
        dispatch('hexstrike:game', data.payload);
      }
      if (data.type === 'match:ended') {
        dispatch('hexstrike:match-ended', data.payload);
      }
    } catch (err) {
      console.warn('Failed to parse SSE message', err);
    }
  });

  window.addEventListener('beforeunload', () => {
    source.close();
  });
}
