import {
  getBeatEntryForCharacter,
  getCharacterFirstEIndex,
  getTimelineMaxIndex,
  isCharacterAtEarliestE,
} from './beatTimeline.js';

const axialDistance = (a, b) => {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const dy = -dq - dr;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dy));
};

const getNearestLandDistance = (location, land) => {
  if (!location || !Array.isArray(land) || !land.length) return Infinity;
  let best = Infinity;
  land.forEach((tile) => {
    const distance = axialDistance(location, tile);
    if (distance < best) best = distance;
  });
  return best;
};

const buildCoordKey = (coord) => {
  if (!coord) return null;
  const q = Number(coord.q);
  const r = Number(coord.r);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  return `${Math.round(q)},${Math.round(r)}`;
};

const isCoordOnLand = (location, land) => {
  if (!location || !Array.isArray(land) || !land.length) return false;
  const key = buildCoordKey(location);
  if (!key) return false;
  return land.some((tile) => buildCoordKey(tile) === key);
};

const getLatestEntryLocation = (beats, character, startIndex) => {
  if (!character) return null;
  if (!Array.isArray(beats) || !beats.length) {
    return buildCoordKey(character.position) ? character.position : null;
  }
  const start = Number.isFinite(startIndex) ? Math.min(startIndex, beats.length - 1) : beats.length - 1;
  for (let i = start; i >= 0; i -= 1) {
    const entry = getBeatEntryForCharacter(beats[i], character);
    if (entry?.location && buildCoordKey(entry.location)) return entry.location;
  }
  return buildCoordKey(character.position) ? character.position : null;
};

export const findDistanceLoss = (beats, characters, land, maxIndex) => {
  for (let i = 0; i <= maxIndex; i += 1) {
    const beat = beats[i] ?? [];
    const losers = [];
    const details = [];
    characters.forEach((character) => {
      const entry = getBeatEntryForCharacter(beat, character);
      if (!entry || entry.calculated !== true) return;
      const location = entry?.location ?? character.position;
      const distance = getNearestLandDistance(location, land);
      if (distance > 4) {
        losers.push(character.userId);
        details.push({ userId: character.userId, location, distance });
      }
    });
    if (losers.length) {
      return { beatIndex: i, loserIds: new Set(losers), detail: { losers: details } };
    }
  }
  return null;
};

export const findMovementLoss = ({
  beats,
  characters,
  land,
  deckState,
  localUserId,
  pendingActions,
  optimisticLock,
}) => {
  if (!deckState || !deckState.movement.length) return null;
  if (deckState.exhaustedMovementIds.size !== deckState.movement.length) return null;
  const localCharacter = characters.find((character) => character.userId === localUserId) || null;
  if (!localCharacter) return null;
  if (optimisticLock || pendingActions?.submittedUserIds?.includes(localUserId)) return null;
  if (!isCharacterAtEarliestE(beats, characters, localCharacter)) return null;
  const firstEIndex = getCharacterFirstEIndex(beats, localCharacter);
  const beat = beats[firstEIndex] ?? [];
  const entry = getBeatEntryForCharacter(beat, localCharacter);
  if (entry && entry.action !== 'E') return null;
  const location = entry?.location ?? getLatestEntryLocation(beats, localCharacter, firstEIndex - 1);
  const onLand = isCoordOnLand(location, land);
  if (onLand) return null;
  const distance = getNearestLandDistance(location, land);
  if (!Number.isFinite(distance) || distance <= 0) return null;
  return {
    beatIndex: firstEIndex,
    loserIds: new Set([localCharacter.userId]),
    detail: { location, distance, onLand },
  };
};

export const resolveMatchEndState = (match, beats, characters, land) => {
  const winners = match?.winnerId
    ? characters.filter((character) => character.userId === match.winnerId)
    : [];
  const loserIds = new Set();
  if (match?.winnerId) {
    characters
      .filter((character) => character.userId !== match.winnerId)
      .forEach((character) => loserIds.add(character.userId));
  }

  const distanceLoss = findDistanceLoss(beats, characters, land, Math.max(0, beats.length - 1));
  if (distanceLoss) {
    const resolvedLosers = distanceLoss.loserIds?.size ? distanceLoss.loserIds : loserIds;
    const resolvedWinners =
      resolvedLosers?.size && !match?.winnerId
        ? characters.filter((character) => !resolvedLosers.has(character.userId))
        : winners;
    return {
      beatIndex: distanceLoss.beatIndex,
      losers: resolvedLosers,
      winners: resolvedWinners,
      reason: 'distance',
      detail: distanceLoss.detail,
    };
  }

  let beatIndex = getTimelineMaxIndex(beats, characters);
  if (loserIds.size) {
    const loserIndices = characters
      .filter((character) => loserIds.has(character.userId))
      .map((character) => getCharacterFirstEIndex(beats, character));
    if (loserIndices.length) {
      beatIndex = Math.min(...loserIndices);
    }
  }

  return {
    beatIndex,
    losers: loserIds,
    winners,
    reason: match?.winnerId ? 'match-ended' : 'unknown',
    detail: null,
  };
};
