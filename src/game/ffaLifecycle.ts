import { BeatEntry, DeckState, FfaState, HexCoord, MatchOutcome, PublicCharacter } from '../types';
import {
  getCharacterFirstEIndex,
  getCharacterLocationAtIndex,
  getLastEntryForCharacter,
  getTimelineEarliestEIndex,
  getTimelineResolvedIndex,
} from './beatTimeline';
import {
  FFA_DEATH_BEATS,
  FFA_INVULNERABLE_BEATS,
  FFA_POINTS_TO_WIN,
  FFA_RESPAWN_CENTER,
  appendBeatRange,
  cloneFfaState,
  createInitialFfaState,
  getOrCreateFfaPlayerState,
  isFfaEnabled,
  isFfaPlayerForfeited,
  isFfaPlayerInvulnerableAtBeat,
  isFfaPlayerOutAtBeat,
  listActiveFfaUserIds,
} from './ffaState';
import { getMaxAbilityHandSize, syncMovementHand } from './handRules';

type DeathReason = 'far-from-land' | 'no-cards-abyss' | 'forfeit';

interface FfaLifecycleParams {
  beats: BeatEntry[][];
  characters: PublicCharacter[];
  land: HexCoord[];
  deckStates: Map<string, DeckState>;
  ffa?: FfaState;
}

interface DeathEvent {
  userId: string;
  beatIndex: number;
  reason: DeathReason;
}

interface FfaLifecycleResult {
  ffa?: FfaState;
  outcome: MatchOutcome | null;
}

interface FfaForfeitResult extends FfaLifecycleResult {
  applied: boolean;
}

const DEFAULT_ACTION = 'E';
const DISTANCE_LOSS_THRESHOLD = 4;
const SQRT_3 = Math.sqrt(3);
const TWO_PI = Math.PI * 2;

const coordKey = (coord: HexCoord | null | undefined): string | null => {
  if (!coord) return null;
  const q = Number(coord.q);
  const r = Number(coord.r);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  return `${Math.round(q)},${Math.round(r)}`;
};

const sameCoord = (a: HexCoord | null | undefined, b: HexCoord | null | undefined): boolean =>
  Boolean(a && b && Math.round(a.q) === Math.round(b.q) && Math.round(a.r) === Math.round(b.r));

const axialDistance = (a: HexCoord, b: HexCoord): number => {
  const aq = Math.round(a.q);
  const ar = Math.round(a.r);
  const bq = Math.round(b.q);
  const br = Math.round(b.r);
  const dq = aq - bq;
  const dr = ar - br;
  const ds = (aq + ar) - (bq + br);
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
};

const getDistanceToLand = (position: HexCoord, land: HexCoord[]): number => {
  if (!Array.isArray(land) || !land.length) return Number.POSITIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  land.forEach((tile) => {
    const distance = axialDistance(position, tile);
    if (distance < min) min = distance;
  });
  return min;
};

const isCoordOnLand = (coord: HexCoord | null | undefined, land: HexCoord[]): boolean => {
  const key = coordKey(coord);
  if (!key) return false;
  return land.some((tile) => coordKey(tile) === key);
};

const normalizeBeatIndex = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
};

const normalizeDegrees = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const normalized = ((parsed % 360) + 360) % 360;
  return Number.isFinite(normalized) ? normalized : 0;
};

const normalizeRespawnCenter = (center: HexCoord | undefined): HexCoord => {
  const q = Number(center?.q);
  const r = Number(center?.r);
  if (!Number.isFinite(q) || !Number.isFinite(r)) {
    return { q: FFA_RESPAWN_CENTER.q, r: FFA_RESPAWN_CENTER.r };
  }
  return { q: Math.round(q), r: Math.round(r) };
};

const matchesCharacterEntry = (entry: BeatEntry, character: PublicCharacter): boolean => {
  const key = `${entry?.username ?? entry?.userId ?? entry?.userID ?? ''}`.trim();
  if (!key) return false;
  return key === character.userId || key === character.username;
};

