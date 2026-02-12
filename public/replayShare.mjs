const REPLAY_QUERY_KEY = 'r';
const REPLAY_QUERY_KEY_LEGACY = 'replay';
const REPLAY_PAYLOAD_QUERY_KEY = 'p';
const REPLAY_PAYLOAD_QUERY_KEY_LEGACY = 'rp';

const COMPRESSED_PAYLOAD_PREFIX = 'z.';
const COMPRESSED_PAYLOAD_PATTERN = /^[A-Za-z0-9\-_]+$/;

const LZ_BASE64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LZ_BASE64URL_LOOKUP = (() => {
  const lookup = Object.create(null);
  for (let index = 0; index < LZ_BASE64URL_CHARS.length; index += 1) {
    lookup[LZ_BASE64URL_CHARS.charAt(index)] = index;
  }
  return lookup;
})();

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

const lzCompressInternal = (uncompressed, bitsPerChar, getCharFromInt) => {
  if (uncompressed == null) return '';
  const input = `${uncompressed}`;
  if (!input) return '';

  const dictionary = Object.create(null);
  const dictionaryToCreate = Object.create(null);
  let w = '';
  let c = '';
  let wc = '';
  let dictSize = 3;
  let numBits = 2;
  let enlargeIn = 2;
  const data = [];
  let dataVal = 0;
  let dataPosition = 0;

  const writeBit = (bit) => {
    dataVal = (dataVal << 1) | bit;
    if (dataPosition === bitsPerChar - 1) {
      dataPosition = 0;
      data.push(getCharFromInt(dataVal));
      dataVal = 0;
      return;
    }
    dataPosition += 1;
  };

  const writeBits = (count, sourceValue) => {
    let value = sourceValue;
    for (let bit = 0; bit < count; bit += 1) {
      writeBit(value & 1);
      value >>= 1;
    }
  };

  const writeWord = (word) => {
    if (dictionaryToCreate[word]) {
      const charCode = word.charCodeAt(0);
      if (charCode < 256) {
        writeBits(numBits, 0);
        writeBits(8, charCode);
      } else {
        writeBits(numBits, 1);
        writeBits(16, charCode);
      }
      enlargeIn -= 1;
      if (enlargeIn === 0) {
        enlargeIn = 2 ** numBits;
        numBits += 1;
      }
      delete dictionaryToCreate[word];
      return;
    }
    writeBits(numBits, dictionary[word]);
  };

  for (let index = 0; index < input.length; index += 1) {
    c = input.charAt(index);
    if (dictionary[c] === undefined) {
      dictionary[c] = dictSize;
      dictSize += 1;
      dictionaryToCreate[c] = true;
    }
    wc = `${w}${c}`;
    if (dictionary[wc] !== undefined) {
      w = wc;
      continue;
    }

    writeWord(w);

    enlargeIn -= 1;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits += 1;
    }

    dictionary[wc] = dictSize;
    dictSize += 1;
    w = `${c}`;
  }

  if (w !== '') {
    writeWord(w);
    enlargeIn -= 1;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits += 1;
    }
  }

  writeBits(numBits, 2);

  while (true) {
    dataVal <<= 1;
    if (dataPosition === bitsPerChar - 1) {
      data.push(getCharFromInt(dataVal));
      break;
    }
    dataPosition += 1;
  }

  return data.join('');
};

