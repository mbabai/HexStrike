export const getMatchOutcome = (publicState) => {
  const outcome = publicState?.matchOutcome ?? null;
  if (!outcome) return null;
  if (outcome.reason === 'draw-agreement') return outcome;
  if (!outcome.winnerUserId || !outcome.loserUserId) return null;
  return outcome;
};

export const getLocalOutcomeLabel = (outcome, localUserId) => {
  if (!outcome || !localUserId) return null;
  if (outcome.reason === 'draw-agreement') return 'draw';
  if (localUserId === outcome.winnerUserId) return 'win';
  if (localUserId === outcome.loserUserId) return 'lose';
  return null;
};