const findEntryForCharacter = (beat: BeatEntry[] | undefined, character: PublicCharacter): BeatEntry | null => {
  if (!Array.isArray(beat) || !character) return null;
  return beat.find((entry) => matchesCharacterEntry(entry, character)) ?? null;
};

const sortBeatEntries = (beat: BeatEntry[], characters: PublicCharacter[]) => {
  const order = new Map<string, number>();
  characters.forEach((character, index) => {
    order.set(character.userId, index);
    order.set(character.username, index);
  });
  beat.sort((a, b) => {
    const keyA = `${a?.username ?? a?.userId ?? a?.userID ?? ''}`;
    const keyB = `${b?.username ?? b?.userId ?? b?.userID ?? ''}`;
    const indexA = order.get(keyA);
    const indexB = order.get(keyB);
    const scoreA = Number.isFinite(indexA) ? (indexA as number) : Number.MAX_SAFE_INTEGER;
    const scoreB = Number.isFinite(indexB) ? (indexB as number) : Number.MAX_SAFE_INTEGER;
    return scoreA - scoreB;
  });
};

const ensureBeatIndex = (beats: BeatEntry[][], index: number) => {
  const safeIndex = normalizeBeatIndex(index);
  while (beats.length <= safeIndex) {
    beats.push([]);
  }
};

const hasPlayableCards = (deckState?: DeckState): boolean => {
  if (!deckState) return true;
  const hasAbility = Array.isArray(deckState.abilityHand) && deckState.abilityHand.length > 0;
  const hasMovement = Array.isArray(deckState.movement)
    && deckState.movement.some((cardId) => !deckState.exhaustedMovementIds.has(cardId));
  return hasAbility && hasMovement;
};

const resetDeckStateForRespawn = (deckState: DeckState | undefined): number | undefined => {
  if (!deckState) return undefined;
  if (deckState.abilityHand.length) {
    const discardedAbility = deckState.abilityHand.splice(0, deckState.abilityHand.length);
    deckState.abilityDeck.push(...discardedAbility);
  }
  deckState.exhaustedMovementIds.clear();
  deckState.movement.forEach((cardId) => {
    deckState.exhaustedMovementIds.add(cardId);
  });
  deckState.activeCardId = null;
  deckState.passiveCardId = null;
  deckState.lastRefreshIndex = null;
  deckState.focusedAbilityCardIds.clear();
  const maxHandSize = getMaxAbilityHandSize(deckState);
  while (deckState.abilityHand.length > maxHandSize) {
    const removed = deckState.abilityHand.pop();
    if (removed) deckState.abilityDeck.push(removed);
  }
  while (deckState.abilityHand.length < maxHandSize && deckState.abilityDeck.length) {
    const next = deckState.abilityDeck.shift();
    if (next) deckState.abilityHand.push(next);
  }
  deckState.exhaustedMovementIds.clear();
  syncMovementHand(deckState);
  return deckState.abilityHand.length;
};

const buildBeatEntry = ({
  character,
  action,
  location,
  damage,
  facing,
  land,
  abilityHandCount,
  respawn,
}: {
  character: PublicCharacter;
  action: string;
  location: HexCoord;
  damage: number;
  facing: number;
  land: HexCoord[];
  abilityHandCount?: number;
  respawn?: boolean;
}): BeatEntry => {
  const entry: BeatEntry = {
    username: character.username ?? character.userId,
    action,
    rotation: '',
    priority: 0,
    damage: Number.isFinite(damage) ? Math.max(0, Math.round(damage)) : 0,
    location: { q: Math.round(location.q), r: Math.round(location.r) },
    terrain: isCoordOnLand(location, land) ? 'land' : 'abyss',
    facing: normalizeDegrees(facing),
    calculated: false,
  };
  if (Number.isFinite(abilityHandCount)) {
    entry.abilityHandCount = Math.max(0, Math.floor(abilityHandCount as number));
  }
  if (respawn) {
    entry.respawn = true;
  }
  return entry;
};

