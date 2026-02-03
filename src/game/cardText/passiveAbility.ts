import { ActionListItem, CardDefinition } from '../../types';
import { isBracketedAction, mapActionList, patchActionEntry, updateActionEntries } from './actionListTransforms';

const normalizeActionLabel = (action: string): string => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const wrapActionLabel = (label: string, bracketed: boolean): string => (bracketed ? `[${label}]` : label);

const isActionLabel = (entry: ActionListItem, label: string): boolean =>
  normalizeActionLabel(entry.action).toLowerCase() === label.toLowerCase();

const replaceEntryAction = (
  entry: ActionListItem,
  nextLabel: string,
  patch: Partial<ActionListItem> = {},
): ActionListItem => {
  const action = wrapActionLabel(nextLabel, isBracketedAction(entry.action));
  return patchActionEntry(entry, { action, ...patch });
};

const replaceAllActions = (
  actionList: ActionListItem[],
  label: string,
  nextLabel: string,
  patch: Partial<ActionListItem> = {},
): ActionListItem[] =>
  mapActionList(actionList, (entry) => (isActionLabel(entry, label) ? replaceEntryAction(entry, nextLabel, patch) : entry));

const replaceFirstAction = (
  actionList: ActionListItem[],
  label: string,
  nextLabel: string,
  patch: Partial<ActionListItem> = {},
): ActionListItem[] => {
  const index = actionList.findIndex((entry) => isActionLabel(entry, label));
  if (index < 0) return actionList;
  return updateActionEntries(actionList, [index], (entry) => replaceEntryAction(entry, nextLabel, patch));
};

const replaceLastAction = (
  actionList: ActionListItem[],
  label: string,
  nextLabel: string,
  patch: Partial<ActionListItem> = {},
): ActionListItem[] => {
  for (let index = actionList.length - 1; index >= 0; index -= 1) {
    if (!isActionLabel(actionList[index], label)) continue;
    return updateActionEntries(actionList, [index], (entry) => replaceEntryAction(entry, nextLabel, patch));
  }
  return actionList;
};

const applyChasePassiveText = (actionList: ActionListItem[]): ActionListItem[] => {
  if (!actionList.length) return actionList;
  const first = actionList[0];
  const waitEntry: ActionListItem = {
    ...first,
    action: 'W',
    rotation: first.rotation,
    rotationSource: first.rotationSource,
    interaction: undefined,
  };
  const clearedFirst = patchActionEntry(first, { rotation: '', rotationSource: undefined });
  const shifted = [waitEntry, clearedFirst, ...actionList.slice(1)];
  return replaceAllActions(shifted, 'm', '2m');
};

const applyCounterAttackPassiveText = (actionList: ActionListItem[]): ActionListItem[] =>
  replaceFirstAction(actionList, 'm', 'm-Ba', { damage: 3, kbf: 3 });

const applyCrossSlashPassiveText = (actionList: ActionListItem[]): ActionListItem[] =>
  replaceAllActions(actionList, 'm', 'm-La-Ra', { damage: 2, kbf: 1 });

const applyFlyingKneePassiveText = (actionList: ActionListItem[]): ActionListItem[] =>
  mapActionList(actionList, (entry) => {
    const label = normalizeActionLabel(entry.action);
    if (!label || !label.toLowerCase().endsWith('m')) return entry;
    const nextLabel = `${label.slice(0, -1)}c`;
    return replaceEntryAction(entry, nextLabel, { damage: 1, kbf: 1 });
  });

const applyGuardPassiveText = (actionList: ActionListItem[]): ActionListItem[] => replaceAllActions(actionList, 'W', 'Bb');

const applyJabPassiveText = (actionList: ActionListItem[]): ActionListItem[] =>
  mapActionList(actionList, (entry) => {
    const basePriority = Number.isFinite(entry.priority) ? entry.priority : 0;
    return patchActionEntry(entry, { priority: basePriority + 30 });
  });

const isJumpAction = (entry: ActionListItem): boolean =>
  normalizeActionLabel(entry.action).toLowerCase().endsWith('j');

const buildSmashAttackEntry = (entry: ActionListItem): ActionListItem => ({
  ...entry,
  action: 'a-La-Ra-BLa-BRa-Ba',
  rotation: '',
  rotationSource: undefined,
  interaction: undefined,
  damage: 1,
  kbf: 1,
});

const applySmashAttackPassiveText = (actionList: ActionListItem[]): ActionListItem[] => {
  const next: ActionListItem[] = [];
  actionList.forEach((entry) => {
    next.push(entry);
    if (isJumpAction(entry)) {
      next.push(buildSmashAttackEntry(entry));
    }
  });
  return next;
};

const applyPushKickPassiveText = (actionList: ActionListItem[]): ActionListItem[] =>
  mapActionList(actionList, (entry) => {
    const label = normalizeActionLabel(entry.action);
    if (!label) return entry;
    const lower = label.toLowerCase();
    if (!lower.endsWith('m') && !lower.endsWith('j')) return entry;
    if (label.startsWith('B')) return entry;
    return replaceEntryAction(entry, `B${label}`);
  });

const applySmokeBombPassiveText = (actionList: ActionListItem[]): ActionListItem[] =>
  mapActionList(actionList, (entry) => {
    const label = normalizeActionLabel(entry.action);
    if (!label || !label.toLowerCase().endsWith('m')) return entry;
    const nextLabel = label.startsWith('B') ? label.slice(1) : `B${label}`;
    return replaceEntryAction(entry, nextLabel);
  });

const applyWhirlwindPassiveText = (actionList: ActionListItem[]): ActionListItem[] =>
  replaceLastAction(actionList, 'm', 'c-La-Ra-BLa-BRa-Ba', { damage: 1, kbf: 0 });

type PassiveAbilityEffect = (actionList: ActionListItem[], activeCard: CardDefinition | undefined) => ActionListItem[];

const PASSIVE_ABILITY_EFFECTS = new Map<string, PassiveAbilityEffect>([
  ['chase', applyChasePassiveText],
  ['counter-attack', applyCounterAttackPassiveText],
  ['cross-slash', applyCrossSlashPassiveText],
  ['flying-knee', applyFlyingKneePassiveText],
  ['guard', applyGuardPassiveText],
  ['jab', applyJabPassiveText],
  ['push-kick', applyPushKickPassiveText],
  ['smash-attack', applySmashAttackPassiveText],
  ['smoke-bomb', applySmokeBombPassiveText],
  ['whirlwind', applyWhirlwindPassiveText],
]);

export const applyPassiveAbilityCardText = (
  actionList: ActionListItem[],
  activeCard: CardDefinition | undefined,
  passiveCard: CardDefinition,
  _rotationLabel: string,
): ActionListItem[] => {
  if (!passiveCard || passiveCard.type !== 'ability') return actionList;
  const handler = PASSIVE_ABILITY_EFFECTS.get(passiveCard.id);
  if (!handler) return actionList;
  return handler(actionList, activeCard);
};
