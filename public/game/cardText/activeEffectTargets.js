import { isBracketedAction } from './actionListTransforms.js';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeSymbol = (value) => `${value ?? ''}`.trim().toUpperCase();

const entryHasTextBody = (entry) => Boolean(typeof entry?.text === 'string' && entry.text.trim());

const entryMatchesSymbol = (entry, symbol) => {
  if (!entry) return false;
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return false;
  const placeholder = normalizeSymbol(entry.placeholder ?? '');
  if (placeholder && placeholder === normalized) return true;
  if (!entryHasTextBody(entry)) return false;
  const pattern = new RegExp(`\\{\\s*${escapeRegExp(normalized)}\\s*\\}`, 'i');
  return pattern.test(entry.text);
};

export const getLegacySymbolActionIndices = (actions, symbol) => {
  if (normalizeSymbol(symbol) === 'I') {
    const indices = [];
    (actions ?? []).forEach((action, index) => {
      if (isBracketedAction(action)) indices.push(index);
    });
    return indices;
  }
  return [];
};

const getPlaceholderActionIndices = (actionList, symbol) => {
  const indices = [];
  (actionList ?? []).forEach((entry, index) => {
    if (!Array.isArray(entry?.textEntries) || !entry.textEntries.length) return;
    if (entry.textEntries.some((textEntry) => entryMatchesSymbol(textEntry, symbol))) {
      indices.push(index);
    }
  });
  return indices;
};

const getTextAnnotatedActionIndices = (actionList) => {
  const indices = [];
  (actionList ?? []).forEach((entry, index) => {
    if (!Array.isArray(entry?.textEntries) || !entry.textEntries.length) return;
    if (entry.textEntries.some((textEntry) => entryHasTextBody(textEntry))) {
      indices.push(index);
    }
  });
  return indices;
};

export const getActiveEffectTargetIndices = (actionList, card, symbol, options = {}) => {
  const byPlaceholder = getPlaceholderActionIndices(actionList, symbol);
  if (byPlaceholder.length) return byPlaceholder;
  const byLegacy = getLegacySymbolActionIndices(Array.isArray(card?.actions) ? card.actions : [], symbol);
  if (byLegacy.length) return byLegacy;
  if (options.fallbackToTextEntries) {
    return getTextAnnotatedActionIndices(actionList);
  }
  return [];
};
