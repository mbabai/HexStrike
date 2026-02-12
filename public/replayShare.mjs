const REPLAY_QUERY_KEY = 'replay';
const REPLAY_PAYLOAD_QUERY_KEY = 'rp';

const isObject = (value) => Boolean(value) && typeof value === 'object';

const toBase64Url = (value) => value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const fromBase64Url = (value) => {
  const normalized = `${value ?? ''}`.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  return normalized + '='.repeat(padLength);
};

const encodeUtf8ToBase64Url = (value) => {
  const bytes = new TextEncoder().encode(`${value ?? ''}`);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return toBase64Url(btoa(binary));
};

const decodeBase64UrlToUtf8 = (value) => {
  const binary = atob(fromBase64Url(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
};

export const normalizeReplayPayload = (replay) => {
  if (!isObject(replay)) return null;
  const state = isObject(replay.state) ? replay.state : null;
  if (!isObject(state?.public)) return null;
  return {
    id: `${replay.id ?? ''}`.trim() || null,
    sourceGameId: replay.sourceGameId ? `${replay.sourceGameId}` : null,
    sourceMatchId: replay.sourceMatchId ? `${replay.sourceMatchId}` : null,
    createdAt: replay.createdAt ? `${replay.createdAt}` : new Date().toISOString(),
    players: Array.isArray(replay.players) ? replay.players : [],
    state: {
      public: state.public,
    },
  };
};

export const encodeReplayPayload = (replay) => {
  const normalized = normalizeReplayPayload(replay);
  if (!normalized) return null;
  try {
    return encodeUtf8ToBase64Url(
      JSON.stringify({
        version: 1,
        replay: normalized,
      }),
    );
  } catch (err) {
    console.warn('Failed to encode replay payload', err);
    return null;
  }
};

export const decodeReplayPayload = (encoded) => {
  const raw = `${encoded ?? ''}`.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeBase64UrlToUtf8(raw));
    const replay = isObject(parsed?.replay) ? parsed.replay : parsed;
    return normalizeReplayPayload(replay);
  } catch (err) {
    console.warn('Failed to decode replay payload', err);
    return null;
  }
};

export const buildReplayShareUrl = (replay, options = {}) => {
  const normalized = normalizeReplayPayload(replay);
  if (!normalized) return null;
  const includePayload = options.includePayload !== false;
  const origin = options.origin || window.location.origin;
  const basePath = options.basePath || '/';
  const url = new URL(basePath, origin);
  if (normalized.id) {
    url.searchParams.set(REPLAY_QUERY_KEY, normalized.id);
  }
  if (includePayload) {
    const encoded = encodeReplayPayload(normalized);
    if (encoded) {
      url.hash = `${REPLAY_PAYLOAD_QUERY_KEY}=${encodeURIComponent(encoded)}`;
    }
  }
  return url.toString();
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

export const parseReplayLinkParams = (search = undefined, hash = undefined) => {
  const searchParams = parseParams(typeof search === 'string' ? search : getWindowLocationPart('search'));
  const hashParams = parseParams(typeof hash === 'string' ? hash : getWindowLocationPart('hash'));
  const replayId = `${searchParams.get(REPLAY_QUERY_KEY) ?? ''}`.trim() || null;
  const encodedPayload =
    `${hashParams.get(REPLAY_PAYLOAD_QUERY_KEY) ?? ''}`.trim() ||
    `${searchParams.get(REPLAY_PAYLOAD_QUERY_KEY) ?? ''}`.trim() ||
    null;
  const replay = encodedPayload ? decodeReplayPayload(encodedPayload) : null;
  return { replayId, replay };
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
  const text = `${value ?? ''}`;
  if (!text) {
    throw new Error('Nothing to copy');
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  await copyTextFallback(text);
};
