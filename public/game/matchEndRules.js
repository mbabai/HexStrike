export const getMatchOutcome = (publicState) => {
  const outcome = publicState?.matchOutcome ?? null;
  if (!outcome || !outcome.winnerUserId || !outcome.loserUserId) return null;
  return outcome;
};

export const getLocalOutcomeLabel = (outcome, localUserId) => {
  if (!outcome || !localUserId) return null;
  if (localUserId === outcome.winnerUserId) return 'win';
  if (localUserId === outcome.loserUserId) return 'lose';
  return null;
};
