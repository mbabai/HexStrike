import {
  ActionListItem,
  BeatEntry,
  BoardToken,
  CardDefinition,
  CustomInteraction,
  HexCoord,
  PublicCharacter,
} from '../types';
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
import { buildCardActionList } from './cardText/actionListBuilder';
import { DEFAULT_LAND_HEXES } from './hexGrid';
import { getHandTriggerDefinition } from './handTriggers';

declare const require: (id: string) => any;

const DEFAULT_ACTION = 'E';
const FOCUS_ACTION = 'F';
const LOG_PREFIX = '[execute]';
const WAIT_ACTION = 'W';
const COMBO_ACTION = 'CO';
const DAMAGE_ICON_ACTION = 'DamageIcon';
const KNOCKBACK_DIVISOR = 10;
const THROW_DISTANCE = 2;
const FIRE_HEX_TOKEN_TYPE = 'fire-hex';
const ETHEREAL_PLATFORM_TOKEN_TYPE = 'ethereal-platform';
const ARROW_TOKEN_TYPE = 'arrow';
const FOCUS_ANCHOR_TOKEN_TYPE = 'focus-anchor';
const ARROW_DAMAGE = 4;
const ARROW_KBF = 1;
const ARROW_LAND_DISTANCE_LIMIT = 5;
const HAVEN_PLATFORM_INTERACTION_TYPE = 'haven-platform';
const GUARD_CONTINUE_INTERACTION_TYPE = 'guard-continue';
const REWIND_FOCUS_INTERACTION_TYPE = 'rewind-focus';
const REWIND_RETURN_INTERACTION_TYPE = 'rewind-return';
const BOW_SHOT_CARD_ID = 'bow-shot';
const BURNING_STRIKE_CARD_ID = 'burning-strike';
const GUARD_CARD_ID = 'guard';
const HAVEN_CARD_ID = 'haven';
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
const REFLEX_DODGE_CARD_ID = 'reflex-dodge';
const SMOKE_BOMB_CARD_ID = 'smoke-bomb';
const REWIND_CARD_ID = 'rewind';
// Keep in sync with cardRules/pendingActionPreview throw detection.
const ACTIVE_THROW_CARD_IDS = new Set(['hip-throw', 'tackle']);
const PASSIVE_THROW_CARD_IDS = new Set(['leap']);
const GRAPPLING_HOOK_CARD_ID = 'grappling-hook';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CARD_DATA = require('../../public/cards/cards.json') as { movement?: unknown[]; ability?: unknown[] };
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
const isOpenBeatAction = (action: string | null | undefined) => {
  const label = normalizeActionLabel(action ?? '').toUpperCase();
  return label === DEFAULT_ACTION || label === FOCUS_ACTION;
};

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

const normalizeHexCoord = (value: unknown): { q: number; r: number } | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { q?: unknown; r?: unknown };
  const q = Number(raw.q);
  const r = Number(raw.r);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  return { q: Math.round(q), r: Math.round(r) };
};

const buildTouchingHexes = (origin: { q: number; r: number }) => [
  { q: origin.q, r: origin.r },
  ...AXIAL_DIRECTIONS.map((direction) => ({
    q: origin.q + direction.q,
    r: origin.r + direction.r,
  })),
];

const getHavenTargetHex = (interaction: CustomInteraction | undefined): { q: number; r: number } | null => {
  const fromResolution = normalizeHexCoord(interaction?.resolution?.targetHex);
  if (fromResolution) return fromResolution;
  return normalizeHexCoord(interaction?.targetHex);
};

let runtimeCardLookup: Map<string, CardDefinition> | null = null;

const normalizeRuntimeCard = (
  card: unknown,
  type: 'movement' | 'ability',
  index: number,
): CardDefinition | null => {
  if (!card || typeof card !== 'object') return null;
  const raw = card as Record<string, unknown>;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `${type}-${index}`;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;
  const actions = Array.isArray(raw.actions)
    ? raw.actions.map((action) => `${action ?? ''}`.trim()).filter(Boolean)
    : [];
  const rotations = typeof raw.rotations === 'string' && raw.rotations.trim() ? raw.rotations.trim() : '*';
  const priority = Number.isFinite(raw.priority) ? Number(raw.priority) : 0;
  const damage = Number.isFinite(raw.damage) ? Number(raw.damage) : 0;
  const kbf = Number.isFinite(raw.kbf) ? Number(raw.kbf) : 0;
  const activeText = typeof raw.activeText === 'string' ? raw.activeText : undefined;
  const passiveText = typeof raw.passiveText === 'string' ? raw.passiveText : undefined;
  return { id, name, type, priority, actions, rotations, damage, kbf, activeText, passiveText };
};

const getRuntimeCardLookup = (): Map<string, CardDefinition> => {
  if (runtimeCardLookup) return runtimeCardLookup;
  runtimeCardLookup = new Map<string, CardDefinition>();
  try {
    const data = CARD_DATA ?? {};
    const movement = Array.isArray(data?.movement) ? data.movement : [];
    const ability = Array.isArray(data?.ability) ? data.ability : [];
    movement.forEach((card, index) => {
      const normalized = normalizeRuntimeCard(card, 'movement', index);
      if (normalized) runtimeCardLookup?.set(normalized.id, normalized);
    });
    ability.forEach((card, index) => {
      const normalized = normalizeRuntimeCard(card, 'ability', index);
      if (normalized) runtimeCardLookup?.set(normalized.id, normalized);
    });
  } catch (error) {
    console.error(LOG_PREFIX, 'card-lookup-load-failed', error);
  }
  return runtimeCardLookup;
};

const getRewindReturnActionList = (): ActionListItem[] => {
  const rewindCard = getRuntimeCardLookup().get(REWIND_CARD_ID);
  const actions = Array.isArray(rewindCard?.actions) ? rewindCard.actions : [];
  const focusIndex = actions.findIndex((action) => normalizeActionLabel(action).toUpperCase() === FOCUS_ACTION);
  const trailingActions = focusIndex >= 0 ? actions.slice(focusIndex + 1) : [];
  const fallbackActions = trailingActions.length ? trailingActions : [DEFAULT_ACTION];
  const priority = Number.isFinite(rewindCard?.priority) ? Number(rewindCard?.priority) : 0;
  const damage = Number.isFinite(rewindCard?.damage) ? Number(rewindCard?.damage) : 0;
  const kbf = Number.isFinite(rewindCard?.kbf) ? Number(rewindCard?.kbf) : 0;
  return fallbackActions.map((action) => ({
    action: `${action ?? ''}`,
    rotation: '',
    priority,
    damage,
    kbf,
    cardId: REWIND_CARD_ID,
  }));
};

const buildSwappedActionList = (
  currentActiveCardId: string | null | undefined,
  currentPassiveCardId: string | null | undefined,
  rotationLabel: string,
): ActionListItem[] => {
  if (!currentActiveCardId || !currentPassiveCardId) return [];
  const cardLookup = getRuntimeCardLookup();
  const nextActive = cardLookup.get(currentPassiveCardId);
  const nextPassive = cardLookup.get(currentActiveCardId);
  if (!nextActive || !nextPassive || nextActive.type === nextPassive.type) return [];
  return buildCardActionList(nextActive, nextPassive, rotationLabel);
};

const isGrapplingHookThrow = (
  entry: BeatEntry | null | undefined,
  options: {
    tokenType?: string;
    actorPosition?: { q: number; r: number } | null;
    targetPosition?: { q: number; r: number } | null;
  } = {},
) => {
  if (!entry || entry.cardId !== GRAPPLING_HOOK_CARD_ID) return false;
  if (entry.cardStartTerrain !== 'land') return false;
  if (`${options.tokenType ?? ''}`.toLowerCase() !== 'c') return false;
  if (!options.actorPosition || !options.targetPosition) return false;
  return axialDistance(options.actorPosition, options.targetPosition) === 1;
};

