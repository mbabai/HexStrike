const USER_ID_KEY = 'hexstrikeUserId';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const readCookie = (key) => {
  const value = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${key}=`));
  if (!value) return null;
  return decodeURIComponent(value.split('=')[1]);
};

const writeCookie = (key, value) => {
  document.cookie = `${key}=${encodeURIComponent(value)}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
};

export function getOrCreateUserId() {
  const stored = readCookie(USER_ID_KEY);
  if (stored) return stored;
  const generated = window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `user-${Math.random().toString(16).slice(2)}-${Date.now()}`;
  writeCookie(USER_ID_KEY, generated);
  return generated;
}
