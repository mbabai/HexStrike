import { BeatEntry, DeckState, HexCoord, MatchOutcome, PublicCharacter } from '../types';
import {
  getCharacterFirstEIndex,
  getCharacterLocationAtIndex,
  getLastEntryForCharacter,
  getTimelineEarliestEIndex,
} from './beatTimeline';
import { DEFAULT_LAND_HEXES } from './hexGrid';

const DEFAULT_ACTION = 'E';
const DISTANCE_LOSS_THRESHOLD = 4;

const buildCoordKey = (coord: HexCoord | undefined): string | null => {
  if (!coord) return null;
  const q = Number(coord.q);
  const r = Number(coord.r);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  return `${Math.round(q)},${Math.round(r)}`;
};

const isCoordOnLand = (location: HexCoord | undefined, land: HexCoord[]): boolean => {
  if (!location || !Array.isArray(land) || !land.length) return false;
  const key = buildCoordKey(location);
  if (!key) return false;
  return land.some((tile) => buildCoordKey(tile) === key);
};

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

const getEntryForCharacter = (beat: BeatEntry[] | undefined, character: PublicCharacter): BeatEntry | null => {
  if (!Array.isArray(beat)) return null;
  return (
    beat.find((entry) => {
      if (!entry) return false;
      const key = entry.username ?? entry.userId ?? entry.userID;
      return key === character.username || key === character.userId;
    }) ?? null
  );
};

const matchesEntryForCharacter = (entry: BeatEntry, character: PublicCharacter): boolean => {
  const key = entry.username ?? entry.userId ?? entry.userID;
  return key === character.username || key === character.userId;
};

const matchesOutcomeUser = (character: PublicCharacter, outcomeUserId: string): boolean =>
  outcomeUserId === character.userId || outcomeUserId === character.username;

const getOutcomeActionForCharacter = (outcome: MatchOutcome, character: PublicCharacter): string | null => {
  if (outcome.reason === 'draw-agreement') {
    if (Array.isArray(outcome.drawUserIds) && outcome.drawUserIds.length) {
      return outcome.drawUserIds.some((userId) => matchesOutcomeUser(character, userId)) ? 'Handshake' : null;
    }
    return 'Handshake';
  }
  if (typeof outcome.loserUserId === 'string' && matchesOutcomeUser(character, outcome.loserUserId)) {
    return 'Death';
  }
  if (typeof outcome.winnerUserId === 'string' && matchesOutcomeUser(character, outcome.winnerUserId)) {
    return 'Victory';
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
    const keyA = a.username ?? a.userId ?? a.userID ?? '';
    const keyB = b.username ?? b.userId ?? b.userID ?? '';
    const indexA = order.get(keyA);
    const indexB = order.get(keyB);
    const scoreA = typeof indexA === 'number' ? indexA : Number.MAX_SAFE_INTEGER;
    const scoreB = typeof indexB === 'number' ? indexB : Number.MAX_SAFE_INTEGER;
    return scoreA - scoreB;
  });
};

const buildOutcomeEntry = (
  action: string,
  character: PublicCharacter,
  priorEntry: BeatEntry | null,
  landTiles: HexCoord[],
): BeatEntry => {
  const location = priorEntry?.location ?? character.position;
  const priorFacing = priorEntry?.facing;
  const priorDamage = priorEntry?.damage;
  const facing = Number.isFinite(priorFacing) ? priorFacing : character.facing ?? 0;
  const damage = Number.isFinite(priorDamage) ? priorDamage : 0;
  const terrain = priorEntry?.terrain ?? (isCoordOnLand(location, landTiles) ? 'land' : 'abyss');
  return {
    username: character.username ?? character.userId,
    action,
    rotation: '',
    priority: 0,
    damage,
    location: { q: location.q, r: location.r },
    terrain,
    facing,
    calculated: false,
  };
};

const hasPlayableCards = (deckState?: DeckState): boolean => {
  if (!deckState) return true;
  const hasAbility = Array.isArray(deckState.abilityHand) && deckState.abilityHand.length > 0;
  const hasMovement = Array.isArray(deckState.movement)
    && deckState.movement.some((cardId) => !deckState.exhaustedMovementIds.has(cardId));
  return hasAbility && hasMovement;
};

const getDistanceLossIndex = (
  beats: BeatEntry[][],
  character: PublicCharacter,
  landTiles: HexCoord[],
): { index: number; distance: number } | null => {
  const defaultPosition = character.position;
  let lastLocation = { q: defaultPosition.q, r: defaultPosition.r };
  if (!Array.isArray(beats) || !beats.length) {
    const distance = getDistanceToLand(lastLocation, landTiles);
    return distance > DISTANCE_LOSS_THRESHOLD ? { index: 0, distance } : null;
  }
  for (let i = 0; i < beats.length; i += 1) {
    const entry = getEntryForCharacter(beats[i], character);
    if (entry?.location) {
      lastLocation = { q: entry.location.q, r: entry.location.r };
    }
    const distance = getDistanceToLand(lastLocation, landTiles);
    if (distance > DISTANCE_LOSS_THRESHOLD) {
      return { index: i, distance };
    }
  }
  return null;
};

