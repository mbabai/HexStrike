import { LAND_HEXES } from '../shared/hex.mjs';
import { getPassiveKbfReduction, isThrowImmune } from './cardText/combatModifiers.js';
import { shouldConvertKbfToDiscard } from './cardText/discardEffects.js';
import {
  isBracketedAction as isBracketedTokenAction,
  normalizeActionToken,
  splitActionTokens,
} from './cardText/actionListTransforms.js';

const DEFAULT_ACTION = 'E';
const FOCUS_ACTION = 'F';
const WAIT_ACTION = 'W';
const COMBO_ACTION = 'CO';
const DAMAGE_ICON_ACTION = 'DamageIcon';
const KNOCKBACK_DIVISOR = 10;
const ACTION_DURATION_MS = 1200;
const THROW_DISTANCE = 2;
const FIRE_HEX_TOKEN_TYPE = 'fire-hex';
const ETHEREAL_PLATFORM_TOKEN_TYPE = 'ethereal-platform';
const ARROW_TOKEN_TYPE = 'arrow';
const FOCUS_ANCHOR_TOKEN_TYPE = 'focus-anchor';
const ARROW_DAMAGE = 4;
const ARROW_KBF = 1;
const ARROW_LAND_DISTANCE_LIMIT = 5;
const HAVEN_PLATFORM_INTERACTION_TYPE = 'haven-platform';
const REWIND_FOCUS_INTERACTION_TYPE = 'rewind-focus';
const REWIND_RETURN_INTERACTION_TYPE = 'rewind-return';
const BOW_SHOT_CARD_ID = 'bow-shot';
const BURNING_STRIKE_CARD_ID = 'burning-strike';
const HAVEN_CARD_ID = 'haven';
const IRON_WILL_CARD_ID = 'iron-will';
const ABSORB_CARD_ID = 'absorb';
const GIGANTIC_STAFF_CARD_ID = 'gigantic-staff';
const HAMMER_CARD_ID = 'hammer';
const HEALING_HARMONY_CARD_ID = 'healing-harmony';
const PARRY_CARD_ID = 'parry';
const STAB_CARD_ID = 'stab';
const CROSS_SLASH_CARD_ID = 'cross-slash';
// Keep in sync with server-side throw detection.
const ACTIVE_THROW_CARD_IDS = new Set(['hip-throw', 'tackle']);
const PASSIVE_THROW_CARD_IDS = new Set(['leap']);
const GRAPPLING_HOOK_CARD_ID = 'grappling-hook';

const toSafeCount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
};

const getCharacterEffects = (character, characterPowersById) => {
  const fromCatalog =
    character?.characterId && characterPowersById?.get(character.characterId)?.effects
      ? characterPowersById.get(character.characterId).effects
      : {};
  const fromCharacter =
    character?.characterPower && typeof character.characterPower === 'object' ? character.characterPower : {};
  return { ...fromCatalog, ...fromCharacter };
};

const getAttackDamageBonusForCharacter = (character, characterPowersById) =>
  toSafeCount(getCharacterEffects(character, characterPowersById).attackDamageBonus);

const getDamageReductionForCharacter = (character, characterPowersById) =>
  toSafeCount(getCharacterEffects(character, characterPowersById).damageReduction);

const getKnockbackBonusForCharacter = (character, accumulatedDamage, kbf, characterPowersById) => {
  if (!Number.isFinite(kbf) || kbf <= 0) return 0;
  const perTen = toSafeCount(getCharacterEffects(character, characterPowersById).knockbackBonusPerTenDamage);
  if (!perTen) return 0;
  const damage = Number.isFinite(accumulatedDamage) ? Math.max(0, Math.floor(accumulatedDamage)) : 0;
  return perTen * Math.floor(damage / 10);
};

const HIT_WINDOW_START = 0.18;
const HIT_WINDOW_END = 0.32;
const KNOCKBACK_START = 0.32;
const KNOCKBACK_END = 0.55;
const SWIPE_DURATION = 0.22;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const easeInOut = (t) => 0.5 - Math.cos(clamp(t, 0, 1) * Math.PI) / 2;

const buildPathFromPositions = (origin, positions, destination) => {
  const path = [{ q: origin.q, r: origin.r }];
  if (!Array.isArray(positions) || !positions.length) return path;
  for (const position of positions) {
    path.push({ q: position.q, r: position.r });
    if (destination && sameCoord(position, destination)) break;
  }
  return path;
};

const buildPartialPath = (path, progress) => {
  if (!Array.isArray(path) || !path.length) return [];
  if (path.length === 1) return [{ q: path[0].q, r: path[0].r }];
  const clamped = clamp(progress, 0, 1);
  const totalSegments = path.length - 1;
  const scaled = clamped * totalSegments;
  const segmentIndex = Math.min(totalSegments - 1, Math.floor(scaled));
  const segmentProgress = scaled - segmentIndex;
  const points = path.slice(0, segmentIndex + 1).map((point) => ({ q: point.q, r: point.r }));
  const start = path[segmentIndex];
  const end = path[segmentIndex + 1];
  points.push({
    q: start.q + (end.q - start.q) * segmentProgress,
    r: start.r + (end.r - start.r) * segmentProgress,
  });
  return points;
};

const hashSeed = (value) => {
  const str = `${value ?? ''}`;
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) % 100000;
  }
  return (hash / 100000) * Math.PI * 2;
};

const getShakeOffset = (progress, intensity, seed) => {
  if (!intensity) return { x: 0, y: 0 };
  const phase = clamp(progress, 0, 1) * Math.PI * 2;
  return {
    x: Math.sin(phase * 7 + seed) * intensity,
    y: Math.cos(phase * 9 + seed * 1.3) * intensity,
  };
};

const getSwipeState = (stepProgress) => {
  const alpha = Math.sin(stepProgress * Math.PI);
  const easedProgress = easeInOut(stepProgress);
  const swipeProgress = clamp(stepProgress / SWIPE_DURATION, 0, 1);
  const swipeFade = clamp((stepProgress - SWIPE_DURATION) / 0.18, 0, 1);
  const swipeIntensity = 1 - swipeFade;
  const attackAlpha = alpha * swipeIntensity;
  return { alpha, easedProgress, swipeProgress, attackAlpha };
};

