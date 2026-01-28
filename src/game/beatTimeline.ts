import { BeatEntry, PublicCharacter } from '../types';

const DEFAULT_ACTION = 'E';

const getEntryForCharacter = (beat: BeatEntry[] | undefined, character: PublicCharacter): BeatEntry | undefined => {
  if (!Array.isArray(beat)) return undefined;
  return beat.find((entry) => {
    if (!entry) return false;
    const key = entry.username ?? entry.userId ?? entry.userID;
    return key === character.username || key === character.userId;
  });
};

export const getLastEntryForCharacter = (
  beats: BeatEntry[][],
  character: PublicCharacter,
  uptoIndex: number = beats.length - 1,
): BeatEntry | null => {
  if (!Array.isArray(beats) || !beats.length) return null;
  for (let i = Math.min(uptoIndex, beats.length - 1); i >= 0; i -= 1) {
    const entry = getEntryForCharacter(beats[i], character);
    if (entry) return entry;
  }
  return null;
};

export const getCharacterLocationAtIndex = (
  beats: BeatEntry[][],
  character: PublicCharacter,
  index: number,
): { q: number; r: number } | null => {
  if (!Array.isArray(beats) || !beats.length) return null;
  const entry = getEntryForCharacter(beats[index], character);
  if (entry?.location) return entry.location;
  const prior = getLastEntryForCharacter(beats, character, index);
  return prior?.location ?? null;
};

export const getCharacterFirstEIndex = (beats: BeatEntry[][], character: PublicCharacter): number => {
  if (!Array.isArray(beats) || !beats.length) return 0;
  for (let i = 0; i < beats.length; i += 1) {
    const entry = getEntryForCharacter(beats[i], character);
    if (!entry || entry.action === DEFAULT_ACTION) {
      return i;
    }
  }
  return Math.max(0, beats.length - 1);
};

export const getTimelineEarliestEIndex = (beats: BeatEntry[][], characters: PublicCharacter[]): number => {
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

export const getTimelineResolvedIndex = (beats: BeatEntry[][]): number => {
  if (!Array.isArray(beats) || !beats.length) return -1;
  let lastResolved = -1;
  for (let i = 0; i < beats.length; i += 1) {
    const beat = beats[i];
    if (!Array.isArray(beat) || !beat.length) break;
    const allCalculated = beat.every((entry) => Boolean(entry?.calculated));
    if (!allCalculated) break;
    lastResolved = i;
  }
  return lastResolved;
};

export const isCharacterAtEarliestE = (
  beats: BeatEntry[][],
  characters: PublicCharacter[],
  character?: PublicCharacter,
): boolean => {
  if (!character) return false;
  return getCharacterFirstEIndex(beats, character) === getTimelineEarliestEIndex(beats, characters);
};

export const getCharactersAtEarliestE = (beats: BeatEntry[][], characters: PublicCharacter[]): PublicCharacter[] => {
  const earliest = getTimelineEarliestEIndex(beats, characters);
  return characters.filter((character) => getCharacterFirstEIndex(beats, character) === earliest);
};