const lzDecompressInternal = (length, resetValue, getNextValue) => {
  if (length === 0) return '';

  const dictionary = [];
  const result = [];
  const data = {
    value: getNextValue(0),
    position: resetValue,
    index: 1,
  };
  let enlargeIn = 4;
  let dictSize = 4;
  let numBits = 3;
  let entry = '';
  let w = '';

  const readBits = (count) => {
    let bits = 0;
    let power = 1;
    const maxPower = 2 ** count;
    while (power !== maxPower) {
      const bit = data.value & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = resetValue;
        data.value = getNextValue(data.index);
        data.index += 1;
      }
      if (bit > 0) {
        bits |= power;
      }
      power <<= 1;
    }
    return bits;
  };

  for (let index = 0; index < 3; index += 1) {
    dictionary[index] = index;
  }

  const next = readBits(2);
  let c;
  switch (next) {
    case 0:
      c = String.fromCharCode(readBits(8));
      break;
    case 1:
      c = String.fromCharCode(readBits(16));
      break;
    case 2:
      return '';
    default:
      return null;
  }

  dictionary[3] = c;
  w = c;
  result.push(c);

  while (true) {
    if (data.index > length) return null;

    let code = readBits(numBits);
    if (code === 0) {
      dictionary[dictSize] = String.fromCharCode(readBits(8));
      code = dictSize;
      dictSize += 1;
      enlargeIn -= 1;
    } else if (code === 1) {
      dictionary[dictSize] = String.fromCharCode(readBits(16));
      code = dictSize;
      dictSize += 1;
      enlargeIn -= 1;
    } else if (code === 2) {
      return result.join('');
    }

    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits += 1;
    }

    if (dictionary[code] !== undefined) {
      entry = dictionary[code];
    } else if (code === dictSize) {
      entry = `${w}${w.charAt(0)}`;
    } else {
      return null;
    }

    result.push(entry);
    dictionary[dictSize] = `${w}${entry.charAt(0)}`;
    dictSize += 1;
    enlargeIn -= 1;
    w = entry;

    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits += 1;
    }
  }
};

const compressJsonForLink = (json) =>
  lzCompressInternal(json, 6, (value) => LZ_BASE64URL_CHARS.charAt(value));

const decompressJsonFromLink = (value) => {
  const compressed = `${value ?? ''}`.trim();
  if (!compressed || !COMPRESSED_PAYLOAD_PATTERN.test(compressed)) return null;
  const decoded = lzDecompressInternal(compressed.length, 32, (index) => {
    const current = compressed.charAt(index);
    return LZ_BASE64URL_LOOKUP[current];
  });
  return typeof decoded === 'string' ? decoded : null;
};

const packReplayPayload = (normalizedReplay) => {
  const packed = {
    v: 2,
    s: normalizedReplay.state.public,
  };
  if (normalizedReplay.id) packed.i = normalizedReplay.id;
  if (normalizedReplay.sourceGameId) packed.g = normalizedReplay.sourceGameId;
  if (normalizedReplay.sourceMatchId) packed.m = normalizedReplay.sourceMatchId;
  if (normalizedReplay.createdAt) packed.c = normalizedReplay.createdAt;
  if (Array.isArray(normalizedReplay.players) && normalizedReplay.players.length) {
    packed.p = normalizedReplay.players;
  }
  return packed;
};

