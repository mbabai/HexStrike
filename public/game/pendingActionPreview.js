const normalizeActionToken = (token) => {
  const trimmed = `${token ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const actionHasAttackToken = (action) => {
  if (!action) return false;
  return action
    .split('-')
    .map((token) => normalizeActionToken(token))
    .some((token) => {
      if (!token) return false;
      const type = token[token.length - 1]?.toLowerCase();
      return type === 'a' || type === 'c';
    });
};

const hasThrowInteraction = (text) => {
  if (!text) return false;
  return /\{i\}\s*:\s*throw\b/i.test(text);
};

const buildPendingActionList = (card, rotation) => {
  const actions = Array.isArray(card?.actions) ? card.actions : [];
  if (!actions.length) return [];
  const priority = Number.isFinite(card?.priority) ? card.priority : 0;
  const damage = Number.isFinite(card?.damage) ? card.damage : 0;
  const kbf = Number.isFinite(card?.kbf) ? card.kbf : 0;
  const supportsThrow = hasThrowInteraction(card?.activeText);
  const rotationLabel = `${rotation ?? ''}`.trim();
  return actions.map((action, index) => ({
    action,
    rotation: index === 0 ? rotationLabel : '',
    priority,
    interaction: supportsThrow && actionHasAttackToken(action) ? { type: 'throw' } : undefined,
    damage,
    kbf,
  }));
};

const isUserSubmitted = (pending, userId) => {
  if (!pending || !Array.isArray(pending.submittedUserIds)) return false;
  return pending.submittedUserIds.includes(userId);
};

const hasPendingBatch = (pending) => Boolean(pending && Array.isArray(pending.requiredUserIds));

export const createPendingActionPreview = () => {
  let actionList = null;

  const setFromCard = (card, rotation) => {
    const nextList = buildPendingActionList(card, rotation);
    actionList = nextList.length ? nextList : null;
  };

  const clear = () => {
    actionList = null;
  };

  const syncWithState = (gameState, localUserId) => {
    const pending = gameState?.state?.public?.pendingActions ?? null;
    if (!hasPendingBatch(pending) || !isUserSubmitted(pending, localUserId)) {
      clear();
    }
  };

  const getTimelinePreview = (gameState, localUserId) => {
    const pending = gameState?.state?.public?.pendingActions ?? null;
    if (!hasPendingBatch(pending)) return null;
    if (!isUserSubmitted(pending, localUserId)) return null;
    if (pending.submittedUserIds.length >= pending.requiredUserIds.length) return null;
    if (!Array.isArray(actionList) || !actionList.length) return null;
    return {
      userId: localUserId,
      beatIndex: pending.beatIndex,
      actionList,
    };
  };

  return {
    setFromCard,
    clear,
    syncWithState,
    getTimelinePreview,
  };
};
