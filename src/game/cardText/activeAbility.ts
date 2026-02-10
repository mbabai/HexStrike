import { ActionListItem, CardDefinition } from '../../types';
import { isBracketedAction, patchActionEntry, updateActionEntries } from './actionListTransforms';

const getBracketedActionIndices = (actions: string[]): number[] => {
  const indices: number[] = [];
  actions.forEach((action, index) => {
    if (isBracketedAction(action)) {
      indices.push(index);
    }
  });
  return indices;
};

const getSymbolActionIndices = (actions: string[], symbol: string): number[] => {
  if (symbol === 'i') {
    return getBracketedActionIndices(actions);
  }
  return [];
};

const applyRotationAfterIndex = (
  actionList: ActionListItem[],
  index: number,
  rotation: string,
  options: { clearStartRotation?: boolean } = {},
): ActionListItem[] => {
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

const shiftSelectedRotationToIndex = (actionList: ActionListItem[], index: number): ActionListItem[] => {
  if (!Number.isFinite(index) || index < 0 || index >= actionList.length) return actionList;
  const selectedRotation = `${actionList[0]?.rotation ?? ''}`.trim();
  if (!selectedRotation) return actionList;
  const clearedStart = updateActionEntries(actionList, [0], (entry) => {
    if (!entry) return entry;
    return patchActionEntry(entry, { rotation: '', rotationSource: undefined });
  });
  return updateActionEntries(clearedStart, [index], (entry) => {
    if (!entry) return entry;
    return patchActionEntry(entry, { rotation: selectedRotation, rotationSource: 'selected' });
  });
};

const applyCounterAttackActiveText = (
  actionList: ActionListItem[],
): ActionListItem[] => actionList;

const applyAerialStrikeActiveText = (actionList: ActionListItem[], card: CardDefinition): ActionListItem[] => {
  const indices = getSymbolActionIndices(Array.isArray(card.actions) ? card.actions : [], 'i');
  const targetIndex = indices.length ? indices[0] + 1 : null;
  if (targetIndex == null) return actionList;
  return applyRotationAfterIndex(actionList, targetIndex, '3', { clearStartRotation: false });
};

const applyWhirlwindActiveText = (actionList: ActionListItem[], card: CardDefinition): ActionListItem[] => {
  const indices = getSymbolActionIndices(Array.isArray(card.actions) ? card.actions : [], 'i');
  if (!indices.length) return actionList;
  return updateActionEntries(actionList, indices, (entry) => {
    if (!entry) return entry;
    return patchActionEntry(entry, { kbf: 3 });
  });
};

const applySmokeBombActiveText = (actionList: ActionListItem[], card: CardDefinition): ActionListItem[] => {
  const indices = getSymbolActionIndices(Array.isArray(card.actions) ? card.actions : [], 'i');
  const targetIndex = indices.length ? indices[0] + 1 : null;
  if (targetIndex == null) return actionList;
  return shiftSelectedRotationToIndex(actionList, targetIndex);
};

type ActiveAbilityEffect = (actionList: ActionListItem[], card: CardDefinition, rotationLabel: string) => ActionListItem[];

const ACTIVE_ABILITY_EFFECTS = new Map<string, ActiveAbilityEffect>([
  ['counter-attack', applyCounterAttackActiveText],
  ['aerial-strike', applyAerialStrikeActiveText],
  ['smoke-bomb', applySmokeBombActiveText],
  ['whirlwind', applyWhirlwindActiveText],
]);

export const applyActiveAbilityCardText = (
  actionList: ActionListItem[],
  card: CardDefinition,
  rotationLabel: string,
): ActionListItem[] => {
  if (!card || card.type !== 'ability') return actionList;
  const handler = ACTIVE_ABILITY_EFFECTS.get(card.id);
  if (!handler) return actionList;
  return handler(actionList, card, rotationLabel);
};
