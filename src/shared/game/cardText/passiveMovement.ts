import type { ActionListItem, CardDefinition } from '../../../types';
import {
  isBracketedAction,
  mapActionList,
  normalizeActionToken,
  patchActionEntry,
  updateActionEntries,
  splitActionTokens,
} from './actionListTransforms';
import { getTimingPriority } from '../timing';

const WAIT_ACTION = 'W';

const actionHasExactSymbol = (action: string, symbol: string): boolean => {
  const normalizedSymbol = `${symbol ?? ''}`.trim().toLowerCase();
  if (!normalizedSymbol) return false;
  return splitActionTokens(action).some((token) => normalizeActionToken(token).toLowerCase() === normalizedSymbol);
};

const isWaitAction = (entry: ActionListItem): boolean => normalizeActionToken(entry.action).toUpperCase() === WAIT_ACTION;

const getFirstAttackIndex = (actionList: ActionListItem[]): number | null => {
  const index = actionList.findIndex((entry) => actionHasExactSymbol(entry.action, 'a'));
  return index >= 0 ? index : null;
};

const getLastWaitBeforeIndex = (actionList: ActionListItem[], index: number): number | null => {
  for (let current = index - 1; current >= 0; current -= 1) {
    if (isWaitAction(actionList[current])) return current;
  }
  return null;
};

const applyFlechePassiveText = (actionList: ActionListItem[], activeCard: CardDefinition | undefined): ActionListItem[] => {
  if (activeCard?.type !== 'ability') return actionList;
  const firstAttackIndex = getFirstAttackIndex(actionList);
  if (firstAttackIndex == null) return actionList;
  const waitIndex = getLastWaitBeforeIndex(actionList, firstAttackIndex);
  if (waitIndex == null) return actionList;
  return updateActionEntries(actionList, [waitIndex], (entry) =>
    patchActionEntry(entry, {
      action: 'm',
      timing: ['late'],
      priority: getTimingPriority(['late']),
    }),
  );
};

const applyNinjaRollPassiveText = (
  actionList: ActionListItem[],
  activeCard: CardDefinition | undefined,
): ActionListItem[] => {
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

type PassiveMovementEffect = (actionList: ActionListItem[], activeCard: CardDefinition | undefined) => ActionListItem[];

const PASSIVE_MOVEMENT_EFFECTS = new Map<string, PassiveMovementEffect>([
  ['fleche', applyFlechePassiveText],
  ['ninja-roll', applyNinjaRollPassiveText],
]);

export const applyPassiveMovementCardText = (
  actionList: ActionListItem[],
  activeCard: CardDefinition | undefined,
  passiveCard: CardDefinition,
  _rotationLabel: string,
): ActionListItem[] => {
  if (!passiveCard || passiveCard.type !== 'movement') return actionList;
  const handler = PASSIVE_MOVEMENT_EFFECTS.get(passiveCard.id);
  if (!handler) return actionList;
  return handler(actionList, activeCard);
};
