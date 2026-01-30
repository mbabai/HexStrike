import {
  actionHasAttackToken,
  isBracketedAction,
  mapActionList,
  normalizeActionToken,
  patchActionEntry,
  removeActionAtIndex,
} from './actionListTransforms.js';

const WAIT_ACTION = 'W';

const getLastWaitIndex = (actionList) => {
  for (let index = actionList.length - 1; index >= 0; index -= 1) {
    const label = `${actionList[index]?.action ?? ''}`.trim().toUpperCase();
    if (label === WAIT_ACTION) return index;
  }
  return null;
};

const hasAttackBeforeIndex = (actionList, index) =>
  actionList.slice(0, index).some((entry) => actionHasAttackToken(entry.action));

const applyFlechePassiveText = (actionList, activeCard) => {
  if (activeCard?.type !== 'ability') return actionList;
  const lastWaitIndex = getLastWaitIndex(actionList);
  if (lastWaitIndex == null) return actionList;
  if (!hasAttackBeforeIndex(actionList, lastWaitIndex)) return actionList;
  return removeActionAtIndex(actionList, lastWaitIndex);
};

const applyNinjaRollPassiveText = (actionList, activeCard) => {
  if (activeCard?.type !== 'ability') return actionList;
  return mapActionList(actionList, (entry) => {
    const normalized = normalizeActionToken(entry.action).toLowerCase();
    if (normalized !== 'a') return entry;
    const bracketed = isBracketedAction(entry.action);
    return patchActionEntry(entry, {
      action: bracketed ? '[a-La-Ra]' : 'a-La-Ra',
      damage: Number.isFinite(entry.damage) ? Math.floor(entry.damage / 2) : 0,
      kbf: Number.isFinite(entry.kbf) ? Math.floor(entry.kbf / 2) : 0,
    });
  });
};

const PASSIVE_MOVEMENT_EFFECTS = new Map([
  ['fleche', applyFlechePassiveText],
  ['ninja-roll', applyNinjaRollPassiveText],
]);

export const applyPassiveMovementCardText = (actionList, activeCard, passiveCard, _rotationLabel) => {
  if (!passiveCard || passiveCard.type !== 'movement') return actionList;
  const handler = PASSIVE_MOVEMENT_EFFECTS.get(passiveCard.id);
  if (!handler) return actionList;
  return handler(actionList, activeCard);
};