const replaceEntryAtBeat = ({
  beats,
  beatIndex,
  character,
  nextEntry,
  characters,
}: {
  beats: BeatEntry[][];
  beatIndex: number;
  character: PublicCharacter;
  nextEntry: BeatEntry;
  characters: PublicCharacter[];
}) => {
  ensureBeatIndex(beats, beatIndex);
  const beat = beats[beatIndex];
  const filtered = beat.filter((entry) => !matchesCharacterEntry(entry, character));
  filtered.push(nextEntry);
  sortBeatEntries(filtered, characters);
  beats[beatIndex] = filtered;
};

const clearCharacterEntriesFromBeat = (
  beats: BeatEntry[][],
  character: PublicCharacter,
  startBeatIndex: number,
) => {
  const safeStart = normalizeBeatIndex(startBeatIndex);
  for (let i = safeStart; i < beats.length; i += 1) {
    const beat = beats[i];
    if (!Array.isArray(beat) || !beat.length) continue;
    const filtered = beat.filter((entry) => !matchesCharacterEntry(entry, character));
    if (filtered.length !== beat.length) {
      beats[i] = filtered;
    }
  }
};

const getCharacterByUserId = (characters: PublicCharacter[], userId: string): PublicCharacter | null =>
  characters.find((character) => character.userId === userId) ?? null;

const getCharacterStateAtBeat = (
  beats: BeatEntry[][],
  character: PublicCharacter,
  beatIndex: number,
): { location: HexCoord; damage: number; facing: number } => {
  const priorEntry = getLastEntryForCharacter(beats, character, beatIndex);
  const location = priorEntry?.location ?? character.position;
  const damage = Number.isFinite(priorEntry?.damage) ? Math.round(priorEntry?.damage ?? 0) : 0;
  const facing = Number.isFinite(priorEntry?.facing) ? Number(priorEntry?.facing) : character.facing;
  return {
    location: { q: Math.round(location.q), r: Math.round(location.r) },
    damage: Math.max(0, damage),
    facing: normalizeDegrees(facing),
  };
};

const toClockwiseAngle = (coord: HexCoord, center: HexCoord): number => {
  const q = coord.q - center.q;
  const r = coord.r - center.r;
  const x = SQRT_3 * (q + r / 2);
  const y = 1.5 * r;
  const angle = Math.atan2(y, x);
  return (TWO_PI - angle + TWO_PI) % TWO_PI;
};

const buildRingCoordinatesClockwise = (center: HexCoord, radius: number): HexCoord[] => {
  if (radius <= 0) return [{ q: center.q, r: center.r }];
  const candidates: HexCoord[] = [];
  for (let dq = -radius; dq <= radius; dq += 1) {
    for (let dr = -radius; dr <= radius; dr += 1) {
      const coord = { q: center.q + dq, r: center.r + dr };
      if (axialDistance(center, coord) !== radius) continue;
      candidates.push(coord);
    }
  }
  return candidates.sort((a, b) => toClockwiseAngle(a, center) - toClockwiseAngle(b, center));
};

const resolveRespawnLocation = ({
  beats,
  characters,
  ffa,
  targetUserId,
  beatIndex,
  center,
}: {
  beats: BeatEntry[][];
  characters: PublicCharacter[];
  ffa: FfaState;
  targetUserId: string;
  beatIndex: number;
  center: HexCoord;
}): HexCoord => {
  const occupied = new Set<string>();
  characters.forEach((character) => {
    if (!character?.userId || character.userId === targetUserId) return;
    if (isFfaPlayerOutAtBeat(ffa, character.userId, beatIndex)) return;
    const state = getCharacterStateAtBeat(beats, character, beatIndex);
    const key = coordKey(state.location);
    if (key) occupied.add(key);
  });
  const centerKey = coordKey(center);
  if (centerKey && !occupied.has(centerKey)) {
    return { q: center.q, r: center.r };
  }
  for (let radius = 1; radius <= 12; radius += 1) {
    const candidates = buildRingCoordinatesClockwise(center, radius);
    for (const candidate of candidates) {
      const key = coordKey(candidate);
      if (!key || occupied.has(key)) continue;
      return { q: candidate.q, r: candidate.r };
    }
  }
  return { q: center.q, r: center.r };
};

