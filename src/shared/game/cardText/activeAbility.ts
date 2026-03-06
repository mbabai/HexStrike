import type { ActionListItem, ActionTiming, CardDefinition } from '../../../types';
import { isBracketedAction, patchActionEntry, updateActionEntries } from './actionListTransforms';
import { getTimingPriority } from '../timing';

const SUBMITTED_ADRENALINE_DAMAGE_PATTERN = /damage\s*\+\s*\{?\s*adrx\s*\}?/i;
const DAMAGE_BONUS_CAP_PATTERN = /maximum\s*\+\s*(\d+)/i;

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

const clampSubmittedAdrenaline = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10, Math.round(value)));
};

const patchEntriesAtIndices = (
  actionList: ActionListItem[],
  indices: number[],
  patcher: (entry: ActionListItem) => ActionListItem,
): ActionListItem[] => {
  if (!indices.length) return actionList;
  return updateActionEntries(actionList, indices, (entry) => {
    if (!entry) return entry;
    return patcher(entry);
  });
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

const applyTimingAtIndices = (
  actionList: ActionListItem[],
  indices: number[],
  timing: ActionTiming[],
): ActionListItem[] =>
  patchEntriesAtIndices(actionList, indices, (entry) =>
    patchActionEntry(entry, {
      timing,
      priority: getTimingPriority(timing),
    }),
  );

const applyDamageBonusAtIndices = (
  actionList: ActionListItem[],
  indices: number[],
  amount: number,
): ActionListItem[] => {
  const bonus = Math.max(0, Math.floor(amount));
  if (!bonus) return actionList;
  return patchEntriesAtIndices(actionList, indices, (entry) =>
    patchActionEntry(entry, {
      damage: Math.max(0, Math.floor(Number(entry.damage) || 0) + bonus),
    }),
  );
};

const applyKbfDeltaAtIndices = (
  actionList: ActionListItem[],
  indices: number[],
  delta: number,
): ActionListItem[] => {
  if (!delta) return actionList;
  return patchEntriesAtIndices(actionList, indices, (entry) =>
    patchActionEntry(entry, {
      kbf: Math.max(0, Math.floor(Number(entry.kbf) || 0) + delta),
    }),
  );
};

const parseSubmittedAdrenalineDamageCap = (card: CardDefinition): number | null => {
  const text = `${card?.activeText ?? ''}`;
  const match = text.match(DAMAGE_BONUS_CAP_PATTERN);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
};

const applySubmittedAdrenalineDamageText = (
  actionList: ActionListItem[],
  card: CardDefinition,
  submittedAdrenaline: number,
): ActionListItem[] => {
  const activeText = `${card?.activeText ?? ''}`;
  if (!activeText.includes('{i}') || !SUBMITTED_ADRENALINE_DAMAGE_PATTERN.test(activeText)) {
    return actionList;
  }
  const indices = getSymbolActionIndices(Array.isArray(card.actions) ? card.actions : [], 'i');
  if (!indices.length) return actionList;
  const cap = parseSubmittedAdrenalineDamageCap(card);
  const bonus = cap == null ? submittedAdrenaline : Math.min(submittedAdrenaline, cap);
  return applyDamageBonusAtIndices(actionList, indices, bonus);
};

const applyCounterAttackActiveText = (
  actionList: ActionListItem[],
  card: CardDefinition,
  _rotationLabel: string,
  submittedAdrenaline: number,
): ActionListItem[] => {
  const indices = getSymbolActionIndices(Array.isArray(card.actions) ? card.actions : [], 'i');
  const targetIndex = indices.length ? indices[0] : null;
  if (targetIndex == null) return actionList;
  if (submittedAdrenaline >= 10) {
    return applyTimingAtIndices(actionList, [targetIndex], ['early']);
  }
  if (submittedAdrenaline >= 5) {
    return applyTimingAtIndices(actionList, [targetIndex], ['mid']);
  }
  return actionList;
};

const applyCrossSlashActiveText = (
  actionList: ActionListItem[],
  card: CardDefinition,
  _rotationLabel: string,
  submittedAdrenaline: number,
): ActionListItem[] => {
  if (submittedAdrenaline < 6) return actionList;
  const indices = getSymbolActionIndices(Array.isArray(card.actions) ? card.actions : [], 'i');
  return applyKbfDeltaAtIndices(actionList, indices, 1);
};

const applyFlyingKneeActiveText = (
  actionList: ActionListItem[],
  card: CardDefinition,
  _rotationLabel: string,
  submittedAdrenaline: number,
): ActionListItem[] => {
  if (submittedAdrenaline < 3) return actionList;
  const indices = getSymbolActionIndices(Array.isArray(card.actions) ? card.actions : [], 'i');
  const withDamage = applyDamageBonusAtIndices(actionList, indices, 4);
  return applyKbfDeltaAtIndices(withDamage, indices, -1);
};

const applyFumikomiActiveText = (
  actionList: ActionListItem[],
  card: CardDefinition,
  _rotationLabel: string,
  submittedAdrenaline: number,
): ActionListItem[] => {
  if (submittedAdrenaline < 6) return actionList;
  const indices = getSymbolActionIndices(Array.isArray(card.actions) ? card.actions : [], 'i');
  return applyKbfDeltaAtIndices(actionList, indices, 2);
};

const applySpinningBackKickActiveText = (
  actionList: ActionListItem[],
  card: CardDefinition,
  _rotationLabel: string,
  submittedAdrenaline: number,
): ActionListItem[] => {
  if (submittedAdrenaline < 4) return actionList;
  const indices = getSymbolActionIndices(Array.isArray(card.actions) ? card.actions : [], 'i');
  return patchEntriesAtIndices(actionList, indices, (entry) => patchActionEntry(entry, { action: '[Bc]' }));
};

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

type ActiveAbilityEffect = (
  actionList: ActionListItem[],
  card: CardDefinition,
  rotationLabel: string,
  submittedAdrenaline: number,
) => ActionListItem[];

const ACTIVE_ABILITY_EFFECTS = new Map<string, ActiveAbilityEffect>([
  ['counter-attack', applyCounterAttackActiveText],
  ['aerial-strike', applyAerialStrikeActiveText],
  ['cross-slash', applyCrossSlashActiveText],
  ['flying-knee', applyFlyingKneeActiveText],
  ['fumikomi', applyFumikomiActiveText],
  ['smoke-bomb', applySmokeBombActiveText],
  ['spinning-back-kick', applySpinningBackKickActiveText],
  ['whirlwind', applyWhirlwindActiveText],
]);

export const applyActiveAbilityCardText = (
  actionList: ActionListItem[],
  card: CardDefinition,
  rotationLabel: string,
  submittedAdrenaline = 0,
): ActionListItem[] => {
  if (!card || card.type !== 'ability') return actionList;
  const safeSubmittedAdrenaline = clampSubmittedAdrenaline(submittedAdrenaline);
  const handler = ACTIVE_ABILITY_EFFECTS.get(card.id);
  const withSpecificEffects = handler
    ? handler(actionList, card, rotationLabel, safeSubmittedAdrenaline)
    : actionList;
  return applySubmittedAdrenalineDamageText(withSpecificEffects, card, safeSubmittedAdrenaline);
};
