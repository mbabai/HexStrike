import { ActionListItem, CardDefinition } from '../../types';
import { isBracketedAction } from './actionListTransforms';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeSymbol = (value: string): string => `${value ?? ''}`.trim().toUpperCase();

const entryHasTextBody = (entry: { text?: string } | null | undefined): boolean =>
  Boolean(typeof entry?.text === 'string' && entry.text.trim());

const entryMatchesSymbol = (
  entry: { placeholder?: string; text?: string } | null | undefined,
  symbol: string,
): boolean => {
  if (!entry) return false;
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return false;
  const placeholder = normalizeSymbol(entry.placeholder ?? '');
  if (placeholder && placeholder === normalized) return true;
  if (!entryHasTextBody(entry)) return false;
  const pattern = new RegExp(`\\{\\s*${escapeRegExp(normalized)}\\s*\\}`, 'i');
  return pattern.test(entry.text as string);
};

export const getLegacySymbolActionIndices = (actions: string[], symbol: string): number[] => {
  if (normalizeSymbol(symbol) === 'I') {
    const indices: number[] = [];
    actions.forEach((action, index) => {
      if (isBracketedAction(action)) indices.push(index);
    });
    return indices;
  }
  return [];
};

const getPlaceholderActionIndices = (actionList: ActionListItem[], symbol: string): number[] => {
  const indices: number[] = [];
  actionList.forEach((entry, index) => {
    if (!Array.isArray(entry?.textEntries) || !entry.textEntries.length) return;
    if (entry.textEntries.some((textEntry) => entryMatchesSymbol(textEntry, symbol))) {
      indices.push(index);
    }
  });
  return indices;
};

const getTextAnnotatedActionIndices = (actionList: ActionListItem[]): number[] => {
  const indices: number[] = [];
  actionList.forEach((entry, index) => {
    if (!Array.isArray(entry?.textEntries) || !entry.textEntries.length) return;
    if (entry.textEntries.some((textEntry) => entryHasTextBody(textEntry))) {
      indices.push(index);
    }
  });
  return indices;
};

export const getActiveEffectTargetIndices = (
  actionList: ActionListItem[],
  card: CardDefinition,
  symbol: string,
  options: { fallbackToTextEntries?: boolean } = {},
): number[] => {
  const byPlaceholder = getPlaceholderActionIndices(actionList, symbol);
  if (byPlaceholder.length) return byPlaceholder;
  const byLegacy = getLegacySymbolActionIndices(Array.isArray(card?.actions) ? card.actions : [], symbol);
  if (byLegacy.length) return byLegacy;
  if (options.fallbackToTextEntries) {
    return getTextAnnotatedActionIndices(actionList);
  }
  return [];
};