const buildFfaOutcome = ({
  winnerUserId,
  characters,
  beatIndex,
  reason,
}: {
  winnerUserId: string;
  characters: PublicCharacter[];
  beatIndex: number;
  reason: DeathReason;
}): MatchOutcome => {
  const loserUserIds = characters
    .map((character) => character.userId)
    .filter((userId) => Boolean(userId) && userId !== winnerUserId);
  return {
    winnerUserId,
    loserUserIds,
    loserUserId: loserUserIds[0],
    reason,
    beatIndex: normalizeBeatIndex(beatIndex),
  };
};

const buildFfaDrawOutcome = ({
  drawUserIds,
  beatIndex,
}: {
  drawUserIds: string[];
  beatIndex: number;
}): MatchOutcome => ({
  reason: 'draw-agreement',
  beatIndex: normalizeBeatIndex(beatIndex),
  drawUserIds: Array.from(new Set(drawUserIds.filter(Boolean))),
});

const ensurePlayerStates = (ffa: FfaState, characters: PublicCharacter[]) => {
  characters.forEach((character) => {
    if (!character?.userId) return;
    getOrCreateFfaPlayerState(ffa, character.userId);
  });
};

const updateLastHitters = ({
  beats,
  characters,
  ffa,
  fromBeatIndex,
  toBeatIndex,
}: {
  beats: BeatEntry[][];
  characters: PublicCharacter[];
  ffa: FfaState;
  fromBeatIndex: number;
  toBeatIndex: number;
}) => {
  if (toBeatIndex < fromBeatIndex) return;
  const characterByLookupKey = new Map<string, PublicCharacter>();
  characters.forEach((character) => {
    characterByLookupKey.set(character.userId, character);
    characterByLookupKey.set(character.username, character);
  });
  for (let beatIndex = Math.max(0, fromBeatIndex); beatIndex <= toBeatIndex; beatIndex += 1) {
    const beat = beats[beatIndex];
    if (!Array.isArray(beat) || !beat.length) continue;
    beat.forEach((entry) => {
      const key = `${entry?.username ?? entry?.userId ?? entry?.userID ?? ''}`.trim();
      if (!key) return;
      const character = characterByLookupKey.get(key);
      if (!character?.userId) return;
      const consequences = Array.isArray(entry?.consequences) ? entry.consequences : [];
      consequences.forEach((consequence) => {
        if (!consequence || consequence.type !== 'hit') return;
        const sourceUserId = `${consequence.sourceUserId ?? ''}`.trim();
        if (!sourceUserId || sourceUserId === character.userId) return;
        if (isFfaPlayerInvulnerableAtBeat(ffa, character.userId, beatIndex)) return;
        const state = getOrCreateFfaPlayerState(ffa, character.userId);
        state.lastHitByUserId = sourceUserId;
      });
    });
  }
};

