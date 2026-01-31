import { CardValidationError, DeckState } from '../types';

// Baseline ability refresh size + movement hand cap.
export const MAX_HAND_SIZE = 4;

type HandSyncMode = 'auto' | 'strict';

export interface MovementHandSyncOptions {
  restoreIds?: string[];
  discardIds?: string[];
  mode?: HandSyncMode;
}

export type MovementHandSyncResult =
  | {
      ok: true;
      targetSize: number;
      movementHandSize: number;
      restored: string[];
      discarded: string[];
    }
  | {
      ok: false;
      error: CardValidationError;
    };

export type AbilityDrawResult =
  | { ok: true; drawn: string[]; movement: Extract<MovementHandSyncResult, { ok: true }> }
  | { ok: false; error: CardValidationError };

export type AbilityDiscardResult =
  | { ok: true; discarded: string[]; movement: Extract<MovementHandSyncResult, { ok: true }> }
  | { ok: false; error: CardValidationError };

const normalizeCardId = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}`;
  }
  return null;
};

const normalizeIdList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  value.forEach((item) => {
    const id = normalizeCardId(item);
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
};

export const getTargetMovementHandSize = (abilityCount: number): number => {
  const safeCount = Number.isFinite(abilityCount) ? Math.max(0, Math.floor(abilityCount)) : 0;
  return safeCount > MAX_HAND_SIZE ? MAX_HAND_SIZE : safeCount;
};

export const getMovementHandIds = (deckState: DeckState): string[] =>
  deckState.movement.filter((id) => !deckState.exhaustedMovementIds.has(id));

export const getDiscardRequirements = (
  deckState: DeckState,
  discardCount: number,
): { abilityDiscardCount: number; movementDiscardCount: number } => {
  const abilityCount = Array.isArray(deckState?.abilityHand) ? deckState.abilityHand.length : 0;
  const abilityDiscardCount = Math.min(Math.max(0, Math.floor(discardCount || 0)), abilityCount);
  const abilityAfter = abilityCount - abilityDiscardCount;
  const targetMovementSize = getTargetMovementHandSize(abilityAfter);
  const movementCount = getMovementHandIds(deckState).length;
  const movementDiscardCount = Math.max(0, movementCount - targetMovementSize);
  return { abilityDiscardCount, movementDiscardCount };
};

export const syncMovementHand = (
  deckState: DeckState,
  options: MovementHandSyncOptions = {},
): MovementHandSyncResult => {
  const mode: HandSyncMode = options.mode ?? 'auto';
  const movementIds = Array.isArray(deckState.movement) ? deckState.movement : [];
  const movementSet = new Set(movementIds);
  const exhausted = deckState.exhaustedMovementIds;
  const targetSize = getTargetMovementHandSize(deckState.abilityHand.length);
  const inHand = getMovementHandIds(deckState);
  let currentSize = inHand.length;
  const restored: string[] = [];
  const discarded: string[] = [];

  const restoreIds = normalizeIdList(options.restoreIds).filter((id) => movementSet.has(id));
  const discardIds = normalizeIdList(options.discardIds).filter((id) => movementSet.has(id));

  if (currentSize < targetSize) {
    const needed = targetSize - currentSize;
    const validRestore = restoreIds.filter((id) => exhausted.has(id));
    if (mode === 'strict') {
      if (validRestore.length !== restoreIds.length) {
        return { ok: false, error: { code: 'movement-restore-invalid', message: 'Invalid movement restore selection.' } };
      }
      if (validRestore.length !== needed) {
        return { ok: false, error: { code: 'movement-restore-required', message: 'Movement restore selection required.' } };
      }
    }
    validRestore.slice(0, needed).forEach((id) => {
      exhausted.delete(id);
      restored.push(id);
      currentSize += 1;
    });
    if (currentSize < targetSize) {
      if (mode === 'strict') {
        return { ok: false, error: { code: 'movement-restore-required', message: 'Movement restore selection required.' } };
      }
      movementIds.forEach((id) => {
        if (currentSize >= targetSize) return;
        if (!exhausted.has(id)) return;
        exhausted.delete(id);
        restored.push(id);
        currentSize += 1;
      });
    }
  } else if (currentSize > targetSize) {
    const excess = currentSize - targetSize;
    const validDiscard = discardIds.filter((id) => !exhausted.has(id));
    if (mode === 'strict') {
      if (validDiscard.length !== discardIds.length) {
        return { ok: false, error: { code: 'movement-discard-invalid', message: 'Invalid movement discard selection.' } };
      }
      if (validDiscard.length !== excess) {
        return { ok: false, error: { code: 'movement-discard-required', message: 'Movement discard selection required.' } };
      }
    }
    validDiscard.slice(0, excess).forEach((id) => {
      exhausted.add(id);
      discarded.push(id);
      currentSize -= 1;
    });
    if (currentSize > targetSize) {
      if (mode === 'strict') {
        return { ok: false, error: { code: 'movement-discard-required', message: 'Movement discard selection required.' } };
      }
      for (let i = movementIds.length - 1; i >= 0 && currentSize > targetSize; i -= 1) {
        const id = movementIds[i];
        if (exhausted.has(id)) continue;
        exhausted.add(id);
        discarded.push(id);
        currentSize -= 1;
      }
    }
  }

  return { ok: true, targetSize, movementHandSize: currentSize, restored, discarded };
};

export const isMovementHandSyncFailure = (
  result: MovementHandSyncResult,
): result is { ok: false; error: CardValidationError } => !result.ok;

export const isAbilityDiscardFailure = (
  result: AbilityDiscardResult,
): result is { ok: false; error: CardValidationError } => !result.ok;

export const drawAbilityCards = (
  deckState: DeckState,
  count: number,
  options: { restoreMovementIds?: string[]; mode?: HandSyncMode } = {},
): AbilityDrawResult => {
  const drawCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const drawn: string[] = [];
  for (let i = 0; i < drawCount && deckState.abilityDeck.length; i += 1) {
    const next = deckState.abilityDeck.shift();
    if (next) {
      deckState.abilityHand.push(next);
      drawn.push(next);
    }
  }
  const movementResult = syncMovementHand(deckState, {
    restoreIds: options.restoreMovementIds,
    mode: options.mode,
  });
  if (isMovementHandSyncFailure(movementResult)) {
    return { ok: false, error: movementResult.error };
  }
  return { ok: true, drawn, movement: movementResult };
};

export const discardAbilityCards = (
  deckState: DeckState,
  abilityIds: unknown,
  options: { discardMovementIds?: string[]; mode?: HandSyncMode } = {},
): AbilityDiscardResult => {
  const ids = normalizeIdList(abilityIds);
  const missing = ids.filter((id) => !deckState.abilityHand.includes(id));
  if (missing.length) {
    return { ok: false, error: { code: 'ability-not-in-hand', message: 'Ability card not in hand.' } };
  }
  ids.forEach((id) => {
    const index = deckState.abilityHand.indexOf(id);
    if (index === -1) return;
    const [removed] = deckState.abilityHand.splice(index, 1);
    if (removed) deckState.abilityDeck.push(removed);
  });
  const movementResult = syncMovementHand(deckState, {
    discardIds: options.discardMovementIds,
    mode: options.mode,
  });
  if (isMovementHandSyncFailure(movementResult)) {
    return { ok: false, error: movementResult.error };
  }
  return { ok: true, discarded: ids, movement: movementResult };
};
