import type { BeatEntry, CustomInteraction, PublicCharacter } from '../../types';

const DEFAULT_ACTION = 'E';
const FOCUS_ACTION = 'F';

const isOpenBeatAction = (action: string | null | undefined): boolean => {
  const normalized = `${action ?? ''}`.trim().toUpperCase();
  return normalized === DEFAULT_ACTION || normalized === FOCUS_ACTION;
};

const getEntryForCharacter = (beat: BeatEntry[] | undefined, character: PublicCharacter): BeatEntry | undefined => {
  if (!Array.isArray(beat)) return undefined;
  return beat.find((entry) => {
    if (!entry) return false;
    const key = entry.username ?? entry.userId ?? entry.userID;
    return key === character.username || key === character.userId;
  });
};

export const getBeatEntryForCharacter = (
  beat: BeatEntry[] | undefined,
  character: PublicCharacter,
): BeatEntry | null => getEntryForCharacter(beat, character) ?? null;

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
  const resolvedIndex = getTimelineResolvedIndex(beats);
  const startIndex = Math.max(0, resolvedIndex + 1);
  for (let i = startIndex; i < beats.length; i += 1) {
    const entry = getEntryForCharacter(beats[i], character);
    if (!entry || isOpenBeatAction(entry.action)) {
      return i;
    }
  }
  return Math.max(0, Math.min(startIndex, beats.length - 1));
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

export const getEarliestPendingInteractionIndex = (
  interactions: CustomInteraction[] | undefined,
): number | null => {
  if (!Array.isArray(interactions) || !interactions.length) return null;
  const pending = interactions
    .filter((interaction) => interaction?.status === 'pending' && Number.isFinite(interaction?.beatIndex))
    .map((interaction) => interaction.beatIndex);
  if (!pending.length) return null;
  return Math.min(...pending);
};

export const getTimelineStopIndex = (
  beats: BeatEntry[][],
  characters: PublicCharacter[],
  interactions: CustomInteraction[] = [],
  options: { alwaysStopTypes?: string[] } = {},
): number => {
  const earliestE = getTimelineEarliestEIndex(beats, characters);
  const resolvedIndex = getTimelineResolvedIndex(beats);
  const pending = (interactions ?? []).filter(
    (interaction) => interaction?.status === 'pending' && Number.isFinite(interaction?.beatIndex),
  );
  const pendingIndex = pending.length ? Math.min(...pending.map((interaction) => interaction.beatIndex)) : null;
  const alwaysStopTypes = new Set(
    options.alwaysStopTypes ?? [
      'throw',
      'discard',
      'hand-trigger',
      'draw',
      'haven-platform',
      'guard-continue',
      'rewind-return',
      'draw-offer',
    ],
  );
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
