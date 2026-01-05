import {
  ActionListItem,
  ActionSubmission,
  ActionValidationResult,
  CardCatalog,
  CardUse,
  CardValidationError,
  DeckDefinition,
  DeckState,
  PlayerCardState,
  PublicCharacter,
  BeatEntry,
  HexCoord,
  CustomInteraction,
  PendingActions,
} from '../types';
import { getCharacterFirstEIndex, getCharacterLocationAtIndex, getTimelineEarliestEIndex } from './beatTimeline';

const ROTATION_LABELS = ['0', 'R1', 'R2', '3', 'L2', 'L1'];
const MAX_HAND_SIZE = 4;

export const isActionValidationFailure = (result: ActionValidationResult): result is { ok: false; error: CardValidationError } =>
  !result.ok;

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

const getRotationMagnitude = (label: string): number | null => {
  const value = `${label ?? ''}`.trim().toUpperCase();
  if (value === '0') return 0;
  if (value === '3') return 3;
  if (value.startsWith('L') || value.startsWith('R')) {
    const amount = Number(value.slice(1));
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
};

const buildAllowedRotationSet = (restriction: string | undefined): Set<string> | null => {
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

const isRotationAllowed = (rotation: string, card: { rotations: string }): boolean => {
  if (!rotation) return false;
  if (!ROTATION_LABELS.includes(rotation)) return false;
  const allowed = buildAllowedRotationSet(card.rotations);
  return !allowed || allowed.has(rotation);
};

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

const normalizeActionToken = (token: string) => {
  const trimmed = `${token ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const actionHasAttackToken = (action: string): boolean => {
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

const hasThrowInteraction = (text: string | undefined): boolean => {
  if (!text) return false;
  return /\{i\}\s*:\s*throw\b/i.test(text);
};

const getEntryForCharacter = (beat: BeatEntry[], character: PublicCharacter): BeatEntry | null =>
  beat.find((entry) => {
    if (!entry) return false;
    const key = entry.username ?? entry.userId ?? entry.userID;
    return key === character.username || key === character.userId;
  }) ?? null;

const drawAbilityCards = (deckState: DeckState) => {
  while (deckState.abilityHand.length < MAX_HAND_SIZE && deckState.abilityDeck.length) {
    const next = deckState.abilityDeck.shift();
    if (next) deckState.abilityHand.push(next);
  }
};

const normalizeDeckList = (
  raw: unknown,
  catalog: CardCatalog,
  type: 'movement' | 'ability',
  errors: CardValidationError[],
): string[] => {
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

export const parseDeckDefinition = (
  deck: unknown,
  catalog: CardCatalog,
): { deck: DeckDefinition | null; errors: CardValidationError[] } => {
  const errors: CardValidationError[] = [];
  if (!deck || typeof deck !== 'object') {
    return { deck: null, errors: [{ code: 'missing-deck', message: 'Deck payload is missing.' }] };
  }
  const raw = deck as Record<string, unknown>;
  const movement = normalizeDeckList(raw.movement, catalog, 'movement', errors);
  const ability = normalizeDeckList(raw.ability, catalog, 'ability', errors);
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

export const createDeckState = (deck: DeckDefinition): DeckState => {
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
    activeCardId: null,
    passiveCardId: null,
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
  submission: ActionSubmission,
  deckState: DeckState,
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
  const attackDamage = Number.isFinite(activeCard.damage) ? activeCard.damage : 0;
  const attackKbf = Number.isFinite(activeCard.kbf) ? activeCard.kbf : 0;
  const actionList: ActionListItem[] = activeCard.actions.map((action, index) => ({
    action,
    rotation: index === 0 ? rotation : '',
    priority: activeCard.priority,
    interaction: supportsThrow && actionHasAttackToken(action) ? { type: 'throw' } : undefined,
    damage: attackDamage,
    kbf: attackKbf,
    cardId: activeCard.id,
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

export const applyCardUse = (deckState: DeckState, cardUse: CardUse): { ok: true } | { ok: false; error: CardValidationError } => {
  deckState.activeCardId = cardUse.activeCardId ?? deckState.activeCardId ?? null;
  deckState.passiveCardId = cardUse.passiveCardId ?? deckState.passiveCardId ?? null;
  deckState.exhaustedMovementIds.add(cardUse.movementCardId);
  const abilityIndex = deckState.abilityHand.indexOf(cardUse.abilityCardId);
  if (abilityIndex !== -1) {
    const [usedAbility] = deckState.abilityHand.splice(abilityIndex, 1);
    if (usedAbility) deckState.abilityDeck.push(usedAbility);
  }
  deckState.lastRefreshIndex = null;
  return { ok: true };
};

export const buildPlayerCardState = (deckState: DeckState): PlayerCardState => ({
  deck: [...deckState.abilityDeck],
  movementHand: [...deckState.movement],
  abilityHand: [...deckState.abilityHand],
  activeCardId: deckState.activeCardId ?? null,
  passiveCardId: deckState.passiveCardId ?? null,
  discardPile: Array.from(deckState.exhaustedMovementIds),
  lastRefreshIndex: deckState.lastRefreshIndex ?? null,
});

export const resolveLandRefreshes = (
  deckStates: Map<string, DeckState>,
  beats: BeatEntry[][],
  characters: PublicCharacter[],
  land: HexCoord[],
  interactions: CustomInteraction[] = [],
  pendingActions?: PendingActions,
): void => {
  if (!deckStates.size) return;
  if (interactions.some((interaction) => interaction.status === 'pending')) return;

  const earliestIndex = getTimelineEarliestEIndex(beats, characters);
  if (pendingActions && pendingActions.beatIndex === earliestIndex) return;
  const comboContinueByUser = new Map<string, number>();
  interactions.forEach((interaction) => {
    if (interaction.type !== 'combo' || interaction.status !== 'resolved') return;
    if (!interaction.resolution?.continue) return;
    const actorId = interaction.actorUserId;
    if (!actorId) return;
    const beatIndex = Number.isFinite(interaction.beatIndex) ? Math.round(interaction.beatIndex) : null;
    if (beatIndex == null) return;
    comboContinueByUser.set(actorId, beatIndex);
  });
  const characterById = new Map<string, PublicCharacter>();
  characters.forEach((character) => {
    characterById.set(character.userId, character);
    characterById.set(character.username, character);
  });

  deckStates.forEach((deckState, userId) => {
    const character = characterById.get(userId);
    if (!character) return;
    const firstEIndex = getCharacterFirstEIndex(beats, character);
    if (firstEIndex !== earliestIndex) return;
    if (comboContinueByUser.get(userId) === firstEIndex) return;
    if (deckState.lastRefreshIndex === firstEIndex) return;
    const beat = beats[firstEIndex];
    const entry = beat ? getEntryForCharacter(beat, character) : null;
    if (entry && entry.action !== 'E') return;
    const location = getCharacterLocationAtIndex(beats, character, firstEIndex);
    if (!location) return;
    const terrain = entry?.terrain;
    const onLand = terrain === 'land' ? true : terrain === 'abyss' ? false : isCoordOnLand(location, land);
    if (!onLand) return;
    deckState.exhaustedMovementIds.clear();
    drawAbilityCards(deckState);
    deckState.lastRefreshIndex = firstEIndex;
  });
};
