const USER_ID_KEY = 'hexstrikeUserId';
const SELECTED_DECK_KEY = 'hexstrikeSelectedDeckId';
const USERNAME_KEY = 'hexstrikeUsername';
const USERNAME_CUSTOM_KEY = 'hexstrikeUsernameCustom';
const ACCOUNT_DECKS_KEY = 'hexstrikeAccountDecks';
const TIMELINE_SPEED_KEY = 'hexstrikeTimelineSpeed';
const USERNAME_MAX_LENGTH = 24;
const ANONYMOUS_NAME_PATTERN = /^anonymous\d+$/i;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const readCookie = (key) => {
  const value = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${key}=`));
  if (!value) return null;
  return decodeURIComponent(value.split('=')[1]);
};

const writeCookie = (key, value, maxAgeSeconds = COOKIE_MAX_AGE_SECONDS) => {
  document.cookie = `${key}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax`;
};

const clearCookie = (key) => {
  writeCookie(key, '', 0);
};

const normalizeUsername = (value) => {
  const trimmed = `${value ?? ''}`.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\s+/g, ' ').slice(0, USERNAME_MAX_LENGTH);
};

const readJsonCookie = (key) => {
  const raw = readCookie(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`Failed to parse ${key} cookie`, err);
    return null;
  }
};

const writeJsonCookie = (key, value) => {
  try {
    writeCookie(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`Failed to serialize ${key} cookie`, err);
  }
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

export const getSelectedDeckId = () => readCookie(SELECTED_DECK_KEY);

export const setSelectedDeckId = (deckId) => {
  if (!deckId) return;
  writeCookie(SELECTED_DECK_KEY, deckId);
};

export const clearSelectedDeckId = () => {
  clearCookie(SELECTED_DECK_KEY);
};

export const getStoredUsername = () => {
  const value = readCookie(USERNAME_KEY);
  const normalized = normalizeUsername(value);
  return normalized || null;
};

export const isDefaultAnonymousName = (username) => ANONYMOUS_NAME_PATTERN.test(`${username ?? ''}`.trim());

export const isUsernameCustom = () => {
  const marker = readCookie(USERNAME_CUSTOM_KEY);
  if (marker === '1') return true;
  if (marker === '0') return false;
  const username = getStoredUsername();
  if (!username) return false;
  return !isDefaultAnonymousName(username);
};

export const setStoredUsername = (username, options = {}) => {
  const custom = typeof options.custom === 'boolean' ? options.custom : undefined;
  const normalized = normalizeUsername(username);
  if (!normalized) {
    clearCookie(USERNAME_KEY);
    clearCookie(USERNAME_CUSTOM_KEY);
    return null;
  }
  writeCookie(USERNAME_KEY, normalized);
  if (typeof custom === 'boolean') {
    writeCookie(USERNAME_CUSTOM_KEY, custom ? '1' : '0');
  }
  return normalized;
};

export const getPreferredServerUsername = () => {
  const username = getStoredUsername();
  if (!username) return null;
  return isUsernameCustom() ? username : null;
};

export const getStoredCustomDecks = () => {
  const parsed = readJsonCookie(ACCOUNT_DECKS_KEY);
  return Array.isArray(parsed) ? parsed : null;
};

export const setStoredCustomDecks = (decks) => {
  writeJsonCookie(ACCOUNT_DECKS_KEY, Array.isArray(decks) ? decks : []);
};

const clampTimelineSpeed = (value) => {
  const parsed = Number.parseFloat(`${value ?? ''}`);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(3, Math.max(1, parsed));
};

export const getTimelineSpeedPreference = () => {
  const stored = readCookie(TIMELINE_SPEED_KEY);
  return clampTimelineSpeed(stored);
};

export const setTimelineSpeedPreference = (speed) => {
  const normalized = clampTimelineSpeed(speed);
  if (normalized === null) return null;
  writeCookie(TIMELINE_SPEED_KEY, `${normalized}`);
  return normalized;
};
