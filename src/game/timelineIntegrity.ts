import { BeatEntry, CustomInteraction, PublicCharacter } from '../types';

const DEFAULT_ACTION = 'E';
const FOCUS_ACTION = 'F';
const REWIND_RETURN_INTERACTION_TYPE = 'rewind-return';

export type TimelineBreakIssue = {
  type: 'open-before-protected-start';
  userId: string;
  username: string;
  beatIndex: number;
  protectedStartIndex: number;
  breakKind: 'missing' | 'open';
  action: string | null;
};

export type TimelineRepair = {
  userId: string;
  username: string;
  beatIndex: number;
  restoredAction: string;
  replacedAction: string | null;
};

const getEntryKey = (entry: BeatEntry | null | undefined): string => `${entry?.username ?? entry?.userId ?? entry?.userID ?? ''}`;

const matchesEntryForCharacter = (entry: BeatEntry | null | undefined, character: PublicCharacter): boolean => {
  if (!entry || !character) return false;
  const key = getEntryKey(entry);
  return key === character.userId || key === character.username;
};

const findEntryForCharacter = (beat: BeatEntry[] | null | undefined, character: PublicCharacter): BeatEntry | null => {
  if (!Array.isArray(beat) || !character) return null;
  for (const entry of beat) {
    if (matchesEntryForCharacter(entry, character)) return entry;
  }
  return null;
};

const cloneEntry = (entry: BeatEntry): BeatEntry => {
  const cloned: BeatEntry = {
    ...entry,
    location: entry.location ? { q: entry.location.q, r: entry.location.r } : { q: 0, r: 0 },
  };
  if (Array.isArray(entry.consequences)) {
    cloned.consequences = entry.consequences.map((item) => ({ ...item }));
  }
  return cloned;
};

const isOpenBeatAction = (action: string | null | undefined): boolean => {
  const normalized = `${action ?? ''}`.trim().toUpperCase();
  return normalized === DEFAULT_ACTION || normalized === FOCUS_ACTION;
};

const isActionSetStart = (entry: BeatEntry | null | undefined): boolean => {
  if (!entry) return false;
  const rotationSource = `${entry.rotationSource ?? ''}`.trim();
  return rotationSource === 'selected' || Boolean(entry.comboStarter);
};

const hasCommittedRewindReturnStart = (
  interactions: CustomInteraction[] | undefined,
  userId: string,
  beatIndex: number,
): boolean => {
  if (!Array.isArray(interactions) || !userId || !Number.isFinite(beatIndex)) return false;
  const safeBeatIndex = Math.max(0, Math.round(beatIndex));
  return interactions.some((interaction) => {
    if (!interaction || interaction.type !== REWIND_RETURN_INTERACTION_TYPE) return false;
    if (interaction.status !== 'resolved') return false;
    if (!interaction.resolution?.returnToAnchor) return false;
    if (interaction.actorUserId !== userId) return false;
    if (!Number.isFinite(interaction.beatIndex)) return false;
    return Math.max(0, Math.round(interaction.beatIndex)) === safeBeatIndex;
  });
};

const getEarliestProtectedStartIndex = (
  beats: BeatEntry[][],
  character: PublicCharacter,
  interactions: CustomInteraction[] | undefined,
  startIndex: number,
): number | null => {
  const safeStartIndex = Math.max(0, Math.round(startIndex));
  for (let i = safeStartIndex; i < beats.length; i += 1) {
    const beat = beats[i];
    const entry = findEntryForCharacter(beat, character);
    if (isActionSetStart(entry) || hasCommittedRewindReturnStart(interactions, character.userId, i)) {
      return i;
    }
  }
  return null;
};

const sortBeatEntries = (beat: BeatEntry[], characters: PublicCharacter[]) => {
  const order = new Map<string, number>();
  characters.forEach((character, index) => {
    order.set(character.userId, index);
    order.set(character.username, index);
  });
  beat.sort((a, b) => {
    const orderA = order.get(getEntryKey(a));
    const orderB = order.get(getEntryKey(b));
    const scoreA = Number.isFinite(orderA) ? (orderA as number) : Number.MAX_SAFE_INTEGER;
    const scoreB = Number.isFinite(orderB) ? (orderB as number) : Number.MAX_SAFE_INTEGER;
    return scoreA - scoreB;
  });
};

