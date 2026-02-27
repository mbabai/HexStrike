import { buildCardActionList } from './cardText/actionListBuilder.js';

const buildPendingActionList = (activeCard, passiveCard, rotation, options = {}) => {
  const rotationLabel = `${rotation ?? ''}`.trim();
  return buildCardActionList(activeCard, passiveCard, rotationLabel, options);
};

const isUserSubmitted = (pending, userId) => {
  if (!pending || !Array.isArray(pending.submittedUserIds)) return false;
  return pending.submittedUserIds.includes(userId);
};

const hasPendingBatch = (pending) => Boolean(pending && Array.isArray(pending.requiredUserIds));

export const createPendingActionPreview = () => {
  let actionList = null;
  let ruleset = 'regular';

  const setRuleset = (nextRuleset) => {
    ruleset = `${nextRuleset ?? ''}`.trim().toLowerCase() === 'alternate' ? 'alternate' : 'regular';
  };

  const setFromCard = (activeCard, passiveCard, rotation, options = {}) => {
    const submittedAdrenaline = Number.isFinite(options.submittedAdrenaline)
      ? Math.max(0, Math.floor(options.submittedAdrenaline))
      : 0;
    const nextList = buildPendingActionList(activeCard, passiveCard, rotation, {
      ruleset,
      submittedAdrenaline,
    });
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
    setRuleset,
    setFromCard,
    clear,
    syncWithState,
    getTimelinePreview,
  };
};
