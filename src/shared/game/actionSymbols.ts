export const DEFAULT_OPEN_ACTION = 'E';
export const SIGNATURE_REFRESH_ACTION = 'SigE';
export const FOCUS_ACTION = 'F';
export const WAIT_ACTION = 'W';
export const COMBO_ACTION = 'Co';

export const normalizeActionLabel = (action: unknown): string => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

export const isRefreshActionLabel = (label: unknown): boolean => {
  const normalized = normalizeActionLabel(label).toUpperCase();
  return normalized === DEFAULT_OPEN_ACTION || normalized === SIGNATURE_REFRESH_ACTION.toUpperCase();
};

export const isSignatureRefreshActionLabel = (label: unknown): boolean =>
  normalizeActionLabel(label).toUpperCase() === SIGNATURE_REFRESH_ACTION.toUpperCase();

export const isOpenBeatActionLabel = (label: unknown): boolean => {
  const normalized = normalizeActionLabel(label).toUpperCase();
  return isRefreshActionLabel(normalized) || normalized === FOCUS_ACTION;
};