const collectZoneDeaths = ({
  beats,
  characters,
  land,
  ffa,
  fromBeatIndex,
  toBeatIndex,
}: {
  beats: BeatEntry[][];
  characters: PublicCharacter[];
  land: HexCoord[];
  ffa: FfaState;
  fromBeatIndex: number;
  toBeatIndex: number;
}): DeathEvent[] => {
  if (toBeatIndex < fromBeatIndex) return [];
  const pending = new Map<string, DeathEvent>();
  for (let beatIndex = Math.max(0, fromBeatIndex); beatIndex <= toBeatIndex; beatIndex += 1) {
    characters.forEach((character) => {
      if (!character?.userId) return;
      if (isFfaPlayerForfeited(ffa, character.userId)) return;
      if (pending.has(character.userId)) return;
      if (isFfaPlayerOutAtBeat(ffa, character.userId, beatIndex)) return;
      const location = getCharacterLocationAtIndex(beats, character, beatIndex);
      if (!location) return;
      const distance = getDistanceToLand(location, land);
      if (distance <= DISTANCE_LOSS_THRESHOLD) return;
      pending.set(character.userId, {
        userId: character.userId,
        beatIndex: beatIndex + 1,
        reason: 'far-from-land',
      });
    });
  }
  return Array.from(pending.values());
};

const collectNoCardDeaths = ({
  beats,
  characters,
  land,
  deckStates,
  ffa,
}: {
  beats: BeatEntry[][];
  characters: PublicCharacter[];
  land: HexCoord[];
  deckStates: Map<string, DeckState>;
  ffa: FfaState;
}): DeathEvent[] => {
  const activeCharacters = characters.filter((character) => !isFfaPlayerForfeited(ffa, character.userId));
  if (!activeCharacters.length) return [];
  const earliestIndex = getTimelineEarliestEIndex(beats, activeCharacters);
  return activeCharacters
    .map((character) => {
      if (isFfaPlayerOutAtBeat(ffa, character.userId, earliestIndex)) return null;
      const firstOpen = getCharacterFirstEIndex(beats, character);
      if (firstOpen !== earliestIndex) return null;
      const entry = findEntryForCharacter(beats[earliestIndex], character);
      const action = `${entry?.action ?? DEFAULT_ACTION}`.trim().toUpperCase();
      if (action !== DEFAULT_ACTION) return null;
      const location = getCharacterLocationAtIndex(beats, character, earliestIndex);
      if (!location || isCoordOnLand(location, land)) return null;
      if (hasPlayableCards(deckStates.get(character.userId))) return null;
      return {
        userId: character.userId,
        beatIndex: earliestIndex,
        reason: 'no-cards-abyss' as DeathReason,
      };
    })
    .filter(Boolean) as DeathEvent[];
};

const dedupeDeathEvents = (events: DeathEvent[]): DeathEvent[] => {
  const deduped = new Map<string, DeathEvent>();
  events.forEach((event) => {
    const existing = deduped.get(event.userId);
    if (!existing) {
      deduped.set(event.userId, event);
      return;
    }
    if (event.beatIndex < existing.beatIndex) {
      deduped.set(event.userId, event);
      return;
    }
    if (event.beatIndex === existing.beatIndex && event.reason === 'forfeit') {
      deduped.set(event.userId, event);
    }
  });
  return Array.from(deduped.values()).sort((a, b) => a.beatIndex - b.beatIndex || a.userId.localeCompare(b.userId));
};

