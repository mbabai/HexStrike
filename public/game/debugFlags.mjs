const getRuntimeDebugFlag = () => {
  try {
    const runtimeFlag = globalThis?.window?.__HEXSTRIKE_DIAG__;
    return typeof runtimeFlag === 'boolean' ? runtimeFlag : null;
  } catch {
    return null;
  }
};

const getStoredDebugFlag = () => {
  try {
    const storedFlag = globalThis?.window?.localStorage?.getItem?.('hexstrike:diag');
    if (storedFlag === '1') return true;
    if (storedFlag === '0') return false;
  } catch {
    // Ignore storage access failures; diagnostics remain disabled.
  }
  return null;
};

const parseBeatFilter = (value) => {
  if (value == null || `${value}`.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
};

export const isDebugLoggingEnabled = () => {
  const runtimeFlag = getRuntimeDebugFlag();
  if (runtimeFlag != null) return runtimeFlag;
  const storedFlag = getStoredDebugFlag();
  if (storedFlag != null) return storedFlag;
  return false;
};

export const getDebugBeatFilter = () => {
  try {
    const runtimeValue = globalThis?.window?.__HEXSTRIKE_DIAG_BEAT__;
    const runtimeFilter = parseBeatFilter(runtimeValue);
    if (runtimeFilter != null) return runtimeFilter;
    const storedValue = globalThis?.window?.localStorage?.getItem?.('hexstrike:diag:beat');
    return parseBeatFilter(storedValue);
  } catch {
    return null;
  }
};

export const createDebugLogger = (prefix = null) => (...args) => {
  if (!isDebugLoggingEnabled()) return;
  if (prefix) {
    console.log(prefix, ...args);
    return;
  }
  console.log(...args);
};

export const createDebugWarnLogger = (prefix = null) => (...args) => {
  if (!isDebugLoggingEnabled()) return;
  if (prefix) {
    console.warn(prefix, ...args);
    return;
  }
  console.warn(...args);
};
