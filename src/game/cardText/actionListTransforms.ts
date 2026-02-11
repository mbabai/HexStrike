import { ActionListItem } from '../../types';

export const isBracketedAction = (action: string): boolean => {
  const trimmed = `${action ?? ''}`.trim();
  return Boolean(trimmed) && trimmed.startsWith('[') && trimmed.endsWith(']');
};

export const normalizeActionToken = (token: string): string => {
  const trimmed = `${token ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

export const splitActionTokens = (action: string): string[] =>
  normalizeActionToken(`${action ?? ''}`.trim())
    .split('-')
    .map((token) => normalizeActionToken(token))
    .filter(Boolean);

export const actionHasAttackToken = (action: string): boolean => {
  if (!action) return false;
  return splitActionTokens(action).some((token) => token.toLowerCase().includes('a'));
};

export const mapActionList = (
  actionList: ActionListItem[],
  mapper: (entry: ActionListItem, index: number) => ActionListItem,
): ActionListItem[] => {
  let changed = false;
  const next = actionList.map((entry, index) => {
    const updated = mapper(entry, index);
    if (updated !== entry) changed = true;
    return updated;
  });
  return changed ? next : actionList;
};

export const updateActionEntries = (
  actionList: ActionListItem[],
  indices: number[],
  updater: (entry: ActionListItem, index: number) => ActionListItem,
): ActionListItem[] => {
  if (!indices.length) return actionList;
  const indexSet = new Set(indices);
  return mapActionList(actionList, (entry, index) => {
    if (!indexSet.has(index)) return entry;
    return updater(entry, index);
  });
};

export const removeActionAtIndex = (actionList: ActionListItem[], index: number): ActionListItem[] => {
  if (!Number.isFinite(index) || index < 0 || index >= actionList.length) return actionList;
  return actionList.filter((_, listIndex) => listIndex !== index);
};

export const insertActionAtIndex = (
  actionList: ActionListItem[],
  index: number,
  entries: ActionListItem[] | ActionListItem,
): ActionListItem[] => {
  const items = Array.isArray(entries) ? entries : [entries];
  if (!items.length) return actionList;
  const safeIndex = Math.max(0, Math.min(Math.floor(index), actionList.length));
  return [...actionList.slice(0, safeIndex), ...items, ...actionList.slice(safeIndex)];
};

export const patchActionEntry = (entry: ActionListItem, patch: Partial<ActionListItem>): ActionListItem => {
  let updated = entry;
  let changed = false;
  Object.keys(patch).forEach((key) => {
    const typedKey = key as keyof ActionListItem;
    const value = patch[typedKey];
    if (Object.is(entry[typedKey], value)) return;
    if (!changed) {
      updated = { ...entry };
      changed = true;
    }
    const updatedEntry = updated as Record<keyof ActionListItem, ActionListItem[keyof ActionListItem]>;
    updatedEntry[typedKey] = value as ActionListItem[keyof ActionListItem];
  });
  return updated;
};
