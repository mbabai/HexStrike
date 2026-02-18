export const getMatchOutcome = (publicState) => {
  const outcome = publicState?.matchOutcome ?? null;
  if (!outcome) return null;
  if (outcome.reason === 'draw-agreement') return outcome;
  if (!outcome.winnerUserId && !Array.isArray(outcome.drawUserIds)) return null;
  return outcome;
};

export const getLocalOutcomeLabel = (outcome, localUserId) => {
  if (!outcome || !localUserId) return null;
  if (outcome.reason === 'draw-agreement') {
    const drawUserIds = Array.isArray(outcome.drawUserIds) ? outcome.drawUserIds : [];
    if (!drawUserIds.length || drawUserIds.includes(localUserId)) return 'draw';
    return 'lose';
  }
  if (localUserId === outcome.winnerUserId) return 'win';
  if (localUserId === outcome.loserUserId) return 'lose';
  if (Array.isArray(outcome.loserUserIds) && outcome.loserUserIds.includes(localUserId)) return 'lose';
  if (outcome.winnerUserId) return 'lose';
  return null;
};
