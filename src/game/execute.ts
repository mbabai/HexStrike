import { BeatEntry, BoardToken, CustomInteraction, HexCoord, PublicCharacter } from '../types';
import {
  getActiveHitDiscardRule,
  getPassiveBlockDiscardCount,
  getPassiveStartDiscardCount,
  isCenterAttackPath,
  isDiscardImmune,
  shouldConvertKbfToDiscard,
} from './cardText/discardEffects';
import { getPassiveKbfReduction, isThrowImmune } from './cardText/combatModifiers';
import { getTimelineResolvedIndex } from './beatTimeline';
import { isBracketedAction, normalizeActionToken } from './cardText/actionListTransforms';
import { DEFAULT_LAND_HEXES } from './hexGrid';
import { getHandTriggerDefinition } from './handTriggers';

const DEFAULT_ACTION = 'E';
const LOG_PREFIX = '[execute]';
const WAIT_ACTION = 'W';
const COMBO_ACTION = 'CO';
const DAMAGE_ICON_ACTION = 'DamageIcon';
const KNOCKBACK_DIVISOR = 10;
const THROW_DISTANCE = 2;
const FIRE_HEX_TOKEN_TYPE = 'fire-hex';
const ARROW_TOKEN_TYPE = 'arrow';
const ARROW_DAMAGE = 4;
const ARROW_KBF = 1;
const ARROW_LAND_DISTANCE_LIMIT = 5;
const BOW_SHOT_CARD_ID = 'bow-shot';
const BURNING_STRIKE_CARD_ID = 'burning-strike';
const SINKING_SHOT_CARD_ID = 'sinking-shot';
const VENGEANCE_CARD_ID = 'vengeance';
const IRON_WILL_CARD_ID = 'iron-will';
const JAB_CARD_ID = 'jab';
const ABSORB_CARD_ID = 'absorb';
const GIGANTIC_STAFF_CARD_ID = 'gigantic-staff';
const HAMMER_CARD_ID = 'hammer';
const HEALING_HARMONY_CARD_ID = 'healing-harmony';
const PARRY_CARD_ID = 'parry';
const STAB_CARD_ID = 'stab';
const CROSS_SLASH_CARD_ID = 'cross-slash';
// Keep in sync with cardRules/pendingActionPreview throw detection.
const ACTIVE_THROW_CARD_IDS = new Set(['hip-throw', 'tackle']);
const PASSIVE_THROW_CARD_IDS = new Set(['leap']);
const GRAPPLING_HOOK_CARD_ID = 'grappling-hook';
type BlockSource = {
  actorId: string;
  cardId?: string;
  passiveCardId?: string;
  action?: string;
};

const LOCAL_DIRECTIONS = {
  F: { q: 1, r: 0 },
  B: { q: -1, r: 0 },
  L: { q: 1, r: -1 },
  R: { q: 0, r: 1 },
  BL: { q: -1, r: 1 },
  BR: { q: 0, r: -1 },
};

const AXIAL_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

const normalizeDegrees = (value: number) => {
  const normalized = ((value % 360) + 360) % 360;
  return Number.isFinite(normalized) ? normalized : 0;
};

const parseRotationDegrees = (rotation: string) => {
  if (!rotation) return 0;
  const trimmed = rotation.trim().toUpperCase();
  if (!trimmed) return 0;
  if (/^\d+$/.test(trimmed)) {
    const steps = Number(trimmed);
    if (Number.isFinite(steps)) {
      return steps <= 5 ? steps * 60 : steps;
    }
  }
  const direction = trimmed.startsWith('L') ? -1 : trimmed.startsWith('R') ? 1 : 0;
  const stepMatch = trimmed.match(/\d+/);
  if (!direction || !stepMatch) return 0;
  const steps = Number(stepMatch[0]);
  return Number.isFinite(steps) ? direction * steps * 60 : 0;
};

const getRotationMagnitude = (rotationLabel: string): number | null => {
  const trimmed = `${rotationLabel ?? ''}`.trim().toUpperCase();
  if (!trimmed) return null;
  if (trimmed === '0') return 0;
  if (trimmed === '3') return 3;
  if (trimmed.startsWith('L') || trimmed.startsWith('R')) {
    const steps = Number(trimmed.slice(1));
    return Number.isFinite(steps) ? steps : null;
  }
  return null;
};

const rotateAxialCW = (coord: { q: number; r: number }) => ({ q: -coord.r, r: coord.q + coord.r });

const rotateAxial = (coord: { q: number; r: number }, steps: number) => {
  let rotated = { ...coord };
  const safeSteps = ((steps % 6) + 6) % 6;
  for (let i = 0; i < safeSteps; i += 1) {
    rotated = rotateAxialCW(rotated);
  }
  return rotated;
};

const getFacingRotationSteps = (facing: number) => {
  const steps = Math.round((normalizeDegrees(facing) - 180) / 60);
  return ((steps % 6) + 6) % 6;
};

const applyFacingToVector = (vector: { q: number; r: number }, facing: number) =>
  rotateAxial(vector, getFacingRotationSteps(facing));

const coordKey = (coord: { q: number; r: number }) => `${coord.q},${coord.r}`;
const sameCoord = (a: { q: number; r: number }, b: { q: number; r: number }) => a.q === b.q && a.r === b.r;
const isCoordOnLand = (coord: { q: number; r: number }, land: HexCoord[]) => {
  if (!coord || !Array.isArray(land) || !land.length) return false;
  const key = coordKey(coord);
  return land.some((tile) => coordKey(tile) === key);
};

const axialDistance = (a: { q: number; r: number }, b: { q: number; r: number }): number => {
  const aq = Math.round(a.q);
  const ar = Math.round(a.r);
  const bq = Math.round(b.q);
  const br = Math.round(b.r);
  const dq = aq - bq;
  const dr = ar - br;
  const ds = (aq + ar) - (bq + br);
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
};

const getDistanceToLand = (position: { q: number; r: number }, land: HexCoord[]): number => {
  if (!Array.isArray(land) || !land.length) return Number.POSITIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  land.forEach((tile) => {
    const distance = axialDistance(position, tile);
    if (distance < min) min = distance;
  });
  return min;
};

const isForwardScale = (value: number) => Number.isFinite(value) && Math.round(value) === value && value > 0;

const getDirectionIndex = (delta: { q: number; r: number }) => {
  for (let i = 0; i < AXIAL_DIRECTIONS.length; i += 1) {
    const dir = AXIAL_DIRECTIONS[i];
    if (dir.q === 0 && delta.q !== 0) continue;
    if (dir.r === 0 && delta.r !== 0) continue;
    if (dir.q !== 0) {
      const scale = delta.q / dir.q;
      if (isForwardScale(scale) && dir.r * scale === delta.r) return i;
      continue;
    }
    if (dir.r !== 0) {
      const scale = delta.r / dir.r;
      if (isForwardScale(scale) && dir.q * scale === delta.q) return i;
    }
  }
  return null;
};

const parsePath = (path: string) => {
  if (!path) return [{ dir: 'F', distance: 1 }];
  const steps: Array<{ dir: string; distance: number }> = [];
  let index = 0;
  const upper = path.toUpperCase();
  while (index < upper.length) {
    const char = upper[index];
    if (/[0-9]/.test(char)) {
      let number = '';
      while (index < upper.length && /[0-9]/.test(upper[index])) {
        number += upper[index];
        index += 1;
      }
      const distance = Number(number);
      if (!Number.isFinite(distance) || distance <= 0) continue;
      if (index >= upper.length || !/[A-Z]/.test(upper[index])) {
        steps.push({ dir: 'F', distance });
      }
      continue;
    }
    let dir = upper[index];
    const next = upper[index + 1];
    if (next && (dir + next === 'BL' || dir + next === 'BR')) {
      dir += next;
      index += 1;
    }
    index += 1;
    let number = '';
    while (index < upper.length && /[0-9]/.test(upper[index])) {
      number += upper[index];
      index += 1;
    }
    const distance = number ? Number(number) : 1;
    steps.push({ dir, distance: Number.isFinite(distance) && distance > 0 ? distance : 1 });
  }
  return steps.length ? steps : [{ dir: 'F', distance: 1 }];
};

const normalizeActionLabel = (action: string) => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const isActionActive = (action: string | null | undefined) => normalizeActionLabel(action ?? '').toUpperCase() !== DEFAULT_ACTION;

const getHealingHarmonyReduction = (entry: BeatEntry | null | undefined): number => {
  if (!entry || entry.passiveCardId !== HEALING_HARMONY_CARD_ID) return 0;
  return isActionActive(entry.action) ? 2 : 0;
};

const isBehindTarget = (
  attackerPosition: { q: number; r: number },
  targetState: { position: { q: number; r: number }; facing: number },
): boolean => {
  const delta = {
    q: attackerPosition.q - targetState.position.q,
    r: attackerPosition.r - targetState.position.r,
  };
  const directionIndex = getDirectionIndex(delta);
  if (directionIndex == null) return false;
  const facingIndex = getFacingRotationSteps(targetState.facing);
  return directionIndex === (facingIndex + 3) % 6;
};

const isWaitAction = (action: string) => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return true;
  const label = normalizeActionLabel(trimmed).toUpperCase();
  return label === WAIT_ACTION || label === DAMAGE_ICON_ACTION.toUpperCase() || label === COMBO_ACTION;
};

const isComboAction = (action: string) => normalizeActionLabel(action).toUpperCase() === COMBO_ACTION;

const applyGiganticStaffAction = (action: string): string => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return action;
  const bracketed = isBracketedAction(trimmed);
  const label = normalizeActionToken(trimmed);
  if (!label) return action;
  if (label[label.length - 1]?.toLowerCase() !== 'm') return action;
  const path = label.slice(0, -1);
  const match = path.match(/^(.*?)(\d+)?$/);
  const prefix = match?.[1] ?? '';
  const distance = match?.[2] ? Math.max(2, Number(match[2])) : 2;
  const nextPath = `${prefix}${distance || ''}`;
  const nextLabel = `${nextPath}j`;
  return bracketed ? `[${nextLabel}]` : nextLabel;
};

const parseActionTokens = (action: string) => {
  const trimmed = action.trim();
  if (isWaitAction(trimmed)) return [];
  return trimmed
    .split('-')
    .map((token) => normalizeActionToken(token))
    .filter(Boolean)
    .map((token) => {
      const type = token[token.length - 1]?.toLowerCase() ?? '';
      const path = token.slice(0, -1);
      return { type, path, steps: parsePath(path) };
    })
    .filter((token) => token.type);
};

