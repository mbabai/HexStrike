import { buildCardActionList } from './cardText/actionListBuilder.js';

const buildPendingActionList = (activeCard, passiveCard, rotation, adrenaline = 0) => {
  const rotationLabel = `${rotation ?? ''}`.trim();
  const safeAdrenaline = Number.isFinite(Number(adrenaline)) ? Math.max(0, Math.min(10, Math.round(Number(adrenaline)))) : 0;
  const actionList = buildCardActionList(activeCard, passiveCard, rotationLabel, { submittedAdrenaline: safeAdrenaline });
  return actionList.map((entry) => ({
    ...entry,
    submittedAdrenaline: safeAdrenaline,
  }));
};

const isUserSubmitted = (pending, userId) => {
  if (!pending || !Array.isArray(pending.submittedUserIds)) return false;
  return pending.submittedUserIds.includes(userId);
};

const hasPendingBatch = (pending) => Boolean(pending && Array.isArray(pending.requiredUserIds));

export const createPendingActionPreview = () => {
  let actionList = null;

  const setFromCard = (activeCard, passiveCard, rotation, adrenaline = 0) => {
    const nextList = buildPendingActionList(activeCard, passiveCard, rotation, adrenaline);
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
