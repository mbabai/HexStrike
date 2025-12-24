import { ActionSetItem, BeatEntry, CharacterState, HexCoord } from '../types';
import { CardCatalog, CardDefinition, CardType, DeckDefinition } from './cardCatalog';
import { getTimelineEarliestEIndex } from './beatTimeline';

const ROTATION_LABELS = ['0', 'R1', 'R2', '3', 'L2', 'L1'];

export interface PendingRefresh {
  beatIndex: number;
  movementCardId: string;
  abilityCardId: string;
}

export interface PlayerDeckState {
  movement: string[];
  abilityHand: string[];
  abilityDeck: string[];
  exhaustedMovementIds: Set<string>;
  exhaustedAbilityIds: Set<string>;
  pendingRefresh?: PendingRefresh;
}

export interface DeckParseResult {
  deck: DeckDefinition | null;
  errors: Array<{ code: string; message: string }>;
}

export interface ActionValidationSuccess {
  ok: true;
  actionList: ActionSetItem[];
  movementCardId: string;
  abilityCardId: string;
  refreshOffset: number;
}

export interface ActionValidationFailure {
  ok: false;
  error: { code: string; message: string };
}

export type ActionValidationResult = ActionValidationSuccess | ActionValidationFailure;

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

const normalizeRotationLabel = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') {
    return `${value}`.trim();
  }
  return '';
};

const getRotationMagnitude = (label: string | null): number | null => {
  const value = `${label ?? ''}`.trim().toUpperCase();
  if (value === '0') return 0;
  if (value === '3') return 3;
  if (value.startsWith('L') || value.startsWith('R')) {
    const amount = Number(value.slice(1));
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
};

const buildAllowedRotationSet = (restriction: string) => {
  const trimmed = `${restriction ?? ''}`.trim();
  if (!trimmed || trimmed === '*') return null;
  const [minRaw, maxRaw] = trimmed.split('-');
  const min = Number(minRaw);
  const max = Number(maxRaw);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const allowed = new Set<string>();
  ROTATION_LABELS.forEach((label) => {
    const magnitude = getRotationMagnitude(label);
    if (magnitude === null) return;
    if (magnitude >= min && magnitude <= max) {
      allowed.add(label);
    }
  });
  return allowed;
};

const isRotationAllowed = (rotation: string, card: CardDefinition) => {
  if (!rotation) return false;
  if (!ROTATION_LABELS.includes(rotation)) return false;
  const allowed = buildAllowedRotationSet(card.rotations);
  return !allowed || allowed.has(rotation);
};

const buildCoordKey = (coord: HexCoord | null | undefined): string | null => {
  if (!coord) return null;
  const q = Number(coord.q);
  const r = Number(coord.r);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  return `${Math.round(q)},${Math.round(r)}`;
};

const isCoordOnLand = (location: HexCoord | null | undefined, land: HexCoord[]): boolean => {
  if (!location || !Array.isArray(land) || !land.length) return false;
  const key = buildCoordKey(location);
  if (!key) return false;
  return land.some((tile) => buildCoordKey(tile) === key);
};

const getEntryForCharacter = (beat: BeatEntry, character: CharacterState) =>
  beat.find((entry) => entry.username === character.username || entry.username === character.userId) ?? null;

const drawAbilityCards = (deckState: PlayerDeckState) => {
  while (deckState.abilityHand.length < 4 && deckState.abilityDeck.length) {
    const next = deckState.abilityDeck.shift();
    if (next) deckState.abilityHand.push(next);
  }
};

const normalizeDeckList = (
  raw: unknown,
  catalog: CardCatalog,
  type: CardType,
  errors: Array<{ code: string; message: string }>,
) => {
  const items = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const ids: string[] = [];
  items.forEach((item) => {
    const id = normalizeCardId(item);
    if (!id) return;
    if (seen.has(id)) {
      errors.push({ code: 'duplicate-card', message: `Duplicate ${type} card ${id}.` });
      return;
    }
    const card = catalog.cardsById.get(id);
    if (!card) {
      errors.push({ code: 'unknown-card', message: `Unknown card ${id}.` });
      return;
    }
    if (card.type !== type) {
      errors.push({ code: 'invalid-card-type', message: `Card ${id} is not a ${type} card.` });
      return;
    }
    seen.add(id);
    ids.push(id);
  });
  return ids;
};

export const parseDeckDefinition = (deck: unknown, catalog: CardCatalog): DeckParseResult => {
  const errors: Array<{ code: string; message: string }> = [];
  if (!deck || typeof deck !== 'object') {
    return { deck: null, errors: [{ code: 'missing-deck', message: 'Deck payload is missing.' }] };
  }
  const movement = normalizeDeckList((deck as DeckDefinition).movement, catalog, 'movement', errors);
  const ability = normalizeDeckList((deck as DeckDefinition).ability, catalog, 'ability', errors);
  if (!movement.length) {
    errors.push({ code: 'missing-movement', message: 'Deck has no movement cards.' });
  }
  if (!ability.length) {
    errors.push({ code: 'missing-ability', message: 'Deck has no ability cards.' });
  }
  return { deck: { movement, ability }, errors };
};

export const buildDefaultDeckDefinition = (catalog: CardCatalog): DeckDefinition => ({
  movement: catalog.movement.map((card) => card.id),
  ability: catalog.ability.map((card) => card.id),
});

export const createDeckState = (deck: DeckDefinition): PlayerDeckState => {
  const movement = Array.isArray(deck.movement) ? deck.movement.map((id) => `${id}`) : [];
  const ability = Array.isArray(deck.ability) ? deck.ability.map((id) => `${id}`) : [];
  const abilityHand = ability.slice(0, 4);
  const abilityDeck = ability.slice(4);
  return {
    movement,
    abilityHand,
    abilityDeck,
    exhaustedMovementIds: new Set(),
    exhaustedAbilityIds: new Set(),
    pendingRefresh: undefined,
  };
};

export const getRefreshOffset = (actions: string[]): number | null => {
  if (!Array.isArray(actions) || !actions.length) return null;
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    const label = `${actions[i] ?? ''}`.trim();
    if (label === 'E') return i;
  }
  return Math.max(0, actions.length - 1);
};

