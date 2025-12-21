import { BeatEntry, CharacterState } from '../types';

const DEFAULT_ACTION = 'E';

const getEntryForCharacter = (beat: BeatEntry, character: CharacterState) => {
  if (!Array.isArray(beat)) return undefined;
  return beat.find((entry) => entry.username === character.username || entry.username === character.userId);
};

export const getCharacterFirstEIndex = (beats: BeatEntry[], character: CharacterState): number => {
  if (!Array.isArray(beats) || !beats.length) return 0;
  for (let i = 0; i < beats.length; i += 1) {
    const entry = getEntryForCharacter(beats[i], character);
    if (!entry || entry.action === DEFAULT_ACTION) return i;
  }
  return Math.max(0, beats.length - 1);
};

export const getTimelineEarliestEIndex = (beats: BeatEntry[], characters: CharacterState[]): number => {
  if (!Array.isArray(beats) || !beats.length || !Array.isArray(characters) || !characters.length) {
    return 0;
  }
  let earliest = beats.length - 1;
  characters.forEach((character) => {
    const firstE = getCharacterFirstEIndex(beats, character);
    if (firstE < earliest) earliest = firstE;
  });
  return Math.max(0, earliest);
};

export const isCharacterAtEarliestE = (
  beats: BeatEntry[],
  characters: CharacterState[],
  character?: CharacterState,
): boolean => {
  if (!character) return false;
  return getCharacterFirstEIndex(beats, character) === getTimelineEarliestEIndex(beats, characters);
};
