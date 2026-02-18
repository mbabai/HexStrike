const toBeat = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
};

const normalizeRange = (range) => {
  const start = toBeat(range?.startBeatIndex);
  const end = Math.max(start, toBeat(range?.endBeatIndex));
  return { startBeatIndex: start, endBeatIndex: end };
};

const isBeatInRanges = (beatIndex, ranges) => {
  if (!Number.isFinite(beatIndex) || !Array.isArray(ranges) || !ranges.length) return false;
  const safeBeat = Math.max(0, Math.floor(beatIndex));
  return ranges.some((range) => {
    const normalized = normalizeRange(range);
    return safeBeat >= normalized.startBeatIndex && safeBeat <= normalized.endBeatIndex;
  });
};

export const isFfaEnabled = (publicState) => Boolean(publicState?.ffa?.enabled);

export const getFfaPlayerState = (publicState, userId) => {
  if (!isFfaEnabled(publicState) || !userId) return null;
  const playerStates = publicState?.ffa?.playerStates ?? {};
  return playerStates[userId] ?? null;
};

export const getFfaScore = (publicState, userId) => {
  const score = Number(getFfaPlayerState(publicState, userId)?.score);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.floor(score));
};

const getCharacterLookupMaps = (characters) => {
  const byAnyKey = new Map();
  const byUserId = new Map();
  if (!Array.isArray(characters)) return { byAnyKey, byUserId };
  characters.forEach((character) => {
    if (!character || typeof character !== 'object') return;
    const userId = `${character.userId ?? ''}`.trim();
    if (!userId) return;
    const username = `${character.username ?? ''}`.trim();
    byUserId.set(userId, character);
    byAnyKey.set(userId, userId);
    if (username) {
      byAnyKey.set(username, userId);
    }
  });
  return { byAnyKey, byUserId };
};

const getBeatEntryByUserId = (beat, userId, username) => {
  if (!Array.isArray(beat) || !userId) return null;
  for (let i = 0; i < beat.length; i += 1) {
    const entry = beat[i];
    if (!entry || typeof entry !== 'object') continue;
    const key = `${entry.username ?? entry.userId ?? entry.userID ?? ''}`.trim();
    if (!key) continue;
    if (key === userId || (username && key === username)) {
      return entry;
    }
  }
  return null;
};

const isForfeitDeathBeat = (publicState, userId, beatIndex) => {
  if (!isFfaPlayerForfeited(publicState, userId)) return false;
  const deathWindows = getFfaPlayerState(publicState, userId)?.deathWindows ?? [];
  return !isBeatInRanges(beatIndex, deathWindows);
};

export const getFfaScoreMapAtBeat = (publicState, beats, characters, beatIndex) => {
  const scoreByUserId = new Map();
  if (!isFfaEnabled(publicState)) return scoreByUserId;
  const { byAnyKey, byUserId } = getCharacterLookupMaps(characters);
  if (!byUserId.size || !Array.isArray(beats) || !beats.length) return scoreByUserId;
  byUserId.forEach((_character, userId) => {
    scoreByUserId.set(userId, 0);
  });
  const lastHitByUserId = new Map();
  const maxBeat = Math.min(Math.max(0, toBeat(beatIndex)), beats.length - 1);

  for (let i = 0; i <= maxBeat; i += 1) {
    const beat = beats[i];
    if (Array.isArray(beat) && beat.length) {
      beat.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const key = `${entry.username ?? entry.userId ?? entry.userID ?? ''}`.trim();
        if (!key) return;
        const targetUserId = byAnyKey.get(key) ?? key;
        if (!byUserId.has(targetUserId)) return;
        const consequences = Array.isArray(entry.consequences) ? entry.consequences : [];
        consequences.forEach((consequence) => {
          if (!consequence || consequence.type !== 'hit') return;
          const sourceKey = `${consequence.sourceUserId ?? ''}`.trim();
          if (!sourceKey) return;
          const sourceUserId = byAnyKey.get(sourceKey) ?? sourceKey;
          if (!byUserId.has(sourceUserId)) return;
          if (sourceUserId === targetUserId) return;
          if (isFfaPlayerInvulnerableAtBeat(publicState, targetUserId, i)) return;
          lastHitByUserId.set(targetUserId, sourceUserId);
        });
      });
    }

    byUserId.forEach((character, userId) => {
      const username = `${character?.username ?? ''}`.trim();
      const currentEntry = getBeatEntryByUserId(beat, userId, username);
      const currentAction = `${currentEntry?.action ?? ''}`.trim();
      if (currentAction !== 'Death') return;
      const previousBeat = i > 0 ? beats[i - 1] : null;
      const previousEntry = getBeatEntryByUserId(previousBeat, userId, username);
      const previousAction = `${previousEntry?.action ?? ''}`.trim();
      if (previousAction === 'Death') return;
      const scorerUserId = `${lastHitByUserId.get(userId) ?? ''}`.trim();
      const canCredit =
        Boolean(scorerUserId) &&
        scorerUserId !== userId &&
        byUserId.has(scorerUserId) &&
        !isFfaPlayerForfeited(publicState, scorerUserId) &&
        (isForfeitDeathBeat(publicState, userId, i) || !isFfaPlayerInvulnerableAtBeat(publicState, userId, i));
      if (canCredit) {
        const prior = scoreByUserId.get(scorerUserId) ?? 0;
        scoreByUserId.set(scorerUserId, prior + 1);
      }
      lastHitByUserId.delete(userId);
    });
  }

  return scoreByUserId;
};

export const isFfaPlayerForfeited = (publicState, userId) =>
  Boolean(getFfaPlayerState(publicState, userId)?.forfeited);

export const isFfaPlayerOutAtBeat = (publicState, userId, beatIndex) => {
  if (!isFfaEnabled(publicState) || !userId) return false;
  if (isFfaPlayerForfeited(publicState, userId)) return true;
  const deathWindows = getFfaPlayerState(publicState, userId)?.deathWindows ?? [];
  return isBeatInRanges(beatIndex, deathWindows);
};

export const isFfaPlayerInvulnerableAtBeat = (publicState, userId, beatIndex) => {
  if (!isFfaEnabled(publicState) || !userId) return false;
  const invulnerableWindows = getFfaPlayerState(publicState, userId)?.invulnerableWindows ?? [];
  return isBeatInRanges(beatIndex, invulnerableWindows);
};
