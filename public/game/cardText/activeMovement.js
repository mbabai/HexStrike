const isBracketedAction = (action) => {
  const trimmed = `${action ?? ''}`.trim();
  return Boolean(trimmed) && trimmed.startsWith('[') && trimmed.endsWith(']');
};

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

const getOppositeRotation = (rotationLabel) => {
  const trimmed = `${rotationLabel ?? ''}`.trim().toUpperCase();
  if (!trimmed) return '';
  if (trimmed.startsWith('R')) return 'L1';
  if (trimmed.startsWith('L')) return 'R1';
  return '';
};

const applyRotationAtIndices = (actionList, indices, rotation, rotationSource) => {
  if (!rotation || !indices.length) return actionList;
  let changed = false;
  const next = actionList.map((item) => ({ ...item }));
  indices.forEach((index) => {
    const entry = next[index];
    if (!entry) return;
    if (entry.rotation && entry.rotation !== rotation) return;
    entry.rotation = rotation;
    entry.rotationSource = rotationSource;
    changed = true;
  });
  return changed ? next : actionList;
};

const applyNinjaRollActiveText = (actionList, card, rotationLabel) => {
  const indices = getSymbolActionIndices(card?.actions ?? [], 'i');
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