const getHitState = (stepProgress) => {
  const hitProgress = clamp(
    (stepProgress - HIT_WINDOW_START) / (HIT_WINDOW_END - HIT_WINDOW_START),
    0,
    1,
  );
  const hitPulse = Math.sin(hitProgress * Math.PI);
  const knockbackProgress = clamp(
    (stepProgress - KNOCKBACK_START) / (KNOCKBACK_END - KNOCKBACK_START),
    0,
    1,
  );
  const knockbackEase = easeInOut(knockbackProgress);
  return {
    hitProgress,
    hitPulse,
    knockbackProgress,
    knockbackEase,
    isHitWindow: stepProgress >= HIT_WINDOW_START && stepProgress <= HIT_WINDOW_END,
  };
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

const normalizeDegrees = (value) => {
  const normalized = ((value % 360) + 360) % 360;
  return Number.isFinite(normalized) ? normalized : 0;
};

const parseRotationDegrees = (rotation) => {
  if (!rotation) return 0;
  const trimmed = `${rotation}`.trim().toUpperCase();
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

const getRotationMagnitude = (rotationLabel) => {
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

const rotateAxialCW = (coord) => ({ q: -coord.r, r: coord.q + coord.r });

const rotateAxial = (coord, steps) => {
  let rotated = { ...coord };
  const safeSteps = ((steps % 6) + 6) % 6;
  for (let i = 0; i < safeSteps; i += 1) {
    rotated = rotateAxialCW(rotated);
  }
  return rotated;
};

const getFacingRotationSteps = (facing) => {
  const steps = Math.round((normalizeDegrees(facing) - 180) / 60);
  return ((steps % 6) + 6) % 6;
};

const applyFacingToVector = (vector, facing) => rotateAxial(vector, getFacingRotationSteps(facing));

const isBehindTarget = (attackerPosition, targetState) => {
  if (!attackerPosition || !targetState?.position) return false;
  const delta = {
    q: attackerPosition.q - targetState.position.q,
    r: attackerPosition.r - targetState.position.r,
  };
  const directionIndex = getDirectionIndex(delta);
  if (directionIndex == null) return false;
  const facingIndex = getFacingRotationSteps(targetState.facing ?? 0);
  return directionIndex === (facingIndex + 3) % 6;
};

const coordKey = (coord) => `${coord.q},${coord.r}`;

const sameCoord = (a, b) => a.q === b.q && a.r === b.r;

const isCoordOnLand = (coord, land) => {
  if (!coord || !Array.isArray(land) || !land.length) return false;
  const key = coordKey(coord);
  return land.some((tile) => coordKey(tile) === key);
};

const axialDistance = (a, b) => {
  const aq = Math.round(a.q);
  const ar = Math.round(a.r);
  const bq = Math.round(b.q);
  const br = Math.round(b.r);
  const dq = aq - bq;
  const dr = ar - br;
  const ds = (aq + ar) - (bq + br);
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
};

const getDistanceToLand = (position, land) => {
  if (!Array.isArray(land) || !land.length) return Number.POSITIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  land.forEach((tile) => {
    const distance = axialDistance(position, tile);
    if (distance < min) min = distance;
  });
  return min;
};

const isBracketedAction = (action) => {
  const trimmed = `${action ?? ''}`.trim();
  return Boolean(trimmed) && trimmed.startsWith('[') && trimmed.endsWith(']');
};

const isGrapplingHookThrow = (entry, options = {}) => {
  if (!entry || entry.cardId !== GRAPPLING_HOOK_CARD_ID) return false;
  if (entry.cardStartTerrain !== 'land') return false;
  if (`${options.tokenType ?? ''}`.toLowerCase() !== 'c') return false;
  if (!options.actorPosition || !options.targetPosition) return false;
  return axialDistance(options.actorPosition, options.targetPosition) === 1;
};

const isEntryThrow = (entry, options = {}) => {
  if (!entry) return false;
  if (entry.interaction?.type === 'throw') return true;
  if (isGrapplingHookThrow(entry, options)) return true;
  if (entry.cardId && ACTIVE_THROW_CARD_IDS.has(entry.cardId)) return true;
  if (entry.passiveCardId && PASSIVE_THROW_CARD_IDS.has(entry.passiveCardId)) return true;
  return false;
};

const isForwardScale = (value) => Number.isFinite(value) && Math.round(value) === value && value > 0;

const getDirectionIndex = (delta) => {
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

const parsePath = (path) => {
  if (!path) return [{ dir: 'F', distance: 1 }];
  const steps = [];
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

const isWaitAction = (action) => {
  const trimmed = `${action ?? ''}`.trim().toUpperCase();
  if (!trimmed) return true;
  if (trimmed === WAIT_ACTION || trimmed === DAMAGE_ICON_ACTION.toUpperCase() || trimmed === COMBO_ACTION) {
    return true;
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const label = trimmed.slice(1, -1).trim();
    return label === COMBO_ACTION;
  }
  return false;
};

const normalizeActionLabel = (action) => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const isOpenBeatAction = (action) => {
  const label = normalizeActionLabel(action ?? '').toUpperCase();
  return label === DEFAULT_ACTION || label === FOCUS_ACTION;
};

const isActionActive = (action) => !isOpenBeatAction(action);
const isActionSetStart = (entry) =>
  `${entry?.rotationSource ?? ''}`.trim() === 'selected' || Boolean(entry?.comboStarter);

const getHealingHarmonyReduction = (entry) => {
  if (!entry || entry.passiveCardId !== HEALING_HARMONY_CARD_ID) return 0;
  return isActionActive(entry.action) ? 2 : 0;
};

const parseActionTokens = (action) => {
  const trimmed = `${action ?? ''}`.trim();
  if (isWaitAction(trimmed)) return [];
  return splitActionTokens(trimmed)
    .map((token) => {
      const type = token[token.length - 1]?.toLowerCase() ?? '';
      const path = token.slice(0, -1);
      return { type, path, steps: parsePath(path) };
    })
    .filter((token) => token.type);
};

const applyGiganticStaffAction = (action) => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return action;
  const bracketed = isBracketedTokenAction(trimmed);
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

const applyRotationPhase = (entries, state, userLookup) => {
  entries.forEach((entry) => {
    const actorId = userLookup.get(entry.username);
    if (!actorId) return;
    const actorState = state.get(actorId);
    if (!actorState) return;
    const rotationDelta = parseRotationDegrees(entry.rotation ?? '');
    if (!rotationDelta) return;
    actorState.facing = normalizeDegrees(actorState.facing + rotationDelta);
  });
};

const buildPath = (origin, steps, facing) => {
  const positions = [];
  let current = { ...origin };
  let lastStep = null;
  steps.forEach((step) => {
    const base = LOCAL_DIRECTIONS[step.dir] ?? LOCAL_DIRECTIONS.F;
    const direction = applyFacingToVector(base, facing);
    lastStep = direction;
    for (let i = 0; i < step.distance; i += 1) {
      current = { q: current.q + direction.q, r: current.r + direction.r };
      positions.push({ ...current });
    }
  });
  return { positions, destination: current, lastStep };
};

const buildGrapplingHookPath = (origin, steps, facing, land, occupancy, actorId) => {
  const positions = [];
  let current = { ...origin };
  let lastStep = null;
  for (const step of steps) {
    const base = LOCAL_DIRECTIONS[step.dir] ?? LOCAL_DIRECTIONS.F;
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

const getKnockbackDistance = (damage, kbf) => {
  if (!Number.isFinite(damage) || !Number.isFinite(kbf)) return 0;
  if (kbf <= 0) return 0;
  if (kbf === 1) return 1;
  return Math.max(1, Math.floor((Math.max(0, damage) * kbf) / KNOCKBACK_DIVISOR));
};

const getKnockbackDirection = (origin, destination, lastStep) => {
  if (lastStep) return { q: lastStep.q, r: lastStep.r };
  const delta = { q: destination.q - origin.q, r: destination.r - origin.r };
  const directionIndex = getDirectionIndex(delta);
  return directionIndex == null ? null : AXIAL_DIRECTIONS[directionIndex];
};

const invertDirection = (direction) => (direction ? { q: -direction.q, r: -direction.r } : null);

const applyGrapplingHookPassiveFlip = (enabled, origin, attackDirection, targetState, occupancy, targetId) => {
  if (!enabled || !attackDirection) {
    return { knockbackDirection: attackDirection, flipPosition: null };
  }
  const grapplingDirection = invertDirection(attackDirection);
  if (!grapplingDirection) {
    return { knockbackDirection: attackDirection, flipPosition: null };
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
      return { knockbackDirection: grapplingDirection, flipPosition: { q: flipPosition.q, r: flipPosition.r } };
    }
  }
  return { knockbackDirection: grapplingDirection, flipPosition: null };
};

const buildInteractionId = (beatIndex, actorId, targetId) => `throw:${beatIndex}:${actorId}:${targetId}`;
const buildHavenInteractionId = (beatIndex, actorId) =>
  `${HAVEN_PLATFORM_INTERACTION_TYPE}:${beatIndex}:${actorId}:${actorId}`;

const getHandTriggerCardId = (interaction) => interaction?.cardId ?? interaction?.abilityCardId ?? '';

const getHandTriggerUse = (interaction) => {
  if (!interaction || interaction.status !== 'resolved') return false;
  const use = interaction?.resolution?.use;
  if (typeof use === 'boolean') return use;
  const ignite = interaction?.resolution?.ignite;
  if (typeof ignite === 'boolean') return ignite;
  return false;
};

const getResolvedDirectionIndex = (interaction) => {
  const direction = interaction?.resolution?.directionIndex;
  if (!Number.isFinite(direction)) return null;
  const rounded = Math.round(direction);
  if (rounded < 0 || rounded >= AXIAL_DIRECTIONS.length) return null;
  return rounded;
};

const normalizeHexCoord = (value) => {
  if (!value || typeof value !== 'object') return null;
  const q = Number(value.q);
  const r = Number(value.r);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  return { q: Math.round(q), r: Math.round(r) };
};

const getHavenTargetHex = (interaction) => {
  const fromResolution = normalizeHexCoord(interaction?.resolution?.targetHex);
  if (fromResolution) return fromResolution;
  return normalizeHexCoord(interaction?.targetHex);
};

const resolveEntryKey = (entry) => entry?.username ?? entry?.userId ?? entry?.userID ?? '';

const getBeatEntryForCharacter = (beat, character) => {
  if (!Array.isArray(beat) || !character) return null;
  const lookupKeys = new Set([character.username, character.userId].filter(Boolean));
  return (
    beat.find((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const key = entry.username ?? entry.userId ?? entry.userID;
      return lookupKeys.has(key);
    }) ?? null
  );
};

const findIronWillInteraction = (interactions, beatIndex, attackerId, targetId) =>
  (interactions ?? []).find((interaction) => {
    if (!interaction || interaction.type !== 'hand-trigger') return false;
    if (getHandTriggerCardId(interaction) !== IRON_WILL_CARD_ID) return false;
    if (interaction.actorUserId !== targetId) return false;
    if (Number.isFinite(interaction.beatIndex) && Math.round(interaction.beatIndex) !== beatIndex) return false;
    if (interaction.sourceUserId && interaction.sourceUserId !== attackerId) return false;
    return true;
  }) ?? null;

const getLastCalculatedEntryForCharacter = (beats, character, uptoIndex) => {
  if (!Array.isArray(beats) || !beats.length || !character) return null;
  const lastIndex = Math.min(uptoIndex, beats.length - 1);
  for (let i = lastIndex; i >= 0; i -= 1) {
    const entry = getBeatEntryForCharacter(beats[i], character);
    if (entry && entry.calculated) return entry;
  }
  return null;
};

const buildCalculatedBaseState = (beats, beatIndex, characters) => {
  const lookupIndex = Number.isFinite(beatIndex) ? beatIndex - 1 : (beats?.length ?? 0) - 1;
  return characters.map((character) => {
    const entry = lookupIndex >= 0 ? getLastCalculatedEntryForCharacter(beats, character, lookupIndex) : null;
    return {
      ...character,
      position: entry?.location ?? { q: character.position.q, r: character.position.r },
      facing: Number.isFinite(entry?.facing) ? entry.facing : normalizeDegrees(character.facing ?? 0),
      damage:
        typeof entry?.damage === 'number'
          ? entry.damage
          : typeof character.damage === 'number'
            ? character.damage
            : 0,
    };
  });
};

const buildResolvedRewindReturnOverrides = (interactions, beatIndex) => {
  const overrides = new Map();
  if (!Array.isArray(interactions) || !Number.isFinite(beatIndex)) return overrides;
  interactions.forEach((interaction) => {
    if (!interaction || interaction.type !== REWIND_RETURN_INTERACTION_TYPE) return;
    if (interaction.status !== 'resolved') return;
    if (!interaction.resolution?.returnToAnchor || !interaction.resolution?.applied) return;
    if (interaction.resolution?.blockedByOccupant) return;
    if (!Number.isFinite(interaction.beatIndex)) return;
    const actorId = `${interaction.actorUserId ?? ''}`.trim();
    if (!actorId) return;
    const interactionBeat = Math.max(0, Math.round(interaction.beatIndex));
    if (interactionBeat !== beatIndex) return;
    const existing = overrides.get(actorId);
    if (!existing || interactionBeat > existing.beatIndex) {
      overrides.set(actorId, { beatIndex: interactionBeat });
    }
  });
  return overrides;
};

const buildBaseStateWithInteractionOverrides = (beats, beatIndex, characters, interactions) => {
  const baseState = buildCalculatedBaseState(beats, beatIndex, characters);
  const rewindOverrides = buildResolvedRewindReturnOverrides(interactions, beatIndex);
  if (!rewindOverrides.size) return baseState;
  return baseState.map((character) => {
    const override =
      rewindOverrides.get(character.userId) ??
      rewindOverrides.get(`${character.username ?? ''}`.trim());
    if (!override) return character;
    const entry = getBeatEntryForCharacter(beats?.[override.beatIndex], character);
    if (!entry?.location) return character;
    return {
      ...character,
      position: { q: entry.location.q, r: entry.location.r },
      facing: Number.isFinite(entry?.facing) ? entry.facing : character.facing,
      damage: typeof entry?.damage === 'number' ? entry.damage : character.damage,
    };
  });
};

const buildBaseState = (beats, beatIndex, characters, interactions) => {
  return buildBaseStateWithInteractionOverrides(beats, beatIndex, characters, interactions);
};

const isBeatCalculated = (beat) =>
  Array.isArray(beat) && beat.length && beat.every((entry) => entry && entry.calculated);

const buildActionSteps = (
  beat,
  characters,
  baseState,
  interactions,
  beatIndex,
  land,
  characterPowersById = new Map(),
) => {
  const rosterOrder = new Map();
  characters.forEach((character, index) => {
    rosterOrder.set(character.userId, index);
    rosterOrder.set(character.username, index);
  });

  const characterById = new Map();
  characters.forEach((character) => {
    characterById.set(character.userId, character);
    if (character.username) {
      characterById.set(character.username, character);
    }
  });

  const userLookup = new Map();
  characters.forEach((character) => {
    userLookup.set(character.userId, character.userId);
    userLookup.set(character.username, character.userId);
  });

  const interactionById = new Map();
  (interactions ?? []).forEach((interaction) => {
    if (interaction?.id) {
      interactionById.set(interaction.id, interaction);
    }
  });

  const landTiles = Array.isArray(land) && land.length ? land : LAND_HEXES;

  const state = new Map();
  const occupancy = new Map();
  baseState.forEach((character) => {
    state.set(character.userId, {
      position: { q: character.position.q, r: character.position.r },
      damage: character.damage ?? 0,
      facing: normalizeDegrees(character.facing ?? 0),
    });
    occupancy.set(coordKey(character.position), character.userId);
  });
  const getCharacterForUser = (userId) => characterById.get(userId) ?? null;
  const applyDamageToUser = (userId, rawDamage) => {
    const targetState = state.get(userId);
    if (!targetState) return 0;
    const safeDamage = Number.isFinite(rawDamage) ? Math.max(0, Math.floor(rawDamage)) : 0;
    if (!safeDamage) return 0;
    const targetCharacter = getCharacterForUser(userId);
    const reduction = getDamageReductionForCharacter(targetCharacter, characterPowersById);
    const adjusted = Math.max(0, safeDamage - reduction);
    targetState.damage = (targetState.damage ?? 0) + adjusted;
    return adjusted;
  };

  const blockMap = new Map();
  const disabledActors = new Set();

  const ordered = (beat ?? [])
    .slice()
    .sort((a, b) => {
      const priorityDelta = (b.priority ?? 0) - (a.priority ?? 0);
      if (priorityDelta) return priorityDelta;
      const orderA = rosterOrder.get(a.username) ?? Number.MAX_SAFE_INTEGER;
      const orderB = rosterOrder.get(b.username) ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    })
    .filter((entry) => entry && !isOpenBeatAction(entry.action));

  const steps = [];
  const persistentEffects = [];

  applyRotationPhase(ordered, state, userLookup);

  const parryInteractions = (interactions ?? []).filter((interaction) => {
    if (interaction?.type !== 'parry') return false;
    if (interaction?.status !== 'resolved') return false;
    const targetBeat = Number.isFinite(interaction?.beatIndex) ? Math.round(interaction.beatIndex) : null;
    if (targetBeat == null) return false;
    return targetBeat === beatIndex;
  });

  if (parryInteractions.length) {
    parryInteractions.forEach((interaction) => {
      const defenderId = interaction.actorUserId;
      const attackerId = interaction.targetUserId;
      if (!attackerId) return;
      const targetState = state.get(attackerId);
      if (!targetState) return;
      const defenderCharacter = characterById.get(defenderId);
      const targetCharacter = characterById.get(attackerId);
      const targetEntry = targetCharacter ? getBeatEntryForCharacter(beat, targetCharacter) : null;
      const baseDamage = Number.isFinite(interaction.damage) ? Math.max(0, Math.floor(interaction.damage)) : 0;
      const attackDamageBonus = getAttackDamageBonusForCharacter(defenderCharacter, characterPowersById);
      const baseKbf = Number.isFinite(interaction.kbf) ? Math.max(0, Math.floor(interaction.kbf)) : 0;
      const directionIndex = Number.isFinite(interaction.directionIndex) ? Math.round(interaction.directionIndex) : null;
      const damageReduction = getHealingHarmonyReduction(targetEntry);
      const adjustedDamage = applyDamageToUser(attackerId, Math.max(0, baseDamage + attackDamageBonus - damageReduction));
      const passiveKbfReduction = getPassiveKbfReduction(targetEntry);
      const effectiveKbf = Math.max(0, baseKbf - passiveKbfReduction);
      const baseKnockbackDistance = getKnockbackDistance(targetState.damage ?? 0, effectiveKbf);
      const knockbackBonus = getKnockbackBonusForCharacter(
        defenderCharacter,
        state.get(defenderId)?.damage ?? 0,
        effectiveKbf,
        characterPowersById,
      );
      const calculatedKnockbackDistance = baseKnockbackDistance + knockbackBonus;
      const knockbackDistance = shouldConvertKbfToDiscard(targetEntry) ? 0 : calculatedKnockbackDistance;
      const knockbackDirection = directionIndex != null ? AXIAL_DIRECTIONS[directionIndex] : null;
      const startPosition = { q: targetState.position.q, r: targetState.position.r };
      let finalPosition = { ...targetState.position };
      const hitPath = [{ q: finalPosition.q, r: finalPosition.r }];
      if (knockbackDirection && knockbackDistance > 0) {
        for (let step = 0; step < knockbackDistance; step += 1) {
          const candidate = {
            q: finalPosition.q + knockbackDirection.q,
            r: finalPosition.r + knockbackDirection.r,
          };
          const occupant = occupancy.get(coordKey(candidate));
          if (occupant && occupant !== attackerId) break;
          finalPosition = candidate;
          hitPath.push({ q: finalPosition.q, r: finalPosition.r });
        }
      }
      if (!sameCoord(finalPosition, targetState.position)) {
        occupancy.delete(coordKey(targetState.position));
        occupancy.set(coordKey(finalPosition), attackerId);
      }
      targetState.position = { q: finalPosition.q, r: finalPosition.r };

      const damageChanges = [];
      const positionChanges = [];
      if (adjustedDamage || knockbackDistance > 0) {
        damageChanges.push({ targetId: attackerId, delta: adjustedDamage });
      }
      if (!sameCoord(finalPosition, startPosition)) {
        positionChanges.push({
          targetId: attackerId,
          position: { q: finalPosition.q, r: finalPosition.r },
          from: { q: startPosition.q, r: startPosition.r },
          path: hitPath,
        });
      }
      const hitTargets = [
        {
          targetId: attackerId,
          from: { q: startPosition.q, r: startPosition.r },
          to: { q: finalPosition.q, r: finalPosition.r },
          path: hitPath,
        },
      ];
      if (
        defenderId &&
        defenderId !== attackerId &&
        targetEntry?.passiveCardId === HAMMER_CARD_ID &&
        isActionActive(targetEntry.action)
      ) {
        const reflected = applyDamageToUser(defenderId, 2);
        if (reflected > 0) {
          damageChanges.push({ targetId: defenderId, delta: reflected });
        }
      }
      steps.push({
        actorId: defenderId ?? attackerId,
        facingAfter: state.get(defenderId)?.facing ?? targetState.facing,
        moveDestination: null,
        moveType: null,
        movePath: null,
        damageChanges,
        positionChanges,
        attackOrigin: null,
        attackTargets: [],
        hitTargets,
        blockHits: [],
        effects: [],
      });
      disabledActors.add(attackerId);
    });
  }

  ordered.forEach((entry) => {
    const actorId = userLookup.get(entry.username);
    if (!actorId) return;
    if (disabledActors.has(actorId)) return;
    const actorState = state.get(actorId);
    if (!actorState) return;
    const actorCharacter = characterById.get(actorId);

    const origin = { q: actorState.position.q, r: actorState.position.r };
    const entryDamage = Number.isFinite(entry?.attackDamage) ? entry.attackDamage : 0;
    const entryKbf = Number.isFinite(entry?.attackKbf) ? entry.attackKbf : 0;
    const attackDamageBonus = getAttackDamageBonusForCharacter(actorCharacter, characterPowersById);
    const hasGrapplingHookPassive = entry?.passiveCardId === GRAPPLING_HOOK_CARD_ID;
    const hasGiganticStaffPassive =
      entry?.passiveCardId === GIGANTIC_STAFF_CARD_ID && !isCoordOnLand(actorState.position, landTiles);
    const action = hasGiganticStaffPassive ? applyGiganticStaffAction(entry.action ?? '') : entry.action ?? '';
    const actionLabel = normalizeActionLabel(action);

    const effects = [];
    const damageChanges = [];
    const positionChanges = [];
    const attackTargets = [];
    const hitTargets = [];
    const blockHits = [];
    let moveDestination = null;
    let moveType = null;
    let movePath = null;

      if (entry.cardId === HEALING_HARMONY_CARD_ID && actionLabel.toUpperCase() === 'X1') {
        const beforeDamage = Number.isFinite(actorState.damage) ? actorState.damage : 0;
        const nextDamage = Math.max(0, beforeDamage - 3);
        const delta = nextDamage - beforeDamage;
        if (delta) {
          actorState.damage = nextDamage;
          damageChanges.push({ targetId: actorId, delta });
        } else {
          actorState.damage = nextDamage;
        }
      }

      if (entry.passiveCardId === CROSS_SLASH_CARD_ID && isActionSetStart(entry)) {
        const selfDamage = applyDamageToUser(actorId, 1);
        if (selfDamage > 0) {
          damageChanges.push({ targetId: actorId, delta: selfDamage });
        }
      }

      const tokens = parseActionTokens(action);
    tokens.forEach((token) => {
      const isGrapplingHookCharge =
        entry.cardId === GRAPPLING_HOOK_CARD_ID && token.type === 'c' && isBracketedAction(action);
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
        const blockEffect = { type: 'block', coord: origin, directionIndex: blockDirectionIndex };
        effects.push(blockEffect);
        persistentEffects.push(blockEffect);
        if (blockDirectionIndex != null) {
          const existing = blockMap.get(coordKey(origin)) ?? new Set();
          existing.add(blockDirectionIndex);
          blockMap.set(coordKey(origin), existing);
        }
        return;
      }

      if (token.type === 'a') {
        effects.push({ type: 'attack', coord: destination });
        attackTargets.push({ q: destination.q, r: destination.r });
      }
      if (token.type === 'm') {
        effects.push({ type: 'move', coord: destination });
      }
      if (token.type === 'j') {
        effects.push({ type: 'jump', coord: destination });
      }
      if (token.type === 'c') {
        effects.push({ type: 'charge', coord: destination });
        attackTargets.push({ q: destination.q, r: destination.r });
      }

      const isBlocked =
        directionIndex != null &&
        blockMap.get(targetKey)?.has(directionIndex);
      const targetCharacter = targetId ? characterById.get(targetId) : null;
      const targetEntry = targetCharacter ? getBeatEntryForCharacter(beat, targetCharacter) : null;
      const targetState = targetId ? state.get(targetId) : null;

      if (token.type === 'a' || token.type === 'c') {
        const isThrow = isEntryThrow(entry, {
          tokenType: token.type,
          actorPosition: origin,
          targetPosition: targetState?.position,
        });
        const throwBlocked = isThrow && isThrowImmune(targetEntry);
        const blocked = (isBlocked && !isThrow) || throwBlocked;
        if (targetId && blocked && directionIndex != null) {
          blockHits.push({ coord: { q: destination.q, r: destination.r }, directionIndex });
        }
        if (targetId && !blocked) {
          if (targetState) {
            const fromPosition = { q: targetState.position.q, r: targetState.position.r };
            if (isThrow) {
              const interactionId = buildInteractionId(beatIndex, actorId, targetId);
              const interaction = interactionById.get(interactionId);
              const resolvedDirection = getResolvedDirectionIndex(interaction);
              const knockbackPath = [{ q: targetState.position.q, r: targetState.position.r }];
              if (interaction?.status === 'resolved' && resolvedDirection != null) {
                const damageReduction = getHealingHarmonyReduction(targetEntry);
                const throwDamage = entryDamage + attackDamageBonus;
                const adjustedDamage = applyDamageToUser(targetId, Math.max(0, throwDamage - damageReduction));
                damageChanges.push({ targetId, delta: adjustedDamage });
                const knockbackDirection = AXIAL_DIRECTIONS[resolvedDirection];
                let finalPosition = { ...targetState.position };
                if (knockbackDirection && THROW_DISTANCE > 0) {
                  for (let step = 0; step < THROW_DISTANCE; step += 1) {
                    const candidate = {
                      q: finalPosition.q + knockbackDirection.q,
                      r: finalPosition.r + knockbackDirection.r,
                    };
                    finalPosition = candidate;
                    knockbackPath.push({ q: finalPosition.q, r: finalPosition.r });
                  }
                  const landingOccupant = occupancy.get(coordKey(finalPosition));
                  if (landingOccupant && landingOccupant !== targetId) {
                    finalPosition = { ...targetState.position };
                    knockbackPath.splice(1);
                  }
                }
                if (!sameCoord(finalPosition, targetState.position)) {
                  occupancy.delete(coordKey(targetState.position));
                  targetState.position = { q: finalPosition.q, r: finalPosition.r };
                  occupancy.set(coordKey(targetState.position), targetId);
                  positionChanges.push({
                    targetId,
                    position: { q: targetState.position.q, r: targetState.position.r },
                    from: { q: fromPosition.q, r: fromPosition.r },
                    path: knockbackPath,
                  });
                }
                hitTargets.push({
                  targetId,
                  from: { q: fromPosition.q, r: fromPosition.r },
                  to: { q: finalPosition.q, r: finalPosition.r },
                  path: knockbackPath,
                });
                if (
                  targetEntry?.passiveCardId === HAMMER_CARD_ID &&
                  isActionActive(targetEntry.action) &&
                  actorId !== targetId
                ) {
                  const reflected = applyDamageToUser(actorId, 2);
                  if (reflected > 0) {
                    damageChanges.push({ targetId: actorId, delta: reflected });
                  }
                }
                disabledActors.add(targetId);
              } else {
                hitTargets.push({
                  targetId,
                  from: { q: fromPosition.q, r: fromPosition.r },
                  to: { q: fromPosition.q, r: fromPosition.r },
                  path: knockbackPath,
                });
                disabledActors.add(targetId);
              }
              return;
            }
            const ironWillInteraction = findIronWillInteraction(interactions, beatIndex, actorId, targetId);
            if (ironWillInteraction?.status === 'pending') {
              return;
            }
            const isStabHit =
              entry.cardId === STAB_CARD_ID &&
              isBracketedAction(entry.action ?? '') &&
              isBehindTarget(origin, targetState);
            const stabBonus = isStabHit ? 3 : 0;
            const rawDamage = entryDamage + stabBonus + attackDamageBonus;
            const rawKbf = entryKbf + stabBonus;
            const damageReduction = getHealingHarmonyReduction(targetEntry);
            const adjustedDamage = applyDamageToUser(targetId, Math.max(0, rawDamage - damageReduction));
            damageChanges.push({ targetId, delta: adjustedDamage });
            const usesGrapplingHookPassive = hasGrapplingHookPassive && token.type === 'a';
            const attackDirection = getKnockbackDirection(origin, destination, lastStep);
            const knockbackPath = [{ q: targetState.position.q, r: targetState.position.r }];
            const { knockbackDirection, flipPosition } = applyGrapplingHookPassiveFlip(
              usesGrapplingHookPassive,
              origin,
              attackDirection,
              targetState,
              occupancy,
              targetId,
            );
            const passiveKbfReduction = getPassiveKbfReduction(targetEntry);
            const baseKbf = Math.max(0, rawKbf - passiveKbfReduction);
            const effectiveKbf = getHandTriggerUse(ironWillInteraction) ? 0 : baseKbf;
            const baseKnockbackDistance = getKnockbackDistance(targetState.damage, effectiveKbf);
            const knockbackBonus = getKnockbackBonusForCharacter(
              actorCharacter,
              state.get(actorId)?.damage ?? 0,
              effectiveKbf,
              characterPowersById,
            );
            const calculatedKnockbackDistance = baseKnockbackDistance + knockbackBonus;
            const knockbackDistance = shouldConvertKbfToDiscard(targetEntry) ? 0 : calculatedKnockbackDistance;
            const shouldStun = effectiveKbf === 1 || (effectiveKbf > 1 && calculatedKnockbackDistance > 0);
            if (flipPosition) {
              knockbackPath.push({ q: flipPosition.q, r: flipPosition.r });
            }
            let finalPosition = { ...targetState.position };
            if (knockbackDirection && knockbackDistance > 0) {
              for (let step = 0; step < knockbackDistance; step += 1) {
                const candidate = {
                  q: finalPosition.q + knockbackDirection.q,
                  r: finalPosition.r + knockbackDirection.r,
                };
                const occupant = occupancy.get(coordKey(candidate));
                if (occupant && occupant !== targetId) break;
                finalPosition = candidate;
                knockbackPath.push({ q: finalPosition.q, r: finalPosition.r });
              }
            }
            if (!sameCoord(finalPosition, targetState.position)) {
              occupancy.delete(coordKey(targetState.position));
              targetState.position = { q: finalPosition.q, r: finalPosition.r };
              occupancy.set(coordKey(targetState.position), targetId);
            }
            if (!sameCoord(targetState.position, fromPosition)) {
              positionChanges.push({
                targetId,
                position: { q: targetState.position.q, r: targetState.position.r },
                from: { q: fromPosition.q, r: fromPosition.r },
                path: knockbackPath,
              });
            }
            hitTargets.push({
              targetId,
              from: { q: fromPosition.q, r: fromPosition.r },
              to: { q: targetState.position.q, r: targetState.position.r },
              path: knockbackPath,
            });
            if (
              targetEntry?.passiveCardId === HAMMER_CARD_ID &&
              isActionActive(targetEntry.action) &&
              actorId !== targetId
            ) {
              const reflected = applyDamageToUser(actorId, 2);
              if (reflected > 0) {
                damageChanges.push({ targetId: actorId, delta: reflected });
              }
            }
            if (shouldStun) {
              disabledActors.add(targetId);
            }
          }
        }
      }

      if (token.type === 'm' || token.type === 'c') {
        let finalPosition = origin;
        for (const stepPosition of positions) {
          const stepKey = coordKey(stepPosition);
          const occupant = occupancy.get(stepKey);
          if (occupant && occupant !== actorId) {
            break;
          }
          finalPosition = stepPosition;
        }
        if (!sameCoord(finalPosition, actorState.position)) {
          occupancy.delete(coordKey(actorState.position));
          actorState.position = { q: finalPosition.q, r: finalPosition.r };
          occupancy.set(coordKey(actorState.position), actorId);
          moveDestination = { q: finalPosition.q, r: finalPosition.r };
          moveType = token.type;
          movePath = buildPathFromPositions(origin, positions, finalPosition);
        }
      }

      if (token.type === 'j') {
        if (!targetId || targetId === actorId) {
          occupancy.delete(coordKey(actorState.position));
          actorState.position = { q: destination.q, r: destination.r };
          occupancy.set(coordKey(actorState.position), actorId);
          moveDestination = { q: destination.q, r: destination.r };
          moveType = token.type;
          movePath = buildPathFromPositions(origin, positions, destination);
        }
      }
    });

    steps.push({
      actorId,
      facingAfter: actorState.facing,
      moveDestination,
      moveType,
      movePath,
      damageChanges,
      positionChanges,
      attackOrigin: attackTargets.length ? { q: origin.q, r: origin.r } : null,
      attackTargets,
      hitTargets,
      blockHits,
      effects,
    });
  });

  return { steps, persistentEffects };
};

const applyStep = (characters, step) => {
  if (!step) return characters;
  const damageChanges = Array.isArray(step.damageChanges) ? step.damageChanges : [];
  const positionChanges = Array.isArray(step.positionChanges) ? step.positionChanges : [];
  const updated = characters.map((character) => {
    if (character.userId !== step.actorId) return character;
    const next = { ...character, facing: step.facingAfter };
    if (step.moveDestination) {
      next.position = { q: step.moveDestination.q, r: step.moveDestination.r };
    }
    return next;
  });

  damageChanges.forEach((change) => {
    const index = updated.findIndex((character) => character.userId === change.targetId);
    if (index >= 0) {
      const target = updated[index];
      updated[index] = { ...target, damage: (target.damage ?? 0) + change.delta };
    }
  });

  positionChanges.forEach((change) => {
    const index = updated.findIndex((character) => character.userId === change.targetId);
    if (index >= 0) {
      const target = updated[index];
      updated[index] = { ...target, position: { q: change.position.q, r: change.position.r } };
    }
  });

  return updated;
};

const createTokenRenderState = (baseTokens) => {
  const renderTokens = Array.isArray(baseTokens)
    ? baseTokens.map((token) => ({ ...token, position: { q: token.position.q, r: token.position.r } }))
    : [];
  const tokenIndex = new Map();
  const rebuildTokenIndex = () => {
    tokenIndex.clear();
    renderTokens.forEach((token, index) => {
      tokenIndex.set(token.id, index);
    });
  };
  rebuildTokenIndex();

  const applyTokenUpdate = (tokenId, patch) => {
    const index = tokenIndex.get(tokenId);
    if (index == null) return;
    const current = renderTokens[index];
    const next = { ...current, ...patch };
    if (patch.position) {
      next.position = { q: patch.position.q, r: patch.position.r };
    } else if (current.position) {
      next.position = { q: current.position.q, r: current.position.r };
    }
    renderTokens[index] = next;
  };

  const applyTokenSpawns = (spawns) => {
    if (!Array.isArray(spawns) || !spawns.length) return;
    spawns.forEach((token) => {
      if (!token) return;
      renderTokens.push({ ...token, position: { q: token.position.q, r: token.position.r } });
    });
    rebuildTokenIndex();
  };

  const applyTokenStep = (step) => {
    if (!step || step.kind !== 'token') return;
    if (step.removeToken) {
      const index = tokenIndex.get(step.tokenId);
      if (index == null) return;
      renderTokens.splice(index, 1);
      rebuildTokenIndex();
      return;
    }
    if (step.moveDestination) {
      applyTokenUpdate(step.tokenId, { position: step.moveDestination });
    }
  };

  return {
    renderTokens,
    applyTokenUpdate,
    applyTokenSpawns,
    applyTokenStep,
  };
};

const buildTokenPlayback = (gameState, beatIndex, characterPowersById = new Map()) => {
  const beats = gameState?.state?.public?.beats ?? [];
  const characters = gameState?.state?.public?.characters ?? [];
  const interactions = gameState?.state?.public?.customInteractions ?? [];
  const land = gameState?.state?.public?.land?.length ? gameState.state.public.land : LAND_HEXES;
  const interactionById = new Map();
  interactions.forEach((interaction) => {
    if (!interaction?.id) return;
    interactionById.set(interaction.id, interaction);
  });

  const userLookup = new Map();
  const rosterOrder = new Map();
  characters.forEach((character, index) => {
    if (character.userId) {
      userLookup.set(character.userId, character.userId);
      rosterOrder.set(character.userId, index);
    }
    if (character.username) {
      userLookup.set(character.username, character.userId);
      rosterOrder.set(character.username, index);
    }
  });
  const characterById = new Map();
  characters.forEach((character) => {
    if (character.userId) {
      characterById.set(character.userId, character);
    }
    if (character.username) {
      characterById.set(character.username, character);
    }
  });

  const state = new Map();
  characters.forEach((character) => {
    state.set(character.userId, {
      position: { q: character.position.q, r: character.position.r },
      facing: normalizeDegrees(character.facing ?? 0),
      damage: typeof character.damage === 'number' ? character.damage : 0,
    });
  });

  const tokens = [];
  const fireTokenKeys = new Set();
  const platformTokenKeys = new Set();
  const focusTokenByOwner = new Map();
  let ephemeralFireKeys = new Set();
  const delayedPassiveFireSpawnsByBeat = new Map();
  let tokenCounter = 0;

  const actionSetFacingByUser = new Map();
  const actionSetRotationByUser = new Map();
  const lastActionByUser = new Map();

  const tokenSpawnsByActor = new Map();
  const tokenSpawnsAtEnd = [];
  const tokenSteps = [];
  let baseTokens = [];

  const nextTokenId = (type) => `${type}:${tokenCounter++}`;

  const cloneToken = (token) => ({
    ...token,
    position: { q: token.position.q, r: token.position.r },
  });

  const scheduleSpawnForActor = (actorId, token, isCurrentBeat) => {
    if (!isCurrentBeat) {
      tokens.push(token);
      return;
    }
    if (!actorId) {
      tokenSpawnsAtEnd.push(token);
      return;
    }
    const existing = tokenSpawnsByActor.get(actorId) ?? [];
    existing.push(token);
    tokenSpawnsByActor.set(actorId, existing);
  };

  const addFireToken = (coord, ownerId, isCurrentBeat, spawnAtEnd = false) => {
    if (!coord) return;
    const key = coordKey(coord);
    const onLand = isCoordOnLand(coord, land);
    if (onLand) {
      if (fireTokenKeys.has(key)) return;
      fireTokenKeys.add(key);
    } else {
      if (ephemeralFireKeys.has(key)) return;
      ephemeralFireKeys.add(key);
      if (!isCurrentBeat) return;
    }
    const token = {
      id: nextTokenId(FIRE_HEX_TOKEN_TYPE),
      type: FIRE_HEX_TOKEN_TYPE,
      position: { q: coord.q, r: coord.r },
      facing: 0,
      ownerUserId: ownerId,
    };
    if (spawnAtEnd && isCurrentBeat) {
      tokenSpawnsAtEnd.push(token);
      return;
    }
    scheduleSpawnForActor(ownerId, token, isCurrentBeat);
  };

  const queueDelayedPassiveFire = (targetBeatIndex, coord, ownerId) => {
    if (!Number.isFinite(targetBeatIndex) || !coord) return;
    const targetBeat = Math.max(0, Math.round(targetBeatIndex));
    const existing = delayedPassiveFireSpawnsByBeat.get(targetBeat) ?? [];
    const targetKey = coordKey(coord);
    if (existing.some((item) => coordKey(item.coord) === targetKey)) {
      return;
    }
    existing.push({ coord: { q: coord.q, r: coord.r }, ownerId });
    delayedPassiveFireSpawnsByBeat.set(targetBeat, existing);
  };

  const applyDelayedPassiveFires = (index, isCurrentBeat) => {
    if (!Number.isFinite(index)) return;
    const targetBeat = Math.max(0, Math.round(index));
    const queued = delayedPassiveFireSpawnsByBeat.get(targetBeat);
    if (!queued?.length) return;
    queued.forEach((item) => {
      addFireToken(item.coord, item.ownerId, isCurrentBeat);
    });
    delayedPassiveFireSpawnsByBeat.delete(targetBeat);
  };

  const addArrowToken = (coord, facing, ownerId, isCurrentBeat) => {
    if (!coord) return;
    const token = {
      id: nextTokenId(ARROW_TOKEN_TYPE),
      type: ARROW_TOKEN_TYPE,
      position: { q: coord.q, r: coord.r },
      facing: normalizeDegrees(facing ?? 0),
      ownerUserId: ownerId,
    };
    scheduleSpawnForActor(ownerId, token, isCurrentBeat);
  };

  const addEtherealPlatformToken = (coord, ownerId, isCurrentBeat, spawnAtEnd = false) => {
    if (!coord || isCoordOnLand(coord, land)) return;
    const key = coordKey(coord);
    if (platformTokenKeys.has(key)) return;
    platformTokenKeys.add(key);
    const token = {
      id: nextTokenId(ETHEREAL_PLATFORM_TOKEN_TYPE),
      type: ETHEREAL_PLATFORM_TOKEN_TYPE,
      position: { q: coord.q, r: coord.r },
      facing: 0,
      ownerUserId: ownerId,
    };
    if (spawnAtEnd && isCurrentBeat) {
      tokenSpawnsAtEnd.push(token);
      return;
    }
    scheduleSpawnForActor(ownerId, token, isCurrentBeat);
  };

  const addFocusAnchorToken = (coord, ownerId, cardId) => {
    const ownerKey = `${ownerId ?? ''}`.trim();
    if (!coord || !ownerKey) return;
    removeFocusAnchorToken(ownerKey);
    const token = {
      id: nextTokenId(FOCUS_ANCHOR_TOKEN_TYPE),
      type: FOCUS_ANCHOR_TOKEN_TYPE,
      position: { q: coord.q, r: coord.r },
      facing: 0,
      ownerUserId: ownerKey,
      cardId: cardId || 'rewind',
    };
    focusTokenByOwner.set(ownerKey, token.id);
    tokens.push(token);
  };

  const removeEtherealPlatformToken = (coord, isCurrentBeat) => {
    if (!coord) return;
    const key = coordKey(coord);
    if (!platformTokenKeys.has(key)) return;
    platformTokenKeys.delete(key);
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const token = tokens[i];
      if (token?.type !== ETHEREAL_PLATFORM_TOKEN_TYPE) continue;
      if (coordKey(token.position) !== key) continue;
      if (isCurrentBeat) {
        tokenSteps.push({
          kind: 'token',
          tokenId: token.id,
          tokenType: token.type,
          facingAfter: token.facing,
          moveDestination: token.position,
          moveType: null,
          movePath: [],
          attackOrigin: null,
          attackTargets: [],
          damageChanges: [],
          positionChanges: [],
          hitTargets: [],
          removeToken: true,
        });
      }
      tokens.splice(i, 1);
      break;
    }
  };

  const removeFocusAnchorToken = (ownerId) => {
    const ownerKey = `${ownerId ?? ''}`.trim();
    if (!ownerKey) return;
    const tokenId = focusTokenByOwner.get(ownerKey);
    if (!tokenId) return;
    focusTokenByOwner.delete(ownerKey);
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const token = tokens[i];
      if (!token || token.id !== tokenId) continue;
      tokens.splice(i, 1);
      break;
    }
  };

  const buildEntriesByUser = (beat) => {
    const entriesByUser = new Map();
    (beat ?? []).forEach((entry) => {
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
    });
    return entriesByUser;
  };

  const applyBeatEntriesToState = (beat) => {
    characters.forEach((character) => {
      const entry = getBeatEntryForCharacter(beat, character);
      if (!entry || !entry.calculated) return;
      const current = state.get(character.userId);
      state.set(character.userId, {
        position: entry.location ? { q: entry.location.q, r: entry.location.r } : current?.position ?? character.position,
        facing: Number.isFinite(entry.facing)
          ? normalizeDegrees(entry.facing)
          : current?.facing ?? normalizeDegrees(character.facing ?? 0),
        damage: typeof entry.damage === 'number' ? entry.damage : current?.damage ?? 0,
      });
    });
  };

  const buildCharacterSnapshot = () =>
    characters.map((character) => {
      const stored = state.get(character.userId);
      const position = stored?.position ?? character.position;
      return {
        ...character,
        position: { q: position.q, r: position.r },
        facing: stored?.facing ?? normalizeDegrees(character.facing ?? 0),
        damage: typeof stored?.damage === 'number'
          ? stored.damage
          : typeof character.damage === 'number'
            ? character.damage
            : 0,
      };
    });

  const applyFocusTokenUpdates = (index) => {
    interactions.forEach((interaction) => {
      if (!interaction || interaction.type !== REWIND_FOCUS_INTERACTION_TYPE) return;
      if (interaction.status !== 'resolved') return;
      const ownerId = interaction.actorUserId;
      if (!ownerId) return;
      const startBeat = Number.isFinite(interaction.beatIndex) ? Math.max(0, Math.round(interaction.beatIndex)) : null;
      if (startBeat != null && startBeat === index) {
        const anchor = normalizeHexCoord(interaction.resolution?.anchorHex);
        if (anchor) {
          addFocusAnchorToken(anchor, ownerId, interaction.cardId ?? interaction.resolution?.cardId);
        }
      }
      const endedBeat = Number.isFinite(interaction?.resolution?.endedBeatIndex)
        ? Math.max(0, Math.round(interaction.resolution.endedBeatIndex))
        : null;
      if (endedBeat != null && endedBeat === index) {
        removeFocusAnchorToken(ownerId);
      }
    });
  };

  for (let index = 0; index < beats.length; index += 1) {
    if (!Number.isFinite(beatIndex) || index > beatIndex) break;
    const beat = beats[index] ?? [];
    const isCurrentBeat = index === beatIndex;
    ephemeralFireKeys = new Set();
    applyFocusTokenUpdates(index);
    applyDelayedPassiveFires(index, isCurrentBeat);
    if (!isBeatCalculated(beat)) {
      baseTokens = tokens.map(cloneToken);
      break;
    }

    if (isCurrentBeat) {
      baseTokens = tokens.map(cloneToken);
    }

    const baseState = buildCharacterSnapshot();
    const { steps, persistentEffects } = buildActionSteps(
      beat,
      characters,
      baseState,
      interactions,
      index,
      land,
      characterPowersById,
    );
    const blockMap = new Map();
    (persistentEffects ?? []).forEach((effect) => {
      if (effect?.type !== 'block') return;
      if (!effect.coord || effect.directionIndex == null) return;
      const key = coordKey(effect.coord);
      const existing = blockMap.get(key) ?? new Set();
      existing.add(effect.directionIndex);
      blockMap.set(key, existing);
    });
    const processedActors = new Set(steps.map((step) => step.actorId));
    let endState = baseState;
    steps.forEach((step) => {
      endState = applyStep(endState, step);
    });
    const endStateById = new Map();
    endState.forEach((character) => {
      endStateById.set(character.userId, {
        position: { q: character.position.q, r: character.position.r },
        facing: normalizeDegrees(character.facing ?? 0),
        damage: typeof character.damage === 'number' ? character.damage : 0,
      });
    });
    const applyEndStateDamage = (userId, rawDamage) => {
      const targetState = endStateById.get(userId);
      if (!targetState) return 0;
      const safeDamage = Number.isFinite(rawDamage) ? Math.max(0, Math.floor(rawDamage)) : 0;
      if (!safeDamage) return 0;
      const targetCharacter = characterById.get(userId);
      const damageReduction = getDamageReductionForCharacter(targetCharacter, characterPowersById);
      const adjusted = Math.max(0, safeDamage - damageReduction);
      targetState.damage = (targetState.damage ?? 0) + adjusted;
      endStateById.set(userId, {
        position: { q: targetState.position.q, r: targetState.position.r },
        facing: targetState.facing,
        damage: targetState.damage,
      });
      return adjusted;
    };
    const stepByActor = new Map();
    steps.forEach((step) => {
      stepByActor.set(step.actorId, step);
    });
    let spawnState = baseState.map((character) => ({
      ...character,
      position: { q: character.position.q, r: character.position.r },
    }));
    const updateSpawnStatePosition = (targetId, position) => {
      spawnState = spawnState.map((character) =>
        character.userId === targetId
          ? { ...character, position: { q: position.q, r: position.r } }
          : character,
      );
    };
    const occupancy = new Map();
    endState.forEach((character) => {
      occupancy.set(coordKey(character.position), character.userId);
    });

    const entriesByUser = buildEntriesByUser(beat);
    characters.forEach((character) => {
      const actorId = character.userId;
      const entry = entriesByUser.get(actorId);
      const action = entry?.action ?? DEFAULT_ACTION;
      const previous = lastActionByUser.get(actorId) ?? DEFAULT_ACTION;
      const comboStart = isOpenBeatAction(previous) || Boolean(entry?.comboStarter);
      if (isOpenBeatAction(action)) {
        actionSetFacingByUser.delete(actorId);
        actionSetRotationByUser.delete(actorId);
      } else {
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
      }
      lastActionByUser.set(actorId, action);
    });

    const facingByUser = new Map();
    state.forEach((value, userId) => {
      facingByUser.set(userId, value.facing);
    });
    entriesByUser.forEach((entry, actorId) => {
      const rotationDelta = parseRotationDegrees(entry.rotation ?? '');
      if (!rotationDelta) return;
      const currentFacing = facingByUser.get(actorId) ?? 0;
      facingByUser.set(actorId, normalizeDegrees(currentFacing + rotationDelta));
    });

    const existingArrowIds = new Set(tokens.filter((token) => token.type === ARROW_TOKEN_TYPE).map((token) => token.id));

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

    const applyArrowHit = ({ token, nextPosition, targetId, forward, isCurrentBeat: applyNow }) => {
      const targetState = endStateById.get(targetId);
      if (!targetState) return;
      const blockDirection = getDirectionIndex({ q: -forward.q, r: -forward.r });
      if (blockDirection != null) {
        const targetKey = coordKey(targetState.position);
        if (blockMap.get(targetKey)?.has(blockDirection)) {
          if (applyNow) {
            const blockHit = { coord: { q: nextPosition.q, r: nextPosition.r }, directionIndex: blockDirection };
            tokenSteps.push({
              kind: 'token',
              tokenId: token.id,
              tokenType: token.type,
              facingAfter: token.facing,
              moveDestination: nextPosition,
              moveType: 'c',
              movePath: buildPathFromPositions(token.position, [nextPosition], nextPosition),
              attackOrigin: { q: token.position.q, r: token.position.r },
              attackTargets: [{ q: nextPosition.q, r: nextPosition.r }],
              blockHits: [blockHit],
              damageChanges: [],
              positionChanges: [],
              hitTargets: [],
              removeToken: true,
            });
          }
          return;
        }
      }
      const startPosition = { q: targetState.position.q, r: targetState.position.r };
      const ironWillInteraction = findIronWillInteraction(
        interactions,
        index,
        token.ownerUserId ?? targetId,
        targetId,
      );
      if (ironWillInteraction?.status === 'pending') {
        if (applyNow) {
          tokenSteps.push({
            kind: 'token',
            tokenId: token.id,
            tokenType: token.type,
            facingAfter: token.facing,
            moveDestination: nextPosition,
            moveType: 'c',
            movePath: buildPathFromPositions(token.position, [nextPosition], nextPosition),
            attackOrigin: { q: token.position.q, r: token.position.r },
            attackTargets: [{ q: nextPosition.q, r: nextPosition.r }],
            damageChanges: [],
            positionChanges: [],
            hitTargets: [],
            removeToken: true,
          });
        }
        return;
      }
      const targetCharacter = characterById.get(targetId);
      const targetEntry = targetCharacter ? getBeatEntryForCharacter(beat, targetCharacter) : null;
      const passiveKbfReduction = getPassiveKbfReduction(targetEntry);
      const baseKbf = Math.max(0, ARROW_KBF - passiveKbfReduction);
      const effectiveKbf = getHandTriggerUse(ironWillInteraction) ? 0 : baseKbf;
      const damageReduction = getHealingHarmonyReduction(targetEntry);
      const ownerCharacter = token.ownerUserId ? characterById.get(token.ownerUserId) : null;
      const arrowDamage = ARROW_DAMAGE + getAttackDamageBonusForCharacter(ownerCharacter, characterPowersById);
      const adjustedDamage = applyEndStateDamage(targetId, Math.max(0, arrowDamage - damageReduction));
      const updatedDamage = endStateById.get(targetId)?.damage ?? targetState.damage ?? 0;
      const baseKnockbackDistance = getKnockbackDistance(updatedDamage, effectiveKbf);
      const knockbackBonus = getKnockbackBonusForCharacter(
        ownerCharacter,
        endStateById.get(token.ownerUserId)?.damage ?? 0,
        effectiveKbf,
        characterPowersById,
      );
      const knockbackDistance = baseKnockbackDistance + knockbackBonus;
      let finalPosition = { q: startPosition.q, r: startPosition.r };
      const hitPath = [{ q: finalPosition.q, r: finalPosition.r }];
      for (let step = 0; step < knockbackDistance; step += 1) {
        const candidate = {
          q: finalPosition.q + forward.q,
          r: finalPosition.r + forward.r,
        };
        const occupant = occupancy.get(coordKey(candidate));
        if (occupant && occupant !== targetId) break;
        finalPosition = candidate;
        hitPath.push({ q: finalPosition.q, r: finalPosition.r });
      }
      if (!sameCoord(finalPosition, targetState.position)) {
        occupancy.delete(coordKey(targetState.position));
        occupancy.set(coordKey(finalPosition), targetId);
      }
      endStateById.set(targetId, {
        position: { q: finalPosition.q, r: finalPosition.r },
        facing: targetState.facing,
        damage: updatedDamage,
      });
      const arrowDamageChanges = [{ targetId, delta: adjustedDamage }];
      if (
        targetEntry?.passiveCardId === HAMMER_CARD_ID &&
        isActionActive(targetEntry.action) &&
        token.ownerUserId &&
        token.ownerUserId !== targetId
      ) {
        const reflected = applyEndStateDamage(token.ownerUserId, 2);
        if (applyNow && reflected > 0) {
          arrowDamageChanges.push({ targetId: token.ownerUserId, delta: reflected });
        }
      }
      if (applyNow) {
        tokenSteps.push({
          kind: 'token',
          tokenId: token.id,
          tokenType: token.type,
          facingAfter: token.facing,
          moveDestination: nextPosition,
          moveType: 'c',
          movePath: buildPathFromPositions(token.position, [nextPosition], nextPosition),
          attackOrigin: { q: token.position.q, r: token.position.r },
          attackTargets: [{ q: nextPosition.q, r: nextPosition.r }],
          damageChanges: arrowDamageChanges,
          positionChanges: !sameCoord(finalPosition, targetState.position)
            ? [{ targetId, position: { q: finalPosition.q, r: finalPosition.r } }]
            : [],
          hitTargets: [
            {
              targetId,
              from: { q: startPosition.q, r: startPosition.r },
              to: { q: finalPosition.q, r: finalPosition.r },
              path: hitPath,
            },
          ],
          removeToken: true,
        });
      }
    };

    ordered.forEach((entry) => {
      const actorId = userLookup.get(resolveEntryKey(entry));
      if (!actorId || !processedActors.has(actorId)) return;
      const originState = state.get(actorId);
      if (!originState) return;
      const origin = originState.position;
      const endStateForActor = endStateById.get(actorId) ?? originState;
      const endPosition = endStateForActor?.position ?? origin;
      const facing = facingByUser.get(actorId) ?? originState.facing ?? 0;
      const actionLabel = normalizeActionLabel(entry.action ?? '');
      const step = stepByActor.get(actorId);
      if (step) {
        spawnState = applyStep(spawnState, step);
      }
      const spawnOccupancy = new Map();
      spawnState.forEach((character) => {
        spawnOccupancy.set(coordKey(character.position), character.userId);
      });

      if (entry.cardId === BOW_SHOT_CARD_ID && actionLabel.toUpperCase() === 'X1') {
        const forward = applyFacingToVector(LOCAL_DIRECTIONS.F, facing);
        const spawnCoord = { q: origin.q + forward.q, r: origin.r + forward.r };
        const spawnTargetId = spawnOccupancy.get(coordKey(spawnCoord));
        if (spawnTargetId && spawnTargetId !== actorId) {
          const token = {
            id: nextTokenId(ARROW_TOKEN_TYPE),
            type: ARROW_TOKEN_TYPE,
            position: { q: spawnCoord.q, r: spawnCoord.r },
            facing: normalizeDegrees(facing ?? 0),
            ownerUserId: actorId,
          };
          applyArrowHit({
            token,
            nextPosition: spawnCoord,
            targetId: spawnTargetId,
            forward,
            isCurrentBeat,
          });
          const updatedTarget = endStateById.get(spawnTargetId);
          if (updatedTarget) {
            updateSpawnStatePosition(spawnTargetId, updatedTarget.position);
          }
        } else {
          addArrowToken(spawnCoord, facing, actorId, isCurrentBeat);
        }
      }
      if (entry.cardId === HAVEN_CARD_ID && actionLabel.toUpperCase() === 'X1') {
        const interaction = interactionById.get(buildHavenInteractionId(index, actorId));
        if (interaction?.status === 'resolved') {
          const consumedBeat = interaction?.resolution?.consumedBeatIndex;
          const consumedAlready = Number.isFinite(consumedBeat) && Math.round(consumedBeat) <= index;
          if (!consumedAlready) {
            const targetHex = getHavenTargetHex(interaction);
            if (targetHex) {
              addEtherealPlatformToken(targetHex, actorId, isCurrentBeat);
            }
          }
        }
      }

      const actionTokens = parseActionTokens(entry.action ?? '');

      if (entry.cardId === BURNING_STRIKE_CARD_ID && isBracketedAction(entry.action ?? '')) {
        actionTokens
          .filter((token) => token.type === 'a')
          .forEach((token) => {
            const { destination } = buildPath(origin, token.steps, facing);
            addFireToken(destination, actorId, isCurrentBeat);
          });
      }

      if (entry.passiveCardId === BURNING_STRIKE_CARD_ID) {
        const hasMoveToken = actionTokens.some((token) => token.type === 'm');
        if (hasMoveToken && !sameCoord(endPosition, origin)) {
          queueDelayedPassiveFire(index + 1, origin, actorId);
        }
      }

      if (entry.passiveCardId === BOW_SHOT_CARD_ID) {
        const hasMoveToken = actionTokens.some((token) => token.type === 'm');
        const rotationMagnitude = getRotationMagnitude(actionSetRotationByUser.get(actorId) ?? '');
        if (hasMoveToken && (rotationMagnitude === 1 || rotationMagnitude === 2) && !sameCoord(endPosition, origin)) {
          const actionSetFacing = actionSetFacingByUser.get(actorId) ?? originState.facing ?? 0;
          const spawnTargetId = spawnOccupancy.get(coordKey(endPosition));
          if (spawnTargetId && spawnTargetId !== actorId) {
            const token = {
              id: nextTokenId(ARROW_TOKEN_TYPE),
              type: ARROW_TOKEN_TYPE,
              position: { q: endPosition.q, r: endPosition.r },
              facing: normalizeDegrees(actionSetFacing ?? 0),
              ownerUserId: actorId,
            };
            const forward = applyFacingToVector(LOCAL_DIRECTIONS.F, actionSetFacing);
            applyArrowHit({
              token,
              nextPosition: endPosition,
              targetId: spawnTargetId,
              forward,
              isCurrentBeat,
            });
            const updatedTarget = endStateById.get(spawnTargetId);
            if (updatedTarget) {
              updateSpawnStatePosition(spawnTargetId, updatedTarget.position);
            }
          } else {
            addArrowToken(endPosition, actionSetFacing, actorId, isCurrentBeat);
          }
        }
      }
    });

    interactions.forEach((interaction) => {
      if (interaction?.type !== 'hand-trigger') return;
      if (getHandTriggerCardId(interaction) !== BURNING_STRIKE_CARD_ID) return;
      if (interaction.status !== 'resolved') return;
      if (!getHandTriggerUse(interaction)) return;
      if (interaction.beatIndex !== index) return;
      const hexes = Array.isArray(interaction.attackHexes) ? interaction.attackHexes : [];
      hexes.forEach((coord) => {
        addFireToken(coord, interaction.actorUserId, isCurrentBeat, true);
      });
    });

    interactions.forEach((interaction) => {
      if (interaction?.type !== HAVEN_PLATFORM_INTERACTION_TYPE) return;
      if (interaction?.status !== 'resolved') return;
      const consumedBeat = interaction?.resolution?.consumedBeatIndex;
      if (!Number.isFinite(consumedBeat) || Math.round(consumedBeat) !== index) return;
      const targetHex = getHavenTargetHex(interaction);
      if (!targetHex) return;
      removeEtherealPlatformToken(targetHex, isCurrentBeat);
    });

    const nextTokens = [];
    tokens.forEach((token) => {
      if (token.type !== ARROW_TOKEN_TYPE || !existingArrowIds.has(token.id)) {
        nextTokens.push(token);
        return;
      }
      const forward = applyFacingToVector(LOCAL_DIRECTIONS.F, token.facing ?? 0);
      const nextPosition = { q: token.position.q + forward.q, r: token.position.r + forward.r };
      const targetId = occupancy.get(coordKey(nextPosition));
      const removeToken = () => {
        if (!isCurrentBeat) {
          return;
        }
        tokenSteps.push({
          kind: 'token',
          tokenId: token.id,
          tokenType: token.type,
          facingAfter: token.facing,
          moveDestination: nextPosition,
          moveType: 'c',
          movePath: buildPathFromPositions(token.position, [nextPosition], nextPosition),
          attackOrigin: { q: token.position.q, r: token.position.r },
          attackTargets: [{ q: nextPosition.q, r: nextPosition.r }],
          damageChanges: [],
          positionChanges: [],
          hitTargets: [],
          removeToken: true,
        });
      };

      if (targetId) {
        applyArrowHit({
          token,
          nextPosition,
          targetId,
          forward,
          isCurrentBeat,
        });
        return;
      }

      const distance = getDistanceToLand(nextPosition, land);
      if (distance >= ARROW_LAND_DISTANCE_LIMIT) {
        removeToken();
        return;
      }

      if (isCurrentBeat) {
        tokenSteps.push({
          kind: 'token',
          tokenId: token.id,
          tokenType: token.type,
          facingAfter: token.facing,
          moveDestination: nextPosition,
          moveType: 'c',
          movePath: buildPathFromPositions(token.position, [nextPosition], nextPosition),
          attackOrigin: { q: token.position.q, r: token.position.r },
          attackTargets: [{ q: nextPosition.q, r: nextPosition.r }],
          damageChanges: [],
          positionChanges: [],
          hitTargets: [],
          removeToken: false,
        });
        return;
      }
      nextTokens.push({
        ...token,
        position: { q: nextPosition.q, r: nextPosition.r },
      });
    });

    if (!isCurrentBeat) {
      tokens.splice(0, tokens.length, ...nextTokens);
      applyBeatEntriesToState(beat);
      continue;
    }

    break;
  }

  return {
    baseTokens,
    tokenSpawnsByActor,
    tokenSpawnsAtEnd,
    tokenSteps,
  };
};

export const createTimelinePlayback = () => {
  let lastBeatIndex = null;
  let lastGameStamp = null;
  let playback = null;
  let characterPowersById = new Map();
  let scene = { characters: [], effects: [] };
  let status = {
    isCalculated: false,
    isAnimating: false,
    isComplete: true,
    elapsed: 0,
    duration: 0,
  };

  const buildPlayback = (gameState, beatIndex, now) => {
    const beats = gameState?.state?.public?.beats ?? [];
    const characters = gameState?.state?.public?.characters ?? [];
    const interactions = gameState?.state?.public?.customInteractions ?? [];
    const beat = beats[beatIndex] ?? [];
    const baseState = buildBaseState(beats, beatIndex, characters, interactions);
    const tokenPlayback = buildTokenPlayback(gameState, beatIndex, characterPowersById);
    const baseTokens = tokenPlayback?.baseTokens ?? [];

    if (!isBeatCalculated(beat)) {
      playback = null;
      scene = { characters: baseState, effects: [], boardTokens: baseTokens };
      status = {
        isCalculated: false,
        isAnimating: false,
        isComplete: true,
        elapsed: 0,
        duration: 0,
      };
      return;
    }

    const land = gameState?.state?.public?.land?.length ? gameState.state.public.land : LAND_HEXES;
    const { steps: characterSteps, persistentEffects } = buildActionSteps(
      beat,
      characters,
      baseState,
      interactions,
      beatIndex,
      land,
      characterPowersById,
    );
    const steps = characterSteps.map((step) => ({
      ...step,
      kind: 'character',
      tokenSpawns: tokenPlayback?.tokenSpawnsByActor?.get(step.actorId) ?? null,
    }));
    if (Array.isArray(tokenPlayback?.tokenSpawnsAtEnd) && tokenPlayback.tokenSpawnsAtEnd.length) {
      steps.push({
        kind: 'token',
        tokenSpawns: tokenPlayback.tokenSpawnsAtEnd,
      });
    }
    if (Array.isArray(tokenPlayback?.tokenSteps) && tokenPlayback.tokenSteps.length) {
      steps.push(...tokenPlayback.tokenSteps);
    }
    const stepDuration = steps.length ? ACTION_DURATION_MS / steps.length : 0;
    playback = {
      baseState,
      steps,
      stepDuration,
      startTime: now,
      persistentEffects,
      damagePreviewByStep: new Map(),
      baseTokens,
    };
    status = {
      isCalculated: true,
      isAnimating: stepDuration > 0 && steps.length > 0,
      isComplete: stepDuration <= 0 || steps.length === 0,
      elapsed: 0,
      duration: stepDuration * steps.length,
    };
    scene = { characters: baseState, effects: [], boardTokens: baseTokens };
  };

  const updateScene = (now) => {
    if (!playback) return;
    const { baseState, steps, stepDuration, startTime, persistentEffects, damagePreviewByStep, baseTokens } = playback;
    if (!steps.length || stepDuration <= 0) {
      const snapshotTokens = Array.isArray(baseTokens)
        ? baseTokens.map((token) => ({ ...token, position: { q: token.position.q, r: token.position.r } }))
        : [];
      scene = { characters: baseState, effects: [], boardTokens: snapshotTokens };
      status = {
        isCalculated: true,
        isAnimating: false,
        isComplete: true,
        elapsed: 0,
        duration: 0,
      };
      return;
    }
    const elapsed = Math.max(0, now - startTime);
    const totalDuration = stepDuration * steps.length;
    const clamped = Math.min(elapsed, totalDuration);
    status = {
      isCalculated: true,
      isAnimating: elapsed < totalDuration,
      isComplete: elapsed >= totalDuration,
      elapsed: clamped,
      duration: totalDuration,
    };
    const completed = Math.floor(clamped / stepDuration);
    const stepIndex = Math.min(completed, steps.length - 1);
    const stepProgress = Math.min(1, Math.max(0, (clamped - stepIndex * stepDuration) / stepDuration));

    let renderCharacters = baseState.map((character) => ({ ...character }));
    const tokenState = createTokenRenderState(baseTokens);

    const characterIndex = new Map();
    renderCharacters.forEach((character, index) => {
      characterIndex.set(character.userId, index);
      if (character.username) characterIndex.set(character.username, index);
    });

    const applyCharacterUpdate = (characterId, patch) => {
      const index = characterIndex.get(characterId);
      if (index == null) return;
      const current = renderCharacters[index];
      const next = { ...current, ...patch };
      if (patch.renderOffset) {
        const base = current.renderOffset ?? { x: 0, y: 0 };
        next.renderOffset = { x: base.x + patch.renderOffset.x, y: base.y + patch.renderOffset.y };
      } else if (current.renderOffset) {
        next.renderOffset = { ...current.renderOffset };
      }
      if (typeof patch.flashAlpha === 'number') {
        next.flashAlpha = Math.max(current.flashAlpha ?? 0, patch.flashAlpha);
      }
      if (typeof patch.healFlashAlpha === 'number') {
        next.healFlashAlpha = Math.max(current.healFlashAlpha ?? 0, patch.healFlashAlpha);
      }
      if (typeof patch.healPulseAlpha === 'number') {
        next.healPulseAlpha = Math.max(current.healPulseAlpha ?? 0, patch.healPulseAlpha);
      }
      if (typeof patch.healPulseScale === 'number') {
        const currentScale = typeof current.healPulseScale === 'number' ? current.healPulseScale : 1;
        next.healPulseScale = Math.max(currentScale, patch.healPulseScale);
      }
      renderCharacters[index] = next;
    };
    for (let i = 0; i < stepIndex; i += 1) {
      const step = steps[i];
      renderCharacters = applyStep(renderCharacters, step);
      if (step?.tokenSpawns) {
        tokenState.applyTokenSpawns(step.tokenSpawns);
      }
      if (step?.kind === 'token') {
        tokenState.applyTokenStep(step);
      }
    }

    const baseDamageById = new Map();
    renderCharacters.forEach((character) => {
      const baseDamage = typeof character.damage === 'number' ? character.damage : 0;
      baseDamageById.set(character.userId, baseDamage);
      if (character.username) baseDamageById.set(character.username, baseDamage);
    });

    const currentStep = steps[stepIndex];
    if (currentStep && stepProgress > 0) {
      renderCharacters = applyStep(renderCharacters, {
        ...currentStep,
        moveDestination: stepProgress >= 1 ? currentStep.moveDestination : null,
        damageChanges: stepProgress >= 1 ? currentStep.damageChanges : [],
        positionChanges: stepProgress >= 1 ? currentStep.positionChanges : [],
      });
    }

    const { alpha, easedProgress, swipeProgress, attackAlpha } = getSwipeState(stepProgress);
    const effects =
      currentStep?.effects?.map((effect) => {
        const baseAlpha =
          effect.type === 'attack' || effect.type === 'charge' ? attackAlpha : alpha;
        return { ...effect, alpha: baseAlpha };
      }) ?? [];
    const trailEffects = [];
    const arcEffects = [];
    const blockShake = new Map();

    const buildDamagePreview = (changes, baseDamageLookup) => {
      const preview = new Map();
      (changes ?? []).forEach((change) => {
        const index = characterIndex.get(change.targetId);
        if (index == null) return;
        const current = renderCharacters[index];
        const baseValue = baseDamageLookup?.get(change.targetId);
        const base = Number.isFinite(baseValue)
          ? baseValue
          : typeof current.damage === 'number'
            ? current.damage
            : 0;
        const existing = preview.get(change.targetId) ?? base;
        preview.set(change.targetId, existing + change.delta);
      });
      return preview;
    };

    if (currentStep && stepProgress > 0) {
      const { hitProgress, hitPulse, knockbackProgress, knockbackEase, isHitWindow } = getHitState(stepProgress);

      if (currentStep.movePath?.length && currentStep.moveType) {
        const partialPath = buildPartialPath(currentStep.movePath, easedProgress);
        const currentPosition = partialPath[partialPath.length - 1];
        if (currentStep.kind === 'token') {
          tokenState.applyTokenUpdate(currentStep.tokenId, { position: currentPosition });
        } else {
          applyCharacterUpdate(currentStep.actorId, { position: currentPosition });
        }
        trailEffects.push({
          type: 'trail',
          trailType: currentStep.moveType === 'j' ? 'jump' : 'move',
          path: partialPath,
          alpha: alpha * 0.85,
        });
      }

      if (currentStep.hitTargets?.length) {
        currentStep.hitTargets.forEach((hit) => {
          if (isHitWindow) {
            const seed = hashSeed(hit.targetId);
            const shake = getShakeOffset(hitProgress, hitPulse * 0.05, seed);
            applyCharacterUpdate(hit.targetId, { renderOffset: shake, flashAlpha: hitPulse * 0.8 });
          }
          if (hit.path?.length > 1 && knockbackProgress > 0) {
            const partialPath = buildPartialPath(hit.path, knockbackEase);
            const currentPosition = partialPath[partialPath.length - 1];
            applyCharacterUpdate(hit.targetId, { position: currentPosition });
            trailEffects.push({
              type: 'trail',
              trailType: 'knockback',
              path: partialPath,
              alpha: alpha * 0.9,
            });
          }
        });
      }

      if (currentStep.damageChanges?.length) {
        const healingPulse = Math.sin(stepProgress * Math.PI);
        if (healingPulse > 0) {
          currentStep.damageChanges.forEach((change) => {
            if (!change || change.delta >= 0) return;
            const healAlpha = healingPulse * 0.75;
            applyCharacterUpdate(change.targetId, {
              healFlashAlpha: healAlpha * 0.6,
              healPulseAlpha: healAlpha,
              healPulseScale: 1 + healingPulse * 0.35,
            });
          });
        }
      }

      if (currentStep.blockHits?.length) {
        currentStep.blockHits.forEach((hit) => {
          if (hit.directionIndex == null) return;
          const key = `${coordKey(hit.coord)}:${hit.directionIndex}`;
          const seed = hashSeed(key);
          blockShake.set(key, getShakeOffset(stepProgress, alpha * 0.08, seed));
        });
      }

      if (currentStep.attackTargets?.length && currentStep.attackOrigin) {
        arcEffects.push({
          type: 'attackArc',
          origin: currentStep.attackOrigin,
          targets: currentStep.attackTargets,
          alpha: attackAlpha * 0.95,
          progress: swipeProgress,
        });
      }

      if (isHitWindow && currentStep.damageChanges?.length && stepProgress < 1 && !damagePreviewByStep.has(stepIndex)) {
        damagePreviewByStep.set(stepIndex, buildDamagePreview(currentStep.damageChanges, baseDamageById));
      }
    }

    if (currentStep && stepProgress >= 1) {
      if (currentStep.tokenSpawns) {
        tokenState.applyTokenSpawns(currentStep.tokenSpawns);
      }
      if (currentStep.kind === 'token') {
        tokenState.applyTokenStep(currentStep);
      }
    }

    const previewedDamage = stepProgress < 1 ? damagePreviewByStep.get(stepIndex) : null;
    if (previewedDamage?.size) {
      previewedDamage.forEach((damageValue, targetId) => {
        const index = characterIndex.get(targetId);
        if (index == null) return;
        const current = renderCharacters[index];
        renderCharacters[index] = { ...current, displayDamage: damageValue };
      });
    }

    damagePreviewByStep.forEach((_, key) => {
      if (key < stepIndex) damagePreviewByStep.delete(key);
    });

    const blockEffects = (persistentEffects ?? []).map((effect) => {
      const key =
        effect.directionIndex != null && effect.coord
          ? `${coordKey(effect.coord)}:${effect.directionIndex}`
          : null;
      return {
        ...effect,
        alpha: 0.9,
        shakeOffset: key ? blockShake.get(key) : null,
      };
    });

    scene = {
      characters: renderCharacters,
      effects: [...trailEffects, ...effects, ...arcEffects, ...blockEffects],
      boardTokens: tokenState.renderTokens,
    };
  };

  return {
    setCharacterPowers(nextMap) {
      characterPowersById = nextMap instanceof Map ? nextMap : new Map();
      lastGameStamp = null;
      lastBeatIndex = null;
    },
    update(now, gameState, beatIndex) {
      const gameStamp = gameState?.updatedAt ?? beatsStamp(gameState);
      if (gameStamp !== lastGameStamp || beatIndex !== lastBeatIndex) {
        lastBeatIndex = beatIndex;
        lastGameStamp = gameStamp;
        buildPlayback(gameState, beatIndex, now);
      }
      updateScene(now);
    },
    getStatus() {
      return { ...status };
    },
    getScene() {
      return scene;
    },
  };
};

const beatsStamp = (gameState) => {
  const beats = gameState?.state?.public?.beats ?? [];
  return `${beats.length}:${beats.map((beat) => beat?.length ?? 0).join(',')}`;
};