export const findTimelineBreaks = ({
  beats,
  baselineBeats,
  characters,
  interactions = [],
  resolvedIndex = -1,
}: {
  beats: BeatEntry[][];
  baselineBeats?: BeatEntry[][];
  characters: PublicCharacter[];
  interactions?: CustomInteraction[];
  resolvedIndex?: number;
}): TimelineBreakIssue[] => {
  if (!Array.isArray(beats) || !Array.isArray(characters) || !characters.length) return [];
  const issues: TimelineBreakIssue[] = [];
  const scanStartIndex = Math.max(0, Math.round(resolvedIndex) + 1);

  characters.forEach((character) => {
    const protectedStartIndex = getEarliestProtectedStartIndex(beats, character, interactions, scanStartIndex);
    if (protectedStartIndex == null) return;
    for (let i = scanStartIndex; i < protectedStartIndex; i += 1) {
      if (Array.isArray(baselineBeats)) {
        const baselineEntry = findEntryForCharacter(baselineBeats[i], character);
        if (!baselineEntry || isOpenBeatAction(baselineEntry.action)) {
          continue;
        }
      }
      const entry = findEntryForCharacter(beats[i], character);
      if (!entry) {
        issues.push({
          type: 'open-before-protected-start',
          userId: character.userId,
          username: character.username,
          beatIndex: i,
          protectedStartIndex,
          breakKind: 'missing',
          action: null,
        });
        continue;
      }
      if (isOpenBeatAction(entry.action)) {
        issues.push({
          type: 'open-before-protected-start',
          userId: character.userId,
          username: character.username,
          beatIndex: i,
          protectedStartIndex,
          breakKind: 'open',
          action: `${entry.action ?? ''}`.trim() || null,
        });
      }
    }
  });

  return issues;
};

export const repairTimelineBreaksFromBaseline = ({
  beats,
  baselineBeats,
  characters,
  interactions = [],
  resolvedIndex = -1,
}: {
  beats: BeatEntry[][];
  baselineBeats: BeatEntry[][];
  characters: PublicCharacter[];
  interactions?: CustomInteraction[];
  resolvedIndex?: number;
}): TimelineRepair[] => {
  if (!Array.isArray(beats) || !Array.isArray(baselineBeats) || !Array.isArray(characters) || !characters.length) {
    return [];
  }
  const repairs: TimelineRepair[] = [];
  const scanStartIndex = Math.max(0, Math.round(resolvedIndex) + 1);

  characters.forEach((character) => {
    const protectedStartIndex = getEarliestProtectedStartIndex(beats, character, interactions, scanStartIndex);
    if (protectedStartIndex == null) return;
    for (let i = scanStartIndex; i < protectedStartIndex; i += 1) {
      const baselineEntry = findEntryForCharacter(baselineBeats[i], character);
      if (!baselineEntry || isOpenBeatAction(baselineEntry.action)) continue;

      while (beats.length <= i) {
        beats.push([]);
      }
      const beat = beats[i];
      const currentEntry = findEntryForCharacter(beat, character);
      if (currentEntry && !isOpenBeatAction(currentEntry.action)) continue;

      const replacement = cloneEntry(baselineEntry);
      const replacedAction = currentEntry ? `${currentEntry.action ?? ''}`.trim() || null : null;
      if (currentEntry) {
        const currentIndex = beat.indexOf(currentEntry);
        if (currentIndex >= 0) {
          beat[currentIndex] = replacement;
        } else {
          beat.push(replacement);
        }
      } else {
        beat.push(replacement);
      }

      for (let j = beat.length - 1; j >= 0; j -= 1) {
        const candidate = beat[j];
        if (candidate === currentEntry) continue;
        if (candidate === replacement) continue;
        if (matchesEntryForCharacter(candidate, character)) {
          beat.splice(j, 1);
        }
      }
      if (beat.length > 1) {
        sortBeatEntries(beat, characters);
      }

      repairs.push({
        userId: character.userId,
        username: character.username,
        beatIndex: i,
        restoredAction: replacement.action,
        replacedAction,
      });
    }
  });

  return repairs;
};