export const validateActionSubmission = (
  submission: { activeCardId?: unknown; passiveCardId?: unknown; rotation?: unknown },
  deckState: PlayerDeckState,
  catalog: CardCatalog,
): ActionValidationResult => {
  const activeCardId = normalizeCardId(submission.activeCardId);
  const passiveCardId = normalizeCardId(submission.passiveCardId);
  if (!activeCardId || !passiveCardId) {
    return { ok: false, error: { code: 'missing-card', message: 'Active and passive card IDs are required.' } };
  }
  if (activeCardId === passiveCardId) {
    return { ok: false, error: { code: 'invalid-card-pair', message: 'Active and passive cards must differ.' } };
  }
  const activeCard = catalog.cardsById.get(activeCardId);
  const passiveCard = catalog.cardsById.get(passiveCardId);
  if (!activeCard || !passiveCard) {
    return { ok: false, error: { code: 'unknown-card', message: 'Unknown card ID submitted.' } };
  }
  if (activeCard.type === passiveCard.type) {
    return { ok: false, error: { code: 'invalid-card-pair', message: 'Active/passive cards must be different types.' } };
  }
  const movementCardId = activeCard.type === 'movement' ? activeCard.id : passiveCard.id;
  const abilityCardId = activeCard.type === 'ability' ? activeCard.id : passiveCard.id;
  if (!deckState.movement.includes(movementCardId)) {
    return { ok: false, error: { code: 'card-unavailable', message: 'Movement card not in deck.' } };
  }
  if (!deckState.abilityHand.includes(abilityCardId)) {
    return { ok: false, error: { code: 'card-unavailable', message: 'Ability card not in hand.' } };
  }
  if (deckState.exhaustedMovementIds.has(movementCardId)) {
    return { ok: false, error: { code: 'card-exhausted', message: 'Movement card is exhausted.' } };
  }
  if (deckState.exhaustedAbilityIds.has(abilityCardId)) {
    return { ok: false, error: { code: 'card-exhausted', message: 'Ability card is exhausted.' } };
  }

  const rotation = normalizeRotationLabel(submission.rotation);
  if (!rotation) {
    return { ok: false, error: { code: 'rotation-missing', message: 'Rotation selection is required.' } };
  }
  if (!isRotationAllowed(rotation, activeCard)) {
    return { ok: false, error: { code: 'rotation-invalid', message: 'Rotation is not allowed for this card.' } };
  }

  if (!activeCard.actions.length) {
    return { ok: false, error: { code: 'no-action-list', message: 'Active card has no actions.' } };
  }
  const actionList: ActionSetItem[] = activeCard.actions.map((action, index) => ({
    action,
    rotation: index === 0 ? rotation : '',
    priority: activeCard.priority,
  }));
  const refreshOffset = getRefreshOffset(activeCard.actions);
  if (refreshOffset === null) {
    return { ok: false, error: { code: 'no-refresh', message: 'Active card has no refresh step.' } };
  }
  return {
    ok: true,
    actionList,
    movementCardId,
    abilityCardId,
    refreshOffset,
  };
};

export const applyPendingUse = (
  deckState: PlayerDeckState,
  pending: PendingRefresh,
): { ok: boolean; error?: { code: string; message: string } } => {
  if (deckState.pendingRefresh) {
    return { ok: false, error: { code: 'pending-refresh', message: 'Pending refresh is already active.' } };
  }
  deckState.exhaustedMovementIds.add(pending.movementCardId);
  deckState.exhaustedAbilityIds.add(pending.abilityCardId);
  deckState.pendingRefresh = pending;
  return { ok: true };
};

export const resolvePendingRefreshes = (
  deckStates: Map<string, PlayerDeckState>,
  beats: BeatEntry[],
  characters: CharacterState[],
  land: HexCoord[],
) => {
  if (!deckStates.size) return;
  const earliestIndex = getTimelineEarliestEIndex(beats, characters);
  const characterById = new Map<string, CharacterState>();
  characters.forEach((character) => {
    characterById.set(character.userId, character);
    characterById.set(character.username, character);
  });

  deckStates.forEach((deckState, userId) => {
    const pending = deckState.pendingRefresh;
    if (!pending || pending.beatIndex !== earliestIndex) return;
    const character = characterById.get(userId);
    if (!character) return;
    const beat = beats[pending.beatIndex];
    if (!beat) return;
    const entry = getEntryForCharacter(beat, character);
    if (!entry || entry.action !== 'E') return;
    const location = entry.location ?? character.position;
    const onLand = isCoordOnLand(location, land);

    const abilityIndex = deckState.abilityHand.indexOf(pending.abilityCardId);
    if (abilityIndex !== -1) {
      const [usedAbility] = deckState.abilityHand.splice(abilityIndex, 1);
      if (usedAbility) deckState.abilityDeck.push(usedAbility);
    }
    deckState.exhaustedAbilityIds.delete(pending.abilityCardId);
    if (onLand) {
      deckState.exhaustedMovementIds.clear();
      drawAbilityCards(deckState);
    }
    deckState.pendingRefresh = undefined;
  });
};
