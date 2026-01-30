import { ActionListItem, CardDefinition } from '../../types';

const WAIT_ACTION = 'W';

const normalizeActionToken = (token: string): string => {
  const trimmed = `${token ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const actionHasAttackToken = (action: string): boolean => {
  if (!action) return false;
  return action
    .split('-')
    .map((token) => normalizeActionToken(token).toLowerCase())
    .some((token) => token.includes('a'));
};

const getLastWaitIndex = (actionList: ActionListItem[]): number | null => {
  for (let index = actionList.length - 1; index >= 0; index -= 1) {
    const label = `${actionList[index]?.action ?? ''}`.trim().toUpperCase();
    if (label === WAIT_ACTION) return index;
  }
  return null;
};

const hasAttackBeforeIndex = (actionList: ActionListItem[], index: number): boolean =>
  actionList.slice(0, index).some((entry) => actionHasAttackToken(entry.action));

const applyFlechePassiveText = (actionList: ActionListItem[], activeCard: CardDefinition | undefined): ActionListItem[] => {
  if (activeCard?.type !== 'ability') return actionList;
  const lastWaitIndex = getLastWaitIndex(actionList);
  if (lastWaitIndex == null) return actionList;
  if (!hasAttackBeforeIndex(actionList, lastWaitIndex)) return actionList;
  return actionList.filter((_, index) => index !== lastWaitIndex);
};

type PassiveMovementEffect = (actionList: ActionListItem[], activeCard: CardDefinition | undefined) => ActionListItem[];

const PASSIVE_MOVEMENT_EFFECTS = new Map<string, PassiveMovementEffect>([['fleche', applyFlechePassiveText]]);

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