const applyDeathEvent = ({
  beats,
  characters,
  land,
  deckStates,
  ffa,
  event,
}: {
  beats: BeatEntry[][];
  characters: PublicCharacter[];
  land: HexCoord[];
  deckStates: Map<string, DeckState>;
  ffa: FfaState;
  event: DeathEvent;
}) => {
  const character = getCharacterByUserId(characters, event.userId);
  if (!character) return;
  const state = getOrCreateFfaPlayerState(ffa, event.userId);
  const beatIndex = normalizeBeatIndex(event.beatIndex);
  const priorState = getCharacterStateAtBeat(beats, character, Math.max(0, beatIndex - 1));

  clearCharacterEntriesFromBeat(beats, character, beatIndex);

  if (event.reason === 'forfeit') {
    state.forfeited = true;
    state.invulnerableWindows = [];
    state.deathWindows = [];
    replaceEntryAtBeat({
      beats,
      beatIndex,
      character,
      nextEntry: buildBeatEntry({
        character,
        action: 'Death',
        location: priorState.location,
        damage: priorState.damage,
        facing: priorState.facing,
        land,
      }),
      characters,
    });
    state.lastHitByUserId = null;
    return;
  }

  const deathBeats = Number.isFinite(ffa.deathBeats) ? Math.max(1, Math.floor(ffa.deathBeats)) : FFA_DEATH_BEATS;
  const invulnerableBeats = Number.isFinite(ffa.invulnerableBeats)
    ? Math.max(0, Math.floor(ffa.invulnerableBeats))
    : FFA_INVULNERABLE_BEATS;
  const deathStart = beatIndex;
  const deathEnd = deathStart + deathBeats - 1;
  const respawnBeat = deathEnd + 1;
  const invulnerableEnd = respawnBeat + Math.max(0, invulnerableBeats - 1);
  state.deathWindows = appendBeatRange(state.deathWindows, {
    startBeatIndex: deathStart,
    endBeatIndex: deathEnd,
  });
  if (invulnerableBeats > 0) {
    state.invulnerableWindows = appendBeatRange(state.invulnerableWindows, {
      startBeatIndex: respawnBeat,
      endBeatIndex: invulnerableEnd,
    });
  }
  state.lastHitByUserId = null;
  const respawnAbilityHandCount = resetDeckStateForRespawn(deckStates.get(character.userId));

  ensureBeatIndex(beats, respawnBeat);
  for (let i = deathStart; i <= deathEnd; i += 1) {
    replaceEntryAtBeat({
      beats,
      beatIndex: i,
      character,
      nextEntry: buildBeatEntry({
        character,
        action: 'Death',
        location: priorState.location,
        damage: priorState.damage,
        facing: priorState.facing,
        land,
      }),
      characters,
    });
  }

  const respawnLocation = resolveRespawnLocation({
    beats,
    characters,
    ffa,
    targetUserId: character.userId,
    beatIndex: respawnBeat,
    center: normalizeRespawnCenter(ffa.respawnCenter),
  });
  replaceEntryAtBeat({
    beats,
    beatIndex: respawnBeat,
    character,
    nextEntry: buildBeatEntry({
      character,
      action: DEFAULT_ACTION,
      location: respawnLocation,
      damage: 0,
      facing: priorState.facing,
      land,
      respawn: true,
      abilityHandCount: respawnAbilityHandCount,
    }),
    characters,
  });
};

const getScoreForUser = (ffa: FfaState, userId: string): number => {
  const state = getOrCreateFfaPlayerState(ffa, userId);
  return Number.isFinite(state.score) ? Math.max(0, Math.floor(state.score)) : 0;
};

const setScoreForUser = (ffa: FfaState, userId: string, score: number) => {
  const state = getOrCreateFfaPlayerState(ffa, userId);
  state.score = Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
};

const resolveOutcomeAfterBeat = ({
  beatEvents,
  characters,
  ffa,
  pointsAwarded,
}: {
  beatEvents: DeathEvent[];
  characters: PublicCharacter[];
  ffa: FfaState;
  pointsAwarded: Map<string, number>;
}): MatchOutcome | null => {
  const pointsToWin = Number.isFinite(ffa.pointsToWin) ? Math.max(1, Math.floor(ffa.pointsToWin)) : FFA_POINTS_TO_WIN;
  pointsAwarded.forEach((award, userId) => {
    if (!award) return;
    const previous = getScoreForUser(ffa, userId);
    const next = previous + award;
    setScoreForUser(ffa, userId, next);
  });
  const beatIndex = beatEvents.length ? beatEvents[0].beatIndex : 0;
  const activeUsers = listActiveFfaUserIds(ffa, characters);
  const winners = activeUsers.filter((userId) => getScoreForUser(ffa, userId) >= pointsToWin);
  if (winners.length >= 2) {
    return buildFfaDrawOutcome({
      drawUserIds: activeUsers,
      beatIndex,
    });
  }
  if (winners.length === 1) {
    const reason = beatEvents[0]?.reason ?? 'far-from-land';
    return buildFfaOutcome({
      winnerUserId: winners[0],
      characters,
      beatIndex,
      reason,
    });
  }
  const remainingUsers = listActiveFfaUserIds(ffa, characters);
  if (remainingUsers.length === 1) {
    return buildFfaOutcome({
      winnerUserId: remainingUsers[0],
      characters,
      beatIndex,
      reason: 'forfeit',
    });
  }
  return null;
};

