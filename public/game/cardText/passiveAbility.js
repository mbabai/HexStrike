import { isBracketedAction, mapActionList, patchActionEntry, updateActionEntries } from './actionListTransforms.js';

const normalizeActionLabel = (action) => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const wrapActionLabel = (label, bracketed) => (bracketed ? `[${label}]` : label);

const isActionLabel = (entry, label) => normalizeActionLabel(entry.action).toLowerCase() === label.toLowerCase();

const replaceEntryAction = (entry, nextLabel, patch = {}) => {
  const action = wrapActionLabel(nextLabel, isBracketedAction(entry.action));
  return patchActionEntry(entry, { action, ...patch });
};

const replaceAllActions = (actionList, label, nextLabel, patch = {}) =>
  mapActionList(actionList, (entry) => (isActionLabel(entry, label) ? replaceEntryAction(entry, nextLabel, patch) : entry));

const replaceFirstAction = (actionList, label, nextLabel, patch = {}) => {
  const index = actionList.findIndex((entry) => isActionLabel(entry, label));
  if (index < 0) return actionList;
  return updateActionEntries(actionList, [index], (entry) => replaceEntryAction(entry, nextLabel, patch));
};

const replaceLastAction = (actionList, label, nextLabel, patch = {}) => {
  for (let index = actionList.length - 1; index >= 0; index -= 1) {
    if (!isActionLabel(actionList[index], label)) continue;
    return updateActionEntries(actionList, [index], (entry) => replaceEntryAction(entry, nextLabel, patch));
  }
  return actionList;
};

const actionHasMovementToken = (action) => {
  if (!action) return false;
  return action
    .split('-')
    .map((token) => normalizeActionLabel(token))
    .some((label) => {
      if (!label) return false;
      const type = label[label.length - 1]?.toLowerCase();
      return type === 'm' || type === 'j';
    });
};

const getLastMovementIndex = (actionList) => {
  for (let index = actionList.length - 1; index >= 0; index -= 1) {
    if (actionHasMovementToken(actionList[index]?.action ?? '')) return index;
  }
  return null;
};

const applyAerialStrikePassiveText = (actionList, activeCard) => {
  if (activeCard?.type !== 'movement') return actionList;
  const lastMovementIndex = getLastMovementIndex(actionList);
  if (lastMovementIndex == null) return actionList;
  const targetIndex = lastMovementIndex + 1;
  if (targetIndex >= actionList.length) return actionList;
  return updateActionEntries(actionList, [targetIndex], (entry) => {
    if (!entry) return entry;
    return patchActionEntry(entry, { rotation: '3', rotationSource: 'forced' });
  });
};

const applyChasePassiveText = (actionList) => {
  if (!actionList.length) return actionList;
  const first = actionList[0];
  const waitEntry = {
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

const applyCounterAttackPassiveText = (actionList) => replaceFirstAction(actionList, 'm', 'm-Ba', { damage: 3, kbf: 3 });

const applyCrossSlashPassiveText = (actionList) => replaceAllActions(actionList, 'm', 'm-La-Ra', { damage: 2, kbf: 1 });

const applyFlyingKneePassiveText = (actionList) =>
  mapActionList(actionList, (entry) => {
    const label = normalizeActionLabel(entry.action);
    if (!label || !label.toLowerCase().endsWith('m')) return entry;
    const nextLabel = `${label.slice(0, -1)}c`;
    return replaceEntryAction(entry, nextLabel, { damage: 1, kbf: 1 });
  });

const applyGuardPassiveText = (actionList) => replaceAllActions(actionList, 'W', 'Bb');

const applyJabPassiveText = (actionList) =>
  mapActionList(actionList, (entry) => {
    const basePriority = Number.isFinite(entry.priority) ? entry.priority : 0;
    return patchActionEntry(entry, { priority: basePriority + 30 });
  });

const isJumpAction = (entry) => normalizeActionLabel(entry.action).toLowerCase().endsWith('j');

const buildSmashAttackEntry = (entry) => ({
  ...entry,
  action: 'a-La-Ra-BLa-BRa-Ba',
  rotation: '',
  rotationSource: undefined,
  interaction: undefined,
  damage: 1,
  kbf: 1,
});

const applySmashAttackPassiveText = (actionList) => {
  const next = [];
  actionList.forEach((entry) => {
    next.push(entry);
    if (isJumpAction(entry)) {
      next.push(buildSmashAttackEntry(entry));
    }
  });
  return next;
};

const applyPushKickPassiveText = (actionList) =>
  mapActionList(actionList, (entry) => {
    const label = normalizeActionLabel(entry.action);
    if (!label) return entry;
    const lower = label.toLowerCase();
    if (!lower.endsWith('m') && !lower.endsWith('j')) return entry;
    if (label.startsWith('B')) return entry;
    return replaceEntryAction(entry, `B${label}`);
  });

const applySmokeBombPassiveText = (actionList) =>
  mapActionList(actionList, (entry) => {
    const label = normalizeActionLabel(entry.action);
    if (!label || !label.toLowerCase().endsWith('m')) return entry;
    const nextLabel = label.startsWith('B') ? label.slice(1) : `B${label}`;
    return replaceEntryAction(entry, nextLabel);
  });

const applyWhirlwindPassiveText = (actionList) => replaceLastAction(actionList, 'm', 'c-La-Ra-BLa-BRa-Ba', { damage: 1, kbf: 0 });

const PASSIVE_ABILITY_EFFECTS = new Map([
  ['aerial-strike', applyAerialStrikePassiveText],
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

export const applyPassiveAbilityCardText = (actionList, activeCard, passiveCard, _rotationLabel) => {
  if (!passiveCard || passiveCard.type !== 'ability') return actionList;
  const handler = PASSIVE_ABILITY_EFFECTS.get(passiveCard.id);
  if (!handler) return actionList;
  return handler(actionList, activeCard);
};
