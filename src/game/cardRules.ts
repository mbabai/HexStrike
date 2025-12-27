import { ActionSetItem, BeatEntry, CharacterState, CustomInteraction, HexCoord } from '../types';
import { CardCatalog, CardDefinition, CardType, DeckDefinition } from './cardCatalog';
import { getCharacterFirstEIndex, getTimelineEarliestEIndex } from './beatTimeline';

const ROTATION_LABELS = ['0', 'R1', 'R2', '3', 'L2', 'L1'];
const MAX_HAND_SIZE = 4;

interface CardUse {
  movementCardId: string;
  abilityCardId: string;
}

export interface PlayerDeckState {
  movement: string[];
  abilityHand: string[];
  abilityDeck: string[];
  exhaustedMovementIds: Set<string>;
  lastRefreshIndex: number | null;
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
}

export interface ActionValidationFailure {
  ok: false;
  error: { code: string; message: string };
}

export type ActionValidationResult = ActionValidationSuccess | ActionValidationFailure;

export const isActionValidationFailure = (
  result: ActionValidationResult,
): result is ActionValidationFailure => !result.ok;

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

const normalizeActionToken = (token: string) => {
  const trimmed = `${token ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const actionHasAttackToken = (action: string) => {
  if (!action) return false;
  return action
    .split('-')
    .map((token) => normalizeActionToken(token))
    .some((token) => {
      if (!token) return false;
      const type = token[token.length - 1]?.toLowerCase();
      return type === 'a' || type === 'c';
    });
};

const hasThrowInteraction = (text?: string) => {
  if (!text) return false;
  return /\{i\}\s*:\s*throw\b/i.test(text);
};

const getEntryForCharacter = (beat: BeatEntry, character: CharacterState) =>
  beat.find((entry) => entry.username === character.username || entry.username === character.userId) ?? null;

const drawAbilityCards = (deckState: PlayerDeckState) => {
  while (deckState.abilityHand.length < MAX_HAND_SIZE && deckState.abilityDeck.length) {
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
  const abilityHand = ability.slice(0, MAX_HAND_SIZE);
  const abilityDeck = ability.slice(MAX_HAND_SIZE);
  return {
    movement,
    abilityHand,
    abilityDeck,
    exhaustedMovementIds: new Set(),
    lastRefreshIndex: null,
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
  const supportsThrow = hasThrowInteraction(activeCard.activeText);
  const actionList: ActionSetItem[] = activeCard.actions.map((action, index) => ({
    action,
    rotation: index === 0 ? rotation : '',
    priority: activeCard.priority,
    interaction: supportsThrow && actionHasAttackToken(action) ? { type: 'throw' } : undefined,
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
  };
};

export const applyCardUse = (
  deckState: PlayerDeckState,
  cardUse: CardUse,
): { ok: boolean; error?: { code: string; message: string } } => {
  deckState.exhaustedMovementIds.add(cardUse.movementCardId);
  const abilityIndex = deckState.abilityHand.indexOf(cardUse.abilityCardId);
  if (abilityIndex !== -1) {
    const [usedAbility] = deckState.abilityHand.splice(abilityIndex, 1);
    if (usedAbility) deckState.abilityDeck.push(usedAbility);
  }
  deckState.lastRefreshIndex = null;
  return { ok: true };
};

export const resolveLandRefreshes = (
  deckStates: Map<string, PlayerDeckState>,
  beats: BeatEntry[],
  characters: CharacterState[],
  land: HexCoord[],
  interactions: CustomInteraction[] = [],
) => {
  if (!deckStates.size) return;
  if (interactions.some((interaction) => interaction.status === 'pending')) return;
  const earliestIndex = getTimelineEarliestEIndex(beats, characters);
  const characterById = new Map<string, CharacterState>();
  characters.forEach((character) => {
    characterById.set(character.userId, character);
    characterById.set(character.username, character);
  });

  deckStates.forEach((deckState, userId) => {
    const character = characterById.get(userId);
    if (!character) return;
    const firstEIndex = getCharacterFirstEIndex(beats, character);
    if (firstEIndex !== earliestIndex) return;
    if (deckState.lastRefreshIndex === firstEIndex) return;
    const beat = beats[firstEIndex];
    if (!beat) return;
    const entry = getEntryForCharacter(beat, character);
    if (!entry || entry.action !== 'E') return;
    const location = entry.location ?? character.position;
    const onLand = isCoordOnLand(location, land);
    if (!onLand) return;
    deckState.exhaustedMovementIds.clear();
    drawAbilityCards(deckState);
    deckState.lastRefreshIndex = firstEIndex;
  });
};