const resolveOutcomeFromCurrentScores = ({
  characters,
  ffa,
  beatIndex,
}: {
  characters: PublicCharacter[];
  ffa: FfaState;
  beatIndex: number;
}): MatchOutcome | null => {
  const pointsToWin = Number.isFinite(ffa.pointsToWin) ? Math.max(1, Math.floor(ffa.pointsToWin)) : FFA_POINTS_TO_WIN;
  const activeUsers = listActiveFfaUserIds(ffa, characters);
  const winners = activeUsers.filter((userId) => getScoreForUser(ffa, userId) >= pointsToWin);
  if (winners.length >= 2) {
    return buildFfaDrawOutcome({
      drawUserIds: activeUsers,
      beatIndex,
    });
  }
  if (winners.length === 1) {
    return buildFfaOutcome({
      winnerUserId: winners[0],
      characters,
      beatIndex,
      reason: 'far-from-land',
    });
  }
  return null;
};

const applyDeathEvents = ({
  beats,
  characters,
  land,
  deckStates,
  ffa,
  events,
}: {
  beats: BeatEntry[][];
  characters: PublicCharacter[];
  land: HexCoord[];
  deckStates: Map<string, DeckState>;
  ffa: FfaState;
  events: DeathEvent[];
}): MatchOutcome | null => {
  if (!events.length) return null;
  const grouped = new Map<number, DeathEvent[]>();
  events.forEach((event) => {
    const beatIndex = normalizeBeatIndex(event.beatIndex);
    const list = grouped.get(beatIndex) ?? [];
    list.push({ ...event, beatIndex });
    grouped.set(beatIndex, list);
  });
  const beatIndices = Array.from(grouped.keys()).sort((a, b) => a - b);
  for (const beatIndex of beatIndices) {
    const beatEvents = grouped.get(beatIndex) ?? [];
    const pointsAwarded = new Map<string, number>();
    beatEvents.forEach((event) => {
      const state = getOrCreateFfaPlayerState(ffa, event.userId);
      if (state.forfeited) return;
      const scorer = `${state.lastHitByUserId ?? ''}`.trim();
      const canCreditFromLastHit =
        Boolean(scorer) &&
        scorer !== event.userId &&
        !isFfaPlayerForfeited(ffa, scorer) &&
        (event.reason === 'forfeit' || !isFfaPlayerInvulnerableAtBeat(ffa, event.userId, beatIndex));
      if (canCreditFromLastHit) {
        pointsAwarded.set(scorer, (pointsAwarded.get(scorer) ?? 0) + 1);
      }
      applyDeathEvent({ beats, characters, land, deckStates, ffa, event: { ...event, beatIndex } });
    });
    const outcome = resolveOutcomeAfterBeat({ beatEvents, characters, ffa, pointsAwarded });
    if (outcome) return outcome;
  }
  return null;
};

const ensureFfaState = (existing: FfaState | undefined, characters: PublicCharacter[]): FfaState | undefined => {
  const cloned = cloneFfaState(existing);
  if (isFfaEnabled(cloned)) {
    ensurePlayerStates(cloned as FfaState, characters);
    return cloned as FfaState;
  }
  const initialized = createInitialFfaState(characters);
  if (!initialized) return undefined;
  ensurePlayerStates(initialized, characters);
  return initialized;
};

