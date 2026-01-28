import { BeatEntry, CustomInteraction, HexCoord, PublicCharacter } from '../types';
import { getTimelineResolvedIndex } from './beatTimeline';
import { DEFAULT_LAND_HEXES } from './hexGrid';

const DEFAULT_ACTION = 'E';
const LOG_PREFIX = '[execute]';
const WAIT_ACTION = 'W';
const COMBO_ACTION = 'CO';
const DAMAGE_ICON_ACTION = 'DamageIcon';
const KNOCKBACK_DIVISOR = 10;
const THROW_DISTANCE = 2;
// Keep in sync with cardRules/pendingActionPreview throw detection.
const ACTIVE_THROW_CARD_IDS = new Set(['hip-throw', 'tackle']);
const PASSIVE_THROW_CARD_IDS = new Set(['leap']);

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

const isWaitAction = (action: string) => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return true;
  const label = normalizeActionLabel(trimmed).toUpperCase();
  return label === WAIT_ACTION || label === DAMAGE_ICON_ACTION.toUpperCase() || label === COMBO_ACTION;
};

const isComboAction = (action: string) => normalizeActionLabel(action).toUpperCase() === COMBO_ACTION;

const normalizeActionToken = (token: string) => {
  const trimmed = token.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
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
      return { type, steps: parsePath(path) };
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

const buildInteractionId = (type: string, beatIndex: number, actorId: string, targetId: string) =>
  `${type}:${beatIndex}:${actorId}:${targetId}`;

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

export const executeBeats = (beats: BeatEntry[][], characters: PublicCharacter[], land?: HexCoord[]) =>
  executeBeatsWithInteractions(beats, characters, [], land);

export const executeBeatsWithInteractions = (
  beats: BeatEntry[][],
  characters: PublicCharacter[],
  interactions: CustomInteraction[] = [],
  land: HexCoord[] = DEFAULT_LAND_HEXES,
  comboAvailability?: Map<string, boolean>,
): { beats: BeatEntry[][]; characters: PublicCharacter[]; lastCalculated: number; interactions: CustomInteraction[] } => {
  const landTiles = Array.isArray(land) && land.length ? land : DEFAULT_LAND_HEXES;
  const comboAvailabilityByUser = comboAvailability ?? new Map<string, boolean>();
  const resolvedIndex = getTimelineResolvedIndex(beats);
  const isHistoryIndex = (index: number) => resolvedIndex >= 0 && index <= resolvedIndex;
  const resolveTerrain = (position: { q: number; r: number }) =>
    (isCoordOnLand(position, landTiles) ? 'land' : 'abyss') as 'land' | 'abyss';
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
  const pendingIndices: number[] = [];
  updatedInteractions.forEach((interaction) => {
    interactionById.set(interaction.id, interaction);
    if (interaction.status === 'pending' && Number.isFinite(interaction.beatIndex)) {
      pendingIndices.push(interaction.beatIndex);
    }
  });
  let haltIndex = pendingIndices.length ? Math.min(...pendingIndices) : null;
  const characterById = new Map<string, PublicCharacter>();
  characters.forEach((character) => {
    characterById.set(character.userId, character);
    characterById.set(character.username, character);
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
    });
    beat.sort((a, b) => getRosterIndex(a) - getRosterIndex(b));
  };

  const ensureBeatIndex = (index: number) => {
    while (normalizedBeats.length <= index) {
      normalizedBeats.push([]);
    }
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
        const entry = upsertBeatEntry(beat, character, DAMAGE_ICON_ACTION, targetState);
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

  const clearCharacterEntriesAfter = (character: PublicCharacter, startIndex: number) => {
    for (let i = startIndex + 1; i < normalizedBeats.length; i += 1) {
      const beat = normalizedBeats[i];
      if (!beat?.length) continue;
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

    characters.forEach((character) => {
      const actorId = character.userId;
      const entry = entriesByUser.get(actorId);
      const action = entry?.action ?? DEFAULT_ACTION;
      const previous = lastActionByUser.get(actorId) ?? DEFAULT_ACTION;
      const comboStart = previous === DEFAULT_ACTION || Boolean(entry?.comboStarter);
      if (action === DEFAULT_ACTION) {
        comboStates.delete(actorId);
      } else if (comboStart && !comboStates.has(actorId)) {
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

    const allReady = characters.every((character) => {
      const entry = entriesByUser.get(character.userId);
      return entry && entry.action !== DEFAULT_ACTION;
    });
    if (!allReady) {
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
    const blockMap = new Map<string, Set<number>>();
    const disabledActors = new Set<string>();
    const executedActors = new Set<string>();
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

    ordered.forEach((entry) => {
      const actorId = userLookup.get(resolveEntryKey(entry));
      if (!actorId) return;
      if (disabledActors.has(actorId)) return;
      const actorState = state.get(actorId);
      if (!actorState) return;
      const comboState = comboStates.get(actorId);
      if (comboState && isEntryThrow(entry)) {
        comboState.throwInteraction = true;
      }
      const origin = { q: actorState.position.q, r: actorState.position.r };

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

      const tokens = parseActionTokens(entry.action ?? '');
      const entryDamage = Number.isFinite(entry.attackDamage) ? entry.attackDamage : 0;
      const entryKbf = Number.isFinite(entry.attackKbf) ? entry.attackKbf : 0;

      tokens.forEach((token) => {
        const { positions, destination, lastStep } = buildPath(origin, token.steps, actorState.facing);
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
            const existing = blockMap.get(blockKey) ?? new Set<number>();
            existing.add(blockDirectionIndex);
            blockMap.set(blockKey, existing);
          }
          return;
        }

        const isBlocked = directionIndex != null && blockMap.get(targetKey)?.has(directionIndex);

        if (token.type === 'a' || token.type === 'c') {
          const isThrow = isEntryThrow(entry);
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
          if (targetId && (!isBlocked || isThrow)) {
            const targetState = state.get(targetId);
            if (targetState) {
              const targetCharacter = characterById.get(targetId);
              const targetEntry = targetCharacter ? findEntryForCharacter(beat, targetCharacter) : null;
              const preserveAction =
                executedActors.has(targetId) && (targetEntry?.action ?? DEFAULT_ACTION) !== DAMAGE_ICON_ACTION;
              if (isThrow) {
                const interactionId = buildInteractionId('throw', index, actorId, targetId);
                const existing = interactionById.get(interactionId);
                const resolvedDirection = getResolvedDirectionIndex(existing);
                if (existing?.status === 'resolved' && resolvedDirection != null) {
                  targetState.damage += entryDamage;
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
                  recordHitConsequence(targetId, index, targetState, entryDamage, knockedSteps);
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
                targetState.damage += entryDamage;
                const knockbackDirection = getKnockbackDirection(origin, destination, lastStep);
                const knockbackDistance = getKnockbackDistance(targetState.damage, entryKbf);
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
                const shouldStun = entryKbf === 1 || (entryKbf > 1 && knockbackDistance > 0);
                if (shouldStun) {
                  applyHitTimeline(targetId, index, targetState, knockedSteps, preserveAction);
                }
                recordHitConsequence(targetId, index, targetState, entryDamage, knockedSteps);
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
  };
};
