const DEFAULT_ACTION = 'E';
const WAIT_ACTION = 'W';
const DAMAGE_ICON_ACTION = 'DamageIcon';
const ATTACK_DAMAGE = 3;
const KNOCKBACK_FACTOR = 2;
const KNOCKBACK_DIVISOR = 10;
const ACTION_DURATION_MS = 600;

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

const coordKey = (coord) => `${coord.q},${coord.r}`;

const sameCoord = (a, b) => a.q === b.q && a.r === b.r;

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
  return !trimmed || trimmed === WAIT_ACTION || trimmed === DAMAGE_ICON_ACTION.toUpperCase();
};

const parseActionTokens = (action) => {
  const trimmed = `${action ?? ''}`.trim();
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

const getKnockbackDistance = (damage) =>
  Math.max(1, Math.floor((damage * KNOCKBACK_FACTOR) / KNOCKBACK_DIVISOR));

const getKnockbackDirection = (origin, destination, lastStep) => {
  if (lastStep) return { q: lastStep.q, r: lastStep.r };
  const delta = { q: destination.q - origin.q, r: destination.r - origin.r };
  const directionIndex = getDirectionIndex(delta);
  return directionIndex == null ? null : AXIAL_DIRECTIONS[directionIndex];
};

const getEntryForCharacter = (beat, character) => {
  if (!Array.isArray(beat) || !character) return null;
  return beat.find((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    return entry.username === character.username || entry.username === character.userId;
  }) || null;
};

const buildBaseState = (beat, characters) => {
  return characters.map((character) => {
    const entry = getEntryForCharacter(beat, character);
    return {
      ...character,
      position: entry?.location ?? { q: character.position.q, r: character.position.r },
      facing: Number.isFinite(entry?.facing) ? entry.facing : normalizeDegrees(character.facing ?? 0),
      damage: typeof entry?.damage === 'number' ? entry.damage : 0,
    };
  });
};

const isBeatCalculated = (beat) =>
  Array.isArray(beat) && beat.length && beat.every((entry) => entry && entry.calculated);

const buildActionSteps = (beat, characters, baseState) => {
  const rosterOrder = new Map();
  characters.forEach((character, index) => {
    rosterOrder.set(character.userId, index);
    rosterOrder.set(character.username, index);
  });

  const userLookup = new Map();
  characters.forEach((character) => {
    userLookup.set(character.userId, character.userId);
    userLookup.set(character.username, character.userId);
  });

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
    .filter((entry) => entry && entry.action !== DEFAULT_ACTION);

  const steps = [];
  const persistentEffects = [];

  ordered.forEach((entry) => {
    const actorId = userLookup.get(entry.username);
    if (!actorId) return;
    if (disabledActors.has(actorId)) return;
    const actorState = state.get(actorId);
    if (!actorState) return;

    const origin = { q: actorState.position.q, r: actorState.position.r };
    const rotationDelta = parseRotationDegrees(entry.rotation ?? '');
    actorState.facing = normalizeDegrees(actorState.facing + rotationDelta);

    const effects = [];
    const damageChanges = [];
    const positionChanges = [];
    let moveDestination = null;
    let moveType = null;

    const tokens = parseActionTokens(entry.action ?? '');
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
      }
      if (token.type === 'm') {
        effects.push({ type: 'move', coord: destination });
      }
      if (token.type === 'j') {
        effects.push({ type: 'jump', coord: destination });
      }
      if (token.type === 'c') {
        effects.push({ type: 'charge', coord: destination });
      }

      const isBlocked =
        directionIndex != null &&
        blockMap.get(targetKey)?.has(directionIndex);

      if (token.type === 'a' || token.type === 'c') {
        if (targetId && !isBlocked) {
          const targetState = state.get(targetId);
          if (targetState) {
            targetState.damage += ATTACK_DAMAGE;
            damageChanges.push({ targetId, delta: ATTACK_DAMAGE });
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
                positionChanges.push({ targetId, position: { ...targetState.position } });
              }
            }
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
          moveDestination = { q: finalPosition.q, r: finalPosition.r };
          moveType = token.type;
        }
      }

      if (token.type === 'j') {
        if (!targetId || targetId === actorId) {
          occupancy.delete(coordKey(actorState.position));
          actorState.position = { q: destination.q, r: destination.r };
          occupancy.set(coordKey(actorState.position), actorId);
          moveDestination = { q: destination.q, r: destination.r };
          moveType = token.type;
        }
      }
    });

    steps.push({
      actorId,
      facingAfter: actorState.facing,
      moveDestination,
      moveType,
      damageChanges,
      positionChanges,
      effects,
    });
  });

  return { steps, persistentEffects };
};