export const applyFfaLifecycle = ({
  beats,
  characters,
  land,
  deckStates,
  ffa,
}: FfaLifecycleParams): FfaLifecycleResult => {
  const nextFfa = ensureFfaState(ffa, characters);
  if (!isFfaEnabled(nextFfa)) {
    return { ffa: undefined, outcome: null };
  }
  const resolvedIndex = getTimelineResolvedIndex(beats);
  const fromBeatIndex = Math.max(0, (nextFfa?.lastProcessedBeatIndex ?? -1) + 1);
  if (resolvedIndex >= fromBeatIndex) {
    updateLastHitters({
      beats,
      characters,
      ffa: nextFfa as FfaState,
      fromBeatIndex,
      toBeatIndex: resolvedIndex,
    });
  }
  const zoneDeaths = collectZoneDeaths({
    beats,
    characters,
    land,
    ffa: nextFfa as FfaState,
    fromBeatIndex,
    toBeatIndex: resolvedIndex,
  });
  const noCardDeaths = collectNoCardDeaths({
    beats,
    characters,
    land,
    deckStates,
    ffa: nextFfa as FfaState,
  });
  const events = dedupeDeathEvents([...zoneDeaths, ...noCardDeaths]);
  const outcome = applyDeathEvents({
    beats,
    characters,
    land,
    deckStates,
    ffa: nextFfa as FfaState,
    events,
  }) ?? resolveOutcomeFromCurrentScores({
    characters,
    ffa: nextFfa as FfaState,
    beatIndex: Math.max(0, resolvedIndex + 1),
  });
  (nextFfa as FfaState).lastProcessedBeatIndex = Math.max(
    Number.isFinite((nextFfa as FfaState).lastProcessedBeatIndex)
      ? Math.floor((nextFfa as FfaState).lastProcessedBeatIndex)
      : -1,
    resolvedIndex,
  );
  return {
    ffa: nextFfa,
    outcome,
  };
};

export const applyFfaForfeit = ({
  beats,
  characters,
  land,
  deckStates,
  ffa,
  userId,
  beatIndex,
}: FfaLifecycleParams & { userId: string; beatIndex: number }): FfaForfeitResult => {
  const nextFfa = ensureFfaState(ffa, characters);
  if (!isFfaEnabled(nextFfa)) {
    return { ffa: undefined, outcome: null, applied: false };
  }
  const target = getCharacterByUserId(characters, userId);
  if (!target || isFfaPlayerForfeited(nextFfa as FfaState, userId)) {
    return { ffa: nextFfa, outcome: null, applied: false };
  }
  const resolvedIndex = getTimelineResolvedIndex(beats);
  const fromBeatIndex = Math.max(0, (nextFfa as FfaState).lastProcessedBeatIndex + 1);
  if (resolvedIndex >= fromBeatIndex) {
    updateLastHitters({
      beats,
      characters,
      ffa: nextFfa as FfaState,
      fromBeatIndex,
      toBeatIndex: resolvedIndex,
    });
  }
  const lifecycleBeforeForfeit = applyFfaLifecycle({
    beats,
    characters,
    land,
    deckStates,
    ffa: nextFfa,
  });
  if (lifecycleBeforeForfeit.outcome) {
    return {
      ffa: lifecycleBeforeForfeit.ffa,
      outcome: lifecycleBeforeForfeit.outcome,
      applied: false,
    };
  }
  const forfeitEvents = dedupeDeathEvents([
    { userId, beatIndex: normalizeBeatIndex(beatIndex), reason: 'forfeit' as DeathReason },
  ]);
  const outcome = applyDeathEvents({
    beats,
    characters,
    land,
    deckStates,
    ffa: lifecycleBeforeForfeit.ffa as FfaState,
    events: forfeitEvents,
  }) ?? resolveOutcomeFromCurrentScores({
    characters,
    ffa: lifecycleBeforeForfeit.ffa as FfaState,
    beatIndex: Math.max(0, normalizeBeatIndex(beatIndex)),
  });
  return {
    ffa: lifecycleBeforeForfeit.ffa,
    outcome,
    applied: true,
  };
};
