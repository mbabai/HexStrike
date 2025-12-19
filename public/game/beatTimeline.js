const DEFAULT_ACTION = 'E';

const getEntryForCharacter = (beat, character) => {
  if (!Array.isArray(beat) || !character) return null;
  const username = character.username;
  const userId = character.userId;
  return beat.find((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const key = entry.username ?? entry.userId ?? entry.userID;
    return key === username || key === userId;
  }) || null;
};

export const getCharacterFirstEIndex = (beats, character) => {
  if (!Array.isArray(beats) || !beats.length || !character) return 0;
  for (let i = 0; i < beats.length; i += 1) {
    const entry = getEntryForCharacter(beats[i], character);
    if (!entry || entry.action === DEFAULT_ACTION) return i;
  }
  return Math.max(0, beats.length - 1);
};

export const getTimelineMaxIndex = (beats, characters) => {
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
