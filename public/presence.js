import { getOrCreateUserId, getPreferredServerUsername, setStoredUsername } from './storage.js';

export function initPresence() {
  const userId = getOrCreateUserId();
  const username = getPreferredServerUsername();
  const params = new URLSearchParams({ userId });
  if (username) {
    params.set('username', username);
  }
  const source = new EventSource(`/events?${params.toString()}`);

  const dispatch = (type, payload) => {
    window.dispatchEvent(new CustomEvent(type, { detail: payload }));
  };

  source.addEventListener('message', (event) => {
    if (!event.data) return;
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'connected') {
        const assigned = setStoredUsername(data?.payload?.username, {
          custom: Boolean(getPreferredServerUsername()),
        });
        dispatch('hexstrike:connected', {
          ...(data.payload || {}),
          username: assigned || data?.payload?.username || null,
        });
      }
      if (data.type === 'match:created') {
        dispatch('hexstrike:match', data.payload);
      }
      if (data.type === 'game:update') {
        dispatch('hexstrike:game', data.payload);
      }
      if (data.type === 'match:ended') {
        dispatch('hexstrike:match-ended', data.payload);
      }
      if (data.type === 'bot:error') {
        dispatch('hexstrike:bot-error', data.payload);
        const message = data?.payload?.message ? `${data.payload.message}` : 'Hex-Bot failed to act.';
        window.alert(message);
      }
    } catch (err) {
      console.warn('Failed to parse SSE message', err);
    }
  });

  window.addEventListener('beforeunload', () => {
    source.close();
  });
}