const isEntryThrow = (
  entry: BeatEntry | null | undefined,
  options: {
    tokenType?: string;
    actorPosition?: { q: number; r: number } | null;
    targetPosition?: { q: number; r: number } | null;
  } = {},
) => {
  if (!entry) return false;
  if (entry.interaction?.type === 'throw') return true;
  if (isGrapplingHookThrow(entry, options)) return true;
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
  guardContinueAvailability?: Map<string, boolean>,
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
  const guardContinueAvailabilityByUser = guardContinueAvailability ?? new Map<string, boolean>();
  const hasHandTriggerCard = (userId: string, cardId: string) =>
    Boolean(handTriggerAvailabilityByUser.get(userId)?.has(cardId));
  const canOfferGuardContinue = (userId: string) => {
    if (!guardContinueAvailabilityByUser.has(userId)) return true;
    return Boolean(guardContinueAvailabilityByUser.get(userId));
  };
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
      continue;
    }
    if (token.type === ETHEREAL_PLATFORM_TOKEN_TYPE && resolveTerrain(token.position) !== 'abyss') {
      boardTokens.splice(i, 1);
    }
  }
  let tokenCounter = boardTokens.length;
  const fireTokenKeys = new Set<string>();
  const platformTokenKeys = new Set<string>();
  const focusTokenByOwner = new Map<string, string>();
  let ephemeralFireKeys = new Set<string>();
  boardTokens.forEach((token) => {
    if (token.type === FIRE_HEX_TOKEN_TYPE) {
      fireTokenKeys.add(coordKey(token.position));
      return;
    }
    if (token.type === ETHEREAL_PLATFORM_TOKEN_TYPE) {
      platformTokenKeys.add(coordKey(token.position));
      return;
    }
    if (token.type === FOCUS_ANCHOR_TOKEN_TYPE) {
      const ownerId = `${token.ownerUserId ?? ''}`.trim();
      if (ownerId) {
        focusTokenByOwner.set(ownerId, token.id);
      }
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
  const activeRewindFocusByUser = new Map<string, CustomInteraction>();
  const handTriggerKeys = new Set<string>();
  const pendingIndices: number[] = [];
  const getRewindFocusCardId = (interaction: CustomInteraction | undefined): string => {
    if (!interaction) return '';
    const cardId = `${interaction.cardId ?? interaction.resolution?.cardId ?? REWIND_CARD_ID}`.trim();
    return cardId || REWIND_CARD_ID;
  };
  const normalizeInteractionHex = (value: unknown): { q: number; r: number } | null => normalizeHexCoord(value);
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
    if (interaction.type === REWIND_FOCUS_INTERACTION_TYPE && interaction.status === 'resolved') {
      const actorId = interaction.actorUserId;
      if (!actorId) return;
      const active = interaction.resolution?.active;
      if (active === false) return;
      activeRewindFocusByUser.set(actorId, interaction);
    }
  });
  const markRewindFocusInactive = (
    actorId: string,
    endedBeatIndex: number,
    reason: 'returned' | 'knockback' | 'stun',
  ): void => {
    const focus = activeRewindFocusByUser.get(actorId);
    if (!focus) return;
    focus.resolution = {
      ...(focus.resolution ?? {}),
      active: false,
      endedBeatIndex,
      endReason: reason,
    };
    activeRewindFocusByUser.delete(actorId);
  };
  const getActiveFocusCardId = (actorId: string): string | null => {
    const focus = activeRewindFocusByUser.get(actorId);
    if (!focus) return null;
    return getRewindFocusCardId(focus);
  };
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
  const appliedRewindReturnsById = new Set<string>();

  const nextTokenId = (type: string) => `${type}:${tokenCounter++}`;

  const addFireHexToken = (coord: { q: number; r: number }, ownerId?: string): boolean => {
    const key = coordKey(coord);
    const onLand = resolveTerrain(coord) === 'land';
    if (onLand) {
      if (fireTokenKeys.has(key)) return false;
      fireTokenKeys.add(key);
      boardTokens.push({
        id: nextTokenId(FIRE_HEX_TOKEN_TYPE),
        type: FIRE_HEX_TOKEN_TYPE,
        position: { q: coord.q, r: coord.r },
        facing: 0,
        ownerUserId: ownerId,
      });
      return true;
    }
    if (ephemeralFireKeys.has(key)) return false;
    ephemeralFireKeys.add(key);
    return true;
  };

  type DelayedPassiveFireSpawn = { coord: { q: number; r: number }; ownerId?: string };
  const delayedPassiveFireSpawnsByBeat = new Map<number, DelayedPassiveFireSpawn[]>();

  const queueDelayedPassiveFireHex = (beatIndex: number, coord: { q: number; r: number }, ownerId?: string) => {
    if (!Number.isFinite(beatIndex)) return;
    const targetBeat = Math.max(0, Math.round(beatIndex));
    const existing = delayedPassiveFireSpawnsByBeat.get(targetBeat) ?? [];
    const targetKey = coordKey(coord);
    if (existing.some((item) => coordKey(item.coord) === targetKey)) {
      return;
    }
    existing.push({ coord: { q: coord.q, r: coord.r }, ownerId });
    delayedPassiveFireSpawnsByBeat.set(targetBeat, existing);
  };

  const applyDelayedPassiveFireHexes = (beatIndex: number) => {
    if (!Number.isFinite(beatIndex)) return;
    const targetBeat = Math.max(0, Math.round(beatIndex));
    const queued = delayedPassiveFireSpawnsByBeat.get(targetBeat);
    if (!queued?.length) return;
    queued.forEach((spawn) => {
      addFireHexToken(spawn.coord, spawn.ownerId);
    });
    delayedPassiveFireSpawnsByBeat.delete(targetBeat);
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

  const addEtherealPlatformToken = (coord: { q: number; r: number }, ownerId?: string) => {
    if (resolveTerrain(coord) !== 'abyss') return;
    const key = coordKey(coord);
    if (platformTokenKeys.has(key)) return;
    platformTokenKeys.add(key);
    boardTokens.push({
      id: nextTokenId(ETHEREAL_PLATFORM_TOKEN_TYPE),
      type: ETHEREAL_PLATFORM_TOKEN_TYPE,
      position: { q: coord.q, r: coord.r },
      facing: 0,
      ownerUserId: ownerId,
    });
  };

  const removeEtherealPlatformToken = (coord: { q: number; r: number }) => {
    const key = coordKey(coord);
    if (!platformTokenKeys.has(key)) return;
    platformTokenKeys.delete(key);
    for (let i = boardTokens.length - 1; i >= 0; i -= 1) {
      const token = boardTokens[i];
      if (token.type !== ETHEREAL_PLATFORM_TOKEN_TYPE) continue;
      if (coordKey(token.position) !== key) continue;
      boardTokens.splice(i, 1);
      break;
    }
  };

  const removeFocusAnchorToken = (ownerUserId: string) => {
    const ownerId = `${ownerUserId ?? ''}`.trim();
    if (!ownerId) return;
    const tokenId = focusTokenByOwner.get(ownerId);
    focusTokenByOwner.delete(ownerId);
    if (!tokenId) return;
    for (let i = boardTokens.length - 1; i >= 0; i -= 1) {
      if (boardTokens[i]?.id !== tokenId) continue;
      boardTokens.splice(i, 1);
      break;
    }
  };

  const addFocusAnchorToken = (
    coord: { q: number; r: number },
    ownerUserId: string,
    cardId: string = REWIND_CARD_ID,
  ) => {
    const ownerId = `${ownerUserId ?? ''}`.trim();
    if (!coord || !ownerId) return;
    removeFocusAnchorToken(ownerId);
    const token: BoardToken = {
      id: nextTokenId(FOCUS_ANCHOR_TOKEN_TYPE),
      type: FOCUS_ANCHOR_TOKEN_TYPE,
      position: { q: coord.q, r: coord.r },
      facing: 0,
      ownerUserId: ownerId,
      cardId,
    };
    boardTokens.push(token);
    focusTokenByOwner.set(ownerId, token.id);
  };

  Array.from(focusTokenByOwner.keys()).forEach((ownerId) => {
    if (!activeRewindFocusByUser.has(ownerId)) {
      removeFocusAnchorToken(ownerId);
    }
  });
  activeRewindFocusByUser.forEach((interaction, actorId) => {
    const anchor = normalizeInteractionHex(interaction.resolution?.anchorHex);
    if (!anchor) return;
    addFocusAnchorToken(anchor, actorId, getRewindFocusCardId(interaction));
  });

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
      const focusCardId = resolved ? getActiveFocusCardId(resolved) : null;
      if (focusCardId) {
        entry.focusCardId = focusCardId;
      } else if ('focusCardId' in entry) {
        delete entry.focusCardId;
      }
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

  const clearActionFields = (entry: BeatEntry) => {
    entry.action = DEFAULT_ACTION;
    entry.rotation = '';
    entry.priority = 0;
    if ('rotationSource' in entry) delete entry.rotationSource;
    if ('interaction' in entry) delete entry.interaction;
    if ('attackDamage' in entry) delete entry.attackDamage;
    if ('attackKbf' in entry) delete entry.attackKbf;
    if ('comboStarter' in entry) delete entry.comboStarter;
    if ('cardId' in entry) delete entry.cardId;
    if ('passiveCardId' in entry) delete entry.passiveCardId;
    if ('stunOnly' in entry) delete entry.stunOnly;
    if ('focusCardId' in entry) delete entry.focusCardId;
  };

  const copyActionFields = (
    target: BeatEntry,
    source: BeatEntry,
    options: { preserveSelectedRotation?: boolean } = {},
  ) => {
    const preserveSelectedRotation = Boolean(options.preserveSelectedRotation);
    target.action = source.action ?? DEFAULT_ACTION;
    if (preserveSelectedRotation && `${target.rotationSource ?? ''}`.trim() === 'selected') {
      // Keep the player's selected rotation on the shifted first entry.
      target.rotation = target.rotation ?? '';
      target.rotationSource = 'selected';
    } else {
      target.rotation = source.rotation ?? '';
      if (source.rotationSource) {
        target.rotationSource = source.rotationSource;
      } else if ('rotationSource' in target) {
        delete target.rotationSource;
      }
    }
    target.priority = Number.isFinite(source.priority) ? source.priority : 0;
    if (source.interaction) {
      target.interaction = source.interaction;
    } else if ('interaction' in target) {
      delete target.interaction;
    }
    if (Number.isFinite(source.attackDamage)) {
      target.attackDamage = source.attackDamage;
    } else if ('attackDamage' in target) {
      delete target.attackDamage;
    }
    if (Number.isFinite(source.attackKbf)) {
      target.attackKbf = source.attackKbf;
    } else if ('attackKbf' in target) {
      delete target.attackKbf;
    }
    if (source.comboStarter) {
      target.comboStarter = true;
    } else if ('comboStarter' in target) {
      delete target.comboStarter;
    }
    if (source.cardId) {
      target.cardId = source.cardId;
    } else if ('cardId' in target) {
      delete target.cardId;
    }
    if (source.passiveCardId) {
      target.passiveCardId = source.passiveCardId;
    } else if ('passiveCardId' in target) {
      delete target.passiveCardId;
    }
    if (source.stunOnly) {
      target.stunOnly = true;
    } else if ('stunOnly' in target) {
      delete target.stunOnly;
    }
    if ('focusCardId' in target) {
      delete target.focusCardId;
    }
  };

  const shiftCharacterActionSetLeft = (character: PublicCharacter, fromBeatIndex: number) => {
    const sequence: BeatEntry[] = [];
    for (let i = fromBeatIndex; i < normalizedBeats.length; i += 1) {
      const beat = normalizedBeats[i];
      const entry = findEntryForCharacter(beat, character);
      if (!entry) break;
      sequence.push(entry);
      if (isOpenBeatAction(entry.action ?? DEFAULT_ACTION)) {
        break;
      }
    }
    if (sequence.length < 2) return;
    for (let i = 0; i < sequence.length - 1; i += 1) {
      copyActionFields(sequence[i], sequence[i + 1], { preserveSelectedRotation: i === 0 });
    }
    clearActionFields(sequence[sequence.length - 1]);
  };

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
      if ('stunOnly' in entry) {
        delete entry.stunOnly;
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

  const clearBeatConsequences = (beatIndex: number) => {
    const beat = normalizedBeats[beatIndex];
    if (!beat?.length) return;
    beat.forEach((entry) => {
      if ('consequences' in entry) {
        delete entry.consequences;
      }
    });
  };

  const applyActionListFromIndex = (
    targetId: string,
    startIndex: number,
    targetState: { position: { q: number; r: number }; damage: number; facing: number },
    actionList: ActionListItem[],
    options: { markComboStarter?: boolean; preserveEntriesAfterEnd?: boolean } = {},
  ): BeatEntry | null => {
    const character = characterById.get(targetId);
    if (!character || !Number.isFinite(startIndex) || startIndex < 0 || !Array.isArray(actionList) || !actionList.length) {
      return null;
    }
    let firstEntry: BeatEntry | null = null;
    actionList.forEach((item, offset) => {
      const beatIndex = startIndex + offset;
      ensureBeatIndex(beatIndex);
      const beat = normalizedBeats[beatIndex];
      const existing = findEntryForCharacter(beat, character);
      const entry = existing ?? buildEntryForCharacter(
        character,
        targetState,
        { action: DEFAULT_ACTION, rotation: '', priority: 0 } as BeatEntry,
        false,
        resolveTerrain(targetState.position),
      );
      entry.username = character.username ?? character.userId;
      entry.action = item.action ?? DEFAULT_ACTION;
      entry.rotation = item.rotation ?? '';
      if (item.rotationSource) {
        entry.rotationSource = item.rotationSource;
      } else if ('rotationSource' in entry) {
        delete entry.rotationSource;
      }
      entry.priority = Number.isFinite(item.priority) ? item.priority : 0;
      if (item.interaction) {
        entry.interaction = item.interaction;
      } else if ('interaction' in entry) {
        delete entry.interaction;
      }
      if (Number.isFinite(item.damage)) {
        entry.attackDamage = item.damage;
      } else if ('attackDamage' in entry) {
        delete entry.attackDamage;
      }
      if (Number.isFinite(item.kbf)) {
        entry.attackKbf = item.kbf;
      } else if ('attackKbf' in entry) {
        delete entry.attackKbf;
      }
      if (item.cardId) {
        entry.cardId = item.cardId;
      } else if ('cardId' in entry) {
        delete entry.cardId;
      }
      if (item.passiveCardId) {
        entry.passiveCardId = item.passiveCardId;
      } else if ('passiveCardId' in entry) {
        delete entry.passiveCardId;
      }
      if (options.markComboStarter && offset === 0) {
        entry.comboStarter = true;
      } else if ('comboStarter' in entry) {
        delete entry.comboStarter;
      }
      if ('comboSkipped' in entry) {
        delete entry.comboSkipped;
      }
      if ('consequences' in entry) {
        delete entry.consequences;
      }
      if ('stunOnly' in entry) {
        delete entry.stunOnly;
      }
      applyStateSnapshotToEntry(entry, targetState, false);
      if (!existing) {
        beat.push(entry);
      }
      pruneDuplicateEntries(beat, character, entry);
      if (!firstEntry) firstEntry = entry;
    });
    const lastIndex = startIndex + actionList.length - 1;
    if (!options.preserveEntriesAfterEnd) {
      for (let i = lastIndex + 1; i < normalizedBeats.length; i += 1) {
        const beat = normalizedBeats[i];
        if (!beat?.length) continue;
        const filtered = beat.filter((entry) => !matchesEntryForCharacter(entry, character));
        if (filtered.length !== beat.length) {
          normalizedBeats[i] = filtered;
        }
      }
    }
    return firstEntry;
  };

  const matchesActionListWindow = (targetId: string, startIndex: number, actionList: ActionListItem[]): boolean => {
    const character = characterById.get(targetId);
    if (!character || !Number.isFinite(startIndex) || startIndex < 0 || !Array.isArray(actionList) || !actionList.length) {
      return false;
    }
    for (let offset = 0; offset < actionList.length; offset += 1) {
      const beatIndex = startIndex + offset;
      const beat = normalizedBeats[beatIndex];
      const entry = beat ? findEntryForCharacter(beat, character) : null;
      if (!entry) return false;
      const expectedAction = `${actionList[offset]?.action ?? DEFAULT_ACTION}`;
      const actualAction = `${entry.action ?? DEFAULT_ACTION}`;
      if (actualAction !== expectedAction) return false;
      const expectedCardId = `${actionList[offset]?.cardId ?? ''}`.trim();
      if (expectedCardId && `${entry.cardId ?? ''}`.trim() !== expectedCardId) return false;
      const expectedPassiveCardId = `${actionList[offset]?.passiveCardId ?? ''}`.trim();
      if (expectedPassiveCardId && `${entry.passiveCardId ?? ''}`.trim() !== expectedPassiveCardId) return false;
    }
    return true;
  };

  const hasCommittedNonRewindActionInWindow = (
    targetId: string,
    startIndex: number,
    windowLength: number,
  ): boolean => {
    const character = characterById.get(targetId);
    if (!character || !Number.isFinite(startIndex) || startIndex < 0 || !Number.isFinite(windowLength) || windowLength <= 0) {
      return false;
    }
    for (let offset = 0; offset < windowLength; offset += 1) {
      const beatIndex = startIndex + offset;
      const beat = normalizedBeats[beatIndex];
      const entry = beat ? findEntryForCharacter(beat, character) : null;
      if (!entry) continue;
      const action = `${entry.action ?? DEFAULT_ACTION}`;
      if (isOpenBeatAction(action)) continue;
      const cardId = `${entry.cardId ?? ''}`.trim();
      if (cardId && cardId !== REWIND_CARD_ID) {
        return true;
      }
    }
    return false;
  };

  const findActionSetRotationForCharacter = (
    character: PublicCharacter,
    beatIndex: number,
  ): string => {
    if (!character || !Number.isFinite(beatIndex)) return '';
    const findAt = (index: number) => {
      const beat = normalizedBeats[index];
      return beat ? findEntryForCharacter(beat, character) : null;
    };
    let start = Math.max(0, Math.round(beatIndex));
    for (let i = start; i >= 0; i -= 1) {
      const entry = findAt(i);
      if (!entry || isOpenBeatAction(entry.action)) {
        start = i + 1;
        break;
      }
      if (i === 0) start = 0;
    }
    let end = normalizedBeats.length - 1;
    for (let i = Math.max(start, Math.round(beatIndex)); i < normalizedBeats.length; i += 1) {
      const entry = findAt(i);
      if (!entry || isOpenBeatAction(entry.action)) {
        end = i;
        break;
      }
    }
    let fallback = '';
    for (let i = start; i <= end; i += 1) {
      const entry = findAt(i);
      if (!entry) continue;
      const rotation = `${entry.rotation ?? ''}`.trim();
      if (!rotation) continue;
      if (`${entry.rotationSource ?? ''}`.trim() === 'selected') {
        return rotation;
      }
      if (!fallback) fallback = rotation;
    }
    return fallback;
  };

  const swapActiveWithPassiveAtBeat = (
    targetId: string,
    beatIndex: number,
    targetState: { position: { q: number; r: number }; damage: number; facing: number },
  ): BeatEntry | null => {
    const character = characterById.get(targetId);
    if (!character) return null;
    const sourceBeat = normalizedBeats[beatIndex];
    const sourceEntry = sourceBeat ? findEntryForCharacter(sourceBeat, character) : null;
    if (!sourceEntry?.cardId || !sourceEntry?.passiveCardId) return null;
    const sourceRotation = `${sourceEntry.rotation ?? ''}`.trim();
    const sourceRotationSource = `${sourceEntry.rotationSource ?? ''}`.trim();
    const swappedActionList = buildSwappedActionList(sourceEntry.cardId, sourceEntry.passiveCardId, sourceRotation);
    if (!swappedActionList.length) return null;
    const firstEntry = swappedActionList[0];
    if (firstEntry) {
      firstEntry.rotation = sourceRotation;
      if (sourceRotationSource === 'forced') {
        firstEntry.rotationSource = 'forced';
      } else if (sourceRotationSource === 'selected') {
        firstEntry.rotationSource = 'selected';
      } else if (!sourceRotation) {
        delete firstEntry.rotationSource;
      }
    }
    return applyActionListFromIndex(targetId, beatIndex, targetState, swappedActionList, { markComboStarter: true });
  };

  const applyHitTimeline = (
    targetId: string,
    beatIndex: number,
    targetState: { position: { q: number; r: number }; damage: number; facing: number },
    knockbackOverride?: number,
    preserveAction = false,
    options: { damageIconCount?: number; stunOnly?: boolean; preserveEntriesAfterEnd?: boolean } = {},
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
    const damageIcons = Number.isFinite(options.damageIconCount)
      ? Math.max(0, Math.round(options.damageIconCount as number))
      : knockbackDistance + 1;
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
        stunOnly: Boolean(options.stunOnly),
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
        if (options.stunOnly) {
          entry.stunOnly = true;
        } else if ('stunOnly' in entry) {
          delete entry.stunOnly;
        }
        pruneDuplicateEntries(beat, character, entry);
        continue;
      }
      const entry = findEntryForCharacter(beat, character);
      if (!knockbackApplied || extendedWindow || !entry || isOpenBeatAction(entry.action) || entry.action === DAMAGE_ICON_ACTION) {
        const next = upsertBeatEntry(beat, character, DEFAULT_ACTION, targetState);
        if ('stunOnly' in next) {
          delete next.stunOnly;
        }
        pruneDuplicateEntries(beat, character, next);
      } else {
        if ('stunOnly' in entry) {
          delete entry.stunOnly;
        }
        applyStateSnapshotToEntry(entry, targetState, false);
        pruneDuplicateEntries(beat, character, entry);
      }
    }
    const shouldPruneAfterEnd = (!knockbackApplied || extendedWindow) && !options.preserveEntriesAfterEnd;
    if (shouldPruneAfterEnd) {
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

  const isCommittedRewindReturnStart = (actorId: string, beatIndex: number): boolean => {
    if (!actorId || !Number.isFinite(beatIndex)) return false;
    const safeBeatIndex = Math.max(0, Math.round(beatIndex));
    for (const interaction of updatedInteractions) {
      if (interaction.type !== REWIND_RETURN_INTERACTION_TYPE) continue;
      if (interaction.status !== 'resolved') continue;
      if (!interaction.resolution?.returnToAnchor) continue;
      if (interaction.actorUserId !== actorId) continue;
      if (!Number.isFinite(interaction.beatIndex)) continue;
      if (Math.max(0, Math.round(interaction.beatIndex)) !== safeBeatIndex) continue;
      return true;
    }
    return false;
  };

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
        if (isActionSetStart(nextEntry) || isCommittedRewindReturnStart(character.userId, i)) {
          break;
        }
      }
      const filtered = beat.filter((entry) => !matchesEntryForCharacter(entry, character));
      if (filtered.length !== beat.length) {
        normalizedBeats[i] = filtered;
      }
    }
  };

  const findCharacterFirstEIndexAfter = (character: PublicCharacter, startIndex: number): number => {
    for (let i = startIndex + 1; i < normalizedBeats.length; i += 1) {
      const beat = normalizedBeats[i];
      const entry = beat ? findEntryForCharacter(beat, character) : null;
      if (!entry || isOpenBeatAction(entry.action)) {
        return i;
      }
    }
    // Missing beats beyond the current array are implicit E.
    return normalizedBeats.length;
  };

  const ensureRewindFocusAtBeat = (actorId: string, beatIndex: number, entry: BeatEntry | null | undefined): boolean => {
    if (!actorId || !Number.isFinite(beatIndex)) return false;
    const cardId = `${entry?.cardId ?? ''}`.trim();
    if (cardId !== REWIND_CARD_ID) return false;
    const existingActive = activeRewindFocusByUser.get(actorId);
    if (existingActive) return true;
    const interactionId = buildInteractionId(REWIND_FOCUS_INTERACTION_TYPE, Math.max(0, Math.round(beatIndex)), actorId, actorId);
    const existing = interactionById.get(interactionId);
    if (existing && existing.type === REWIND_FOCUS_INTERACTION_TYPE && existing.status === 'resolved') {
      const active = existing.resolution?.active;
      if (active !== false) {
        activeRewindFocusByUser.set(actorId, existing);
        const anchor = normalizeInteractionHex(existing.resolution?.anchorHex);
        if (anchor) {
          addFocusAnchorToken(anchor, actorId, getRewindFocusCardId(existing));
        }
        return true;
      }
      return false;
    }
    if (isHistoryIndex(beatIndex)) return false;
    const actorState = state.get(actorId);
    const anchorHex = actorState?.position
      ? { q: actorState.position.q, r: actorState.position.r }
      : entry?.location
        ? { q: entry.location.q, r: entry.location.r }
        : null;
    if (!anchorHex) return false;
    const returnActions = getRewindReturnActionList().map((item) => ({
      action: item.action,
      rotation: item.rotation,
      priority: item.priority,
      damage: item.damage,
      kbf: item.kbf,
      cardId: item.cardId,
    }));
    const created: CustomInteraction = {
      id: interactionId,
      type: REWIND_FOCUS_INTERACTION_TYPE,
      beatIndex: Math.max(0, Math.round(beatIndex)),
      actorUserId: actorId,
      targetUserId: actorId,
      cardId: REWIND_CARD_ID,
      status: 'resolved',
      resolution: {
        active: true,
        cardId: REWIND_CARD_ID,
        anchorHex,
        focusStartBeatIndex: Math.max(0, Math.round(beatIndex)),
        returnActions,
      },
    };
    updatedInteractions.push(created);
    interactionById.set(interactionId, created);
    activeRewindFocusByUser.set(actorId, created);
    addFocusAnchorToken(anchorHex, actorId, REWIND_CARD_ID);
    return true;
  };

  const forcedGuardDiscardByBeat = new Map<number, Set<string>>();

  const scheduleForcedGuardDiscard = (actorId: string, beatIndex: number) => {
    if (!actorId || !Number.isFinite(beatIndex)) return;
    const safeBeatIndex = Math.max(0, Math.round(beatIndex));
    const existing = forcedGuardDiscardByBeat.get(safeBeatIndex) ?? new Set<string>();
    existing.add(actorId);
    forcedGuardDiscardByBeat.set(safeBeatIndex, existing);
  };

  const ensurePendingRewindReturn = (actorId: string, beatIndex: number): boolean => {
    const focus = activeRewindFocusByUser.get(actorId);
    if (!focus) return false;
    const safeBeatIndex = Math.max(0, Math.round(beatIndex));
    const interactionId = buildInteractionId(REWIND_RETURN_INTERACTION_TYPE, safeBeatIndex, actorId, actorId);
    const existing = interactionById.get(interactionId);
    if (existing) {
      if (existing.status === 'pending' && (haltIndex == null || safeBeatIndex < haltIndex)) {
        haltIndex = safeBeatIndex;
      }
      return existing.status === 'pending';
    }
    if (isHistoryIndex(safeBeatIndex)) return false;
    const created: CustomInteraction = {
      id: interactionId,
      type: REWIND_RETURN_INTERACTION_TYPE,
      beatIndex: safeBeatIndex,
      actorUserId: actorId,
      targetUserId: actorId,
      cardId: getRewindFocusCardId(focus),
      status: 'pending',
      resolution: {
        focusInteractionId: focus.id,
        anchorHex: focus.resolution?.anchorHex,
      },
    };
    updatedInteractions.push(created);
    interactionById.set(interactionId, created);
    if (haltIndex == null || safeBeatIndex < haltIndex) {
      haltIndex = safeBeatIndex;
    }
    return true;
  };

  const applyGuardContinueLoop = (
    actorId: string,
    character: PublicCharacter,
    continueBeatIndex: number,
    eBeatIndex: number,
  ): boolean => {
    const actorState = state.get(actorId);
    if (!actorState) return false;
    if (eBeatIndex < continueBeatIndex) return false;

    const buildImplicitEEntry = (seed: BeatEntry | null): BeatEntry => {
      const next: BeatEntry = {
        ...(seed ? { ...seed } : {}),
        action: DEFAULT_ACTION,
        rotation: '',
        priority: 0,
      } as BeatEntry;
      if ('rotationSource' in next) delete next.rotationSource;
      if ('interaction' in next) delete next.interaction;
      if ('attackDamage' in next) delete next.attackDamage;
      if ('attackKbf' in next) delete next.attackKbf;
      if ('comboStarter' in next) delete next.comboStarter;
      return next;
    };

    const pattern: BeatEntry[] = [];
    let lastSource: BeatEntry | null = null;
    for (let i = continueBeatIndex; i <= eBeatIndex; i += 1) {
      const beat = normalizedBeats[i];
      const entry = beat ? findEntryForCharacter(beat, character) : null;
      if (entry) {
        const source = { ...entry };
        pattern.push(source);
        lastSource = source;
        continue;
      }
      if (i !== eBeatIndex) return false;
      pattern.push(buildImplicitEEntry(lastSource));
    }
    if (!pattern.length) return false;
    pattern.forEach((source, offset) => {
      const targetBeatIndex = eBeatIndex + offset;
      const target = getOrCreateEntryForCharacter(targetBeatIndex, character, actorState);
      copyActionFields(target, source);
      if ('consequences' in target) {
        delete target.consequences;
      }
    });
    return true;
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

  updatedInteractions.forEach((interaction) => {
    if (interaction.type !== GUARD_CONTINUE_INTERACTION_TYPE || interaction.status !== 'resolved') return;
    if (!interaction.resolution?.continue) return;
    const actorId = interaction.actorUserId;
    const character = actorId ? characterById.get(actorId) : undefined;
    if (!character) return;
    if (!Number.isFinite(interaction.beatIndex)) return;
    const beatIndex = Math.max(0, Math.round(interaction.beatIndex));
    const storedRepeatBeat = Number(interaction.resolution?.guardRepeatBeatIndex);
    const repeatBeatIndex = Number.isFinite(storedRepeatBeat) ? Math.max(0, Math.round(storedRepeatBeat)) : null;
    const repeatApplied = Boolean(interaction.resolution?.guardRepeatApplied);
    let nextRepeatBeat = repeatBeatIndex;
    if (!repeatApplied) {
      const eBeatIndex = findCharacterFirstEIndexAfter(character, beatIndex);
      const applied = applyGuardContinueLoop(actorId, character, beatIndex, eBeatIndex);
      if (!applied) return;
      nextRepeatBeat = eBeatIndex;
      interaction.resolution = {
        ...(interaction.resolution ?? {}),
        continue: true,
        guardRepeatApplied: true,
        guardRepeatBeatIndex: eBeatIndex,
      };
      interactionById.set(interaction.id, interaction);
    }
    if (nextRepeatBeat == null) return;
    const discardInteractionId = buildInteractionId('discard', nextRepeatBeat, actorId, actorId);
    if (!interactionById.has(discardInteractionId)) {
      scheduleForcedGuardDiscard(actorId, nextRepeatBeat);
    }
  });

  const comboStates = new Map<string, { coIndex: number; hit: boolean; cardId: string; throwInteraction: boolean }>();
  const lastActionByUser = new Map<string, string>();
  const cardStartTerrainByUser = new Map<string, 'land' | 'abyss'>();
  const havenPassiveSkipByUser = new Map<string, boolean>();
  const actionSetFacingByUser = new Map<string, number>();
  const actionSetRotationByUser = new Map<string, string>();
  const reflexDodgeAvoidedByUser = new Set<string>();

  const findNextComboIndex = (character: PublicCharacter, startIndex: number) => {
    for (let i = startIndex; i < normalizedBeats.length; i += 1) {
      const beat = normalizedBeats[i];
      const entry = beat ? findEntryForCharacter(beat, character) : null;
      if (!entry || isOpenBeatAction(entry.action)) return null;
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
    const rotatedActors = new Set<string>();
    entries.forEach((entry, actorId) => {
      const rotationDelta = parseRotationDegrees(entry.rotation ?? '');
      if (!rotationDelta) return;
      const actorState = state.get(actorId);
      if (!actorState) return;
      actorState.facing = normalizeDegrees(actorState.facing + rotationDelta);
      rotatedActors.add(actorId);
    });
    return rotatedActors;
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
    applyDelayedPassiveFireHexes(index);
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
      if (isOpenBeatAction(existingAction) && !isOpenBeatAction(nextAction)) {
        entriesByUser.set(resolved, entry);
        return;
      }
      if (!isOpenBeatAction(existingAction) && isOpenBeatAction(nextAction)) {
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
    updatedInteractions.forEach((interaction) => {
      if (interaction.type !== REWIND_RETURN_INTERACTION_TYPE) return;
      if (interaction.status !== 'resolved') return;
      if (!interaction.resolution?.returnToAnchor) return;
      if (interaction.id && appliedRewindReturnsById.has(interaction.id)) return;
      if (!Number.isFinite(interaction.beatIndex) || Math.max(0, Math.round(interaction.beatIndex)) !== index) return;
      const actorId = interaction.actorUserId;
      if (!actorId) return;
      const actorState = state.get(actorId);
      if (!actorState) return;
      const focus = activeRewindFocusByUser.get(actorId);
      const anchor =
        normalizeInteractionHex(interaction.resolution?.anchorHex) ??
        normalizeInteractionHex(focus?.resolution?.anchorHex) ??
        { q: actorState.position.q, r: actorState.position.r };
      const occupiedByUser = new Map<string, string>();
      state.forEach((value, userId) => {
        occupiedByUser.set(coordKey(value.position), userId);
      });
      const anchorKey = coordKey(anchor);
      const anchorOccupant = occupiedByUser.get(anchorKey);
      const blockedByOccupant = anchorOccupant && anchorOccupant !== actorId ? anchorOccupant : null;
      const alreadyApplied = Boolean(interaction.resolution?.applied);
      const rawReturnActions = (() => {
        if (Array.isArray(interaction.resolution?.returnActions)) {
          return interaction.resolution.returnActions;
        }
        if (Array.isArray(focus?.resolution?.returnActions)) {
          return focus.resolution.returnActions;
        }
        return [];
      })();
      const normalizedReturnActions = rawReturnActions
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const action = `${(item as { action?: unknown }).action ?? ''}`.trim();
          if (!action) return null;
          const rotation = `${(item as { rotation?: unknown }).rotation ?? ''}`;
          const priority = Number.isFinite((item as { priority?: unknown }).priority)
            ? Number((item as { priority?: number }).priority)
            : 0;
          const damage = Number.isFinite((item as { damage?: unknown }).damage)
            ? Number((item as { damage?: number }).damage)
            : 0;
          const kbf = Number.isFinite((item as { kbf?: unknown }).kbf)
            ? Number((item as { kbf?: number }).kbf)
            : 0;
          const cardId = `${(item as { cardId?: unknown }).cardId ?? REWIND_CARD_ID}`.trim() || REWIND_CARD_ID;
          const passiveCardId = `${(item as { passiveCardId?: unknown }).passiveCardId ?? ''}`.trim();
          return {
            action,
            rotation,
            priority,
            damage,
            kbf,
            cardId,
            ...(passiveCardId ? { passiveCardId } : {}),
          } as ActionListItem;
        })
        .filter((item): item is ActionListItem => Boolean(item));
      const returnActions = normalizedReturnActions.length ? normalizedReturnActions : getRewindReturnActionList();
      let firstEntry: BeatEntry | null = null;
      if (blockedByOccupant) {
        const configuredStunDuration = Number(interaction.resolution?.stunDuration);
        const stunDuration = Number.isFinite(configuredStunDuration)
          ? Math.max(0, Math.round(configuredStunDuration))
          : 3;
        applyHitTimeline(actorId, index, actorState, 0, false, {
          damageIconCount: stunDuration,
          stunOnly: true,
          preserveEntriesAfterEnd: alreadyApplied,
        });
        const actorCharacter = characterById.get(actorId);
        firstEntry = actorCharacter ? findEntryForCharacter(beat, actorCharacter) : null;
      } else {
        actorState.position = { q: anchor.q, r: anchor.r };
        const hasExpectedReturnWindow = matchesActionListWindow(actorId, index, returnActions);
        const hasCommittedNonRewindWindow = hasCommittedNonRewindActionInWindow(actorId, index, returnActions.length);
        if (!alreadyApplied || (!hasExpectedReturnWindow && !hasCommittedNonRewindWindow)) {
          firstEntry = applyActionListFromIndex(actorId, index, actorState, returnActions, {
            preserveEntriesAfterEnd: alreadyApplied,
          });
        } else {
          const actorCharacter = characterById.get(actorId);
          firstEntry = actorCharacter ? findEntryForCharacter(beat, actorCharacter) : null;
        }
      }
      if (firstEntry) {
        entriesByUser.set(actorId, firstEntry);
      }
      markRewindFocusInactive(actorId, index, 'returned');
      removeFocusAnchorToken(actorId);
      if (interaction.id) {
        appliedRewindReturnsById.add(interaction.id);
      }
      const nextResolution: { [key: string]: unknown } = {
        ...(interaction.resolution ?? {}),
        returnToAnchor: true,
        applied: true,
        anchorHex: { q: anchor.q, r: anchor.r },
        focusInteractionId: focus?.id ?? interaction.resolution?.focusInteractionId,
      };
      if (blockedByOccupant) {
        nextResolution.blockedByOccupant = true;
        nextResolution.blockedOccupantUserId = blockedByOccupant;
        const configuredStunDuration = Number(interaction.resolution?.stunDuration);
        nextResolution.stunDuration = Number.isFinite(configuredStunDuration)
          ? Math.max(0, Math.round(configuredStunDuration))
          : 3;
      } else {
        nextResolution.returnActions = returnActions.map((item) => ({
          action: item.action,
          rotation: item.rotation ?? '',
          priority: Number.isFinite(item.priority) ? Number(item.priority) : 0,
          damage: Number.isFinite(item.damage) ? Number(item.damage) : 0,
          kbf: Number.isFinite(item.kbf) ? Number(item.kbf) : 0,
          cardId: `${item.cardId ?? REWIND_CARD_ID}` || REWIND_CARD_ID,
          ...(item.passiveCardId ? { passiveCardId: `${item.passiveCardId}` } : {}),
        }));
        if ('blockedByOccupant' in nextResolution) delete nextResolution.blockedByOccupant;
        if ('blockedOccupantUserId' in nextResolution) delete nextResolution.blockedOccupantUserId;
        if ('stunDuration' in nextResolution) delete nextResolution.stunDuration;
      }
      interaction.resolution = nextResolution;
    });
    const actionSetEnders = new Map<string, BeatEntry>();

    characters.forEach((character) => {
      const actorId = character.userId;
      const entry = entriesByUser.get(actorId);
      const action = entry?.action ?? DEFAULT_ACTION;
      const previous = lastActionByUser.get(actorId) ?? DEFAULT_ACTION;
      const comboStart = isOpenBeatAction(previous) || Boolean(entry?.comboStarter);
      if (isOpenBeatAction(action)) {
        if (!isOpenBeatAction(previous) && entry) {
          actionSetEnders.set(actorId, entry);
        }
        comboStates.delete(actorId);
        reflexDodgeAvoidedByUser.delete(actorId);
        cardStartTerrainByUser.delete(actorId);
        havenPassiveSkipByUser.delete(actorId);
        actionSetFacingByUser.delete(actorId);
        actionSetRotationByUser.delete(actorId);
        if (entry && 'cardStartTerrain' in entry) {
          delete entry.cardStartTerrain;
        }
      } else {
        if (comboStart) {
          reflexDodgeAvoidedByUser.delete(actorId);
        }
        if (comboStart || !cardStartTerrainByUser.has(actorId)) {
          const actorState = state.get(actorId);
          if (actorState) {
            cardStartTerrainByUser.set(actorId, resolveTerrain(actorState.position));
          }
        }
        if (comboStart) {
          const startTerrain = cardStartTerrainByUser.get(actorId);
          const shouldSkipFirstWait = entry?.passiveCardId === HAVEN_CARD_ID && startTerrain === 'abyss';
          havenPassiveSkipByUser.set(actorId, shouldSkipFirstWait);
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
    const scheduledForcedGuardDiscard = forcedGuardDiscardByBeat.get(index);
    const hasForcedResolution = Boolean(parryCounters?.length || scheduledForcedGuardDiscard?.size);
    type BeatReadiness = { userId: string; username: string; action: string };
    const getBeatReadiness = (options: { useCurrentBeatEntries?: boolean } = {}): BeatReadiness[] =>
      characters.map((character) => {
        const mappedEntry = entriesByUser.get(character.userId);
        const beatEntry = findEntryForCharacter(beat, character);
        const entry = options.useCurrentBeatEntries ? beatEntry : mappedEntry ?? beatEntry;
        return {
          userId: character.userId,
          username: character.username,
          action: entry?.action ?? 'missing',
        };
      });
    const isBeatReady = (readiness: BeatReadiness[]) =>
      readiness.every((item) => item.action !== 'missing' && !isOpenBeatAction(item.action));
    const haltAtCurrentBeat = (readiness: BeatReadiness[]) => {
      console.log(LOG_PREFIX, 'halt', {
        index,
        haltIndex,
        readiness,
        pendingInteractions: pendingIndices,
      });
      for (let j = index; j < normalizedBeats.length; j += 1) {
        applyStateToBeat(normalizedBeats[j], false);
      }
    };
    const initialReadiness = getBeatReadiness();
    if (!isBeatReady(initialReadiness) && !hasForcedResolution) {
      initialReadiness.forEach((item) => {
        const actionLabel = normalizeActionLabel(item.action).toUpperCase();
        const character = characterById.get(item.userId);
        const entry = character ? findEntryForCharacter(beat, character) : null;
        if (actionLabel === FOCUS_ACTION) {
          ensureRewindFocusAtBeat(item.userId, index, entry);
        }
        if ((item.action === 'missing' || actionLabel === DEFAULT_ACTION) && activeRewindFocusByUser.has(item.userId)) {
          ensurePendingRewindReturn(item.userId, index);
        }
      });
      haltAtCurrentBeat(getBeatReadiness({ useCurrentBeatEntries: true }));
      break;
    }
    type ActionPhaseActorState = { position: { q: number; r: number }; damage: number; facing: number };
    type ComboState = { coIndex: number; hit: boolean; cardId: string; throwInteraction: boolean };
    type ActionPhaseSnapshot = {
      state: Map<string, ActionPhaseActorState>;
      boardTokens: BoardToken[];
      tokenCounter: number;
      fireTokenKeys: Set<string>;
      platformTokenKeys: Set<string>;
      ephemeralFireKeys: Set<string>;
      delayedPassiveFireSpawnsByBeat: Map<number, DelayedPassiveFireSpawn[]>;
      appliedRewindReturnsById: Set<string>;
      interactions: CustomInteraction[];
      handTriggerKeys: Set<string>;
      haltIndex: number | null;
      parryCountersByBeat: Map<number, ParryCounter[]>;
      parryEndersByBeat: Map<number, Set<string>>;
      parryCounterKeys: Set<string>;
      comboStates: Map<string, ComboState>;
      reflexDodgeAvoidedByUser: Set<string>;
    };
    const cloneInteraction = (interaction: CustomInteraction): CustomInteraction => ({
      ...interaction,
      resolution: interaction.resolution ? { ...interaction.resolution } : undefined,
      touchingHexes: Array.isArray(interaction.touchingHexes)
        ? interaction.touchingHexes.map((coord) => ({ q: coord.q, r: coord.r }))
        : undefined,
      attackHexes: Array.isArray(interaction.attackHexes)
        ? interaction.attackHexes.map((coord) => ({ q: coord.q, r: coord.r }))
        : undefined,
      targetHex: interaction.targetHex
        ? { q: interaction.targetHex.q, r: interaction.targetHex.r }
        : undefined,
    });
    const cloneParryCountersByBeat = () => {
      const snapshot = new Map<number, ParryCounter[]>();
      parryCountersByBeat.forEach((list, beatIndex) => {
        snapshot.set(
          beatIndex,
          list.map((counter) => ({
            beatIndex: counter.beatIndex,
            defenderId: counter.defenderId,
            attackerId: counter.attackerId,
            damage: counter.damage,
            kbf: counter.kbf,
            directionIndex: counter.directionIndex,
          })),
        );
      });
      return snapshot;
    };
    const cloneParryEndersByBeat = () => {
      const snapshot = new Map<number, Set<string>>();
      parryEndersByBeat.forEach((list, beatIndex) => {
        snapshot.set(beatIndex, new Set(list));
      });
      return snapshot;
    };
    const captureActionPhaseSnapshot = (): ActionPhaseSnapshot => ({
      state: new Map(
        Array.from(state.entries()).map(([userId, value]) => [
          userId,
          {
            position: { q: value.position.q, r: value.position.r },
            damage: value.damage,
            facing: value.facing,
          },
        ]),
      ),
      boardTokens: boardTokens.map((token) => ({
        ...token,
        position: { q: token.position.q, r: token.position.r },
      })),
      tokenCounter,
      fireTokenKeys: new Set(fireTokenKeys),
      platformTokenKeys: new Set(platformTokenKeys),
      ephemeralFireKeys: new Set(ephemeralFireKeys),
      delayedPassiveFireSpawnsByBeat: new Map(
        Array.from(delayedPassiveFireSpawnsByBeat.entries()).map(([beatIndex, list]) => [
          beatIndex,
          list.map((item) => ({
            coord: { q: item.coord.q, r: item.coord.r },
            ownerId: item.ownerId,
          })),
        ]),
      ),
      appliedRewindReturnsById: new Set(appliedRewindReturnsById),
      interactions: updatedInteractions.map((interaction) => cloneInteraction(interaction)),
      handTriggerKeys: new Set(handTriggerKeys),
      haltIndex,
      parryCountersByBeat: cloneParryCountersByBeat(),
      parryEndersByBeat: cloneParryEndersByBeat(),
      parryCounterKeys: new Set(parryCounterKeys),
      comboStates: new Map(
        Array.from(comboStates.entries()).map(([actorId, comboState]) => [
          actorId,
          {
            coIndex: comboState.coIndex,
            hit: comboState.hit,
            cardId: comboState.cardId,
            throwInteraction: comboState.throwInteraction,
          },
        ]),
      ),
      reflexDodgeAvoidedByUser: new Set(reflexDodgeAvoidedByUser),
    });
    const restoreActionPhaseSnapshot = (snapshot: ActionPhaseSnapshot) => {
      state.clear();
      snapshot.state.forEach((value, userId) => {
        state.set(userId, {
          position: { q: value.position.q, r: value.position.r },
          damage: value.damage,
          facing: value.facing,
        });
      });
      boardTokens.splice(
        0,
        boardTokens.length,
        ...snapshot.boardTokens.map((token) => ({
          ...token,
          position: { q: token.position.q, r: token.position.r },
        })),
      );
      tokenCounter = snapshot.tokenCounter;
      fireTokenKeys.clear();
      snapshot.fireTokenKeys.forEach((key) => fireTokenKeys.add(key));
      platformTokenKeys.clear();
      snapshot.platformTokenKeys.forEach((key) => platformTokenKeys.add(key));
      ephemeralFireKeys = new Set(snapshot.ephemeralFireKeys);
      delayedPassiveFireSpawnsByBeat.clear();
      snapshot.delayedPassiveFireSpawnsByBeat.forEach((list, beatIndex) => {
        delayedPassiveFireSpawnsByBeat.set(
          beatIndex,
          list.map((item) => ({
            coord: { q: item.coord.q, r: item.coord.r },
            ownerId: item.ownerId,
          })),
        );
      });
      appliedRewindReturnsById.clear();
      snapshot.appliedRewindReturnsById.forEach((id) => appliedRewindReturnsById.add(id));
      updatedInteractions.splice(
        0,
        updatedInteractions.length,
        ...snapshot.interactions.map((interaction) => cloneInteraction(interaction)),
      );
      interactionById.clear();
      updatedInteractions.forEach((interaction) => {
        interactionById.set(interaction.id, interaction);
      });
      handTriggerKeys.clear();
      snapshot.handTriggerKeys.forEach((key) => handTriggerKeys.add(key));
      haltIndex = snapshot.haltIndex;
      parryCountersByBeat.clear();
      snapshot.parryCountersByBeat.forEach((list, beatIndex) => {
        parryCountersByBeat.set(
          beatIndex,
          list.map((counter) => ({
            beatIndex: counter.beatIndex,
            defenderId: counter.defenderId,
            attackerId: counter.attackerId,
            damage: counter.damage,
            kbf: counter.kbf,
            directionIndex: counter.directionIndex,
          })),
        );
      });
      parryEndersByBeat.clear();
      snapshot.parryEndersByBeat.forEach((list, beatIndex) => {
        parryEndersByBeat.set(beatIndex, new Set(list));
      });
      parryCounterKeys.clear();
      snapshot.parryCounterKeys.forEach((key) => parryCounterKeys.add(key));
      comboStates.clear();
      snapshot.comboStates.forEach((comboState, actorId) => {
        comboStates.set(actorId, {
          coIndex: comboState.coIndex,
          hit: comboState.hit,
          cardId: comboState.cardId,
          throwInteraction: comboState.throwInteraction,
        });
      });
      reflexDodgeAvoidedByUser.clear();
      snapshot.reflexDodgeAvoidedByUser.forEach((actorId) => reflexDodgeAvoidedByUser.add(actorId));
    };

    const actionPhaseSnapshot = captureActionPhaseSnapshot();
    const resolvedRerunCauseKeys = new Set<string>();
    let hasRestoredActionPhaseSnapshot = false;
    let haltForRerunReadiness = false;
    let rerunHaltReadiness: BeatReadiness[] | null = null;
    do {
      if (hasRestoredActionPhaseSnapshot) {
        restoreActionPhaseSnapshot(actionPhaseSnapshot);
      }
      // Reruns replay the same beat and must replace, not append, hit summaries.
      clearBeatConsequences(index);
      type BeatRerunRequest = {
        changedActorId: string;
        causeActorId: string;
        causePriority: number;
        causeOrder: number;
        causeKey: string;
      };
      let rerunRequest: BeatRerunRequest | null = null;
      const isBetterRerunRequest = (next: BeatRerunRequest, current: BeatRerunRequest | null) => {
        if (!current) return true;
        if (next.causePriority !== current.causePriority) {
          return next.causePriority > current.causePriority;
        }
        if (next.causeOrder !== current.causeOrder) {
          return next.causeOrder < current.causeOrder;
        }
        return false;
      };
      const currentBeatActionSignature = (actorId: string) => {
        const actorCharacter = characterById.get(actorId);
        if (!actorCharacter) return '__missing__';
        const actorEntry = findEntryForCharacter(beat, actorCharacter);
        if (!actorEntry) return '__missing__';
        const interactionType = `${actorEntry.interaction?.type ?? ''}`.trim();
        const rotationSource = `${actorEntry.rotationSource ?? ''}`.trim();
        return [
          actorEntry.action ?? DEFAULT_ACTION,
          actorEntry.rotation ?? '',
          Number.isFinite(actorEntry.priority) ? actorEntry.priority : 0,
          actorEntry.cardId ?? '',
          actorEntry.passiveCardId ?? '',
          rotationSource,
          actorEntry.comboStarter ? 'combo' : '',
          interactionType,
        ].join('|');
      };
      const getCausePriority = (
        causeActorId: string,
        fallbackPriority: number,
        explicitPriority?: number,
      ) => {
        if (Number.isFinite(explicitPriority)) {
          return Math.round(explicitPriority as number);
        }
        const causePriority = entriesByUser.get(causeActorId)?.priority;
        if (Number.isFinite(causePriority)) {
          return Math.round(causePriority as number);
        }
        return Math.round(fallbackPriority);
      };
      const buildRerunCauseKey = (causeActorId: string, causePriority: number) => {
        const causeCharacter = characterById.get(causeActorId);
        const causeEntry = causeCharacter ? findEntryForCharacter(beat, causeCharacter) : null;
        return [
          causeActorId,
          causeEntry?.cardId ?? '',
          causeEntry?.passiveCardId ?? '',
          causeEntry?.action ?? DEFAULT_ACTION,
          causePriority,
        ].join('|');
      };
      const requestCurrentBeatRerun = (
        changedActorId: string,
        options: { causeActorId?: string; causePriority?: number } = {},
      ) => {
        if (!changedActorId) return;
        const changedPriority = entriesByUser.get(changedActorId)?.priority;
        const fallbackPriority = Number.isFinite(changedPriority) ? (changedPriority as number) : 0;
        const causeActorId = options.causeActorId ?? changedActorId;
        const causePriority = getCausePriority(causeActorId, fallbackPriority, options.causePriority);
        const causeOrder =
          rosterOrder.get(causeActorId) ??
          rosterOrder.get(changedActorId) ??
          Number.MAX_SAFE_INTEGER;
        const causeKey = buildRerunCauseKey(causeActorId, causePriority);
        if (resolvedRerunCauseKeys.has(causeKey)) return;
        const candidate: BeatRerunRequest = {
          changedActorId,
          causeActorId,
          causePriority,
          causeOrder,
          causeKey,
        };
        if (isBetterRerunRequest(candidate, rerunRequest)) {
          rerunRequest = candidate;
        }
      };
      const rerunIfCurrentFrameChanged = (
        actorId: string,
        beforeSignature: string,
        options: { causeActorId?: string; causePriority?: number } = {},
      ) => {
        if (!actorId) return;
        const afterSignature = currentBeatActionSignature(actorId);
        if (afterSignature !== beforeSignature) {
          requestCurrentBeatRerun(actorId, options);
        }
      };
      const passReadiness = getBeatReadiness({ useCurrentBeatEntries: true });
      if (!isBeatReady(passReadiness) && !hasForcedResolution) {
        passReadiness.forEach((item) => {
          const actionLabel = normalizeActionLabel(item.action).toUpperCase();
          const character = characterById.get(item.userId);
          const entry = character ? findEntryForCharacter(beat, character) : null;
          if (actionLabel === FOCUS_ACTION) {
            ensureRewindFocusAtBeat(item.userId, index, entry);
          }
          if ((item.action === 'missing' || actionLabel === DEFAULT_ACTION) && activeRewindFocusByUser.has(item.userId)) {
            ensurePendingRewindReturn(item.userId, index);
          }
        });
        rerunHaltReadiness = getBeatReadiness({ useCurrentBeatEntries: true });
        haltForRerunReadiness = true;
        break;
      }

      const rotatedActorsThisBeat = applyRotationPhase(entriesByUser);
      const occupancy = new Map<string, string>();
      state.forEach((value, userId) => {
        occupancy.set(coordKey(value.position), userId);
      });
      const blockMap = new Map<string, Map<number, BlockSource>>();
      const discardQueue = new Map<string, number>();
      const forcedDiscardQueue = new Map<string, number>();
      const disabledActors = new Set<string>();
      const executedActors = new Set<string>();
    const registerBlockActions = (
      actorId: string,
      entry: BeatEntry | null | undefined,
      actorState: { position: { q: number; r: number }; facing: number } | undefined,
    ): Set<number> => {
      const directions = new Set<number>();
      if (!entry || !actorState) return directions;
      const tokens = parseActionTokens(entry.action ?? '');
      tokens.forEach((token) => {
        if (token.type !== 'b') return;
        const { lastStep } = buildPath(actorState.position, token.steps, actorState.facing);
        const blockVector = lastStep ?? applyFacingToVector(LOCAL_DIRECTIONS.F, actorState.facing);
        const blockDirectionIndex = getDirectionIndex(blockVector);
        if (blockDirectionIndex == null) return;
        const blockKey = coordKey(actorState.position);
        const existing = blockMap.get(blockKey) ?? new Map<number, BlockSource>();
        existing.set(blockDirectionIndex, {
          actorId,
          cardId: entry.cardId ?? undefined,
          passiveCardId: entry.passiveCardId ?? undefined,
          action: entry.action ?? undefined,
        });
        blockMap.set(blockKey, existing);
        directions.add(blockDirectionIndex);
      });
      return directions;
    };
    const forceActionSetEndAtBeat = (
      targetId: string,
      beatIndex: number,
      targetState: { position: { q: number; r: number }; damage: number; facing: number },
      sourceEntry: BeatEntry,
    ) => {
      const beforeSignature = currentBeatActionSignature(targetId);
      const endList: ActionListItem[] = [
        {
          action: DEFAULT_ACTION,
          rotation: '',
          priority: 0,
          cardId: sourceEntry.cardId,
          passiveCardId: sourceEntry.passiveCardId,
        },
      ];
      const forced = applyActionListFromIndex(targetId, beatIndex, targetState, endList);
      if (forced) {
        entriesByUser.set(targetId, forced);
        rerunIfCurrentFrameChanged(targetId, beforeSignature);
      }
      return forced;
    };
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
        let targetEntry = targetCharacter ? findEntryForCharacter(beat, targetCharacter) : null;
        if (
          targetCharacter &&
          targetEntry?.passiveCardId === REFLEX_DODGE_CARD_ID &&
          normalizeActionLabel(targetEntry.action ?? '').toUpperCase() === WAIT_ACTION
        ) {
          const beforeSignature = currentBeatActionSignature(targetId);
          const swappedEntry = swapActiveWithPassiveAtBeat(targetId, index, targetState);
          if (swappedEntry) {
            entriesByUser.set(targetId, swappedEntry);
            targetEntry = swappedEntry;
          const swappedRotationDelta = parseRotationDegrees(swappedEntry.rotation ?? '');
          if (swappedRotationDelta && !rotatedActorsThisBeat.has(targetId)) {
            targetState.facing = normalizeDegrees(targetState.facing + swappedRotationDelta);
            rotatedActorsThisBeat.add(targetId);
          }
          const startTerrain = resolveTerrain(targetState.position);
          cardStartTerrainByUser.set(targetId, startTerrain);
          havenPassiveSkipByUser.set(targetId, swappedEntry.passiveCardId === HAVEN_CARD_ID && startTerrain === 'abyss');
          actionSetFacingByUser.set(targetId, targetState.facing);
          const refreshedRotation = findActionSetRotationForCharacter(targetCharacter, index);
          if (refreshedRotation) {
            actionSetRotationByUser.set(targetId, refreshedRotation);
          }
          registerBlockActions(targetId, swappedEntry, targetState);
          rerunIfCurrentFrameChanged(targetId, beforeSignature, { causeActorId: targetId });
        }
      }
      const hasHammerPassive =
        targetEntry?.passiveCardId === HAMMER_CARD_ID && isActionActive(targetEntry.action);
      const blockDirection = getDirectionIndex({ q: -forward.q, r: -forward.r });
      if (blockDirection != null) {
        const targetKey = coordKey(targetState.position);
        const blockSource = blockMap.get(targetKey)?.get(blockDirection);
        if (blockSource) {
          const blockAction = blockSource.action ?? targetEntry?.action;
          const blockCardId = blockSource.cardId ?? targetEntry?.cardId;
          if (blockCardId === REFLEX_DODGE_CARD_ID) {
            reflexDodgeAvoidedByUser.add(targetId);
          }
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
      if (shouldStun || knockedSteps > 0) {
        markRewindFocusInactive(targetId, index, shouldStun ? 'stun' : 'knockback');
        removeFocusAnchorToken(targetId);
      }
      if (shouldStun) {
        const beforeSignature = currentBeatActionSignature(targetId);
        applyHitTimeline(targetId, index, targetState, knockedSteps, true);
        rerunIfCurrentFrameChanged(targetId, beforeSignature, {
          causeActorId: safeOwnerId || targetId,
        });
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
    if (scheduledForcedGuardDiscard?.size) {
      scheduledForcedGuardDiscard.forEach((targetId) => {
        const targetCharacter = characterById.get(targetId);
        const targetEntry = targetCharacter ? findEntryForCharacter(beat, targetCharacter) : null;
        queueDiscard(targetId, 1, 'self', targetEntry, { force: true });
      });
    }
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
        if (shouldStun || knockedSteps > 0) {
          markRewindFocusInactive(counter.attackerId, index, shouldStun ? 'stun' : 'knockback');
          removeFocusAnchorToken(counter.attackerId);
        }
        if (shouldStun) {
          const beforeSignature = currentBeatActionSignature(counter.attackerId);
          applyHitTimeline(counter.attackerId, index, targetState, knockedSteps, false);
          rerunIfCurrentFrameChanged(counter.attackerId, beforeSignature, {
            causeActorId: counter.defenderId || counter.attackerId,
          });
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
      .filter((entry) => !isOpenBeatAction(entry.action));

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
      if (havenPassiveSkipByUser.get(actorId)) {
        const firstActionLabel = normalizeActionLabel(entry.action ?? '').toUpperCase();
        if (firstActionLabel === WAIT_ACTION) {
          const actorCharacter = characterById.get(actorId);
          if (actorCharacter) {
            shiftCharacterActionSetLeft(actorCharacter, index);
          }
        }
        havenPassiveSkipByUser.set(actorId, false);
      }
      if (entry.cardId === SMOKE_BOMB_CARD_ID && normalizeActionLabel(entry.action ?? '').toUpperCase() === 'X1') {
        const beforeSignature = currentBeatActionSignature(actorId);
        const actorCharacter = characterById.get(actorId);
        const swappedEntry = swapActiveWithPassiveAtBeat(actorId, index, actorState);
        if (swappedEntry) {
          entriesByUser.set(actorId, swappedEntry);
          const swappedRotationDelta = parseRotationDegrees(swappedEntry.rotation ?? '');
          if (swappedRotationDelta && !rotatedActorsThisBeat.has(actorId)) {
            actorState.facing = normalizeDegrees(actorState.facing + swappedRotationDelta);
            rotatedActorsThisBeat.add(actorId);
          }
          const startTerrain = resolveTerrain(actorState.position);
          cardStartTerrainByUser.set(actorId, startTerrain);
          havenPassiveSkipByUser.set(actorId, swappedEntry.passiveCardId === HAVEN_CARD_ID && startTerrain === 'abyss');
          actionSetFacingByUser.set(actorId, actorState.facing);
          const refreshedRotation = actorCharacter
            ? findActionSetRotationForCharacter(actorCharacter, index)
            : actionSetRotationByUser.get(actorId) ?? '';
          if (refreshedRotation) {
            actionSetRotationByUser.set(actorId, refreshedRotation);
          }
          rerunIfCurrentFrameChanged(actorId, beforeSignature, { causeActorId: actorId });
        }
      }
      if (
        entry.cardId === REFLEX_DODGE_CARD_ID &&
        normalizeActionLabel(entry.action ?? '').toUpperCase() === 'X1' &&
        reflexDodgeAvoidedByUser.has(actorId)
      ) {
        forceActionSetEndAtBeat(actorId, index, actorState, entry);
      }
      if (isOpenBeatAction(entry.action ?? DEFAULT_ACTION)) {
        executedActors.add(actorId);
        return;
      }
      const actionLabel = normalizeActionLabel(entry.action ?? '');

      if (entry.cardId === BOW_SHOT_CARD_ID && actionLabel.toUpperCase() === 'X1') {
        const forward = applyFacingToVector(LOCAL_DIRECTIONS.F, actorState.facing);
        spawnArrowToken(
          { q: origin.q + forward.q, r: origin.r + forward.r },
          actorState.facing,
          actorId,
        );
      }
      if (entry.cardId === HAVEN_CARD_ID && actionLabel.toUpperCase() === 'X1') {
        const interactionId = buildInteractionId(HAVEN_PLATFORM_INTERACTION_TYPE, index, actorId, actorId);
        const touchingHexes = buildTouchingHexes(origin);
        const touchingKeys = new Set(touchingHexes.map((coord) => coordKey(coord)));
        const existing = interactionById.get(interactionId);
        if (!existing && !isHistoryIndex(index)) {
          const created: CustomInteraction = {
            id: interactionId,
            type: HAVEN_PLATFORM_INTERACTION_TYPE,
            beatIndex: index,
            actorUserId: actorId,
            targetUserId: actorId,
            status: 'pending',
            touchingHexes,
          };
          updatedInteractions.push(created);
          interactionById.set(interactionId, created);
          if (haltIndex == null || index < haltIndex) {
            haltIndex = index;
          }
          return;
        }
        if (existing?.status === 'pending') {
          if (haltIndex == null || index < haltIndex) {
            haltIndex = index;
          }
          return;
        }
        if (existing?.status === 'resolved') {
          const consumedBeatIndex = existing.resolution?.consumedBeatIndex;
          const consumedAlready =
            Number.isFinite(consumedBeatIndex) && Math.round(consumedBeatIndex as number) <= index;
          if (!consumedAlready) {
            const targetHex = getHavenTargetHex(existing);
            if (targetHex && touchingKeys.has(coordKey(targetHex))) {
              addEtherealPlatformToken(targetHex, actorId);
            }
          }
        }
      }
      if (entry.cardId === IRON_WILL_CARD_ID && actionLabel.toUpperCase() === 'X1') {
        const interactionId = buildInteractionId('draw', index, actorId, actorId);
        if (!interactionById.has(interactionId)) {
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
        if (!interactionById.has(interactionId)) {
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

        if (entry.passiveCardId === CROSS_SLASH_CARD_ID && !isOpenBeatAction(entry.action) && isActionSetStart(entry)) {
          actorState.damage += 1;
          recordHitConsequence(actorId, index, actorState, 1, 0);
        }

        const startDiscard = getPassiveStartDiscardCount(entry.passiveCardId);
        if (startDiscard && !isOpenBeatAction(entry.action) && isActionSetStart(entry)) {
          queueDiscard(actorId, startDiscard, 'self');
        }

        const isGuardReturnBeat = Boolean(scheduledForcedGuardDiscard?.has(actorId));
        const canOpenOnResolvedBeat = resolvedIndex >= 0 && index === resolvedIndex;
        const guardPromptAllowedAtIndex = !isHistoryIndex(index) || canOpenOnResolvedBeat;
        if (
          entry.cardId === GUARD_CARD_ID &&
          isBracketedAction(entry.action ?? '') &&
          guardPromptAllowedAtIndex &&
          !isGuardReturnBeat &&
          canOfferGuardContinue(actorId)
        ) {
          const interactionId = buildInteractionId(GUARD_CONTINUE_INTERACTION_TYPE, index, actorId, actorId);
          const existing = interactionById.get(interactionId);
          if (!existing) {
            const created: CustomInteraction = {
              id: interactionId,
              type: GUARD_CONTINUE_INTERACTION_TYPE,
              beatIndex: index,
              actorUserId: actorId,
              targetUserId: actorId,
              status: 'pending',
              resolution: undefined,
            };
            updatedInteractions.push(created);
            interactionById.set(interactionId, created);
          }
          const pending = interactionById.get(interactionId);
          if (pending?.status === 'pending' && (haltIndex == null || index < haltIndex)) {
            haltIndex = index;
          }
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
        const targetCharacter = targetId ? characterById.get(targetId) : null;
        const targetEntry = targetCharacter ? findEntryForCharacter(beat, targetCharacter) : null;
        const targetState = targetId ? state.get(targetId) : null;

        if (token.type === 'a' || token.type === 'c') {
          recordBurningStrikeAttack(actorId, destination);
          const isThrow = isEntryThrow(entry, {
            tokenType: token.type,
            actorPosition: origin,
            targetPosition: targetState?.position,
          });
          let resolvedTargetEntry = targetEntry;
          let resolvedBlockSource = blockSource;
          let blockedByBlock = Boolean(resolvedBlockSource) && !isThrow;
          if (
            targetId &&
            !blockedByBlock &&
            resolvedTargetEntry?.passiveCardId === REFLEX_DODGE_CARD_ID &&
            normalizeActionLabel(resolvedTargetEntry.action ?? '').toUpperCase() === WAIT_ACTION
          ) {
            const targetState = state.get(targetId);
            if (targetState && targetCharacter) {
              const beforeSignature = currentBeatActionSignature(targetId);
              const swappedEntry = swapActiveWithPassiveAtBeat(targetId, index, targetState);
              if (swappedEntry) {
                entriesByUser.set(targetId, swappedEntry);
                resolvedTargetEntry = swappedEntry;
                const swappedRotationDelta = parseRotationDegrees(swappedEntry.rotation ?? '');
                if (swappedRotationDelta && !rotatedActorsThisBeat.has(targetId)) {
                  targetState.facing = normalizeDegrees(targetState.facing + swappedRotationDelta);
                  rotatedActorsThisBeat.add(targetId);
                }
                const startTerrain = resolveTerrain(targetState.position);
                cardStartTerrainByUser.set(targetId, startTerrain);
                havenPassiveSkipByUser.set(
                  targetId,
                  swappedEntry.passiveCardId === HAVEN_CARD_ID && startTerrain === 'abyss',
                );
                actionSetFacingByUser.set(targetId, targetState.facing);
                const refreshedRotation = findActionSetRotationForCharacter(targetCharacter, index);
                if (refreshedRotation) {
                  actionSetRotationByUser.set(targetId, refreshedRotation);
                }
                registerBlockActions(targetId, swappedEntry, targetState);
                resolvedBlockSource = directionIndex != null ? blockMap.get(targetKey)?.get(directionIndex) : undefined;
                blockedByBlock = Boolean(resolvedBlockSource) && !isThrow;
                rerunIfCurrentFrameChanged(targetId, beforeSignature, { causeActorId: targetId });
              }
            }
          }
          const throwBlocked = isThrow && isThrowImmune(resolvedTargetEntry);
          const blocked = blockedByBlock || throwBlocked;
          const comboCardId = entry.cardId ? `${entry.cardId}` : '';
          let activeComboState = comboState;
          if (!isThrow && targetId && !blockedByBlock) {
            if (!activeComboState || activeComboState.cardId !== comboCardId) {
              activeComboState = ensureComboStateForHit(actorId, characterById.get(actorId), comboCardId, index);
            }
            if (activeComboState && activeComboState.cardId === comboCardId) {
              activeComboState.hit = true;
            }
          }
          const isStabHit =
            targetId &&
            entry.cardId === STAB_CARD_ID &&
            isBracketedAction(entry.action ?? '') &&
            targetState &&
            isBehindTarget(origin, targetState);
          const stabBonus = isStabHit ? 3 : 0;
          const attackDamage = entryDamage + stabBonus;
          const attackKbf = entryKbf + stabBonus;
          if (targetId && blockedByBlock && resolvedTargetEntry?.cardId === REFLEX_DODGE_CARD_ID) {
            reflexDodgeAvoidedByUser.add(targetId);
          }
          if (targetId && blockedByBlock && attackDamage > 0) {
            const blockAction = resolvedBlockSource?.action ?? resolvedTargetEntry?.action;
            const blockCardId = resolvedBlockSource?.cardId ?? resolvedTargetEntry?.cardId;
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
                  executedActors.has(targetId) && (resolvedTargetEntry?.action ?? DEFAULT_ACTION) !== DAMAGE_ICON_ACTION;
                const hasHammerPassive =
                  resolvedTargetEntry?.passiveCardId === HAMMER_CARD_ID && isActionActive(resolvedTargetEntry?.action);
                const isSmokeBombStunHit =
                  entry.cardId === SMOKE_BOMB_CARD_ID &&
                  isBracketedAction(entry.action ?? '') &&
                  (token.type === 'a' || token.type === 'c');
                if (isSmokeBombStunHit) {
                  markRewindFocusInactive(targetId, index, 'stun');
                  removeFocusAnchorToken(targetId);
                  const beforeSignature = currentBeatActionSignature(targetId);
                  const actorCharacter = characterById.get(actorId);
                  const selectedRotation =
                    actionSetRotationByUser.get(actorId) ||
                    (actorCharacter ? findActionSetRotationForCharacter(actorCharacter, index) : '');
                  const rotationAmount = getRotationMagnitude(selectedRotation) ?? 0;
                  const stunDuration = Math.max(0, 5 - rotationAmount);
                  if (stunDuration > 0) {
                    applyHitTimeline(
                      targetId,
                      index,
                      targetState,
                      Math.max(0, stunDuration - 1),
                      preserveAction,
                      { damageIconCount: stunDuration, stunOnly: true },
                    );
                  } else {
                    applyHitTimeline(targetId, index, targetState, 0, preserveAction, { damageIconCount: 0 });
                  }
                  rerunIfCurrentFrameChanged(targetId, beforeSignature, {
                    causeActorId: actorId,
                    causePriority: entry.priority,
                  });
                  if (hasHammerPassive && actorId !== targetId) {
                    const attackerState = state.get(actorId);
                    if (attackerState) {
                      attackerState.damage += 2;
                      recordHitConsequence(actorId, index, attackerState, 2, 0);
                    }
                  }
                  disabledActors.add(targetId);
                  return;
                }
                if (isThrow) {
                  const interactionId = buildInteractionId('throw', index, actorId, targetId);
                  const existing = interactionById.get(interactionId);
                const resolvedDirection = getResolvedDirectionIndex(existing);
                if (existing?.status === 'resolved' && resolvedDirection != null) {
                  const beforeSignature = currentBeatActionSignature(targetId);
                  const damageReduction = getHealingHarmonyReduction(resolvedTargetEntry);
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
                    if (knockedSteps > 0) {
                      markRewindFocusInactive(targetId, index, 'knockback');
                      removeFocusAnchorToken(targetId);
                    }
                    applyHitTimeline(targetId, index, targetState, knockedSteps, preserveAction);
                    rerunIfCurrentFrameChanged(targetId, beforeSignature, {
                      causeActorId: actorId,
                      causePriority: entry.priority,
                    });
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
                    queueDiscard(targetId, discardRule.count, 'opponent', resolvedTargetEntry, { force: true });
                  }
                }

                const fromPosition = { q: targetState.position.q, r: targetState.position.r };
                const damageReduction = getHealingHarmonyReduction(resolvedTargetEntry);
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
                const passiveKbfReduction = getPassiveKbfReduction(resolvedTargetEntry);
                const baseKbf = Math.max(0, attackKbf - passiveKbfReduction);
                const effectiveKbf = getHandTriggerUse(ironWillInteraction) ? 0 : baseKbf;
                const baseKnockbackDistance = getKnockbackDistance(targetState.damage, effectiveKbf);
                const convertKbf = shouldConvertKbfToDiscard(resolvedTargetEntry);
                if (convertKbf && baseKnockbackDistance > 0) {
                  queueDiscard(targetId, baseKnockbackDistance, 'self', resolvedTargetEntry, { force: true });
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
                if (shouldStun || knockedSteps > 0) {
                  markRewindFocusInactive(targetId, index, shouldStun ? 'stun' : 'knockback');
                  removeFocusAnchorToken(targetId);
                }
                if (shouldStun) {
                  const beforeSignature = currentBeatActionSignature(targetId);
                  applyHitTimeline(targetId, index, targetState, knockedSteps, preserveAction);
                  rerunIfCurrentFrameChanged(targetId, beforeSignature, {
                    causeActorId: actorId,
                    causePriority: entry.priority,
                  });
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
              queueDelayedPassiveFireHex(index + 1, origin, actorId);
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

    updatedInteractions.forEach((interaction) => {
      if (interaction.type !== HAVEN_PLATFORM_INTERACTION_TYPE) return;
      if (interaction.status !== 'resolved') return;
      const consumedBeat = interaction.resolution?.consumedBeatIndex;
      if (!Number.isFinite(consumedBeat) || Math.round(consumedBeat as number) !== index) return;
      const targetHex = getHavenTargetHex(interaction);
      if (!targetHex) return;
      removeEtherealPlatformToken(targetHex);
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

    if (rerunRequest) {
      resolvedRerunCauseKeys.add(rerunRequest.causeKey);
      hasRestoredActionPhaseSnapshot = true;
      continue;
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
      break;
    } while (true);

    if (haltForRerunReadiness) {
      haltAtCurrentBeat(rerunHaltReadiness ?? getBeatReadiness({ useCurrentBeatEntries: true }));
      break;
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