const applyStep = (characters, step) => {
  const updated = characters.map((character) => {
    if (character.userId !== step.actorId) return character;
    const next = { ...character, facing: step.facingAfter };
    if (step.moveDestination) {
      next.position = { q: step.moveDestination.q, r: step.moveDestination.r };
    }
    return next;
  });

  step.damageChanges.forEach((change) => {
    const index = updated.findIndex((character) => character.userId === change.targetId);
    if (index >= 0) {
      const target = updated[index];
      updated[index] = { ...target, damage: (target.damage ?? 0) + change.delta };
    }
  });

  step.positionChanges.forEach((change) => {
    const index = updated.findIndex((character) => character.userId === change.targetId);
    if (index >= 0) {
      const target = updated[index];
      updated[index] = { ...target, position: { q: change.position.q, r: change.position.r } };
    }
  });

  return updated;
};

export const createTimelinePlayback = () => {
  let lastBeatIndex = null;
  let lastGameStamp = null;
  let playback = null;
  let scene = { characters: [], effects: [] };

  const buildPlayback = (gameState, beatIndex, now) => {
    const beats = gameState?.state?.public?.beats ?? [];
    const characters = gameState?.state?.public?.characters ?? [];
    const beat = beats[beatIndex] ?? [];
    const priorBeat = beatIndex > 0 ? beats[beatIndex - 1] : null;
    const baseState = buildBaseState(priorBeat, characters);

    if (!isBeatCalculated(beat)) {
      playback = null;
      scene = { characters: baseState, effects: [] };
      return;
    }

    const { steps, persistentEffects } = buildActionSteps(beat, characters, baseState);
    const stepDuration = steps.length ? ACTION_DURATION_MS / steps.length : 0;
    playback = { baseState, steps, stepDuration, startTime: now, persistentEffects };
    scene = { characters: baseState, effects: [] };
  };

  const updateScene = (now) => {
    if (!playback) return;
    const { baseState, steps, stepDuration, startTime, persistentEffects } = playback;
    if (!steps.length || stepDuration <= 0) {
      scene = { characters: baseState, effects: [] };
      return;
    }
    const elapsed = Math.max(0, now - startTime);
    const totalDuration = stepDuration * steps.length;
    const clamped = Math.min(elapsed, totalDuration);
    const completed = Math.floor(clamped / stepDuration);
    const stepIndex = Math.min(completed, steps.length - 1);
    const stepProgress = Math.min(1, Math.max(0, (clamped - stepIndex * stepDuration) / stepDuration));

    let renderCharacters = baseState.map((character) => ({ ...character }));
    for (let i = 0; i < stepIndex; i += 1) {
      renderCharacters = applyStep(renderCharacters, steps[i]);
    }

    const currentStep = steps[stepIndex];
    if (currentStep && stepProgress > 0) {
      renderCharacters = applyStep(renderCharacters, {
        ...currentStep,
        moveDestination: stepProgress >= 1 ? currentStep.moveDestination : null,
        damageChanges: stepProgress >= 1 ? currentStep.damageChanges : [],
        positionChanges: stepProgress >= 1 ? currentStep.positionChanges : [],
      });
    }

    const alpha = Math.sin(stepProgress * Math.PI);
    const effects = currentStep?.effects?.map((effect) => ({ ...effect, alpha })) ?? [];
    const blockEffects = (persistentEffects ?? []).map((effect) => ({ ...effect, alpha: 0.9 }));
    scene = { characters: renderCharacters, effects: [...blockEffects, ...effects] };
  };

  return {
    update(now, gameState, beatIndex) {
      const gameStamp = gameState?.updatedAt ?? beatsStamp(gameState);
      if (gameStamp !== lastGameStamp || beatIndex !== lastBeatIndex) {
        lastBeatIndex = beatIndex;
        lastGameStamp = gameStamp;
        buildPlayback(gameState, beatIndex, now);
      }
      updateScene(now);
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