const unpackReplayPayload = (packedReplay) => {
  if (!isObject(packedReplay) || !isObject(packedReplay.s)) return null;
  return normalizeReplayPayload({
    id: packedReplay.i ? `${packedReplay.i}` : null,
    sourceGameId: packedReplay.g ? `${packedReplay.g}` : null,
    sourceMatchId: packedReplay.m ? `${packedReplay.m}` : null,
    createdAt: packedReplay.c ? `${packedReplay.c}` : undefined,
    players: Array.isArray(packedReplay.p) ? packedReplay.p : [],
    state: {
      public: packedReplay.s,
    },
  });
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

const encodeReplayPayloadLegacy = (normalized) =>
  encodeUtf8ToBase64Url(
    JSON.stringify({
      version: 1,
      replay: normalized,
    }),
  );

const decodeReplayPayloadLegacy = (raw) => {
  const parsed = JSON.parse(decodeBase64UrlToUtf8(raw));
  const replay = isObject(parsed?.replay) ? parsed.replay : parsed;
  return normalizeReplayPayload(replay);
};

export const encodeReplayPayload = (replay) => {
  const normalized = normalizeReplayPayload(replay);
  if (!normalized) return null;
  try {
    const packed = packReplayPayload(normalized);
    const compressed = compressJsonForLink(JSON.stringify(packed));
    if (compressed) {
      return `${COMPRESSED_PAYLOAD_PREFIX}${compressed}`;
    }
  } catch (err) {
    console.warn('Failed to encode compressed replay payload', err);
  }
  try {
    return encodeReplayPayloadLegacy(normalized);
  } catch (err) {
    console.warn('Failed to encode replay payload', err);
    return null;
  }
};

const decodeCompressedReplayPayload = (rawPayload) => {
  const compressed = `${rawPayload ?? ''}`.trim();
  if (!compressed) return null;
  const json = decompressJsonFromLink(compressed);
  if (!json) return null;
  const parsed = JSON.parse(json);
  if (isObject(parsed?.replay)) {
    return normalizeReplayPayload(parsed.replay);
  }
  return unpackReplayPayload(parsed);
};

export const decodeReplayPayload = (encoded) => {
  const raw = `${encoded ?? ''}`.trim();
  if (!raw) return null;

  const compressedCandidates = [];
  if (raw.startsWith(COMPRESSED_PAYLOAD_PREFIX)) {
    compressedCandidates.push(raw.slice(COMPRESSED_PAYLOAD_PREFIX.length));
  } else if (!raw.includes('.')) {
    compressedCandidates.push(raw);
  }
  for (const candidate of compressedCandidates) {
    try {
      const replay = decodeCompressedReplayPayload(candidate);
      if (replay) return replay;
    } catch (err) {
      console.warn('Failed to decode compressed replay payload', err);
    }
  }

  try {
    return decodeReplayPayloadLegacy(raw);
  } catch (err) {
    console.warn('Failed to decode replay payload', err);
    return null;
  }
};

const firstNonEmpty = (...values) => {
  for (const value of values) {
    const normalized = `${value ?? ''}`.trim();
    if (normalized) return normalized;
  }
  return null;
};

export const buildReplayShareUrl = (replay, options = {}) => {
  const normalized = normalizeReplayPayload(replay);
  if (!normalized) return null;
  const includePayloadOption = options.includePayload;
  const includePayload =
    includePayloadOption === true || (includePayloadOption !== false && !normalized.id);
  const origin = options.origin || window.location.origin;
  const basePath = options.basePath || '/';
  const url = new URL(basePath, origin);
  if (normalized.id) {
    url.searchParams.set(REPLAY_QUERY_KEY, normalized.id);
  }
  if (includePayload) {
    const encoded = encodeReplayPayload(normalized);
    if (encoded) {
      url.hash = encoded;
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

const extractReplayPayloadFromHash = (hash) => {
  const raw = `${hash ?? ''}`.trim();
  if (!raw) return null;
  const stripped = raw.startsWith('#') ? raw.slice(1) : raw;
  if (!stripped) return null;
  if (!stripped.includes('=') && !stripped.includes('&')) {
    return stripped;
  }
  const hashParams = parseParams(stripped);
  return firstNonEmpty(
    hashParams.get(REPLAY_PAYLOAD_QUERY_KEY),
    hashParams.get(REPLAY_PAYLOAD_QUERY_KEY_LEGACY),
  );
};

const getWindowLocationPart = (part) => {
  if (typeof window === 'undefined' || !window.location) return '';
  return `${window.location[part] ?? ''}`;
};

export const parseReplayLinkParams = (search = undefined, hash = undefined) => {
  const rawSearch = typeof search === 'string' ? search : getWindowLocationPart('search');
  const rawHash = typeof hash === 'string' ? hash : getWindowLocationPart('hash');
  const searchParams = parseParams(rawSearch);
  const replayId = firstNonEmpty(
    searchParams.get(REPLAY_QUERY_KEY),
    searchParams.get(REPLAY_QUERY_KEY_LEGACY),
  );
  const encodedPayload = firstNonEmpty(
    extractReplayPayloadFromHash(rawHash),
    searchParams.get(REPLAY_PAYLOAD_QUERY_KEY),
    searchParams.get(REPLAY_PAYLOAD_QUERY_KEY_LEGACY),
  );
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
