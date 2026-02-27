import { patchActionEntry, updateActionEntries } from './actionListTransforms.js';
import { getActiveEffectTargetIndices } from './activeEffectTargets.js';

const getOppositeRotation = (rotationLabel) => {
  const trimmed = `${rotationLabel ?? ''}`.trim().toUpperCase();
  if (!trimmed) return '';
  if (trimmed.startsWith('R')) return 'L1';
  if (trimmed.startsWith('L')) return 'R1';
  return '';
};

const applyRotationAtIndices = (actionList, indices, rotation, rotationSource) => {
  if (!rotation || !indices.length) return actionList;
  return updateActionEntries(actionList, indices, (entry) => {
    if (!entry) return entry;
    if (entry.rotation && entry.rotation !== rotation) return entry;
    return patchActionEntry(entry, { rotation, rotationSource });
  });
};

const applyNinjaRollActiveText = (actionList, card, rotationLabel) => {
  const indices = getActiveEffectTargetIndices(actionList, card, 'i', { fallbackToTextEntries: true });
  const targetIndex = indices.length ? indices[0] : null;
  if (targetIndex == null) return actionList;
  const opposite = getOppositeRotation(rotationLabel);
  if (!opposite) return actionList;
  return applyRotationAtIndices(actionList, [targetIndex], opposite, 'forced');
};

const ACTIVE_MOVEMENT_EFFECTS = new Map([['ninja-roll', applyNinjaRollActiveText]]);

export const applyActiveMovementCardText = (actionList, card, rotationLabel) => {
  if (!card || card.type !== 'movement') return actionList;
  const handler = ACTIVE_MOVEMENT_EFFECTS.get(card.id);
  if (!handler) return actionList;
  return handler(actionList, card, rotationLabel);
};