const buildPath = (origin: { q: number; r: number }, steps: Array<{ dir: string; distance: number }>, facing: number) => {
  const positions: Array<{ q: number; r: number }> = [];
  let current = { ...origin };
  let lastStep: { q: number; r: number } | null = null;
  steps.forEach((step) => {
    const base = LOCAL_DIRECTIONS[step.dir as keyof typeof LOCAL_DIRECTIONS] ?? LOCAL_DIRECTIONS.F;
    const direction = applyFacingToVector(base, facing);
    lastStep = direction;
    for (let i = 0; i < step.distance; i += 1) {
      current = { q: current.q + direction.q, r: current.r + direction.r };
      positions.push({ ...current });
    }
  });
  return { positions, destination: current, lastStep };
};

const buildGrapplingHookPath = (
  origin: { q: number; r: number },
  steps: Array<{ dir: string; distance: number }>,
  facing: number,
  land: HexCoord[],
  occupancy: Map<string, string>,
  actorId: string,
) => {
  const positions: Array<{ q: number; r: number }> = [];
  let current = { ...origin };
  let lastStep: { q: number; r: number } | null = null;
  for (const step of steps) {
    const base = LOCAL_DIRECTIONS[step.dir as keyof typeof LOCAL_DIRECTIONS] ?? LOCAL_DIRECTIONS.F;
    const direction = applyFacingToVector(base, facing);
    lastStep = direction;
    for (let i = 0; i < step.distance; i += 1) {
      current = { q: current.q + direction.q, r: current.r + direction.r };
      positions.push({ ...current });
      const occupant = occupancy.get(coordKey(current));
      if ((occupant && occupant !== actorId) || isCoordOnLand(current, land)) {
        return { positions, destination: { ...current }, lastStep };
      }
    }
  }
  if (!positions.length) {
    return { positions, destination: { ...origin }, lastStep };
  }
  return { positions, destination: { ...positions[positions.length - 1] }, lastStep };
};

const getKnockbackDistance = (damage: number, kbf: number) => {
  if (!Number.isFinite(damage) || !Number.isFinite(kbf)) return 0;
  if (kbf <= 0) return 0;
  if (kbf === 1) return 1;
  return Math.max(1, Math.floor((Math.max(0, damage) * kbf) / KNOCKBACK_DIVISOR));
};

const getKnockbackDirection = (
  origin: { q: number; r: number },
  destination: { q: number; r: number },
  lastStep: { q: number; r: number } | null,
) => {
  if (lastStep) return { q: lastStep.q, r: lastStep.r };
  const delta = { q: destination.q - origin.q, r: destination.r - origin.r };
  const directionIndex = getDirectionIndex(delta);
  return directionIndex == null ? null : AXIAL_DIRECTIONS[directionIndex];
};

const invertDirection = (direction: { q: number; r: number } | null) =>
  direction ? { q: -direction.q, r: -direction.r } : null;

const applyGrapplingHookPassiveFlip = (
  enabled: boolean,
  origin: { q: number; r: number },
  attackDirection: { q: number; r: number } | null,
  targetState: { position: { q: number; r: number } },
  occupancy: Map<string, string>,
  targetId: string,
) => {
  if (!enabled || !attackDirection) {
    return { knockbackDirection: attackDirection, flipped: false };
  }
  const grapplingDirection = invertDirection(attackDirection);
  if (!grapplingDirection) {
    return { knockbackDirection: attackDirection, flipped: false };
  }
  const flipPosition = {
    q: origin.q + grapplingDirection.q,
    r: origin.r + grapplingDirection.r,
  };
  const occupant = occupancy.get(coordKey(flipPosition));
  if (!occupant || occupant === targetId) {
    if (!sameCoord(flipPosition, targetState.position)) {
      occupancy.delete(coordKey(targetState.position));
      targetState.position = { q: flipPosition.q, r: flipPosition.r };
      occupancy.set(coordKey(targetState.position), targetId);
      return { knockbackDirection: grapplingDirection, flipped: true };
    }
  }
  return { knockbackDirection: grapplingDirection, flipped: false };
};

const buildInteractionId = (type: string, beatIndex: number, actorId: string, targetId: string) =>
  `${type}:${beatIndex}:${actorId}:${targetId}`;

const buildHandTriggerKey = (cardId: string, beatIndex: number, actorId: string) =>
  `${cardId}:${beatIndex}:${actorId}`;

const buildHandTriggerInteractionId = (
  cardId: string,
  beatIndex: number,
  actorId: string,
  targetId: string,
  sourceId?: string,
) => `hand-trigger:${cardId}:${beatIndex}:${actorId}:${sourceId ?? targetId}`;

const getHandTriggerCardId = (interaction: CustomInteraction) => interaction.cardId ?? interaction.abilityCardId ?? '';

const getHandTriggerUse = (interaction: CustomInteraction | undefined) => {
  if (!interaction || interaction.status !== 'resolved') return false;
  const use = interaction.resolution?.use;
  if (typeof use === 'boolean') return use;
  const ignite = interaction.resolution?.ignite;
  if (typeof ignite === 'boolean') return ignite;
  return false;
};

const getResolvedDirectionIndex = (interaction: CustomInteraction | undefined) => {
  const direction = interaction?.resolution?.directionIndex;
  if (!Number.isFinite(direction)) return null;
  const rounded = Math.round(direction as number);
  if (rounded < 0 || rounded >= AXIAL_DIRECTIONS.length) return null;
  return rounded;
};

const resolveEntryKey = (entry: BeatEntry) => entry.username ?? entry.userId ?? entry.userID ?? '';

const isEntryThrow = (entry: BeatEntry | null | undefined) => {
  if (!entry) return false;
  if (entry.interaction?.type === 'throw') return true;
  if (entry.cardId === GRAPPLING_HOOK_CARD_ID && entry.cardStartTerrain === 'land') return true;
  if (entry.cardId && ACTIVE_THROW_CARD_IDS.has(entry.cardId)) return true;
  if (entry.passiveCardId && PASSIVE_THROW_CARD_IDS.has(entry.passiveCardId)) return true;
  return false;
};


const matchesEntryForCharacter = (entry: BeatEntry, character: PublicCharacter) => {
  const key = resolveEntryKey(entry);
  return key === character.username || key === character.userId;
};

const pruneDuplicateEntries = (beat: BeatEntry[], character: PublicCharacter, primary?: BeatEntry) => {
  if (!Array.isArray(beat) || beat.length < 2) return;
  const keep = primary ?? beat.find((entry) => matchesEntryForCharacter(entry, character));
  if (!keep) return;
  for (let i = beat.length - 1; i >= 0; i -= 1) {
    const entry = beat[i];
    if (entry === keep) continue;
    if (matchesEntryForCharacter(entry, character)) {
      beat.splice(i, 1);
    }
  }
};

const buildEntryForCharacter = (
  character: PublicCharacter,
  state: { position: { q: number; r: number }; damage: number; facing: number },
  entry?: BeatEntry,
  calculated = false,
  terrain?: 'land' | 'abyss',
): BeatEntry => {
  const action = entry?.action ?? DEFAULT_ACTION;
  const next: BeatEntry = {
    username: character.username ?? character.userId,
    action,
    rotation: entry?.rotation ?? '',
    priority: typeof entry?.priority === 'number' ? entry.priority : 0,
    damage: state.damage,
    location: { q: state.position.q, r: state.position.r },
    terrain,
    facing: state.facing,
    calculated,
  };
  if (entry?.interaction) {
    next.interaction = entry.interaction;
  }
  if (Number.isFinite(entry?.attackDamage)) {
    next.attackDamage = entry.attackDamage;
  }
  if (Number.isFinite(entry?.attackKbf)) {
    next.attackKbf = entry.attackKbf;
  }
  return next;
};

export const executeBeats = (
  beats: BeatEntry[][],
  characters: PublicCharacter[],
  land?: HexCoord[],
  initialTokens: BoardToken[] = [],
) => executeBeatsWithInteractions(beats, characters, [], land, undefined, initialTokens);

