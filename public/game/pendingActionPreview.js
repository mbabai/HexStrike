import { buildCardActionList } from './cardText/actionListBuilder.js';

const buildPendingActionList = (activeCard, passiveCard, rotation) => {
  const rotationLabel = `${rotation ?? ''}`.trim();
  return buildCardActionList(activeCard, passiveCard, rotationLabel);
};

const isUserSubmitted = (pending, userId) => {
  if (!pending || !Array.isArray(pending.submittedUserIds)) return false;
  return pending.submittedUserIds.includes(userId);
};

const hasPendingBatch = (pending) => Boolean(pending && Array.isArray(pending.requiredUserIds));

export const createPendingActionPreview = () => {
  let actionList = null;

  const setFromCard = (activeCard, passiveCard, rotation) => {
    const nextList = buildPendingActionList(activeCard, passiveCard, rotation);
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