export const applyDeathToBeats = (
  beats: BeatEntry[][],
  characters: PublicCharacter[],
  loserUserId: string,
  deathIndex: number,
  land: HexCoord[] = DEFAULT_LAND_HEXES,
): void => {
  if (!Array.isArray(beats) || !Array.isArray(characters) || !characters.length) return;
  const target = characters.find(
    (character) => character.userId === loserUserId || character.username === loserUserId,
  );
  if (!target) return;
  const landTiles = Array.isArray(land) && land.length ? land : DEFAULT_LAND_HEXES;
  const index = Math.max(0, Math.floor(deathIndex));
  while (beats.length <= index) {
    beats.push([]);
  }
  const priorEntry = getLastEntryForCharacter(beats, target, index);
  const location = priorEntry?.location ?? target.position;
  const priorFacing = priorEntry?.facing;
  const priorDamage = priorEntry?.damage;
  const facing = Number.isFinite(priorFacing) ? priorFacing : target.facing ?? 0;
  const damage = Number.isFinite(priorDamage) ? priorDamage : 0;
  const terrain = priorEntry?.terrain ?? (isCoordOnLand(location, landTiles) ? 'land' : 'abyss');
  const deathEntry: BeatEntry = {
    username: target.username ?? target.userId,
    action: 'Death',
    rotation: '',
    priority: 0,
    damage,
    location: { q: location.q, r: location.r },
    terrain,
    facing,
    calculated: false,
  };
  const beat = beats[index] ?? [];
  const filtered = beat.filter((entry) => !matchesEntryForCharacter(entry, target));
  filtered.push(deathEntry);
  beats[index] = filtered;
  sortBeatEntries(beats[index], characters);
  for (let i = index + 1; i < beats.length; i += 1) {
    const nextBeat = beats[i];
    if (!Array.isArray(nextBeat) || !nextBeat.length) continue;
    const cleared = nextBeat.filter((entry) => !matchesEntryForCharacter(entry, target));
    if (cleared.length !== nextBeat.length) {
      beats[i] = cleared;
    }
  }
};

export const applyMatchOutcomeToBeats = (
  beats: BeatEntry[][],
  characters: PublicCharacter[],
  outcome: MatchOutcome,
  land: HexCoord[] = DEFAULT_LAND_HEXES,
): void => {
  if (!Array.isArray(beats) || !Array.isArray(characters) || !characters.length || !outcome) return;
  const landTiles = Array.isArray(land) && land.length ? land : DEFAULT_LAND_HEXES;
  const index = Math.max(0, Math.floor(Number.isFinite(outcome.beatIndex) ? outcome.beatIndex : beats.length - 1));
  while (beats.length <= index) {
    beats.push([]);
  }
  const beat = Array.isArray(beats[index]) ? beats[index] : [];
  const outcomeCharacters = characters
    .map((character) => ({
      character,
      action: getOutcomeActionForCharacter(outcome, character),
    }))
    .filter((item) => Boolean(item.action)) as Array<{ character: PublicCharacter; action: string }>;
  if (!outcomeCharacters.length) return;
  const filtered = beat.filter(
    (entry) => !outcomeCharacters.some((item) => matchesEntryForCharacter(entry, item.character)),
  );
  const outcomeEntries = outcomeCharacters.map((item) => {
    const priorEntry = getLastEntryForCharacter(beats, item.character, index);
    return buildOutcomeEntry(item.action, item.character, priorEntry, landTiles);
  });
  beats[index] = [...filtered, ...outcomeEntries];
  sortBeatEntries(beats[index], characters);
  if (beats.length > index + 1) {
    beats.splice(index + 1);
  }
};

export const evaluateMatchOutcome = (
  beats: BeatEntry[][],
  characters: PublicCharacter[],
  deckStates: Map<string, DeckState>,
  land: HexCoord[] = DEFAULT_LAND_HEXES,
): MatchOutcome | null => {
  if (!Array.isArray(characters) || !characters.length) return null;
  const landTiles = Array.isArray(land) && land.length ? land : DEFAULT_LAND_HEXES;
  const earliestIndex = getTimelineEarliestEIndex(beats, characters);
  const distanceLosses: Array<{ userId: string; lossIndex: number; distance: number }> = [];
  const losses: Array<{ userId: string; reason: MatchOutcome['reason']; beatIndex: number }> = [];

  characters.forEach((character) => {
    const beatIndex = getCharacterFirstEIndex(beats, character);
    const distanceLoss = getDistanceLossIndex(beats, character, landTiles);
    if (distanceLoss) {
      distanceLosses.push({ userId: character.userId, lossIndex: distanceLoss.index, distance: distanceLoss.distance });
      return;
    }

    const entry = getEntryForCharacter(beats[beatIndex], character);
    const action = entry?.action ?? DEFAULT_ACTION;
    const onE = action === DEFAULT_ACTION;
    if (!onE) return;
    if (beatIndex !== earliestIndex) return;
    const location = getCharacterLocationAtIndex(beats, character, beatIndex);
    if (!location) return;
    if (isCoordOnLand(location, landTiles)) return;
    if (hasPlayableCards(deckStates.get(character.userId))) return;
    losses.push({ userId: character.userId, reason: 'no-cards-abyss', beatIndex });
  });

  if (distanceLosses.length) {
    const worst = distanceLosses
      .slice()
      .sort((a, b) => {
        const indexDelta = a.lossIndex - b.lossIndex;
        if (indexDelta) return indexDelta;
        const distanceDelta = b.distance - a.distance;
        if (distanceDelta) return distanceDelta;
        return a.userId.localeCompare(b.userId);
      })[0];
    const winner = characters.find((character) => character.userId !== worst.userId);
    if (!winner) return null;
    const deathIndex = Math.max(0, worst.lossIndex + 1);
    return {
      winnerUserId: winner.userId,
      loserUserId: worst.userId,
      reason: 'far-from-land',
      beatIndex: deathIndex,
    };
  }

  if (losses.length !== 1) return null;
  const loserId = losses[0].userId;
  const winner = characters.find((character) => character.userId !== loserId);
  if (!winner) return null;
  return {
    winnerUserId: winner.userId,
    loserUserId: loserId,
    reason: losses[0].reason,
    beatIndex: losses[0].beatIndex,
  };
};
