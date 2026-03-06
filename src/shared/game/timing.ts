import type { ActionTiming } from '../../types';

const TIMING_ORDER: ActionTiming[] = ['early', 'mid', 'late'];

const TIMING_PRIORITY_MAP: Record<ActionTiming, number> = {
  early: 100,
  mid: 60,
  late: 20,
};

const DEFAULT_TIMING: ActionTiming[] = ['mid'];
const OPEN_OR_UNTIMED_ACTIONS = new Set(['E', 'W', 'CO']);
const ADRENALINE_UTILITY_ACTION_PATTERN = /^ADR[+-]\d+$/i;

const isUntimedActionLabel = (label: string): boolean =>
  OPEN_OR_UNTIMED_ACTIONS.has(label) || ADRENALINE_UTILITY_ACTION_PATTERN.test(label);

export const getTimingOrder = (): ActionTiming[] => TIMING_ORDER.slice();

export const normalizeActionLabel = (action: unknown): string => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

export const normalizeActionTiming = (value: unknown): ActionTiming[] | null => {
  if (!Array.isArray(value) || !value.length) return null;
  const normalized = new Set<ActionTiming>();
  value.forEach((item) => {
    const label = `${item ?? ''}`.trim().toLowerCase();
    if (label === 'early' || label === 'mid' || label === 'late') {
      normalized.add(label);
    }
  });
  if (!normalized.size) return null;
  return TIMING_ORDER.filter((item) => normalized.has(item));
};

export const resolveActionTiming = (action: unknown, timing: unknown): ActionTiming[] | null => {
  const label = normalizeActionLabel(action).toUpperCase();
  if (!label || isUntimedActionLabel(label)) return null;
  return normalizeActionTiming(timing) ?? DEFAULT_TIMING;
};

export const normalizeCardTimings = (actions: unknown, rawTimings: unknown): Array<ActionTiming[] | null> => {
  const actionList = Array.isArray(actions) ? actions : [];
  const timingList = Array.isArray(rawTimings) ? rawTimings : [];
  return actionList.map((action, index) => resolveActionTiming(action, timingList[index]));
};

export const hasTimingPhase = (timing: ActionTiming[] | null | undefined, phase: ActionTiming): boolean =>
  Boolean(timing && timing.includes(phase));

export const getPrimaryTimingPhase = (timing: ActionTiming[] | null | undefined): ActionTiming | null =>
  timing?.length ? timing[0] : null;

export const getTimingPriority = (timing: ActionTiming[] | null | undefined): number => {
  if (!timing || !timing.length) return 0;
  return timing.reduce((highest, item) => Math.max(highest, TIMING_PRIORITY_MAP[item] ?? 0), 0);
};
