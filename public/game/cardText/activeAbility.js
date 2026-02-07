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

const applyRotationAfterIndex = (actionList, index, rotation, options = {}) => {
  if (!rotation || !Number.isFinite(index) || index < 0 || index >= actionList.length) return actionList;
  const { clearStartRotation = true } = options;
  const base = clearStartRotation
    ? updateActionEntries(actionList, [0], (entry) => {
        if (!entry?.rotation) return entry;
        return patchActionEntry(entry, { rotation: '' });
      })
    : actionList;
  return updateActionEntries(base, [index], (entry) => {
    if (!entry) return entry;
    return patchActionEntry(entry, { rotation, rotationSource: 'forced' });
  });
};

const applyCounterAttackActiveText = (actionList) => actionList;

const applyAerialStrikeActiveText = (actionList, card) => {
  const indices = getSymbolActionIndices(card?.actions ?? [], 'i');
  const targetIndex = indices.length ? indices[0] + 1 : null;
  if (targetIndex == null) return actionList;
  return applyRotationAfterIndex(actionList, targetIndex, '3', { clearStartRotation: false });
};

const applyWhirlwindActiveText = (actionList, card) => {
  const indices = getSymbolActionIndices(card?.actions ?? [], 'i');
  if (!indices.length) return actionList;
  return updateActionEntries(actionList, indices, (entry) => {
    if (!entry) return entry;
    return patchActionEntry(entry, { kbf: 3 });
  });
};

const ACTIVE_ABILITY_EFFECTS = new Map([
  ['counter-attack', applyCounterAttackActiveText],
  ['aerial-strike', applyAerialStrikeActiveText],
  ['whirlwind', applyWhirlwindActiveText],
]);

export const applyActiveAbilityCardText = (actionList, card, rotationLabel) => {
  if (!card || card.type !== 'ability') return actionList;
  const handler = ACTIVE_ABILITY_EFFECTS.get(card.id);
  if (!handler) return actionList;
  return handler(actionList, card, rotationLabel);
};
