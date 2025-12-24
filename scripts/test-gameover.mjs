import assert from 'node:assert/strict';
const getBeatEntryForCharacter = (beat, character) => {
  if (!Array.isArray(beat) || !character) return null;
  const username = character.username;
  const userId = character.userId;
  return (
    beat.find((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const key = entry.username ?? entry.userId ?? entry.userID;
      return key === username || key === userId;
    }) || null
  );
};

const getCharacterFirstEIndex = (beats, character) => {
  if (!Array.isArray(beats) || !beats.length || !character) return 0;
  for (let i = 0; i < beats.length; i += 1) {
    const entry = getBeatEntryForCharacter(beats[i], character);
    if (!entry || entry.action === 'E') return i;
  }
  return Math.max(0, beats.length - 1);
};

const getTimelineMaxIndex = (beats, characters) => {
  if (!Array.isArray(beats) || !beats.length || !Array.isArray(characters) || !characters.length) {
    return 0;
  }
  let maxIndex = beats.length - 1;
  characters.forEach((character) => {
    const firstE = getCharacterFirstEIndex(beats, character);
    if (firstE < maxIndex) maxIndex = firstE;
  });
  return Math.max(0, maxIndex);
};

const isCharacterAtEarliestE = (beats, characters, character) => {
  if (!character) return false;
  const earliest = getTimelineMaxIndex(beats, characters);
  const firstE = getCharacterFirstEIndex(beats, character);
  return firstE === earliest;
};

const buildLand = (...coords) => coords.map(([q, r]) => ({ q, r }));

const isCoordOnLand = (location, land) => {
  if (!location || !Array.isArray(land) || !land.length) return false;
  return land.some((tile) => tile.q === location.q && tile.r === location.r);
};

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

const findDistanceLoss = (beats, characters, land, maxIndex) => {
  for (let i = 0; i <= maxIndex; i += 1) {
    const beat = beats[i] ?? [];
    const losers = [];
    characters.forEach((character) => {
      const entry = getBeatEntryForCharacter(beat, character);
      if (!entry || entry.calculated !== true) return;
      const location = entry?.location ?? character.position;
      const distance = getNearestLandDistance(location, land);
      if (distance > 4) {
        losers.push(character.userId);
      }
    });
    if (losers.length) {
      return { beatIndex: i, loserIds: new Set(losers) };
    }
  }
  return null;
};

const findMovementLoss = ({ beats, characters, land, exhaustedMovementCount, movementCount, localUserId }) => {
  if (!movementCount) return null;
  if (exhaustedMovementCount !== movementCount) return null;
  const localCharacter = characters.find((character) => character.userId === localUserId);
  if (!localCharacter) return null;
  if (!isCharacterAtEarliestE(beats, characters, localCharacter)) return null;
  const firstEIndex = getCharacterFirstEIndex(beats, localCharacter);
  const beat = beats[firstEIndex] ?? [];
  const entry = getBeatEntryForCharacter(beat, localCharacter);
  if (entry && entry.action !== 'E') return null;
  const location = entry?.location ?? localCharacter.position;
  if (!isCoordOnLand(location, land)) {
    return { beatIndex: firstEIndex };
  }
  return null;
};

const resolveMatchEndState = ({ match, beats, characters, land }) => {
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
    return { beatIndex: distanceLoss.beatIndex };
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
  return { beatIndex };
};

const run = () => {
  const characters = [
    { userId: 'player-a', username: 'Player A', position: { q: 0, r: 0 } },
    { userId: 'player-b', username: 'Player B', position: { q: 1, r: 0 } },
  ];
  const land = buildLand([0, 0], [1, 0]);
  const beats = [
    [
      { username: 'Player A', action: 'E', rotation: '', priority: 0, damage: 0, location: { q: 0, r: 0 } },
      { username: 'Player B', action: 'E', rotation: '', priority: 0, damage: 0, location: { q: 1, r: 0 } },
    ],
  ];

  const onLand = findMovementLoss({
    beats,
    characters,
    land,
    exhaustedMovementCount: 4,
    movementCount: 4,
    localUserId: 'player-a',
  });
  assert.equal(onLand, null, 'Expected no loss when on land at E with no movement cards');

  const abyssBeats = [
    [
      { username: 'Player A', action: 'E', rotation: '', priority: 0, damage: 0, location: { q: 5, r: 0 } },
      { username: 'Player B', action: 'E', rotation: '', priority: 0, damage: 0, location: { q: 1, r: 0 } },
    ],
  ];
  const onAbyss = findMovementLoss({
    beats: abyssBeats,
    characters: [
      { userId: 'player-a', username: 'Player A', position: { q: 5, r: 0 } },
      { userId: 'player-b', username: 'Player B', position: { q: 1, r: 0 } },
    ],
    land,
    exhaustedMovementCount: 4,
    movementCount: 4,
    localUserId: 'player-a',
  });
  assert.ok(onAbyss, 'Expected loss when on abyss at E with no movement cards');

  const matchBeats = [
    [
      { username: 'Player A', action: 'E', rotation: '', priority: 0, damage: 0, location: { q: 0, r: 0 } },
      { username: 'Player B', action: 'W', rotation: '', priority: 0, damage: 0, location: { q: 1, r: 0 } },
    ],
    [
      { username: 'Player B', action: 'E', rotation: '', priority: 0, damage: 0, location: { q: 1, r: 0 } },
    ],
  ];
  const matchState = resolveMatchEndState({
    match: { winnerId: 'player-a' },
    beats: matchBeats,
    characters,
    land,
  });
  assert.equal(matchState.beatIndex, 1, 'Expected match end to align to loser E beat');

  console.log('test-gameover: ok');
};

run();
