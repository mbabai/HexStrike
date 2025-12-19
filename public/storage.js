const USER_ID_KEY = 'hexstrikeUserId';

export function getOrCreateUserId() {
  const stored = window.localStorage.getItem(USER_ID_KEY);
  if (stored) return stored;
  const generated = window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `user-${Math.random().toString(16).slice(2)}-${Date.now()}`;
  window.localStorage.setItem(USER_ID_KEY, generated);
  return generated;
}
