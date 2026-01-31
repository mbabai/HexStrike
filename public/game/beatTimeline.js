const DEFAULT_ACTION = 'E';

export const getBeatEntryForCharacter = (beat, character) => {
  if (!Array.isArray(beat) || !character) return null;
  const lookupKeys = new Set([character.username, character.userId].filter(Boolean));
  return (
    beat.find((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const key = entry.username ?? entry.userId ?? entry.userID;
      return lookupKeys.has(key);
    }) ?? null
  );
};

export const getLastEntryForCharacter = (beats, character, uptoIndex = beats.length - 1) => {
  if (!Array.isArray(beats) || !beats.length || !character) return null;
  const lastIndex = Math.min(uptoIndex, beats.length - 1);
  for (let i = lastIndex; i >= 0; i -= 1) {
    const entry = getBeatEntryForCharacter(beats[i], character);
    if (entry) return entry;
  }
  return null;
};

export const getCharacterFirstEIndex = (beats, character) => {
  if (!Array.isArray(beats) || !beats.length) return 0;
  for (let i = 0; i < beats.length; i += 1) {
    const entry = getBeatEntryForCharacter(beats[i], character);
    if (!entry || entry.action === DEFAULT_ACTION) return i;
  }
  return Math.max(0, beats.length - 1);
};

export const getTimelineEarliestEIndex = (beats, characters) => {
  if (!Array.isArray(beats) || !beats.length || !Array.isArray(characters) || !characters.length) return 0;
  let earliest = beats.length - 1;
  characters.forEach((character) => {
    const firstE = getCharacterFirstEIndex(beats, character);
    if (firstE < earliest) earliest = firstE;
  });
  return Math.max(0, earliest);
};

export const getTimelineResolvedIndex = (beats) => {
  if (!Array.isArray(beats) || !beats.length) return -1;
  let lastResolved = -1;
  for (let i = 0; i < beats.length; i += 1) {
    const beat = beats[i];
    if (!Array.isArray(beat) || !beat.length) break;
    const allCalculated = beat.every((entry) => entry && entry.calculated);
    if (!allCalculated) break;
    lastResolved = i;
  }
  return lastResolved;
};

export const getCharactersAtEarliestE = (beats, characters) => {
  const earliest = getTimelineEarliestEIndex(beats, characters);
  return (characters ?? []).filter((character) => getCharacterFirstEIndex(beats, character) === earliest);
};

export const getEarliestPendingInteractionIndex = (interactions) => {
  if (!Array.isArray(interactions) || !interactions.length) return null;
  const pending = interactions
    .filter((interaction) => interaction?.status === 'pending' && Number.isFinite(interaction?.beatIndex))
    .map((interaction) => interaction.beatIndex);
  if (!pending.length) return null;
  return Math.min(...pending);
};

export const getTimelineStopIndex = (beats, characters, interactions = [], options = {}) => {
  const earliestE = getTimelineEarliestEIndex(beats, characters);
  const resolvedIndex = getTimelineResolvedIndex(beats);
  const pending = (interactions ?? []).filter(
    (interaction) => interaction?.status === 'pending' && Number.isFinite(interaction?.beatIndex),
  );
  const pendingIndex = pending.length ? Math.min(...pending.map((interaction) => interaction.beatIndex)) : null;
  const alwaysStopTypes = new Set(options.alwaysStopTypes ?? ['throw', 'discard']);
  const alwaysPending = pending.filter((interaction) => alwaysStopTypes.has(interaction?.type));
  const alwaysPendingIndex = alwaysPending.length
    ? Math.min(...alwaysPending.map((interaction) => interaction.beatIndex))
    : null;
  let effectivePending = pendingIndex;
  if (effectivePending !== null && resolvedIndex >= 0 && effectivePending <= resolvedIndex) {
    effectivePending = alwaysPendingIndex;
  }
  if (effectivePending === null) return earliestE;
  return Math.min(earliestE, effectivePending);
};