export const executeBeatsWithInteractions = (
  beats: BeatEntry[][],
  characters: PublicCharacter[],
  interactions: CustomInteraction[] = [],
  land: HexCoord[] = DEFAULT_LAND_HEXES,
  comboAvailability?: Map<string, boolean>,
  initialTokens: BoardToken[] = [],
  handTriggerAvailability?: Map<string, Set<string>>,
): {
  beats: BeatEntry[][];
  characters: PublicCharacter[];
  lastCalculated: number;
  interactions: CustomInteraction[];
  boardTokens: BoardToken[];
} => {
  const landTiles = Array.isArray(land) && land.length ? land : DEFAULT_LAND_HEXES;
  const comboAvailabilityByUser = comboAvailability ?? new Map<string, boolean>();
  const handTriggerAvailabilityByUser = handTriggerAvailability ?? new Map<string, Set<string>>();
  const hasHandTriggerCard = (userId: string, cardId: string) =>
    Boolean(handTriggerAvailabilityByUser.get(userId)?.has(cardId));
  const resolvedIndex = getTimelineResolvedIndex(beats);
  const isHistoryIndex = (index: number) => resolvedIndex >= 0 && index <= resolvedIndex;
  const resolveTerrain = (position: { q: number; r: number }) =>
    (isCoordOnLand(position, landTiles) ? 'land' : 'abyss') as 'land' | 'abyss';
  const boardTokens: BoardToken[] = Array.isArray(initialTokens)
    ? initialTokens.map((token) => ({
      ...token,
      position: { q: token.position.q, r: token.position.r },
    }))
    : [];
  for (let i = boardTokens.length - 1; i >= 0; i -= 1) {
    const token = boardTokens[i];
    if (token.type === FIRE_HEX_TOKEN_TYPE && resolveTerrain(token.position) === 'abyss') {
      boardTokens.splice(i, 1);
    }
  }
  let tokenCounter = boardTokens.length;
  const fireTokenKeys = new Set<string>();
  let ephemeralFireKeys = new Set<string>();
  boardTokens.forEach((token) => {
    if (token.type === FIRE_HEX_TOKEN_TYPE) {
      fireTokenKeys.add(coordKey(token.position));
    }
  });
  const userLookup = new Map<string, string>();
  characters.forEach((character) => {
    userLookup.set(character.userId, character.userId);
    userLookup.set(character.username, character.userId);
  });
  const rosterOrder = new Map<string, number>();
  characters.forEach((character, index) => {
    rosterOrder.set(character.userId, index);
    rosterOrder.set(character.username, index);
  });
  const normalizedBeats = beats.map((beat) => beat.map((entry) => ({ ...entry })));
  normalizedBeats.forEach((beat) => {
    beat.forEach((entry) => {
      if (entry && entry.consequences) {
        delete entry.consequences;
      }
    });
  });
  const state = new Map<string, { position: { q: number; r: number }; damage: number; facing: number }>();
  characters.forEach((character) => {
    state.set(character.userId, {
      position: { q: character.position.q, r: character.position.r },
      damage: 0,
      facing: normalizeDegrees(character.facing ?? 0),
    });
  });
  let lastCalculated = -1;
  const updatedInteractions: CustomInteraction[] = interactions.map((interaction) => ({
    ...interaction,
    resolution: interaction.resolution ? { ...interaction.resolution } : undefined,
  }));
  const interactionById = new Map<string, CustomInteraction>();
  const handTriggerKeys = new Set<string>();
  const pendingIndices: number[] = [];
  updatedInteractions.forEach((interaction) => {
    interactionById.set(interaction.id, interaction);
    if (interaction.status === 'pending' && Number.isFinite(interaction.beatIndex)) {
      pendingIndices.push(interaction.beatIndex);
    }
    if (interaction.type === 'hand-trigger') {
      const cardId = getHandTriggerCardId(interaction);
      const beatIndex = Number.isFinite(interaction.beatIndex) ? Math.round(interaction.beatIndex) : null;
      if (cardId && beatIndex != null && interaction.actorUserId) {
        handTriggerKeys.add(buildHandTriggerKey(cardId, beatIndex, interaction.actorUserId));
      }
    }
  });
  let haltIndex = pendingIndices.length ? Math.min(...pendingIndices) : null;
  const characterById = new Map<string, PublicCharacter>();
  characters.forEach((character) => {
    characterById.set(character.userId, character);
    characterById.set(character.username, character);
  });
  type ParryCounter = {
    beatIndex: number;
    defenderId: string;
    attackerId: string;
    damage: number;
    kbf: number;
    directionIndex: number | null;
  };
  const parryCountersByBeat = new Map<number, ParryCounter[]>();
  const parryEndersByBeat = new Map<number, Set<string>>();
  const parryCounterKeys = new Set<string>();

  const nextTokenId = (type: string) => `${type}:${tokenCounter++}`;

  const addFireHexToken = (coord: { q: number; r: number }, ownerId?: string) => {
    const key = coordKey(coord);
    const onLand = resolveTerrain(coord) === 'land';
    if (onLand) {
      if (fireTokenKeys.has(key)) return;
      fireTokenKeys.add(key);
      boardTokens.push({
        id: nextTokenId(FIRE_HEX_TOKEN_TYPE),
        type: FIRE_HEX_TOKEN_TYPE,
        position: { q: coord.q, r: coord.r },
        facing: 0,
        ownerUserId: ownerId,
      });
      return;
    }
    if (ephemeralFireKeys.has(key)) return;
    ephemeralFireKeys.add(key);
  };

  const addArrowToken = (coord: { q: number; r: number }, facing: number, ownerId?: string) => {
    boardTokens.push({
      id: nextTokenId(ARROW_TOKEN_TYPE),
      type: ARROW_TOKEN_TYPE,
      position: { q: coord.q, r: coord.r },
      facing: normalizeDegrees(facing),
      ownerUserId: ownerId,
    });
  };

  const getRosterIndex = (entry: BeatEntry) => {
    const key = resolveEntryKey(entry);
    const resolved = userLookup.get(key) ?? key;
    return rosterOrder.get(resolved) ?? rosterOrder.get(key) ?? Number.MAX_SAFE_INTEGER;
  };

  const applyStateToBeat = (beat: BeatEntry[], calculated: boolean) => {
    beat.forEach((entry) => {
      const key = resolveEntryKey(entry);
      const resolved = userLookup.get(key) ?? key;
      const current = resolved ? state.get(resolved) : undefined;
      const character = resolved ? characterById.get(resolved) : undefined;
      if (character) {
        entry.username = entry.username ?? character.username ?? character.userId;
      }
      const action = typeof entry.action === 'string' ? entry.action : DEFAULT_ACTION;
      entry.action = action;
      entry.rotation = entry.rotation ?? '';
      entry.priority = typeof entry.priority === 'number' ? entry.priority : 0;
      if (current) {
        entry.location = { q: current.position.q, r: current.position.r };
        entry.damage = current.damage;
        entry.facing = current.facing;
        entry.terrain = resolveTerrain(current.position);
      } else if (entry.location) {
        entry.terrain = resolveTerrain(entry.location);
      }
      entry.calculated = calculated;
    });
    beat.sort((a, b) => getRosterIndex(a) - getRosterIndex(b));
  };

  const ensureBeatIndex = (index: number) => {
    while (normalizedBeats.length <= index) {
      normalizedBeats.push([]);
    }
  };

  const queueParryCounter = (
    sourceBeatIndex: number,
    counterBeatIndex: number,
    defenderId: string,
    attackerId: string,
    damage: number,
    kbf: number,
    directionIndex: number | null,
  ) => {
    if (!defenderId || !attackerId) return;
    if (!Number.isFinite(counterBeatIndex)) return;
    const safeBeat = Math.max(0, Math.round(counterBeatIndex));
    const key = `${defenderId}:${safeBeat}`;
    if (parryCounterKeys.has(key)) return;
    parryCounterKeys.add(key);
    ensureBeatIndex(safeBeat);
    const list = parryCountersByBeat.get(safeBeat) ?? [];
    list.push({
      beatIndex: safeBeat,
      defenderId,
      attackerId,
      damage: Number.isFinite(damage) ? Math.max(0, Math.round(damage)) : 0,
      kbf: Number.isFinite(kbf) ? Math.max(0, Math.round(kbf)) : 0,
      directionIndex,
    });
    parryCountersByBeat.set(safeBeat, list);
    const enders = parryEndersByBeat.get(safeBeat) ?? new Set<string>();
    enders.add(defenderId);
    parryEndersByBeat.set(safeBeat, enders);
    if (isHistoryIndex(sourceBeatIndex)) return;
    const interactionId = buildInteractionId('parry', safeBeat, defenderId, attackerId);
    if (interactionById.has(interactionId)) return;
    const created: CustomInteraction = {
      id: interactionId,
      type: 'parry',
      beatIndex: safeBeat,
      actorUserId: defenderId,
      targetUserId: attackerId,
      status: 'resolved',
      damage,
      kbf,
      directionIndex,
    };
    updatedInteractions.push(created);
    interactionById.set(interactionId, created);
  };

  const findEntryForCharacter = (beat: BeatEntry[], character: PublicCharacter) =>
    beat.find((item) => matchesEntryForCharacter(item, character)) ?? null;

  const applyStateSnapshotToEntry = (
    entry: BeatEntry,
    stateSnapshot: { position: { q: number; r: number }; damage: number; facing: number },
    calculated: boolean,
  ) => {
    entry.damage = stateSnapshot.damage;
    entry.location = { q: stateSnapshot.position.q, r: stateSnapshot.position.r };
    entry.facing = stateSnapshot.facing;
    entry.terrain = resolveTerrain(stateSnapshot.position);
    entry.calculated = calculated;
  };

  const getOrCreateEntryForCharacter = (
    beatIndex: number,
    character: PublicCharacter,
    stateSnapshot: { position: { q: number; r: number }; damage: number; facing: number },
  ): BeatEntry => {
    ensureBeatIndex(beatIndex);
    const beat = normalizedBeats[beatIndex];
    const existing = findEntryForCharacter(beat, character);
    if (existing) return existing;
    const next = buildEntryForCharacter(
      character,
      stateSnapshot,
      { action: DEFAULT_ACTION, rotation: '', priority: 0 } as BeatEntry,
      false,
      resolveTerrain(stateSnapshot.position),
    );
    beat.push(next);
    return next;
  };

  const recordHitConsequence = (
    targetId: string,
    beatIndex: number,
    targetState: { position: { q: number; r: number }; damage: number; facing: number },
    damageDelta: number,
    knockbackDistance: number,
  ) => {
    const character = characterById.get(targetId);
    if (!character) return;
    const delta = Number.isFinite(damageDelta) ? Math.round(damageDelta) : 0;
    const distance = Number.isFinite(knockbackDistance) ? Math.max(0, Math.round(knockbackDistance)) : 0;
    const entry = getOrCreateEntryForCharacter(beatIndex, character, targetState);
    const list = Array.isArray(entry.consequences) ? entry.consequences : [];
    list.push({ type: 'hit', damageDelta: delta, knockbackDistance: distance });
    entry.consequences = list;
  };

  const upsertBeatEntry = (
    beat: BeatEntry[],
    character: PublicCharacter,
    action: string,
    stateSnapshot: { position: { q: number; r: number }; damage: number; facing: number },
  ): BeatEntry => {
    const entry = findEntryForCharacter(beat, character);
    if (entry) {
      entry.username = character.username ?? character.userId;
      entry.action = action;
      entry.priority = 0;
      if ('cardId' in entry) {
        delete entry.cardId;
      }
      if ('passiveCardId' in entry) {
        delete entry.passiveCardId;
      }
      if ('comboStarter' in entry) {
        delete entry.comboStarter;
      }
      if ('comboSkipped' in entry) {
        delete entry.comboSkipped;
      }
      applyStateSnapshotToEntry(entry, stateSnapshot, false);
      return entry;
    }
    const next = buildEntryForCharacter(
      character,
      stateSnapshot,
      { action, rotation: '', priority: 0 } as BeatEntry,
      false,
      resolveTerrain(stateSnapshot.position),
    );
    beat.push(next);
    return next;
  };

  const applyHitTimeline = (
    targetId: string,
    beatIndex: number,
    targetState: { position: { q: number; r: number }; damage: number; facing: number },
    knockbackOverride?: number,
    preserveAction = false,
  ) => {
    const character = characterById.get(targetId);
    if (!character) return;
    const sourceBeat = normalizedBeats[beatIndex];
    const sourceEntry = sourceBeat ? findEntryForCharacter(sourceBeat, character) : null;
    const sourceCardId = sourceEntry?.cardId ?? null;
    const sourcePassiveCardId = sourceEntry?.passiveCardId ?? null;
    const startIndex = preserveAction ? beatIndex + 1 : beatIndex;
    const knockbackDistance = Number.isFinite(knockbackOverride)
      ? Math.max(0, Math.round(knockbackOverride as number))
      : getKnockbackDistance(targetState.damage, 1);
    const damageIcons = knockbackDistance + 1;
    const computedEndIndex = startIndex + damageIcons;
    const getAppliedWindowEnd = () => {
      let lastApplied: number | null = null;
      for (let i = startIndex; i < normalizedBeats.length; i += 1) {
        const beat = normalizedBeats[i];
        if (!beat) break;
        const entry = findEntryForCharacter(beat, character);
        if (!entry || entry.action !== DAMAGE_ICON_ACTION) break;
        lastApplied = i;
      }
      return lastApplied;
    };
    const appliedEnd = getAppliedWindowEnd();
    const knockbackApplied = appliedEnd !== null;
    const priorEndIndex = knockbackApplied ? appliedEnd + 1 : null;
    const endIndex = knockbackApplied ? Math.max(computedEndIndex, appliedEnd + 1) : computedEndIndex;
    const extendedWindow = priorEndIndex !== null && endIndex > priorEndIndex;
    const beforeLength = normalizedBeats.length;
    ensureBeatIndex(endIndex);
    const extendedBy = normalizedBeats.length - beforeLength;
    if (extendedBy > 0) {
      console.log(LOG_PREFIX, 'knockback-extend', {
        targetId,
        beatIndex,
        endIndex,
        extendedBy,
        knockbackDistance,
        damageIcons,
      });
    }
    for (let i = startIndex; i <= endIndex; i += 1) {
      const beat = normalizedBeats[i];
      if (!beat) continue;
      if (i < endIndex) {
        const existing = findEntryForCharacter(beat, character);
        const hadDamageIcon = existing?.action === DAMAGE_ICON_ACTION;
        const entry = upsertBeatEntry(beat, character, DAMAGE_ICON_ACTION, targetState);
        if (i === startIndex && !hadDamageIcon && (sourceCardId || sourcePassiveCardId)) {
          if (sourceCardId) entry.cardId = sourceCardId;
          if (sourcePassiveCardId) entry.passiveCardId = sourcePassiveCardId;
        }
        pruneDuplicateEntries(beat, character, entry);
        continue;
      }
      const entry = findEntryForCharacter(beat, character);
      if (!knockbackApplied || extendedWindow || !entry || entry.action === DEFAULT_ACTION || entry.action === DAMAGE_ICON_ACTION) {
        const next = upsertBeatEntry(beat, character, DEFAULT_ACTION, targetState);
        pruneDuplicateEntries(beat, character, next);
      } else {
        applyStateSnapshotToEntry(entry, targetState, false);
        pruneDuplicateEntries(beat, character, entry);
      }
    }
    if (!knockbackApplied || extendedWindow) {
      for (let i = endIndex + 1; i < normalizedBeats.length; i += 1) {
        const beat = normalizedBeats[i];
        if (!beat?.length) continue;
        const filtered = beat.filter((entry) => !matchesEntryForCharacter(entry, character));
        if (filtered.length !== beat.length) {
          normalizedBeats[i] = filtered;
        }
      }
    }
  };

  const isActionSetStart = (entry: BeatEntry | null | undefined) =>
    `${entry?.rotationSource ?? ''}`.trim() === 'selected' || Boolean(entry?.comboStarter);

  const clearCharacterEntriesAfter = (
    character: PublicCharacter,
    startIndex: number,
    options?: { preserveFutureActionSetStarts?: boolean },
  ) => {
    for (let i = startIndex + 1; i < normalizedBeats.length; i += 1) {
      const beat = normalizedBeats[i];
      if (!beat?.length) continue;
      if (options?.preserveFutureActionSetStarts) {
        const nextEntry = beat.find((entry) => matchesEntryForCharacter(entry, character));
        if (isActionSetStart(nextEntry)) {
          break;
        }
      }
      const filtered = beat.filter((entry) => !matchesEntryForCharacter(entry, character));
      if (filtered.length !== beat.length) {
        normalizedBeats[i] = filtered;
      }
    }
  };

  updatedInteractions.forEach((interaction) => {
    if (interaction.type !== 'combo' || interaction.status !== 'resolved') return;
    if (!Number.isFinite(interaction.beatIndex)) return;
    const actorId = interaction.actorUserId;
    const character = actorId ? characterById.get(actorId) : undefined;
    if (!character) return;
    const beatIndex = Math.max(0, Math.round(interaction.beatIndex));
    ensureBeatIndex(beatIndex);
    const beat = normalizedBeats[beatIndex];
    const entry = beat ? findEntryForCharacter(beat, character) : null;
    const shouldContinue = Boolean(interaction.resolution?.continue);
    if (entry) {
      if (shouldContinue) {
        entry.action = DEFAULT_ACTION;
        entry.priority = 0;
        if ('comboSkipped' in entry) {
          delete entry.comboSkipped;
        }
      } else {
        if (!isComboAction(entry.action ?? '')) {
          entry.action = 'Co';
        }
        entry.comboSkipped = true;
      }
      if ('comboStarter' in entry) {
        delete entry.comboStarter;
      }
    }
    if (shouldContinue) {
      clearCharacterEntriesAfter(character, beatIndex);
    }
  });

  const comboStates = new Map<string, { coIndex: number; hit: boolean; cardId: string; throwInteraction: boolean }>();
  const lastActionByUser = new Map<string, string>();
  const cardStartTerrainByUser = new Map<string, 'land' | 'abyss'>();
  const actionSetFacingByUser = new Map<string, number>();
  const actionSetRotationByUser = new Map<string, string>();

  const findNextComboIndex = (character: PublicCharacter, startIndex: number) => {
    for (let i = startIndex; i < normalizedBeats.length; i += 1) {
      const beat = normalizedBeats[i];
      const entry = beat ? findEntryForCharacter(beat, character) : null;
      if (!entry || entry.action === DEFAULT_ACTION) return null;
      if (isComboAction(entry.action)) {
        const cardId = entry.cardId ? `${entry.cardId}` : '';
        if (!cardId) return null;
        return { index: i, cardId };
      }
    }
    return null;
  };

  const ensureComboStateForHit = (
    actorId: string,
    character: PublicCharacter | undefined,
    cardId: string,
    startIndex: number,
  ) => {
    if (!character || !cardId) return null;
    const existing = comboStates.get(actorId);
    if (existing) {
      return existing.cardId === cardId ? existing : null;
    }
    const nextCombo = findNextComboIndex(character, startIndex);
    if (!nextCombo || nextCombo.cardId !== cardId) return null;
    if (isHistoryIndex(nextCombo.index)) return null;
    const created = {
      coIndex: nextCombo.index,
      hit: false,
      cardId: nextCombo.cardId,
      throwInteraction: false,
    };
    comboStates.set(actorId, created);
    return created;
  };

const applyRotationPhase = (entries: Map<string, BeatEntry>) => {
  entries.forEach((entry, actorId) => {
    const rotationDelta = parseRotationDegrees(entry.rotation ?? '');
    if (!rotationDelta) return;
    const actorState = state.get(actorId);
    if (!actorState) return;
    actorState.facing = normalizeDegrees(actorState.facing + rotationDelta);
  });
};

  for (let index = 0; index < normalizedBeats.length; index += 1) {
    if (haltIndex != null && index > haltIndex) {
      for (let j = index; j < normalizedBeats.length; j += 1) {
        applyStateToBeat(normalizedBeats[j], false);
      }
      break;
    }
    const beat = normalizedBeats[index];
    const parryEnders = parryEndersByBeat.get(index);
    if (parryEnders?.size) {
      parryEnders.forEach((defenderId) => {
        const defender = characterById.get(defenderId);
        const defenderState = defender ? state.get(defender.userId) : null;
        if (!defender || !defenderState) return;
        const entry = upsertBeatEntry(beat, defender, DEFAULT_ACTION, defenderState);
        pruneDuplicateEntries(beat, defender, entry);
        clearCharacterEntriesAfter(defender, index, { preserveFutureActionSetStarts: true });
      });
      parryEndersByBeat.delete(index);
    }
    ephemeralFireKeys = new Set<string>();
    const existingArrowIds = new Set(
      boardTokens.filter((token) => token.type === ARROW_TOKEN_TYPE).map((token) => token.id),
    );
    const entriesByUser = new Map<string, BeatEntry>();
    beat.forEach((entry) => {
      const key = resolveEntryKey(entry);
      const resolved = userLookup.get(key) ?? key;
      if (!resolved) return;
      const existing = entriesByUser.get(resolved);
      if (!existing) {
        entriesByUser.set(resolved, entry);
        return;
      }
      const existingAction = existing.action ?? DEFAULT_ACTION;
      const nextAction = entry.action ?? DEFAULT_ACTION;
      if (existingAction === DEFAULT_ACTION && nextAction !== DEFAULT_ACTION) {
        entriesByUser.set(resolved, entry);
        return;
      }
      if (existingAction !== DEFAULT_ACTION && nextAction === DEFAULT_ACTION) {
        return;
      }
      if (existingAction !== nextAction) {
        console.log(LOG_PREFIX, 'duplicate-entry', {
          index,
          resolved,
          existingAction,
          nextAction,
        });
      }
    });
    const actionSetEnders = new Map<string, BeatEntry>();

    characters.forEach((character) => {
      const actorId = character.userId;
      const entry = entriesByUser.get(actorId);
      const action = entry?.action ?? DEFAULT_ACTION;
      const previous = lastActionByUser.get(actorId) ?? DEFAULT_ACTION;
      const comboStart = previous === DEFAULT_ACTION || Boolean(entry?.comboStarter);
      if (action === DEFAULT_ACTION) {
        if (previous !== DEFAULT_ACTION && entry) {
          actionSetEnders.set(actorId, entry);
        }
        comboStates.delete(actorId);
        cardStartTerrainByUser.delete(actorId);
        actionSetFacingByUser.delete(actorId);
        actionSetRotationByUser.delete(actorId);
        if (entry && 'cardStartTerrain' in entry) {
          delete entry.cardStartTerrain;
        }
      } else {
        if (comboStart || !cardStartTerrainByUser.has(actorId)) {
          const actorState = state.get(actorId);
          if (actorState) {
            cardStartTerrainByUser.set(actorId, resolveTerrain(actorState.position));
          }
        }
        if (comboStart || !actionSetFacingByUser.has(actorId)) {
          const actorState = state.get(actorId);
          if (actorState) {
            actionSetFacingByUser.set(actorId, actorState.facing);
          }
        }
        if (comboStart || !actionSetRotationByUser.has(actorId)) {
          const rotation = `${entry?.rotation ?? ''}`.trim();
          const rotationSource = `${entry?.rotationSource ?? ''}`.trim();
          if (rotation && (rotationSource === 'selected' || !rotationSource)) {
            actionSetRotationByUser.set(actorId, rotation);
          }
        }
        const startTerrain = cardStartTerrainByUser.get(actorId);
        if (entry) {
          if (startTerrain) {
            entry.cardStartTerrain = startTerrain;
          } else if ('cardStartTerrain' in entry) {
            delete entry.cardStartTerrain;
          }
        }
        if (comboStart && !comboStates.has(actorId)) {
          const nextCombo = findNextComboIndex(character, index);
          if (nextCombo) {
            comboStates.set(actorId, {
              coIndex: nextCombo.index,
              hit: false,
              cardId: nextCombo.cardId,
              throwInteraction: false,
            });
          }
        }
      }
      lastActionByUser.set(actorId, action);
    });

    let comboPause = false;
    entriesByUser.forEach((entry, actorId) => {
      if (!isComboAction(entry.action ?? '')) return;
      const comboState = comboStates.get(actorId);
      if (comboState && isEntryThrow(entry)) {
        comboState.throwInteraction = true;
      }
      if (comboState?.throwInteraction) {
        comboStates.delete(actorId);
        return;
      }
      if (!comboState || comboState.coIndex !== index || !comboState.hit) return;
      if (comboState.cardId !== entry.cardId) return;
      if (entry.comboSkipped || isHistoryIndex(index)) {
        comboStates.delete(actorId);
        return;
      }
      if (!comboAvailabilityByUser.get(actorId)) return;
      const interactionId = buildInteractionId('combo', index, actorId, actorId);
      const existing = interactionById.get(interactionId);
      if (!existing) {
        const created: CustomInteraction = {
          id: interactionId,
          type: 'combo',
          beatIndex: index,
          actorUserId: actorId,
          targetUserId: actorId,
          status: 'pending',
          resolution: undefined,
        };
        updatedInteractions.push(created);
        interactionById.set(interactionId, created);
      }
      if (haltIndex == null || index < haltIndex) {
        haltIndex = index;
      }
      comboStates.delete(actorId);
      comboPause = true;
    });

    if (comboPause) {
      for (let j = index; j < normalizedBeats.length; j += 1) {
        applyStateToBeat(normalizedBeats[j], false);
      }
      break;
    }

    const parryCounters = parryCountersByBeat.get(index);
    const hasForcedResolution = Boolean(parryCounters?.length);

    const allReady = characters.every((character) => {
      const entry = entriesByUser.get(character.userId);
      return entry && entry.action !== DEFAULT_ACTION;
    });
    if (!allReady && !hasForcedResolution) {
      const readiness = characters.map((character) => {
        const entry = entriesByUser.get(character.userId);
        return {
          userId: character.userId,
          username: character.username,
          action: entry?.action ?? 'missing',
        };
      });
      console.log(LOG_PREFIX, 'halt', {
        index,
        haltIndex,
        readiness,
        pendingInteractions: pendingIndices,
      });
      for (let j = index; j < normalizedBeats.length; j += 1) {
        applyStateToBeat(normalizedBeats[j], false);
      }
      break;
    }
    applyRotationPhase(entriesByUser);
    const occupancy = new Map<string, string>();
    state.forEach((value, userId) => {
      occupancy.set(coordKey(value.position), userId);
    });
    const blockMap = new Map<string, Map<number, BlockSource>>();
    const discardQueue = new Map<string, number>();
    const forcedDiscardQueue = new Map<string, number>();
    const disabledActors = new Set<string>();
    const executedActors = new Set<string>();
    const queueDraw = (targetId: string, drawCount: number) => {
      const safeCount = Number.isFinite(drawCount) ? Math.max(0, Math.floor(drawCount)) : 0;
      if (!targetId || !safeCount) return;
      if (isHistoryIndex(index)) return;
      const interactionId = buildInteractionId('draw', index, targetId, targetId);
      const existing = interactionById.get(interactionId);
      if (existing && existing.type === 'draw') {
        const base = Number.isFinite(existing.drawCount) ? Math.max(0, Math.floor(existing.drawCount)) : 0;
        existing.drawCount = base + safeCount;
        if (existing.status === 'pending') {
          existing.status = 'resolved';
        }
        return;
      }
      if (existing) return;
      const created: CustomInteraction = {
        id: interactionId,
        type: 'draw',
        beatIndex: index,
        actorUserId: targetId,
        targetUserId: targetId,
        status: 'resolved',
        drawCount: safeCount,
        resolution: { applied: false },
      };
      updatedInteractions.push(created);
      interactionById.set(interactionId, created);
    };
    const resolveArrowHit = (targetId: string, ownerId: string, forward: { q: number; r: number }) => {
      const targetState = state.get(targetId);
      if (!targetState) return;
      const targetCharacter = characterById.get(targetId);
      const targetEntry = targetCharacter ? findEntryForCharacter(beat, targetCharacter) : null;
      const hasHammerPassive =
        targetEntry?.passiveCardId === HAMMER_CARD_ID && isActionActive(targetEntry.action);
      const blockDirection = getDirectionIndex({ q: -forward.q, r: -forward.r });
      if (blockDirection != null) {
        const targetKey = coordKey(targetState.position);
        const blockSource = blockMap.get(targetKey)?.get(blockDirection);
        if (blockSource) {
          const blockAction = blockSource.action ?? targetEntry?.action;
          const blockCardId = blockSource.cardId ?? targetEntry?.cardId;
          if (blockCardId === ABSORB_CARD_ID && isBracketedAction(blockAction ?? '')) {
            queueDraw(targetId, ARROW_DAMAGE);
          }
          return;
        }
      }
      const safeOwnerId = ownerId ?? '';
      if (
        safeOwnerId &&
        safeOwnerId !== targetId &&
        hasHandTriggerCard(safeOwnerId, SINKING_SHOT_CARD_ID) &&
        !handTriggerKeys.has(buildHandTriggerKey(SINKING_SHOT_CARD_ID, index, safeOwnerId)) &&
        !isHistoryIndex(index)
      ) {
        const definition = getHandTriggerDefinition(SINKING_SHOT_CARD_ID);
        const interactionId = buildHandTriggerInteractionId(SINKING_SHOT_CARD_ID, index, safeOwnerId, targetId);
        if (!interactionById.has(interactionId)) {
          const created: CustomInteraction = {
            id: interactionId,
            type: 'hand-trigger',
            beatIndex: index,
            actorUserId: safeOwnerId,
            targetUserId: targetId,
            sourceUserId: safeOwnerId,
            status: 'pending',
            discardCount: definition?.discardCount ?? 1,
            cardId: definition?.cardId ?? SINKING_SHOT_CARD_ID,
            cardType: definition?.cardType ?? 'ability',
            effect: definition?.effect ?? 'sinking-shot',
          };
          updatedInteractions.push(created);
          interactionById.set(interactionId, created);
          handTriggerKeys.add(buildHandTriggerKey(SINKING_SHOT_CARD_ID, index, safeOwnerId));
          if (haltIndex == null || index < haltIndex) {
            haltIndex = index;
          }
        }
      }

      const ironWillKey = buildHandTriggerKey(IRON_WILL_CARD_ID, index, targetId);
      const ironWillInteractionId = buildHandTriggerInteractionId(
        IRON_WILL_CARD_ID,
        index,
        targetId,
        targetId,
        safeOwnerId || targetId,
      );
      const ironWillInteraction = interactionById.get(ironWillInteractionId);
      if (
        !isHistoryIndex(index) &&
        hasHandTriggerCard(targetId, IRON_WILL_CARD_ID) &&
        !ironWillInteraction &&
        !handTriggerKeys.has(ironWillKey)
      ) {
        const definition = getHandTriggerDefinition(IRON_WILL_CARD_ID);
        const created: CustomInteraction = {
          id: ironWillInteractionId,
          type: 'hand-trigger',
          beatIndex: index,
          actorUserId: targetId,
          targetUserId: targetId,
          sourceUserId: safeOwnerId || undefined,
          status: 'pending',
          discardCount: definition?.discardCount ?? 1,
          cardId: definition?.cardId ?? IRON_WILL_CARD_ID,
          cardType: definition?.cardType ?? 'ability',
          effect: definition?.effect ?? 'iron-will',
        };
        updatedInteractions.push(created);
        interactionById.set(ironWillInteractionId, created);
        handTriggerKeys.add(ironWillKey);
        if (haltIndex == null || index < haltIndex) {
          haltIndex = index;
        }
        return;
      }
      if (ironWillInteraction?.status === 'pending') {
        if (haltIndex == null || index < haltIndex) {
          haltIndex = index;
        }
        return;
      }

      const fromPosition = { q: targetState.position.q, r: targetState.position.r };
      const damageReduction = getHealingHarmonyReduction(targetEntry);
      const adjustedDamage = Math.max(0, ARROW_DAMAGE - damageReduction);
      targetState.damage += adjustedDamage;
      const passiveKbfReduction = getPassiveKbfReduction(targetEntry);
      const baseKbf = Math.max(0, ARROW_KBF - passiveKbfReduction);
      const effectiveKbf = getHandTriggerUse(ironWillInteraction) ? 0 : baseKbf;
      const knockbackDistance = getKnockbackDistance(targetState.damage, effectiveKbf);
      let knockedSteps = 0;
      if (knockbackDistance > 0) {
        let finalPosition = { ...targetState.position };
        for (let step = 0; step < knockbackDistance; step += 1) {
          const candidate = {
            q: finalPosition.q + forward.q,
            r: finalPosition.r + forward.r,
          };
          const occupant = occupancy.get(coordKey(candidate));
          if (occupant && occupant !== targetId) break;
          finalPosition = candidate;
          knockedSteps += 1;
        }
        if (!sameCoord(finalPosition, targetState.position)) {
          occupancy.delete(coordKey(targetState.position));
          targetState.position = { q: finalPosition.q, r: finalPosition.r };
          occupancy.set(coordKey(targetState.position), targetId);
        }
      }
      const shouldStun = effectiveKbf === 1 || (effectiveKbf > 1 && knockbackDistance > 0);
      if (shouldStun) {
        applyHitTimeline(targetId, index, targetState, knockedSteps, true);
      }
      recordHitConsequence(targetId, index, targetState, adjustedDamage, knockedSteps);
        if (safeOwnerId && safeOwnerId !== targetId && hasHammerPassive) {
          const attackerState = state.get(safeOwnerId);
          if (attackerState) {
            attackerState.damage += 2;
            recordHitConsequence(safeOwnerId, index, attackerState, 2, 0);
          }
      }

      const wasOnLand = resolveTerrain(fromPosition) === 'land';
      const nowOnAbyss = resolveTerrain(targetState.position) === 'abyss';
      if (
        knockedSteps > 0 &&
        wasOnLand &&
        nowOnAbyss &&
        hasHandTriggerCard(targetId, VENGEANCE_CARD_ID) &&
        !handTriggerKeys.has(buildHandTriggerKey(VENGEANCE_CARD_ID, index, targetId)) &&
        !isHistoryIndex(index)
      ) {
        const definition = getHandTriggerDefinition(VENGEANCE_CARD_ID);
        const interactionId = buildHandTriggerInteractionId(VENGEANCE_CARD_ID, index, targetId, targetId);
        if (!interactionById.has(interactionId)) {
          const created: CustomInteraction = {
            id: interactionId,
            type: 'hand-trigger',
            beatIndex: index,
            actorUserId: targetId,
            targetUserId: targetId,
            status: 'pending',
            discardCount: definition?.discardCount ?? 1,
            cardId: definition?.cardId ?? VENGEANCE_CARD_ID,
            cardType: definition?.cardType ?? 'ability',
            effect: definition?.effect ?? 'vengeance',
            drawCount: knockedSteps,
          };
          updatedInteractions.push(created);
          interactionById.set(interactionId, created);
          handTriggerKeys.add(buildHandTriggerKey(VENGEANCE_CARD_ID, index, targetId));
          if (haltIndex == null || index < haltIndex) {
            haltIndex = index;
          }
        }
      }
    };
    const spawnArrowToken = (coord: { q: number; r: number }, facing: number, ownerId: string) => {
      const key = coordKey(coord);
      const occupant = occupancy.get(key);
      if (occupant && occupant !== ownerId) {
        const forward = applyFacingToVector(LOCAL_DIRECTIONS.F, facing);
        resolveArrowHit(occupant, ownerId, forward);
        return;
      }
      addArrowToken(coord, facing, ownerId);
    };
    const queueDiscard = (
      targetId: string,
      count: number,
      source: 'self' | 'opponent',
      targetEntry?: BeatEntry | null,
      options: { force?: boolean } = {},
    ) => {
      const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
      if (!safeCount) return;
      const entryForImmunity =
        targetEntry ??
        (() => {
          const targetCharacter = characterById.get(targetId);
          return targetCharacter ? findEntryForCharacter(beat, targetCharacter) : null;
        })();
      if (source === 'opponent' && isDiscardImmune(entryForImmunity)) return;
      const queue = options.force ? forcedDiscardQueue : discardQueue;
      queue.set(targetId, (queue.get(targetId) ?? 0) + safeCount);
    };
    if (parryCounters?.length) {
      parryCounters.forEach((counter) => {
        const targetState = state.get(counter.attackerId);
        if (!targetState) return;
        const targetCharacter = characterById.get(counter.attackerId);
        const targetEntry = targetCharacter ? findEntryForCharacter(beat, targetCharacter) : null;
        const hasHammerPassive =
          targetEntry?.passiveCardId === HAMMER_CARD_ID && isActionActive(targetEntry.action);
        const damageReduction = getHealingHarmonyReduction(targetEntry);
        const adjustedDamage = Math.max(0, counter.damage - damageReduction);
        targetState.damage += adjustedDamage;
        const passiveKbfReduction = getPassiveKbfReduction(targetEntry);
        const baseKbf = Math.max(0, counter.kbf - passiveKbfReduction);
        const baseKnockbackDistance = getKnockbackDistance(targetState.damage, baseKbf);
        const convertKbf = shouldConvertKbfToDiscard(targetEntry);
        if (convertKbf && baseKnockbackDistance > 0) {
          queueDiscard(counter.attackerId, baseKnockbackDistance, 'self', targetEntry);
        }
        const knockbackDistance = convertKbf ? 0 : baseKnockbackDistance;
        let knockedSteps = 0;
        const knockbackDirection = counter.directionIndex != null ? AXIAL_DIRECTIONS[counter.directionIndex] : null;
        if (knockbackDirection && knockbackDistance > 0) {
          let finalPosition = { ...targetState.position };
          for (let step = 0; step < knockbackDistance; step += 1) {
            const candidate = {
              q: finalPosition.q + knockbackDirection.q,
              r: finalPosition.r + knockbackDirection.r,
            };
            const occupant = occupancy.get(coordKey(candidate));
            if (occupant && occupant !== counter.attackerId) break;
            finalPosition = candidate;
            knockedSteps += 1;
          }
          if (!sameCoord(finalPosition, targetState.position)) {
            occupancy.delete(coordKey(targetState.position));
            targetState.position = { q: finalPosition.q, r: finalPosition.r };
            occupancy.set(coordKey(targetState.position), counter.attackerId);
          }
        }
        const shouldStun = baseKbf === 1 || (baseKbf > 1 && baseKnockbackDistance > 0);
        if (shouldStun) {
          applyHitTimeline(counter.attackerId, index, targetState, knockedSteps, false);
        }
        recordHitConsequence(counter.attackerId, index, targetState, adjustedDamage, knockedSteps);
          if (
            counter.defenderId &&
            counter.defenderId !== counter.attackerId &&
            hasHammerPassive
          ) {
            const defenderState = state.get(counter.defenderId);
            if (defenderState) {
              defenderState.damage += 2;
              recordHitConsequence(counter.defenderId, index, defenderState, 2, 0);
          }
        }
        disabledActors.add(counter.attackerId);
      });
      parryCountersByBeat.delete(index);
    }
    const ordered = beat
      .slice()
      .sort((a, b) => {
        const priorityDelta = (b.priority ?? 0) - (a.priority ?? 0);
        if (priorityDelta) return priorityDelta;
        const orderA = rosterOrder.get(resolveEntryKey(a)) ?? Number.MAX_SAFE_INTEGER;
        const orderB = rosterOrder.get(resolveEntryKey(b)) ?? Number.MAX_SAFE_INTEGER;
        return orderA - orderB;
      })
      .filter((entry) => entry.action !== DEFAULT_ACTION);

    const burningStrikeBeatData = new Map<string, { attackedHexes: HexCoord[]; hasHit: boolean }>();
    const recordBurningStrikeAttack = (actorId: string, coord: { q: number; r: number }) => {
      const current = burningStrikeBeatData.get(actorId) ?? { attackedHexes: [], hasHit: false };
      current.attackedHexes.push({ q: coord.q, r: coord.r });
      burningStrikeBeatData.set(actorId, current);
    };
    const recordBurningStrikeHit = (actorId: string) => {
      const current = burningStrikeBeatData.get(actorId) ?? { attackedHexes: [], hasHit: false };
      current.hasHit = true;
      burningStrikeBeatData.set(actorId, current);
    };

    ordered.forEach((entry) => {
      const actorId = userLookup.get(resolveEntryKey(entry));
      if (!actorId) return;
      if (disabledActors.has(actorId)) return;
      const actorState = state.get(actorId);
      if (!actorState) return;
      const actionSetFacing = actionSetFacingByUser.get(actorId) ?? actorState.facing;
      const actionSetRotation = actionSetRotationByUser.get(actorId) ?? '';
      const rotationMagnitude = getRotationMagnitude(actionSetRotation);
      const comboState = comboStates.get(actorId);
      if (comboState && isEntryThrow(entry)) {
        comboState.throwInteraction = true;
      }
      const origin = { q: actorState.position.q, r: actorState.position.r };
      const actionLabel = normalizeActionLabel(entry.action ?? '');

      if (entry.cardId === BOW_SHOT_CARD_ID && actionLabel.toUpperCase() === 'X1') {
        const forward = applyFacingToVector(LOCAL_DIRECTIONS.F, actorState.facing);
        spawnArrowToken(
          { q: origin.q + forward.q, r: origin.r + forward.r },
          actorState.facing,
          actorId,
        );
      }
      if (entry.cardId === IRON_WILL_CARD_ID && actionLabel.toUpperCase() === 'X1') {
        const interactionId = buildInteractionId('draw', index, actorId, actorId);
        if (!interactionById.has(interactionId) && !isHistoryIndex(index)) {
          const created: CustomInteraction = {
            id: interactionId,
            type: 'draw',
            beatIndex: index,
            actorUserId: actorId,
            targetUserId: actorId,
            status: 'resolved',
            drawCount: 3,
            resolution: { applied: false },
          };
          updatedInteractions.push(created);
          interactionById.set(interactionId, created);
        }
      }
      if (entry.cardId === JAB_CARD_ID && isBracketedAction(entry.action ?? '')) {
        const interactionId = buildInteractionId('draw', index, actorId, actorId);
        if (!interactionById.has(interactionId) && !isHistoryIndex(index)) {
          const created: CustomInteraction = {
            id: interactionId,
            type: 'draw',
            beatIndex: index,
            actorUserId: actorId,
            targetUserId: actorId,
            status: 'resolved',
            drawCount: 1,
            resolution: { applied: false },
          };
          updatedInteractions.push(created);
          interactionById.set(interactionId, created);
        }
      }
        if (entry.cardId === HEALING_HARMONY_CARD_ID && actionLabel.toUpperCase() === 'X1') {
          const targetState = state.get(actorId);
          if (targetState) {
            targetState.damage = Math.max(0, targetState.damage - 3);
          }
        }

        if (entry.passiveCardId === CROSS_SLASH_CARD_ID && entry.action !== DEFAULT_ACTION && isActionSetStart(entry)) {
          actorState.damage += 1;
          recordHitConsequence(actorId, index, actorState, 1, 0);
        }

        const startDiscard = getPassiveStartDiscardCount(entry.passiveCardId);
        if (startDiscard && entry.action !== DEFAULT_ACTION && isActionSetStart(entry)) {
          queueDiscard(actorId, startDiscard, 'self');
        }

      if (isComboAction(entry.action ?? '')) {
        if (entry.comboSkipped || isHistoryIndex(index)) {
          comboStates.delete(actorId);
          return;
        }
        const comboIndex = comboState?.coIndex ?? null;
        const cardMatches = comboState?.cardId === entry.cardId;
        const canCombo =
          comboIndex === index &&
          cardMatches &&
          Boolean(comboState?.hit) &&
          Boolean(comboAvailabilityByUser.get(actorId)) &&
          !comboState?.throwInteraction;
        if (!canCombo) {
          if (!isComboAction(entry.action ?? '')) {
            entry.action = 'Co';
          }
          entry.comboSkipped = true;
          comboStates.delete(actorId);
          return;
        }
        const interactionId = buildInteractionId('combo', index, actorId, actorId);
        const existing = interactionById.get(interactionId);
        if (!existing) {
          const created: CustomInteraction = {
            id: interactionId,
            type: 'combo',
            beatIndex: index,
            actorUserId: actorId,
            targetUserId: actorId,
            status: 'pending',
            resolution: undefined,
          };
          updatedInteractions.push(created);
          interactionById.set(interactionId, created);
        }
        if (haltIndex == null || index < haltIndex) {
          haltIndex = index;
        }
        comboStates.delete(actorId);
        return;
      }

        const entryDamage = Number.isFinite(entry.attackDamage) ? entry.attackDamage : 0;
        const entryKbf = Number.isFinite(entry.attackKbf) ? entry.attackKbf : 0;
        const hasGrapplingHookPassive = entry.passiveCardId === GRAPPLING_HOOK_CARD_ID;
        const hasGiganticStaffPassive =
          entry.passiveCardId === GIGANTIC_STAFF_CARD_ID && resolveTerrain(actorState.position) === 'abyss';
        if (hasGiganticStaffPassive) {
          const nextAction = applyGiganticStaffAction(entry.action ?? '');
          if (nextAction !== entry.action) {
            entry.action = nextAction;
          }
        }
        const tokens = parseActionTokens(entry.action ?? '');

      tokens.forEach((token) => {
        const isGrapplingHookCharge =
          entry.cardId === GRAPPLING_HOOK_CARD_ID && token.type === 'c' && isBracketedAction(entry.action ?? '');
        const { positions, destination, lastStep } = isGrapplingHookCharge
          ? buildGrapplingHookPath(origin, token.steps, actorState.facing, landTiles, occupancy, actorId)
          : buildPath(origin, token.steps, actorState.facing);
        const targetKey = coordKey(destination);
        const targetId = occupancy.get(targetKey);
        const delta = { q: origin.q - destination.q, r: origin.r - destination.r };
        const directionIndex =
          getDirectionIndex(delta) ?? (lastStep ? getDirectionIndex({ q: -lastStep.q, r: -lastStep.r }) : null);

        if (token.type === 'b') {
          const blockVector = lastStep ?? applyFacingToVector(LOCAL_DIRECTIONS.F, actorState.facing);
          const blockDirectionIndex = getDirectionIndex(blockVector);
          const blockKey = coordKey(origin);
          if (blockDirectionIndex != null) {
            const existing = blockMap.get(blockKey) ?? new Map<number, BlockSource>();
            existing.set(blockDirectionIndex, {
              actorId,
              cardId: entry.cardId ?? undefined,
              passiveCardId: entry.passiveCardId ?? undefined,
              action: entry.action ?? undefined,
            });
            blockMap.set(blockKey, existing);
          }
          return;
        }

        const blockSource = directionIndex != null ? blockMap.get(targetKey)?.get(directionIndex) : undefined;
        const isBlocked = Boolean(blockSource);
        const targetCharacter = targetId ? characterById.get(targetId) : null;
        const targetEntry = targetCharacter ? findEntryForCharacter(beat, targetCharacter) : null;

        if (token.type === 'a' || token.type === 'c') {
          recordBurningStrikeAttack(actorId, destination);
          const isThrow = isEntryThrow(entry);
          const throwBlocked = isThrow && isThrowImmune(targetEntry);
          const blockedByBlock = isBlocked && !isThrow;
          const blocked = blockedByBlock || throwBlocked;
          const comboCardId = entry.cardId ? `${entry.cardId}` : '';
          let activeComboState = comboState;
          if (!isThrow && targetId && !isBlocked) {
            if (!activeComboState || activeComboState.cardId !== comboCardId) {
              activeComboState = ensureComboStateForHit(actorId, characterById.get(actorId), comboCardId, index);
            }
            if (activeComboState && activeComboState.cardId === comboCardId) {
              activeComboState.hit = true;
            }
          }
          const targetState = targetId ? state.get(targetId) : null;
          const isStabHit =
            targetId &&
            entry.cardId === STAB_CARD_ID &&
            isBracketedAction(entry.action ?? '') &&
            targetState &&
            isBehindTarget(origin, targetState);
          const stabBonus = isStabHit ? 3 : 0;
          const attackDamage = entryDamage + stabBonus;
          const attackKbf = entryKbf + stabBonus;
          if (targetId && blockedByBlock && attackDamage > 0) {
            const blockAction = blockSource?.action ?? targetEntry?.action;
            const blockCardId = blockSource?.cardId ?? targetEntry?.cardId;
            if (blockCardId === ABSORB_CARD_ID && isBracketedAction(blockAction ?? '')) {
              queueDraw(targetId, attackDamage);
            }
            if (blockCardId === PARRY_CARD_ID && isBracketedAction(blockAction ?? '')) {
              queueParryCounter(index, index + 1, targetId, actorId, attackDamage * 2, attackKbf + 1, directionIndex);
            }
          }
            if (targetId && !blocked) {
              if (targetState) {
                const preserveAction =
                  executedActors.has(targetId) && (targetEntry?.action ?? DEFAULT_ACTION) !== DAMAGE_ICON_ACTION;
                const hasHammerPassive =
                  targetEntry?.passiveCardId === HAMMER_CARD_ID && isActionActive(targetEntry?.action);
                if (isThrow) {
                  const interactionId = buildInteractionId('throw', index, actorId, targetId);
                  const existing = interactionById.get(interactionId);
                const resolvedDirection = getResolvedDirectionIndex(existing);
                if (existing?.status === 'resolved' && resolvedDirection != null) {
                  const damageReduction = getHealingHarmonyReduction(targetEntry);
                  const adjustedDamage = Math.max(0, attackDamage - damageReduction);
                  targetState.damage += adjustedDamage;
                  recordBurningStrikeHit(actorId);
                  const knockbackDirection = AXIAL_DIRECTIONS[resolvedDirection];
                  let knockedSteps = 0;
                  if (knockbackDirection && THROW_DISTANCE > 0) {
                    let finalPosition = { ...targetState.position };
                    for (let step = 0; step < THROW_DISTANCE; step += 1) {
                      const candidate = {
                        q: finalPosition.q + knockbackDirection.q,
                        r: finalPosition.r + knockbackDirection.r,
                      };
                      finalPosition = candidate;
                      knockedSteps += 1;
                    }
                    const landingOccupant = occupancy.get(coordKey(finalPosition));
                    if (landingOccupant && landingOccupant !== targetId) {
                      finalPosition = { ...targetState.position };
                      knockedSteps = 0;
                    }
                    if (!sameCoord(finalPosition, targetState.position)) {
                      occupancy.delete(coordKey(targetState.position));
                      targetState.position = { q: finalPosition.q, r: finalPosition.r };
                      occupancy.set(coordKey(targetState.position), targetId);
                    }
                  }
                    applyHitTimeline(targetId, index, targetState, knockedSteps, preserveAction);
                    recordHitConsequence(targetId, index, targetState, adjustedDamage, knockedSteps);
                    if (hasHammerPassive && actorId !== targetId) {
                      const attackerState = state.get(actorId);
                      if (attackerState) {
                        attackerState.damage += 2;
                        recordHitConsequence(actorId, index, attackerState, 2, 0);
                      }
                  }
                  disabledActors.add(targetId);
                } else {
                  if (!existing) {
                    const created: CustomInteraction = {
                      id: interactionId,
                      type: 'throw',
                      beatIndex: index,
                      actorUserId: actorId,
                      targetUserId: targetId,
                      status: 'pending',
                      resolution: undefined,
                    };
                    updatedInteractions.push(created);
                    interactionById.set(interactionId, created);
                  }
                  disabledActors.add(targetId);
                  if (haltIndex == null || index < haltIndex) {
                    haltIndex = index;
                  }
                }
              } else {
                recordBurningStrikeHit(actorId);
                const ironWillKey = buildHandTriggerKey(IRON_WILL_CARD_ID, index, targetId);
                const ironWillInteractionId = buildHandTriggerInteractionId(
                  IRON_WILL_CARD_ID,
                  index,
                  targetId,
                  targetId,
                  actorId,
                );
                const ironWillInteraction = interactionById.get(ironWillInteractionId);
                if (
                  !isHistoryIndex(index) &&
                  hasHandTriggerCard(targetId, IRON_WILL_CARD_ID) &&
                  !ironWillInteraction &&
                  !handTriggerKeys.has(ironWillKey)
                ) {
                  const definition = getHandTriggerDefinition(IRON_WILL_CARD_ID);
                  const created: CustomInteraction = {
                    id: ironWillInteractionId,
                    type: 'hand-trigger',
                    beatIndex: index,
                    actorUserId: targetId,
                    targetUserId: targetId,
                    sourceUserId: actorId,
                    status: 'pending',
                    discardCount: definition?.discardCount ?? 1,
                    cardId: definition?.cardId ?? IRON_WILL_CARD_ID,
                    cardType: definition?.cardType ?? 'ability',
                    effect: definition?.effect ?? 'iron-will',
                  };
                  updatedInteractions.push(created);
                  interactionById.set(ironWillInteractionId, created);
                  handTriggerKeys.add(ironWillKey);
                  if (haltIndex == null || index < haltIndex) {
                    haltIndex = index;
                  }
                  return;
                }
                if (ironWillInteraction?.status === 'pending') {
                  if (haltIndex == null || index < haltIndex) {
                    haltIndex = index;
                  }
                  return;
                }

                const discardRule = getActiveHitDiscardRule(entry.cardId);
                if (discardRule && isBracketedAction(entry.action ?? '')) {
                  const isCenter = !discardRule.centerOnly || isCenterAttackPath(token.path);
                  if (isCenter) {
                    queueDiscard(targetId, discardRule.count, 'opponent', targetEntry);
                  }
                }

                const fromPosition = { q: targetState.position.q, r: targetState.position.r };
                const damageReduction = getHealingHarmonyReduction(targetEntry);
                const adjustedDamage = Math.max(0, attackDamage - damageReduction);
                targetState.damage += adjustedDamage;
                if (
                  entry.cardId === BURNING_STRIKE_CARD_ID &&
                  isBracketedAction(entry.action ?? '') &&
                  token.type === 'a'
                ) {
                  addFireHexToken(destination, actorId);
                }
                const usesGrapplingHookPassive = hasGrapplingHookPassive && token.type === 'a';
                const attackDirection = getKnockbackDirection(origin, destination, lastStep);
                const { knockbackDirection } = applyGrapplingHookPassiveFlip(
                  usesGrapplingHookPassive,
                  origin,
                  attackDirection,
                  targetState,
                  occupancy,
                  targetId,
                );
                const passiveKbfReduction = getPassiveKbfReduction(targetEntry);
                const baseKbf = Math.max(0, attackKbf - passiveKbfReduction);
                const effectiveKbf = getHandTriggerUse(ironWillInteraction) ? 0 : baseKbf;
                const baseKnockbackDistance = getKnockbackDistance(targetState.damage, effectiveKbf);
                const convertKbf = shouldConvertKbfToDiscard(targetEntry);
                if (convertKbf && baseKnockbackDistance > 0) {
                  queueDiscard(targetId, baseKnockbackDistance, 'self', targetEntry);
                }
                const knockbackDistance = convertKbf ? 0 : baseKnockbackDistance;
                let knockedSteps = 0;
                if (knockbackDirection && knockbackDistance > 0) {
                  let finalPosition = { ...targetState.position };
                  for (let step = 0; step < knockbackDistance; step += 1) {
                    const candidate = {
                      q: finalPosition.q + knockbackDirection.q,
                      r: finalPosition.r + knockbackDirection.r,
                    };
                    const occupant = occupancy.get(coordKey(candidate));
                    if (occupant && occupant !== targetId) break;
                    finalPosition = candidate;
                    knockedSteps += 1;
                  }
                  if (!sameCoord(finalPosition, targetState.position)) {
                    occupancy.delete(coordKey(targetState.position));
                    targetState.position = { q: finalPosition.q, r: finalPosition.r };
                    occupancy.set(coordKey(targetState.position), targetId);
                  }
                }
                const shouldStun = effectiveKbf === 1 || (effectiveKbf > 1 && baseKnockbackDistance > 0);
                if (shouldStun) {
                  applyHitTimeline(targetId, index, targetState, knockedSteps, preserveAction);
                }
                recordHitConsequence(targetId, index, targetState, adjustedDamage, knockedSteps);
                if (hasHammerPassive && actorId !== targetId) {
                  const attackerState = state.get(actorId);
                  if (attackerState) {
                    attackerState.damage += 2;
                    recordHitConsequence(actorId, index, attackerState, 2, 0);
                  }
                }
                if (shouldStun) {
                  disabledActors.add(targetId);
                }

                const wasOnLand = resolveTerrain(fromPosition) === 'land';
                const nowOnAbyss = resolveTerrain(targetState.position) === 'abyss';
                if (
                  knockedSteps > 0 &&
                  wasOnLand &&
                  nowOnAbyss &&
                  hasHandTriggerCard(targetId, VENGEANCE_CARD_ID) &&
                  !handTriggerKeys.has(buildHandTriggerKey(VENGEANCE_CARD_ID, index, targetId)) &&
                  !isHistoryIndex(index)
                ) {
                  const definition = getHandTriggerDefinition(VENGEANCE_CARD_ID);
                  const interactionId = buildHandTriggerInteractionId(VENGEANCE_CARD_ID, index, targetId, targetId);
                  if (!interactionById.has(interactionId)) {
                    const created: CustomInteraction = {
                      id: interactionId,
                      type: 'hand-trigger',
                      beatIndex: index,
                      actorUserId: targetId,
                      targetUserId: targetId,
                      status: 'pending',
                      discardCount: definition?.discardCount ?? 1,
                      cardId: definition?.cardId ?? VENGEANCE_CARD_ID,
                      cardType: definition?.cardType ?? 'ability',
                      effect: definition?.effect ?? 'vengeance',
                      drawCount: knockedSteps,
                    };
                    updatedInteractions.push(created);
                    interactionById.set(interactionId, created);
                    handTriggerKeys.add(buildHandTriggerKey(VENGEANCE_CARD_ID, index, targetId));
                    if (haltIndex == null || index < haltIndex) {
                      haltIndex = index;
                    }
                  }
                }
              }
            }
          } else if (
            entry.cardId === BURNING_STRIKE_CARD_ID &&
            isBracketedAction(entry.action ?? '') &&
            token.type === 'a'
          ) {
            addFireHexToken(destination, actorId);
          }
        }

        if (token.type === 'm' || token.type === 'c') {
          let finalPosition = origin;
          let blockedBy: string | null = null;
          for (const stepPosition of positions) {
            const stepKey = coordKey(stepPosition);
            const occupant = occupancy.get(stepKey);
            if (occupant && occupant !== actorId) {
              blockedBy = occupant;
              break;
            }
            finalPosition = stepPosition;
          }
          if (blockedBy) {
            const blockDiscard = getPassiveBlockDiscardCount(entry.passiveCardId);
            if (blockDiscard) {
              const targetCharacter = characterById.get(blockedBy);
              const targetEntry = targetCharacter ? findEntryForCharacter(beat, targetCharacter) : null;
              queueDiscard(blockedBy, blockDiscard, 'opponent', targetEntry);
            }
          }
          if (!sameCoord(finalPosition, actorState.position)) {
            occupancy.delete(coordKey(actorState.position));
            actorState.position = { q: finalPosition.q, r: finalPosition.r };
            occupancy.set(coordKey(actorState.position), actorId);
          }
          if (token.type === 'm' && !sameCoord(finalPosition, origin)) {
            if (entry.passiveCardId === BURNING_STRIKE_CARD_ID) {
              addFireHexToken(origin, actorId);
            }
            if (entry.passiveCardId === BOW_SHOT_CARD_ID && (rotationMagnitude === 1 || rotationMagnitude === 2)) {
              spawnArrowToken(finalPosition, actionSetFacing, actorId);
            }
          }
        }

        if (token.type === 'j') {
          if (!targetId || targetId === actorId) {
            occupancy.delete(coordKey(actorState.position));
            actorState.position = { q: destination.q, r: destination.r };
            occupancy.set(coordKey(actorState.position), actorId);
          }
        }
      });

      executedActors.add(actorId);
    });

    updatedInteractions.forEach((interaction) => {
      if (interaction.type !== 'hand-trigger') return;
      if (interaction.status !== 'resolved') return;
      if (interaction.beatIndex !== index) return;
      if (!getHandTriggerUse(interaction)) return;
      const cardId = getHandTriggerCardId(interaction);
      if (cardId === BURNING_STRIKE_CARD_ID) {
        const hexes = Array.isArray(interaction.attackHexes) ? interaction.attackHexes : [];
        hexes.forEach((coord) => {
          if (!coord) return;
          addFireHexToken(coord, interaction.actorUserId);
        });
      }
      if (cardId === SINKING_SHOT_CARD_ID && interaction.targetUserId) {
        const targetCharacter = characterById.get(interaction.targetUserId);
        const targetEntry = targetCharacter ? findEntryForCharacter(beat, targetCharacter) : null;
        queueDiscard(interaction.targetUserId, 2, 'opponent', targetEntry, { force: true });
      }
    });

    if (burningStrikeBeatData.size) {
      burningStrikeBeatData.forEach((data, actorId) => {
        if (!data.hasHit) return;
        if (!hasHandTriggerCard(actorId, BURNING_STRIKE_CARD_ID)) return;
        if (isHistoryIndex(index)) return;
        const interactionKey = buildHandTriggerKey(BURNING_STRIKE_CARD_ID, index, actorId);
        if (handTriggerKeys.has(interactionKey)) return;
        const uniqueHexes: HexCoord[] = [];
        const seen = new Set<string>();
        data.attackedHexes.forEach((coord) => {
          const key = coordKey(coord);
          if (seen.has(key)) return;
          seen.add(key);
          uniqueHexes.push({ q: coord.q, r: coord.r });
        });
        const definition = getHandTriggerDefinition(BURNING_STRIKE_CARD_ID);
        const interactionId = buildHandTriggerInteractionId(BURNING_STRIKE_CARD_ID, index, actorId, actorId);
        if (interactionById.has(interactionId)) return;
        const created: CustomInteraction = {
          id: interactionId,
          type: 'hand-trigger',
          beatIndex: index,
          actorUserId: actorId,
          targetUserId: actorId,
          status: 'pending',
          discardCount: definition?.discardCount ?? 1,
          attackHexes: uniqueHexes,
          cardId: definition?.cardId ?? BURNING_STRIKE_CARD_ID,
          cardType: definition?.cardType ?? 'ability',
          effect: definition?.effect ?? 'burning-strike',
        };
        updatedInteractions.push(created);
        interactionById.set(interactionId, created);
        handTriggerKeys.add(interactionKey);
        if (haltIndex == null || index < haltIndex) {
          haltIndex = index;
        }
      });
    }

    if (existingArrowIds.size) {
      const nextTokens: BoardToken[] = [];
      boardTokens.forEach((token) => {
        if (token.type !== ARROW_TOKEN_TYPE) {
          nextTokens.push(token);
          return;
        }
        if (!existingArrowIds.has(token.id)) {
          nextTokens.push(token);
          return;
        }
        const forward = applyFacingToVector(LOCAL_DIRECTIONS.F, token.facing);
        const nextPosition = { q: token.position.q + forward.q, r: token.position.r + forward.r };
        const targetId = occupancy.get(coordKey(nextPosition));
        if (targetId) {
          resolveArrowHit(targetId, token.ownerUserId ?? '', forward);
          return;
        }
        const distance = getDistanceToLand(nextPosition, landTiles);
        if (distance >= ARROW_LAND_DISTANCE_LIMIT) {
          return;
        }
        nextTokens.push({ ...token, position: { q: nextPosition.q, r: nextPosition.r } });
      });
      boardTokens.splice(0, boardTokens.length, ...nextTokens);
    }

    if (fireTokenKeys.size || ephemeralFireKeys.size) {
      state.forEach((targetState, targetId) => {
        const key = coordKey(targetState.position);
        if (!fireTokenKeys.has(key) && !ephemeralFireKeys.has(key)) return;
        targetState.damage += 1;
        recordHitConsequence(targetId, index, targetState, 1, 0);
      });
    }

    if (actionSetEnders.size) {
      actionSetEnders.forEach((entry, actorId) => {
        if (entry.passiveCardId !== ABSORB_CARD_ID) return;
        const actorState = state.get(actorId);
        if (!actorState) return;
        if (resolveTerrain(actorState.position) !== 'abyss') return;
        queueDraw(actorId, 1);
      });
    }

    if (discardQueue.size || forcedDiscardQueue.size) {
      const combined = new Map<string, { count: number; force: boolean }>();
      discardQueue.forEach((count, targetId) => {
        combined.set(targetId, { count, force: false });
      });
      forcedDiscardQueue.forEach((count, targetId) => {
        const existing = combined.get(targetId);
        combined.set(targetId, {
          count: (existing?.count ?? 0) + count,
          force: true,
        });
      });
      combined.forEach((item, targetId) => {
        if (!item.count) return;
        if (!item.force && isHistoryIndex(index)) return;
        const interactionId = buildInteractionId('discard', index, targetId, targetId);
        const existing = interactionById.get(interactionId);
        if (existing) {
          if (existing.status === 'pending' && existing.discardCount !== item.count) {
            existing.discardCount = item.count;
          }
          return;
        }
        const created: CustomInteraction = {
          id: interactionId,
          type: 'discard',
          beatIndex: index,
          actorUserId: targetId,
          targetUserId: targetId,
          status: 'pending',
          discardCount: item.count,
        };
        updatedInteractions.push(created);
        interactionById.set(interactionId, created);
        if (haltIndex == null || index < haltIndex) {
          haltIndex = index;
        }
      });
    }

    applyStateToBeat(beat, true);
    lastCalculated = index;
    if (haltIndex != null && index >= haltIndex) {
      for (let j = index + 1; j < normalizedBeats.length; j += 1) {
        applyStateToBeat(normalizedBeats[j], false);
      }
      break;
    }
  }

    const updatedCharacters = characters.map((character) => ({
      ...character,
      position: { q: character.position.q, r: character.position.r },
    }));

  console.log(LOG_PREFIX, 'result', {
    beats: normalizedBeats.length,
    lastCalculated,
    haltIndex,
    pendingInteractions: updatedInteractions.filter((item) => item.status === 'pending').length,
  });

  return {
    beats: normalizedBeats,
    characters: updatedCharacters,
    lastCalculated,
    interactions: updatedInteractions,
    boardTokens: boardTokens.map((token) => ({
      ...token,
      position: { q: token.position.q, r: token.position.r },
    })),
  };
};
