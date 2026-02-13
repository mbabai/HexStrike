const HISTORY_QUERY_KEY = 'g';
const HISTORY_QUERY_KEY_LEGACY = 'r';
const HISTORY_QUERY_KEY_LEGACY_ALT = 'replay';

const isObject = (value) => Boolean(value) && typeof value === 'object';

const firstNonEmpty = (...values) => {
  for (const value of values) {
    const normalized = `${value ?? ''}`.trim();
    if (normalized) return normalized;
  }
  return null;
};

const parseParams = (value) => {
  const raw = `${value ?? ''}`.trim();
  if (!raw) return new URLSearchParams();
  if (raw.startsWith('?') || raw.startsWith('#')) {
    return new URLSearchParams(raw.slice(1));
  }
  return new URLSearchParams(raw);
};

const getWindowLocationPart = (part) => {
  if (typeof window === 'undefined' || !window.location) return '';
  return `${window.location[part] ?? ''}`;
};

const normalizeReplayId = (value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (isObject(value) && typeof value.id === 'string') {
    const trimmed = value.id.trim();
    return trimmed || null;
  }
  return null;
};

export const normalizeReplayPayload = (replay) => {
  if (!isObject(replay)) return null;
  const state = isObject(replay.state) ? replay.state : null;
  if (!isObject(state?.public)) return null;
  const id = normalizeReplayId(replay);
  return {
    id,
    sourceGameId: replay.sourceGameId ? `${replay.sourceGameId}` : null,
    sourceMatchId: replay.sourceMatchId ? `${replay.sourceMatchId}` : null,
    createdAt: replay.createdAt ? `${replay.createdAt}` : new Date().toISOString(),
    players: Array.isArray(replay.players) ? replay.players : [],
    state: {
      public: state.public,
    },
  };
};

export const buildReplayShareUrl = (replayOrId, options = {}) => {
  const replayId = normalizeReplayId(replayOrId);
  if (!replayId) return null;
  const origin = options.origin || window.location.origin;
  const basePath = options.basePath || '/';
  const url = new URL(basePath, origin);
  url.searchParams.set(HISTORY_QUERY_KEY, replayId);
  return url.toString();
};

export const parseReplayLinkParams = (search = undefined) => {
  const rawSearch = typeof search === 'string' ? search : getWindowLocationPart('search');
  const searchParams = parseParams(rawSearch);
  const replayId = firstNonEmpty(
    searchParams.get(HISTORY_QUERY_KEY),
    searchParams.get(HISTORY_QUERY_KEY_LEGACY),
    searchParams.get(HISTORY_QUERY_KEY_LEGACY_ALT),
  );
  return { replayId, replay: null };
};

const copyTextFallback = async (value) => {
  const input = document.createElement('textarea');
  input.value = value;
  input.style.position = 'fixed';
  input.style.top = '-1000px';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.focus();
  input.select();
  const didCopy = document.execCommand('copy');
  input.remove();
  if (!didCopy) {
    throw new Error('Clipboard unavailable');
  }
};

export const copyTextToClipboard = async (value) => {
  const text = `${value ?? ''}`.trim();
  if (!text) {
    throw new Error('Nothing to copy');
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  await copyTextFallback(text);
};

