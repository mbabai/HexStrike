import { ActionListItem, CardDefinition } from '../../types';
import { patchActionEntry, updateActionEntries } from './actionListTransforms';
import { getActiveEffectTargetIndices } from './activeEffectTargets';

type RotationSource = ActionListItem['rotationSource'];

const getOppositeRotation = (rotationLabel: string): string => {
  const trimmed = `${rotationLabel ?? ''}`.trim().toUpperCase();
  if (!trimmed) return '';
  if (trimmed.startsWith('R')) return 'L1';
  if (trimmed.startsWith('L')) return 'R1';
  return '';
};

const applyRotationAtIndices = (
  actionList: ActionListItem[],
  indices: number[],
  rotation: string,
  rotationSource: RotationSource,
): ActionListItem[] => {
  if (!rotation || !indices.length) return actionList;
  return updateActionEntries(actionList, indices, (entry) => {
    if (!entry) return entry;
    if (entry.rotation && entry.rotation !== rotation) return entry;
    return patchActionEntry(entry, { rotation, rotationSource });
  });
};

const applyNinjaRollActiveText = (
  actionList: ActionListItem[],
  card: CardDefinition,
  rotationLabel: string,
): ActionListItem[] => {
  const indices = getActiveEffectTargetIndices(actionList, card, 'i', { fallbackToTextEntries: true });
  const targetIndex = indices.length ? indices[0] : null;
  if (targetIndex == null) return actionList;
  const opposite = getOppositeRotation(rotationLabel);
  if (!opposite) return actionList;
  return applyRotationAtIndices(actionList, [targetIndex], opposite, 'forced');
};

type ActiveMovementEffect = (actionList: ActionListItem[], card: CardDefinition, rotationLabel: string) => ActionListItem[];

const ACTIVE_MOVEMENT_EFFECTS = new Map<string, ActiveMovementEffect>([['ninja-roll', applyNinjaRollActiveText]]);

export const applyActiveMovementCardText = (
  actionList: ActionListItem[],
  card: CardDefinition,
  rotationLabel: string,
): ActionListItem[] => {
  if (!card || card.type !== 'movement') return actionList;
  const handler = ACTIVE_MOVEMENT_EFFECTS.get(card.id);
  if (!handler) return actionList;
  return handler(actionList, card, rotationLabel);
};
