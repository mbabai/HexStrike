import { isBracketedAction, patchActionEntry, updateActionEntries } from './actionListTransforms.js';

const getBracketedActionIndices = (actions) => {
  const indices = [];
  (actions ?? []).forEach((action, index) => {
    if (isBracketedAction(action)) {
      indices.push(index);
    }
  });
  return indices;
};

const getSymbolActionIndices = (actions, symbol) => {
  if (symbol === 'i') {
    return getBracketedActionIndices(actions);
  }
  return [];
};

const applyRotationAfterIndex = (actionList, index, rotation) => {
  if (!rotation || !Number.isFinite(index) || index < 0 || index >= actionList.length) return actionList;
  const cleared = updateActionEntries(actionList, [0], (entry) => {
    if (!entry?.rotation) return entry;
    return patchActionEntry(entry, { rotation: '' });
  });
  return updateActionEntries(cleared, [index], (entry) => {
    if (!entry) return entry;
    return patchActionEntry(entry, { rotation, rotationSource: 'forced' });
  });
};

const applyCounterAttackActiveText = (actionList, card, rotationLabel) => {
  const indices = getSymbolActionIndices(card?.actions ?? [], 'i');
  const targetIndex = indices.length ? indices[0] + 1 : null;
  if (targetIndex == null) return actionList;
  return applyRotationAfterIndex(actionList, targetIndex, rotationLabel);
};

const ACTIVE_ABILITY_EFFECTS = new Map([['counter-attack', applyCounterAttackActiveText]]);

export const applyActiveAbilityCardText = (actionList, card, rotationLabel) => {
  if (!card || card.type !== 'ability') return actionList;
  const handler = ACTIVE_ABILITY_EFFECTS.get(card.id);
  if (!handler) return actionList;
  return handler(actionList, card, rotationLabel);
};
