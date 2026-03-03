const TIMING_ORDER = ['early', 'mid', 'late'];

const TIMING_PRIORITY_MAP = {
  early: 100,
  mid: 60,
  late: 20,
};

const DEFAULT_TIMING = ['mid'];
const OPEN_OR_UNTIMED_ACTIONS = new Set(['E', 'W', 'CO']);

export const getTimingOrder = () => [...TIMING_ORDER];

export const normalizeActionLabel = (action) => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

export const normalizeActionTiming = (value) => {
  if (!Array.isArray(value) || !value.length) return null;
  const normalized = new Set();
  value.forEach((item) => {
    const label = `${item ?? ''}`.trim().toLowerCase();
    if (label === 'early' || label === 'mid' || label === 'late') {
      normalized.add(label);
    }
  });
  if (!normalized.size) return null;
  return TIMING_ORDER.filter((item) => normalized.has(item));
};

export const resolveActionTiming = (action, timing) => {
  const label = normalizeActionLabel(action).toUpperCase();
  if (!label || OPEN_OR_UNTIMED_ACTIONS.has(label)) return null;
  return normalizeActionTiming(timing) ?? [...DEFAULT_TIMING];
};

export const normalizeCardTimings = (actions, rawTimings) => {
  const actionList = Array.isArray(actions) ? actions : [];
  const timingList = Array.isArray(rawTimings) ? rawTimings : [];
  return actionList.map((action, index) => resolveActionTiming(action, timingList[index]));
};

export const hasTimingPhase = (timing, phase) => Boolean(Array.isArray(timing) && timing.includes(phase));

export const getPrimaryTimingPhase = (timing) => (Array.isArray(timing) && timing.length ? timing[0] : null);

export const getTimingPriority = (timing) => {
  if (!Array.isArray(timing) || !timing.length) return 0;
  return timing.reduce((highest, item) => Math.max(highest, TIMING_PRIORITY_MAP[item] ?? 0), 0);
};

