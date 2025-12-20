import { BeatEntry, CharacterState, HexCoord } from '../types';

const DEFAULT_ACTION = 'E';
const WAIT_ACTION = 'W';
const DAMAGE_ICON_ACTION = 'DamageIcon';
const ATTACK_DAMAGE = 3;
const KNOCKBACK_FACTOR = 2;
const KNOCKBACK_DIVISOR = 10;

const LOCAL_DIRECTIONS: Record<string, HexCoord> = {
  F: { q: 1, r: 0 },
  B: { q: -1, r: 0 },
  L: { q: 1, r: -1 },
  R: { q: 0, r: 1 },
  BL: { q: -1, r: 1 },
  BR: { q: 0, r: -1 },
};

const AXIAL_DIRECTIONS: HexCoord[] = [
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

const rotateAxialCW = (coord: HexCoord) => ({ q: -coord.r, r: coord.q + coord.r });

const rotateAxial = (coord: HexCoord, steps: number) => {
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

const applyFacingToVector = (vector: HexCoord, facing: number) => {
  const steps = getFacingRotationSteps(facing);
  return rotateAxial(vector, steps);
};

const coordKey = (coord: HexCoord) => `${coord.q},${coord.r}`;

const sameCoord = (a: HexCoord, b: HexCoord) => a.q === b.q && a.r === b.r;

const isForwardScale = (value: number) => Number.isFinite(value) && Math.round(value) === value && value > 0;

const getDirectionIndex = (delta: HexCoord) => {
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

const isWaitAction = (action: string) => {
  const trimmed = action.trim().toUpperCase();
  return !trimmed || trimmed === WAIT_ACTION || trimmed === DAMAGE_ICON_ACTION.toUpperCase();
};

const parseActionTokens = (action: string) => {
  const trimmed = action.trim();
  if (isWaitAction(trimmed)) return [];
  return trimmed
    .split('-')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const type = token[token.length - 1]?.toLowerCase() ?? '';
      const path = token.slice(0, -1);
      return { type, steps: parsePath(path) };
    })
    .filter((token) => token.type);
};

const buildPath = (origin: HexCoord, steps: Array<{ dir: string; distance: number }>, facing: number) => {
  const positions: HexCoord[] = [];
  let current = { ...origin };
  let lastStep: HexCoord | null = null;
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

type ExecutionState = { position: HexCoord; damage: number; facing: number };

const getKnockbackDistance = (damage: number) =>
  Math.max(1, Math.floor((damage * KNOCKBACK_FACTOR) / KNOCKBACK_DIVISOR));

const getKnockbackDirection = (origin: HexCoord, destination: HexCoord, lastStep: HexCoord | null) => {
  if (lastStep) return { q: lastStep.q, r: lastStep.r };
  const delta = { q: destination.q - origin.q, r: destination.r - origin.r };
  const directionIndex = getDirectionIndex(delta);
  return directionIndex == null ? null : AXIAL_DIRECTIONS[directionIndex];
};

const buildEntryForCharacter = (
  character: CharacterState,
  state: ExecutionState,
  entry?: Partial<BeatEntry[number]>,
  calculated = false,
): BeatEntry[number] => ({
  username: character.username,
  action: entry?.action ?? DEFAULT_ACTION,
  rotation: entry?.rotation ?? '',
  priority: typeof entry?.priority === 'number' ? entry.priority : 0,
  damage: state.damage,
  location: { q: state.position.q, r: state.position.r },
  facing: state.facing,
  calculated,
});

export const executeBeats = (beats: BeatEntry[], characters: CharacterState[]) => {
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

  const state = new Map<string, ExecutionState>();
  characters.forEach((character) => {
    state.set(character.userId, {
      position: { q: character.position.q, r: character.position.r },
      damage: 0,
      facing: normalizeDegrees(character.facing ?? 0),
    });
  });

  const normalizedBeats = beats.map((beat) => beat.map((entry) => ({ ...entry })));
  let lastCalculated = -1;
  const characterById = new Map<string, CharacterState>();
  characters.forEach((character) => {
    characterById.set(character.userId, character);
    characterById.set(character.username, character);
  });

  const getRosterIndex = (entry: BeatEntry[number]) => {
    const key = entry.username ?? '';
    const resolved = userLookup.get(key) ?? key;
    return rosterOrder.get(resolved) ?? rosterOrder.get(key) ?? Number.MAX_SAFE_INTEGER;
  };

  const applyStateToBeat = (beat: BeatEntry, calculated: boolean, fillMissing: boolean) => {
    if (!fillMissing) {
      beat.forEach((entry) => {
        const resolved = userLookup.get(entry.username) ?? entry.username;
        const current = resolved ? state.get(resolved) : undefined;
        if (current) {
          entry.location = { q: current.position.q, r: current.position.r };
          entry.damage = current.damage;
          entry.facing = current.facing;
        }
        entry.calculated = calculated;
      });
      beat.sort((a, b) => getRosterIndex(a) - getRosterIndex(b));
      return;
    }

    const seen = new Set<string>();
    const ordered: BeatEntry = [];
    characters.forEach((character) => {
      const entry = beat.find((item) => item.username === character.username || item.username === character.userId);
      const current = state.get(character.userId);
      if (!current) return;
      if (entry) {
        entry.location = { q: current.position.q, r: current.position.r };
        entry.damage = current.damage;
        entry.facing = current.facing;
        entry.calculated = calculated;
        ordered.push(entry);
        seen.add(character.userId);
      } else {
        ordered.push(buildEntryForCharacter(character, current, undefined, calculated));
        seen.add(character.userId);
      }
    });
    beat.forEach((entry) => {
      const resolved = userLookup.get(entry.username) ?? entry.username;
      if (!resolved || seen.has(resolved)) return;
      entry.calculated = calculated;
      ordered.push(entry);
    });
    beat.length = 0;
    ordered.forEach((entry) => beat.push(entry));
  };

  const ensureBeatIndex = (index: number) => {
    while (normalizedBeats.length <= index) {
      normalizedBeats.push([]);
    }
  };

  const upsertBeatEntry = (
    beat: BeatEntry,
    character: CharacterState,
    action: string,
    stateSnapshot: ExecutionState,
  ) => {
    const entry =
      beat.find((item) => item.username === character.username || item.username === character.userId) ?? null;
    if (entry) {
      entry.action = action;
      entry.rotation = '';
      entry.priority = 0;
      entry.damage = stateSnapshot.damage;
      entry.location = { q: stateSnapshot.position.q, r: stateSnapshot.position.r };
      entry.facing = stateSnapshot.facing;
      entry.calculated = false;
      return;
    }
    beat.push(
      buildEntryForCharacter(character, stateSnapshot, { action, rotation: '', priority: 0 }, false),
    );
  };

  const applyHitTimeline = (targetId: string, beatIndex: number, targetState: ExecutionState) => {
    const character = characterById.get(targetId);
    if (!character) return;
    const knockbackDistance = getKnockbackDistance(targetState.damage);
    const damageIcons = knockbackDistance + 1;
    const endIndex = beatIndex + damageIcons;
    ensureBeatIndex(endIndex);

    for (let i = beatIndex; i <= endIndex; i += 1) {
      const beat = normalizedBeats[i];
      if (!beat) continue;
      const action = i < endIndex ? DAMAGE_ICON_ACTION : DEFAULT_ACTION;
      upsertBeatEntry(beat, character, action, targetState);
    }

    for (let i = endIndex + 1; i < normalizedBeats.length; i += 1) {
      const beat = normalizedBeats[i];
      if (!beat?.length) continue;
      const filtered = beat.filter((entry) => entry.username !== character.username && entry.username !== character.userId);
      if (filtered.length !== beat.length) {
        normalizedBeats[i] = filtered;
      }
    }
  };

  for (let index = 0; index < normalizedBeats.length; index += 1) {
    const beat = normalizedBeats[index];
    const entriesByUser = new Map<string, BeatEntry[number]>();
    beat.forEach((entry) => {
      const resolved = userLookup.get(entry.username);
      if (resolved) {
        entriesByUser.set(resolved, entry);
      }
    });

    const allReady = characters.every((character) => {
      const entry = entriesByUser.get(character.userId);
      return entry && entry.action !== DEFAULT_ACTION;
    });

    if (!allReady) {
      for (let j = index; j < normalizedBeats.length; j += 1) {
        applyStateToBeat(normalizedBeats[j], false, false);
      }
      break;
    }

    const occupancy = new Map<string, string>();
    state.forEach((value, userId) => {
      occupancy.set(coordKey(value.position), userId);
    });
    const blockMap = new Map<string, Set<number>>();
    const disabledActors = new Set<string>();

    const ordered = beat
      .slice()
      .sort((a, b) => {
        const priorityDelta = (b.priority ?? 0) - (a.priority ?? 0);
        if (priorityDelta) return priorityDelta;
        const orderA = rosterOrder.get(a.username) ?? Number.MAX_SAFE_INTEGER;
        const orderB = rosterOrder.get(b.username) ?? Number.MAX_SAFE_INTEGER;
        return orderA - orderB;
      })
      .filter((entry) => entry.action !== DEFAULT_ACTION);

    ordered.forEach((entry) => {
      const actorId = userLookup.get(entry.username ?? '');
      if (!actorId) return;
      if (disabledActors.has(actorId)) return;
      const actorState = state.get(actorId);
      if (!actorState) return;

      const origin = { q: actorState.position.q, r: actorState.position.r };
      const rotationDelta = parseRotationDegrees(entry.rotation ?? '');
      actorState.facing = normalizeDegrees(actorState.facing + rotationDelta);

      const tokens = parseActionTokens(entry.action ?? '');
      tokens.forEach((token) => {
        const { positions, destination, lastStep } = buildPath(origin, token.steps, actorState.facing);
        const targetKey = coordKey(destination);
        const targetId = occupancy.get(targetKey);
        const delta = { q: origin.q - destination.q, r: origin.r - destination.r };
        const directionIndex =
          getDirectionIndex(delta) ??
          (lastStep ? getDirectionIndex({ q: -lastStep.q, r: -lastStep.r }) : null);

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

        const isBlocked =
          directionIndex != null &&
          blockMap.get(targetKey)?.has(directionIndex);

        if (token.type === 'a' || token.type === 'c') {
          if (targetId && !isBlocked) {
            const targetState = state.get(targetId);
            if (targetState) {
              targetState.damage += ATTACK_DAMAGE;
              const knockbackDirection = getKnockbackDirection(origin, destination, lastStep);
              const knockbackDistance = getKnockbackDistance(targetState.damage);
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
                }
                if (!sameCoord(finalPosition, targetState.position)) {
                  occupancy.delete(coordKey(targetState.position));
                  targetState.position = { q: finalPosition.q, r: finalPosition.r };
                  occupancy.set(coordKey(targetState.position), targetId);
                }
              }
              applyHitTimeline(targetId, index, targetState);
              disabledActors.add(targetId);
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
    });

    applyStateToBeat(beat, true, true);
    lastCalculated = index;
  }

  const updatedCharacters = characters.map((character) => ({
    ...character,
    position: { q: character.position.q, r: character.position.r },
  }));

  return { beats: normalizedBeats, characters: updatedCharacters, lastCalculated };
};
