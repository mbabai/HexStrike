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

const getFfaWinReasonLabel = (outcome, publicState) => {
  const ffa = publicState?.ffa;
  if (!ffa?.enabled) return null;
  const winnerUserId = `${outcome?.winnerUserId ?? ''}`.trim();
  if (!winnerUserId) return null;
  const pointsToWinRaw = Number(ffa?.pointsToWin);
  const pointsToWin = Number.isFinite(pointsToWinRaw) ? Math.max(1, Math.floor(pointsToWinRaw)) : 2;
  const winnerScoreRaw = Number(ffa?.playerStates?.[winnerUserId]?.score);
  if (!Number.isFinite(winnerScoreRaw)) return null;
  const winnerScore = Math.max(0, Math.floor(winnerScoreRaw));
  if (winnerScore < pointsToWin) return null;
  return `${pointsToWin} victory points`;
};

const REASON_LABELS = {
  'far-from-land': 'Zone',
  'no-cards-abyss': 'Empty hand',
  forfeit: 'Forfeit',
  'draw-agreement': 'Draw',
};

export const getMatchOutcomeReasonLabel = (outcome, publicState) => {
  if (!outcome) return null;
  const ffaWinReason = getFfaWinReasonLabel(outcome, publicState);
  if (ffaWinReason) return ffaWinReason;
  return REASON_LABELS[outcome.reason] ?? null;
};
