export const isBracketedAction = (action) => {
  const trimmed = `${action ?? ''}`.trim();
  return Boolean(trimmed) && trimmed.startsWith('[') && trimmed.endsWith(']');
};

export const normalizeActionToken = (token) => {
  const trimmed = `${token ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

export const splitActionTokens = (action) =>
  normalizeActionToken(`${action ?? ''}`.trim())
    .split('-')
    .map((token) => normalizeActionToken(token))
    .filter(Boolean);

export const actionHasAttackToken = (action) => {
  if (!action) return false;
  return splitActionTokens(action).some((token) => token.toLowerCase().includes('a'));
};

export const mapActionList = (actionList, mapper) => {
  let changed = false;
  const next = actionList.map((entry, index) => {
    const updated = mapper(entry, index);
    if (updated !== entry) changed = true;
    return updated;
  });
  return changed ? next : actionList;
};

export const updateActionEntries = (actionList, indices, updater) => {
  if (!indices.length) return actionList;
  const indexSet = new Set(indices);
  return mapActionList(actionList, (entry, index) => {
    if (!indexSet.has(index)) return entry;
    return updater(entry, index);
  });
};

export const removeActionAtIndex = (actionList, index) => {
  if (!Number.isFinite(index) || index < 0 || index >= actionList.length) return actionList;
  return actionList.filter((_, listIndex) => listIndex !== index);
};

export const insertActionAtIndex = (actionList, index, entries) => {
  const items = Array.isArray(entries) ? entries : [entries];
  if (!items.length) return actionList;
  const safeIndex = Math.max(0, Math.min(Math.floor(index), actionList.length));
  return [...actionList.slice(0, safeIndex), ...items, ...actionList.slice(safeIndex)];
};

export const patchActionEntry = (entry, patch) => {
  let next = null;
  Object.keys(patch).forEach((key) => {
    const value = patch[key];
    if (Object.is(entry[key], value)) return;
    if (!next) next = { ...entry };
    next[key] = value;
  });
  return next ?? entry;
};
