import { BeatRange, FfaPlayerState, FfaState, HexCoord, PublicCharacter } from '../types';

export const FFA_MIN_PLAYERS = 3;
export const FFA_POINTS_TO_WIN = 2;
export const FFA_DEATH_BEATS = 10;
export const FFA_INVULNERABLE_BEATS = 5;
export const FFA_RESPAWN_CENTER: HexCoord = { q: 0, r: 0 };

const toBeatIndex = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
};

const normalizeRange = (range: BeatRange): BeatRange => {
  const start = toBeatIndex(range.startBeatIndex);
  const end = Math.max(start, toBeatIndex(range.endBeatIndex));
  return { startBeatIndex: start, endBeatIndex: end };
};

const cloneRange = (range: BeatRange): BeatRange => ({
  startBeatIndex: range.startBeatIndex,
  endBeatIndex: range.endBeatIndex,
});

const clonePlayerState = (state: FfaPlayerState): FfaPlayerState => ({
  score: Number.isFinite(state.score) ? Math.max(0, Math.floor(state.score)) : 0,
  lastHitByUserId: typeof state.lastHitByUserId === 'string' ? state.lastHitByUserId : null,
  deathWindows: Array.isArray(state.deathWindows) ? state.deathWindows.map((range) => normalizeRange(range)) : [],
  invulnerableWindows: Array.isArray(state.invulnerableWindows)
    ? state.invulnerableWindows.map((range) => normalizeRange(range))
    : [],
  forfeited: Boolean(state.forfeited),
});

const buildDefaultPlayerState = (): FfaPlayerState => ({
  score: 0,
  lastHitByUserId: null,
  deathWindows: [],
  invulnerableWindows: [],
  forfeited: false,
});

export const cloneFfaState = (ffa: FfaState | null | undefined): FfaState | undefined => {
  if (!ffa || !ffa.enabled) return undefined;
  const playerStates: Record<string, FfaPlayerState> = {};
  Object.entries(ffa.playerStates ?? {}).forEach(([userId, state]) => {
    if (!userId) return;
    playerStates[userId] = clonePlayerState(state ?? buildDefaultPlayerState());
  });
  return {
    enabled: true,
    pointsToWin: Number.isFinite(ffa.pointsToWin) ? Math.max(1, Math.floor(ffa.pointsToWin)) : FFA_POINTS_TO_WIN,
    deathBeats: Number.isFinite(ffa.deathBeats) ? Math.max(1, Math.floor(ffa.deathBeats)) : FFA_DEATH_BEATS,
    invulnerableBeats: Number.isFinite(ffa.invulnerableBeats)
      ? Math.max(0, Math.floor(ffa.invulnerableBeats))
      : FFA_INVULNERABLE_BEATS,
    respawnCenter: {
      q: Number.isFinite(ffa.respawnCenter?.q) ? Math.round(ffa.respawnCenter.q) : FFA_RESPAWN_CENTER.q,
      r: Number.isFinite(ffa.respawnCenter?.r) ? Math.round(ffa.respawnCenter.r) : FFA_RESPAWN_CENTER.r,
    },
    lastProcessedBeatIndex: Number.isFinite(ffa.lastProcessedBeatIndex)
      ? Math.max(-1, Math.floor(ffa.lastProcessedBeatIndex))
      : -1,
    playerStates,
  };
};

export const isFfaEnabled = (ffa: FfaState | null | undefined): boolean => Boolean(ffa?.enabled);

export const createInitialFfaState = (characters: PublicCharacter[]): FfaState | undefined => {
  if (!Array.isArray(characters) || characters.length < FFA_MIN_PLAYERS) return undefined;
  const playerStates: Record<string, FfaPlayerState> = {};
  characters.forEach((character) => {
    if (!character?.userId) return;
    playerStates[character.userId] = buildDefaultPlayerState();
  });
  return {
    enabled: true,
    pointsToWin: FFA_POINTS_TO_WIN,
    deathBeats: FFA_DEATH_BEATS,
    invulnerableBeats: FFA_INVULNERABLE_BEATS,
    respawnCenter: { q: FFA_RESPAWN_CENTER.q, r: FFA_RESPAWN_CENTER.r },
    lastProcessedBeatIndex: -1,
    playerStates,
  };
};

export const getOrCreateFfaPlayerState = (ffa: FfaState | undefined, userId: string): FfaPlayerState => {
  if (!ffa || !userId) return buildDefaultPlayerState();
  const existing = ffa.playerStates[userId];
  if (existing) return existing;
  const created = buildDefaultPlayerState();
  ffa.playerStates[userId] = created;
  return created;
};

export const isBeatInRanges = (beatIndex: number, ranges: BeatRange[] | undefined): boolean => {
  if (!Number.isFinite(beatIndex) || !Array.isArray(ranges) || !ranges.length) return false;
  const safeBeat = Math.max(0, Math.floor(beatIndex));
  return ranges.some((range) => {
    const normalized = normalizeRange(range);
    return safeBeat >= normalized.startBeatIndex && safeBeat <= normalized.endBeatIndex;
  });
};

export const isFfaPlayerForfeited = (ffa: FfaState | undefined, userId: string): boolean => {
  if (!isFfaEnabled(ffa) || !userId) return false;
  return Boolean(ffa?.playerStates?.[userId]?.forfeited);
};

export const isFfaPlayerOutAtBeat = (
  ffa: FfaState | undefined,
  userId: string,
  beatIndex: number,
): boolean => {
  if (!isFfaEnabled(ffa) || !userId) return false;
  if (isFfaPlayerForfeited(ffa, userId)) return true;
  return isBeatInRanges(beatIndex, ffa?.playerStates?.[userId]?.deathWindows);
};

export const isFfaPlayerInvulnerableAtBeat = (
  ffa: FfaState | undefined,
  userId: string,
  beatIndex: number,
): boolean => {
  if (!isFfaEnabled(ffa) || !userId) return false;
  return isBeatInRanges(beatIndex, ffa?.playerStates?.[userId]?.invulnerableWindows);
};

export const listActiveFfaUserIds = (ffa: FfaState | undefined, characters: PublicCharacter[]): string[] => {
  if (!Array.isArray(characters) || !characters.length) return [];
  if (!isFfaEnabled(ffa)) return characters.map((character) => character.userId).filter(Boolean);
  return characters
    .map((character) => character.userId)
    .filter((userId) => Boolean(userId) && !isFfaPlayerForfeited(ffa, userId));
};

export const appendBeatRange = (ranges: BeatRange[], nextRange: BeatRange): BeatRange[] => {
  const normalized = normalizeRange(nextRange);
  if (!Array.isArray(ranges) || !ranges.length) return [normalized];
  const sorted = [...ranges.map((range) => normalizeRange(range)), normalized].sort(
    (a, b) => a.startBeatIndex - b.startBeatIndex || a.endBeatIndex - b.endBeatIndex,
  );
  const merged: BeatRange[] = [];
  sorted.forEach((range) => {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push(cloneRange(range));
      return;
    }
    if (range.startBeatIndex > previous.endBeatIndex + 1) {
      merged.push(cloneRange(range));
      return;
    }
    previous.endBeatIndex = Math.max(previous.endBeatIndex, range.endBeatIndex);
  });
  return merged;
};
