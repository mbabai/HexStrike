import { createServer } from 'http';
import { parse } from 'url';
import { readFile } from 'fs';
import { createHash, randomUUID } from 'crypto';
import { createLobbyStore } from './state/lobby';
import { MemoryDb } from './persistence/memoryDb';
import { assignMatchUsernames } from './matchmaking/usernames';
import { CHARACTER_IDS } from './game/characters';
import { createInitialGameState } from './game/state';
import { applyActionSetToBeats } from './game/actionSets';
import { executeBeatsWithInteractions } from './game/execute';
import { buildReplaySeedTokens } from './game/tokenReplay';
import { applyMatchOutcomeToBeats, evaluateMatchOutcome } from './game/matchEndRules';
import { shouldBotAcceptDrawOffer } from './game/drawOfferRules';
import {
  getCharacterFirstEIndex,
  getCharacterLocationAtIndex,
  getCharactersAtEarliestE,
  getLastEntryForCharacter,
  getTimelineEarliestEIndex,
  getTimelineResolvedIndex,
  isCharacterAtEarliestE,
} from './game/beatTimeline';
import { loadCardCatalog } from './game/cardCatalog';
import {
  applyCardUse,
  buildDefaultDeckDefinition,
  buildPlayerCardState,
  clearFocusedAbilityCard,
  createDeckState,
  drawAbilityCards,
  discardAbilityCards,
  isAbilityDiscardFailure,
  getDiscardRequirements,
  getMovementHandIds,
  setFocusedAbilityCard,
  isActionValidationFailure,
  parseDeckDefinition,
  resolveLandRefreshes,
  validateActionSubmission,
} from './game/cardRules';
import { getMaxAbilityHandSize, getTargetMovementHandSize } from './game/handRules';
import { HAND_TRIGGER_BY_ID, HAND_TRIGGER_DEFINITIONS } from './game/handTriggers';
import { getCharacterMaxHandSize } from './game/characterPowers';
import {
  buildEasyBotActionCandidates,
  buildEasyBotInteractionCandidates,
} from './bot/easyBot';
import { buildTopWeightedDistribution, buildWeightedChoiceOrder } from './bot/weightedChoice';
import { writeDevTempEvent } from './dev/tempLogs';
import {
  ActionListItem,
  BeatEntry,
  CardCatalog,
  CharacterId,
  CustomInteraction,
  BoardToken,
  DeckDefinition,
  DeckState,
  GameDoc,
  GameStateDoc,
  HexCoord,
  MatchDoc,
  PublicCharacter,
  QueueName,
  ReplayDoc,
  ReplayPlayerDoc,
} from './types';
import type { AbilityDiscardResult } from './game/cardRules';

interface PendingActionBatch {
  beatIndex: number;
  requiredUserIds: string[];
  submitted: Map<string, { actionList: ActionListItem[]; play: unknown[] }>;
}

interface WsClient {
  id: string;
  userId: string;
  socket: any;
  buffer: Buffer;
}

interface ActionSetResponse {
  ok: boolean;
  status: number;
  payload?: unknown;
  error?: string;
  code?: string;
  details?: Record<string, unknown>;
}

interface ReplayResponse {
  ok: boolean;
  status: number;
  payload?: unknown;
  error?: string;
}

const cloneBaselineCharacter = (character: PublicCharacter): PublicCharacter => ({
  ...character,
  position: { q: character.position.q, r: character.position.r },
  abilityHandCount: Number.isFinite(character.abilityHandCount)
    ? Math.max(0, Math.floor(character.abilityHandCount as number))
    : undefined,
});

const ensureBaselineCharacters = (publicState: GameStateDoc['public']): PublicCharacter[] => {
  const existing = publicState.startingCharacters;
  if (Array.isArray(existing) && existing.length) {
    return existing.map((character) => cloneBaselineCharacter(character));
  }
  const characters = Array.isArray(publicState.characters) ? publicState.characters : [];
  const baseline = characters.map((character) => cloneBaselineCharacter(character));
  publicState.startingCharacters = baseline.map((character) => cloneBaselineCharacter(character));
  return baseline;
};

const resetCharactersToBaseline = (publicState: GameStateDoc['public']) => {
  publicState.characters = ensureBaselineCharacters(publicState);
};

const toAbilityHandCount = (value: unknown): number | undefined => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.floor(parsed));
};

const withAbilityHandCountAtActionStart = (
  actionList: ActionListItem[],
  abilityHandCount: number,
): ActionListItem[] => {
  const safeCount = toAbilityHandCount(abilityHandCount);
  if (!actionList.length || !Number.isFinite(safeCount)) return actionList;
  return actionList.map((item, index) =>
    index === 0 ? { ...item, abilityHandCount: safeCount } : item,
  );
};

const findCharacterBeatEntry = (beat: BeatEntry[] | undefined, character: PublicCharacter): BeatEntry | null => {
  if (!Array.isArray(beat)) return null;
  return (
    beat.find((entry) => {
      const key = entry.username ?? entry.userId ?? entry.userID;
      return key === character.userId || key === character.username;
    }) ?? null
  );
};

const applyAbilityHandCountMarkers = (
  beats: BeatEntry[][],
  characters: PublicCharacter[],
  deckStates: Map<string, DeckState> | undefined,
) => {
  if (!Array.isArray(beats) || !beats.length) return;
  if (!Array.isArray(characters) || !characters.length) return;
  if (!deckStates?.size) return;
  characters.forEach((character) => {
    const deckState = deckStates.get(character.userId);
    if (!deckState) return;
    const abilityHandCount = toAbilityHandCount(deckState.abilityHand.length);
    if (!Number.isFinite(abilityHandCount)) return;
    const firstOpenIndex = getCharacterFirstEIndex(beats, character);
    if (!Number.isFinite(firstOpenIndex)) return;
    const safeIndex = Math.max(0, Math.round(firstOpenIndex));
    let entry: BeatEntry | null = null;
    if (safeIndex < beats.length) {
      entry = findCharacterBeatEntry(beats[safeIndex], character);
    } else {
      for (let i = beats.length - 1; i >= 0; i -= 1) {
        entry = findCharacterBeatEntry(beats[i], character);
        if (entry) break;
      }
    }
    if (!entry) return;
    entry.abilityHandCount = abilityHandCount;
  });
};

const attachAbilityHandCountsToCharacters = (
  characters: PublicCharacter[],
  deckStates: Map<string, DeckState> | undefined,
): PublicCharacter[] =>
  characters.map((character) => {
    const deckState = deckStates?.get(character.userId);
    if (!deckState) return { ...character };
    const abilityHandCount = toAbilityHandCount(deckState.abilityHand.length);
    if (!Number.isFinite(abilityHandCount)) return { ...character };
    return { ...character, abilityHandCount };
  });

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const LOG_PREFIX = '[hexstrike]';
const COMBO_ACTION = 'CO';
const GUARD_CONTINUE_INTERACTION_TYPE = 'guard-continue';
const REWIND_FOCUS_INTERACTION_TYPE = 'rewind-focus';
const REWIND_RETURN_INTERACTION_TYPE = 'rewind-return';
const DRAW_OFFER_INTERACTION_TYPE = 'draw-offer';
const WHIRLWIND_CARD_ID = 'whirlwind';
const WHIRLWIND_MIN_DAMAGE = 12;
const DRAW_OFFER_COOLDOWN_MS = 30_000;
const PROD_FAVICON_PATH = '/public/images/X1.png';
const DEV_FAVICON_PATH = '/public/images/X2.png';
const IS_DEV_RUNTIME = process.env.HEXSTRIKE_TEMP_LOGS === '1' || process.env.NODE_ENV === 'development';
const MAX_USERNAME_LENGTH = 24;
type BotDifficulty = 'easy' | 'medium' | 'hard';
type BotQueueName = 'botQueue' | 'botHardQueue' | 'botMediumQueue' | 'botEasyQueue';

interface BotQueueConfig {
  queue: BotQueueName;
  username: string;
  difficulty: BotDifficulty;
  idPrefix: string;
}

const BOT_BASE_DECK_CHARACTERS: CharacterId[] = ['murelious', 'strylan', 'aumandetta'];
const BOT_QUEUE_CONFIGS: Record<BotQueueName, BotQueueConfig> = {
  botQueue: {
    queue: 'botQueue',
    username: 'Hex-bot',
    difficulty: 'medium',
    idPrefix: 'hexbot',
  },
  botHardQueue: {
    queue: 'botHardQueue',
    username: 'Strike-bot',
    difficulty: 'hard',
    idPrefix: 'strikebot',
  },
  botMediumQueue: {
    queue: 'botMediumQueue',
    username: 'Hex-bot',
    difficulty: 'medium',
    idPrefix: 'hexbot',
  },
  botEasyQueue: {
    queue: 'botEasyQueue',
    username: 'Bot-bot',
    difficulty: 'easy',
    idPrefix: 'botbot',
  },
};

const BOT_QUEUE_NAMES = Object.keys(BOT_QUEUE_CONFIGS) as BotQueueName[];
const BOT_DEFAULT_CONFIG = BOT_QUEUE_CONFIGS.botHardQueue;
const BOT_FALLBACK_CONFIG_BY_DIFFICULTY: Record<BotDifficulty, BotQueueConfig> = {
  hard: BOT_QUEUE_CONFIGS.botHardQueue,
  medium: BOT_QUEUE_CONFIGS.botMediumQueue,
  easy: BOT_QUEUE_CONFIGS.botEasyQueue,
};
const BOT_SELECTION_RULES: Record<BotDifficulty, { removeTop: number; topLimit: number | 'all' }> = {
  hard: { removeTop: 0, topLimit: 5 },
  medium: { removeTop: 0, topLimit: 'all' },
  easy: { removeTop: 10, topLimit: 'all' },
};
const BOT_MAX_DECISION_ATTEMPTS = 12;
const BOT_MAX_RUN_STEPS = 64;
const BOT_TEMP_EVENT_CHANNEL = 'easy-bot';

const isBotQueue = (queue: QueueName): queue is BotQueueName =>
  BOT_QUEUE_NAMES.includes(queue as BotQueueName);

const normalizeBotDifficulty = (value: unknown): BotDifficulty => {
  if (value === 'easy' || value === 'medium' || value === 'hard') return value;
  return BOT_DEFAULT_CONFIG.difficulty;
};

const normalizeActionLabel = (value: unknown): string => {
  const trimmed = `${value ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const isComboAction = (value: unknown): boolean => normalizeActionLabel(value).toUpperCase() === COMBO_ACTION;

const cardHasCombo = (card: { actions?: unknown[] } | undefined | null): boolean =>
  Array.isArray(card?.actions) && card.actions.some((action) => isComboAction(action));

const buildComboAvailability = (deckStates: Map<string, DeckState>, catalog: CardCatalog) => {
  const availability = new Map<string, boolean>();
  deckStates.forEach((deckState, userId) => {
    const movementAvailable = deckState.movement.filter((id) => !deckState.exhaustedMovementIds.has(id));
    const abilityAvailable = deckState.abilityHand.slice();
    const hasCombo = [...movementAvailable, ...abilityAvailable].some((id) => cardHasCombo(catalog.cardsById.get(id)));
    availability.set(userId, hasCombo);
  });
  return availability;
};

const buildHandTriggerAvailability = (deckStates: Map<string, DeckState>) => {
  const availability = new Map<string, Set<string>>();
  deckStates.forEach((deckState, userId) => {
    const available = new Set<string>();
    const movementHand = getMovementHandIds(deckState);
    HAND_TRIGGER_DEFINITIONS.forEach((definition) => {
      if (definition.cardType === 'ability') {
        if (deckState.abilityHand.includes(definition.cardId)) {
          available.add(definition.cardId);
        }
        return;
      }
      if (movementHand.includes(definition.cardId)) {
        available.add(definition.cardId);
      }
    });
    if (available.size) {
      availability.set(userId, available);
    }
  });
  return availability;
};

const buildGuardContinueAvailability = (deckStates: Map<string, DeckState>) => {
  const availability = new Map<string, boolean>();
  deckStates.forEach((deckState, userId) => {
    const movementHandSize = getMovementHandIds(deckState).length;
    const abilityHandSize = Array.isArray(deckState.abilityHand) ? deckState.abilityHand.length : 0;
    availability.set(userId, movementHandSize + abilityHandSize > 0);
  });
  return availability;
};

const cloneForLog = <T>(value: T): T => {
  if (value === undefined || value === null) return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
};

const buildPublicStateSnapshotForLog = (publicState: GameStateDoc['public'] | undefined) => {
  if (!publicState) return null;
  const beats = publicState.beats ?? publicState.timeline ?? [];
  const characters = Array.isArray(publicState.characters) ? publicState.characters : [];
  return {
    earliestIndex: getTimelineEarliestEIndex(beats, characters),
    resolvedIndex: getTimelineResolvedIndex(beats),
    characters: cloneForLog(characters),
    beats: cloneForLog(beats),
    customInteractions: cloneForLog(publicState.customInteractions ?? []),
    pendingActions: cloneForLog(publicState.pendingActions ?? null),
    boardTokens: cloneForLog(publicState.boardTokens ?? []),
    matchOutcome: cloneForLog(publicState.matchOutcome ?? null),
  };
};

const buildDeckStatesSnapshotForLog = (deckStates?: Map<string, DeckState>) => {
  if (!deckStates) return null;
  const snapshot: Record<string, unknown> = {};
  deckStates.forEach((deckState, userId) => {
    snapshot[userId] = {
      movement: [...deckState.movement],
      exhaustedMovementIds: Array.from(deckState.exhaustedMovementIds),
      movementHand: getMovementHandIds(deckState),
      targetMovementHandSize: getTargetMovementHandSize(deckState.abilityHand.length, getMaxAbilityHandSize(deckState)),
      abilityHand: [...deckState.abilityHand],
      abilityDeck: [...deckState.abilityDeck],
      focusedAbilityCardIds: Array.from(deckState.focusedAbilityCardIds),
      maxAbilityHandSize: getMaxAbilityHandSize(deckState),
      activeCardId: deckState.activeCardId,
      passiveCardId: deckState.passiveCardId,
      lastRefreshIndex: deckState.lastRefreshIndex,
    };
  });
  return snapshot;
};

const hashString = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
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

const getLandCenter = (land: HexCoord[] | undefined): { q: number; r: number } => {
  if (!Array.isArray(land) || !land.length) {
    return { q: 0, r: 0 };
  }
  let sumQ = 0;
  let sumR = 0;
  land.forEach((tile) => {
    sumQ += tile.q;
    sumR += tile.r;
  });
  return { q: sumQ / land.length, r: sumR / land.length };
};

const getCharacterDamageAtIndex = (beats: BeatEntry[][], character: PublicCharacter, index: number): number => {
  const entry = getLastEntryForCharacter(beats, character, index);
  return Number.isFinite(entry?.damage) ? Math.round(entry.damage as number) : 0;
};

const buildHandTriggerOrder = (
  interactions: CustomInteraction[],
  beats: BeatEntry[][],
  characters: PublicCharacter[],
  land: HexCoord[] | undefined,
  deckStates: Map<string, DeckState> | undefined,
): Map<string, number> => {
  const orderById = new Map<string, number>();
  if (!Array.isArray(interactions) || !interactions.length || !Array.isArray(characters) || !characters.length) {
    return orderById;
  }
  const pending = interactions.filter(
    (interaction) => interaction?.type === 'hand-trigger' && interaction?.status === 'pending',
  );
  if (!pending.length) return orderById;

  const center = getLandCenter(land);
  const characterById = new Map<string, PublicCharacter>();
  characters.forEach((character) => {
    characterById.set(character.userId, character);
    characterById.set(character.username, character);
  });

  const ranked = pending.map((interaction) => {
    const actorId = interaction.actorUserId;
    const character = characterById.get(actorId);
    const beatIndex = Number.isFinite(interaction.beatIndex) ? Math.round(interaction.beatIndex) : beats.length - 1;
    const damage = character ? getCharacterDamageAtIndex(beats, character, beatIndex) : 0;
    const deckState = actorId && deckStates ? deckStates.get(actorId) : undefined;
    const movementCount = deckState ? getMovementHandIds(deckState).length : 0;
    const abilityCount = deckState ? deckState.abilityHand.length : 0;
    const handSize = movementCount + abilityCount;
    const location = character ? getCharacterLocationAtIndex(beats, character, beatIndex) ?? character.position : null;
    const distance = location ? axialDistance(location, center) : Number.POSITIVE_INFINITY;
    return {
      interaction,
      damage,
      handSize,
      distance,
      tieBreaker: hashString(interaction.id ?? ''),
    };
  });

  ranked.sort((a, b) => {
    if (a.damage !== b.damage) return b.damage - a.damage;
    if (a.handSize !== b.handSize) return a.handSize - b.handSize;
    if (a.distance !== b.distance) return b.distance - a.distance;
    return a.tieBreaker - b.tieBreaker;
  });

  ranked.forEach((item, index) => {
    orderById.set(item.interaction.id, index + 1);
  });

  return orderById;
};

const DRAW_SELECTION_MAX_MOVEMENT = 3;
const AXIAL_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

const getDrawSelectionRequirement = (deckState: DeckState, drawCount: number) => {
  const requested = Number.isFinite(drawCount) ? Math.max(0, Math.floor(drawCount)) : 0;
  const actualDraw = Math.min(requested, deckState.abilityDeck.length);
  const abilityAfter = deckState.abilityHand.length + actualDraw;
  const targetMovementSize = getTargetMovementHandSize(abilityAfter, getMaxAbilityHandSize(deckState));
  const movementHandSize = getMovementHandIds(deckState).length;
  const requiredRestore = Math.max(0, targetMovementSize - movementHandSize);
  const requiresSelection = requiredRestore > 0 && targetMovementSize <= DRAW_SELECTION_MAX_MOVEMENT;
  return { requested, actualDraw, targetMovementSize, requiredRestore, requiresSelection };
};

const applyDrawInteractions = (deckStates: Map<string, DeckState>, interactions: CustomInteraction[]): void => {
  if (!deckStates || !interactions?.length) return;
  interactions.forEach((interaction) => {
    if (!interaction || interaction.type !== 'draw') return;
    if (interaction.status !== 'resolved') return;
    if (interaction.resolution?.applied) return;
    const drawCount = Number.isFinite(interaction.drawCount) ? Math.max(0, Math.floor(interaction.drawCount)) : 0;
    const deckState = deckStates.get(interaction.actorUserId);
    if (!deckState) return;
    const requirement = getDrawSelectionRequirement(deckState, drawCount);
    if (requirement.requiresSelection) {
      interaction.status = 'pending';
      interaction.drawMovementCount = requirement.requiredRestore;
      return;
    }
    if (drawCount > 0) {
      const drawResult = drawAbilityCards(deckState, drawCount, { mode: 'auto' });
      if ('error' in drawResult) {
        console.log(`${LOG_PREFIX} draw:resolve failed`, {
          userId: interaction.actorUserId,
          error: drawResult.error.code,
        });
        return;
      }
    }
    interaction.resolution = { ...(interaction.resolution ?? {}), applied: true };
  });
};

const getFocusedCardIdFromInteraction = (interaction: CustomInteraction): string => {
  const raw = `${interaction.cardId ?? interaction.resolution?.cardId ?? 'rewind'}`.trim();
  return raw || 'rewind';
};

const syncFocusedCardsFromInteractions = (
  deckStates: Map<string, DeckState>,
  interactions: CustomInteraction[],
) => {
  if (!deckStates?.size) return;
  const desiredByUser = new Map<string, Set<string>>();
  interactions.forEach((interaction) => {
    if (!interaction || interaction.type !== REWIND_FOCUS_INTERACTION_TYPE) return;
    if (interaction.status !== 'resolved') return;
    if (interaction.resolution?.active === false) return;
    const actorId = `${interaction.actorUserId ?? ''}`.trim();
    if (!actorId) return;
    const cardId = getFocusedCardIdFromInteraction(interaction);
    const desired = desiredByUser.get(actorId) ?? new Set<string>();
    desired.add(cardId);
    desiredByUser.set(actorId, desired);
  });

  deckStates.forEach((deckState, userId) => {
    const desired = desiredByUser.get(userId) ?? new Set<string>();
    const current = Array.from(deckState.focusedAbilityCardIds ?? []);
    current.forEach((cardId) => {
      if (desired.has(cardId)) return;
      clearFocusedAbilityCard(deckState, cardId, { returnToDeck: true });
    });
    desired.forEach((cardId) => {
      if (deckState.focusedAbilityCardIds.has(cardId)) return;
      setFocusedAbilityCard(deckState, cardId);
    });
  });
};

const hasPlayableCards = (deckState?: DeckState): boolean => {
  if (!deckState) return true;
  const hasAbility = Array.isArray(deckState.abilityHand) && deckState.abilityHand.length > 0;
  const hasMovement = getMovementHandIds(deckState).length > 0;
  return hasAbility && hasMovement;
};

const autoResolveForcedRewindReturns = (
  beats: BeatEntry[][],
  characters: PublicCharacter[],
  interactions: CustomInteraction[],
  deckStates: Map<string, DeckState>,
): boolean => {
  let updated = false;
  const activeFocusByUser = new Map<string, CustomInteraction>();
  interactions.forEach((interaction) => {
    if (!interaction || interaction.type !== REWIND_FOCUS_INTERACTION_TYPE) return;
    if (interaction.status !== 'resolved') return;
    if (interaction.resolution?.active === false) return;
    const actorId = `${interaction.actorUserId ?? ''}`.trim();
    if (!actorId) return;
    activeFocusByUser.set(actorId, interaction);
  });
  const characterByUserId = new Map<string, PublicCharacter>();
  characters.forEach((character) => {
    characterByUserId.set(character.userId, character);
  });

  interactions.forEach((interaction) => {
    if (!interaction || interaction.type !== REWIND_RETURN_INTERACTION_TYPE) return;
    if (interaction.status !== 'pending') return;
    const actorId = `${interaction.actorUserId ?? ''}`.trim();
    if (!actorId) return;
    const deckState = deckStates.get(actorId);
    if (hasPlayableCards(deckState)) return;
    interaction.status = 'resolved';
    interaction.resolution = {
      ...(interaction.resolution ?? {}),
      returnToAnchor: true,
      forced: true,
    };
    updated = true;
  });

  activeFocusByUser.forEach((focusInteraction, actorId) => {
    const deckState = deckStates.get(actorId);
    if (hasPlayableCards(deckState)) return;
    const hasPending = interactions.some(
      (interaction) =>
        interaction?.type === REWIND_RETURN_INTERACTION_TYPE &&
        interaction?.status === 'pending' &&
        interaction?.actorUserId === actorId,
    );
    if (hasPending) return;
    const hasUnappliedResolved = interactions.some(
      (interaction) =>
        interaction?.type === REWIND_RETURN_INTERACTION_TYPE &&
        interaction?.status === 'resolved' &&
        interaction?.actorUserId === actorId &&
        Boolean(interaction?.resolution?.returnToAnchor) &&
        !interaction?.resolution?.applied,
    );
    if (hasUnappliedResolved) return;
    const character = characterByUserId.get(actorId);
    if (!character) return;
    const beatIndex = getCharacterFirstEIndex(beats, character);
    const safeBeatIndex = Number.isFinite(beatIndex) ? Math.max(0, Math.round(beatIndex)) : 0;
    const interactionId = `${REWIND_RETURN_INTERACTION_TYPE}:${safeBeatIndex}:${actorId}:${actorId}`;
    const cardId = getFocusedCardIdFromInteraction(focusInteraction);
    interactions.push({
      id: interactionId,
      type: REWIND_RETURN_INTERACTION_TYPE,
      beatIndex: safeBeatIndex,
      actorUserId: actorId,
      targetUserId: actorId,
      cardId,
      status: 'resolved',
      resolution: {
        returnToAnchor: true,
        forced: true,
        focusInteractionId: focusInteraction.id,
        anchorHex: focusInteraction.resolution?.anchorHex,
      },
    });
    updated = true;
  });

  return updated;
};

const executeWithForcedRewindReturns = ({
  beats,
  characters,
  interactions,
  land,
  comboAvailability,
  handTriggerAvailability,
  guardContinueAvailability,
  deckStates,
  initialTokens = [],
}: {
  beats: BeatEntry[][];
  characters: PublicCharacter[];
  interactions: CustomInteraction[];
  land: HexCoord[];
  comboAvailability: Map<string, boolean>;
  handTriggerAvailability: Map<string, Set<string>>;
  guardContinueAvailability: Map<string, boolean>;
  deckStates: Map<string, DeckState>;
  initialTokens?: BoardToken[];
}) => {
  // Replay execution must seed tokens from timeline/interactions, not the current
  // public board token snapshot, or old fire/arrow states get projected into beat 0.
  const replaySeedTokens = buildReplaySeedTokens(initialTokens);
  let executed = executeBeatsWithInteractions(
    beats,
    characters,
    interactions,
    land,
    comboAvailability,
    replaySeedTokens,
    handTriggerAvailability,
    guardContinueAvailability,
  );
  syncFocusedCardsFromInteractions(deckStates, executed.interactions);
  while (autoResolveForcedRewindReturns(executed.beats, executed.characters, executed.interactions, deckStates)) {
    executed = executeBeatsWithInteractions(
      executed.beats,
      characters,
      executed.interactions,
      land,
      comboAvailability,
      replaySeedTokens,
      handTriggerAvailability,
      guardContinueAvailability,
    );
    syncFocusedCardsFromInteractions(deckStates, executed.interactions);
  }
  return executed;
};

const findComboContinuation = (
  interactions: Array<{
    id?: string;
    type?: string;
    status?: string;
    actorUserId?: string;
    beatIndex?: number;
    resolution?: { continue?: boolean };
  }>,
  userId: string,
  beatIndex: number,
) =>
  interactions.find(
    (interaction) =>
      interaction?.type === 'combo' &&
      interaction?.status === 'resolved' &&
      interaction?.actorUserId === userId &&
      interaction?.beatIndex === beatIndex &&
      Boolean((interaction as { resolution?: { continue?: boolean } }).resolution?.continue),
  ) ?? null;

const withComboStarter = (actionList: ActionListItem[]) =>
  actionList.map((item, index) => (index === 0 ? { ...item, comboStarter: true } : { ...item }));

const getEntryForCharacter = (beat: BeatEntry[] | undefined, character: { userId: string; username?: string }) => {
  if (!Array.isArray(beat)) return undefined;
  return beat.find((entry) => {
    const key = entry.username ?? entry.userId ?? entry.userID;
    return key === character.userId || key === character.username;
  });
};

const buildTimelineSummary = (beats: BeatEntry[][], characters: PublicCharacter[]) => {
  const perCharacter = characters.map((character) => {
    const firstE = getCharacterFirstEIndex(beats, character);
    let lastNonE = -1;
    for (let i = beats.length - 1; i >= 0; i -= 1) {
      const entry = getEntryForCharacter(beats[i], character);
      if (entry && entry.action !== 'E') {
        lastNonE = i;
        break;
      }
    }
    return {
      userId: character.userId,
      username: character.username,
      firstE,
      lastNonE,
    };
  });

  let trailingAllE = 0;
  for (let i = beats.length - 1; i >= 0; i -= 1) {
    const isAllE = characters.every((character) => {
      const entry = getEntryForCharacter(beats[i], character);
      if (!entry) return true;
      return entry.action === 'E';
    });
    if (!isAllE) break;
    trailingAllE += 1;
  }

  return {
    length: beats.length,
    trailingAllE,
    perCharacter,
  };
};

export function buildServer(port: number) {
  const lobby = createLobbyStore();
  const db = new MemoryDb();
  const sseClients = new Map<string, any>();
  const wsClients = new Map<string, WsClient>();
  const pendingActionSets = new Map<string, PendingActionBatch>();
  const drawOfferCooldownByGame = new Map<string, Map<string, number>>();
  const pendingInvites = new Map<string, string>();
  const matchDisconnects = new Map<string, Set<string>>();
  const matchExitUsers = new Map<string, Set<string>>();
  const queuedDecks = new Map<string, DeckDefinition>();
  const gameDeckStates = new Map<string, Map<string, DeckState>>();
  const botUsersByGame = new Map<string, Set<string>>();
  const botRunsInProgress = new Set<string>();
  const botRunsQueued = new Set<string>();
  const winsRequired = 3;
  let anonymousCounter = 0;

  const pickRandomCharacterId = () => CHARACTER_IDS[Math.floor(Math.random() * CHARACTER_IDS.length)];
  const nextAnonymousName = () => {
    anonymousCounter += 1;
    return `anonymous${anonymousCounter}`;
  };

  const normalizeUsername = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.replace(/\s+/g, ' ').slice(0, MAX_USERNAME_LENGTH);
  };

  const normalizeCharacterId = (value: unknown): CharacterId | undefined => {
    if (typeof value !== 'string') return undefined;
    const candidate = value.trim().toLowerCase();
    if (!candidate) return undefined;
    return CHARACTER_IDS.includes(candidate as CharacterId) ? (candidate as CharacterId) : undefined;
  };

  const getDrawOfferCooldownRemainingSeconds = (gameId: string, userId: string, nowMs = Date.now()): number => {
    const gameCooldowns = drawOfferCooldownByGame.get(gameId);
    if (!gameCooldowns) return 0;
    const nextAllowedAt = gameCooldowns.get(userId);
    if (!Number.isFinite(nextAllowedAt)) return 0;
    const remainingMs = nextAllowedAt - nowMs;
    if (remainingMs <= 0) return 0;
    return Math.max(1, Math.ceil(remainingMs / 1000));
  };

  const setDrawOfferCooldown = (gameId: string, userId: string, nowMs = Date.now()) => {
    const gameCooldowns = drawOfferCooldownByGame.get(gameId) ?? new Map<string, number>();
    gameCooldowns.set(userId, nowMs + DRAW_OFFER_COOLDOWN_MS);
    drawOfferCooldownByGame.set(gameId, gameCooldowns);
  };

  const sendSseEvent = (packet: Record<string, unknown>, targetId?: string) => {
    const entries = targetId
      ? [[targetId, sseClients.get(targetId)]]
      : Array.from(sseClients.entries());
    entries.forEach(([id, res]) => {
      if (!res) return;
      res.write(`data: ${JSON.stringify({ ...packet, recipient: id })}\n\n`);
    });
  };

  const buildWsAccept = (key: string) => createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');

  const encodeWsMessage = (message: string): Buffer => {
    const payload = Buffer.from(message);
    const length = payload.length;
    if (length < 126) {
      const header = Buffer.alloc(2);
      header[0] = 0x81;
      header[1] = length;
      return Buffer.concat([header, payload]);
    }
    if (length < 65536) {
      const header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
      return Buffer.concat([header, payload]);
    }
    const header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(length, 6);
    return Buffer.concat([header, payload]);
  };

  const decodeWsMessages = (buffer: Buffer) => {
    let offset = 0;
    const messages: string[] = [];
    while (offset + 2 <= buffer.length) {
      const first = buffer.readUInt8(offset);
      const second = buffer.readUInt8(offset + 1);
      const opcode = first & 0x0f;
      let payloadLength = second & 0x7f;
      const masked = (second & 0x80) !== 0;
      let headerLength = 2;
      if (payloadLength === 126) {
        if (offset + 4 > buffer.length) break;
        payloadLength = buffer.readUInt16BE(offset + 2);
        headerLength = 4;
      } else if (payloadLength === 127) {
        if (offset + 10 > buffer.length) break;
        payloadLength = buffer.readUInt32BE(offset + 6);
        headerLength = 10;
      }
      const maskOffset = masked ? headerLength : 0;
      if (masked && offset + headerLength + 4 > buffer.length) break;
      const payloadOffset = offset + headerLength + maskOffset;
      if (payloadOffset + payloadLength > buffer.length) break;
      const payload = buffer.slice(payloadOffset, payloadOffset + payloadLength);
      if (masked) {
        const mask = buffer.slice(offset + headerLength, offset + headerLength + 4);
        for (let i = 0; i < payload.length; i += 1) {
          payload[i] ^= mask[i % 4];
        }
      }
      if (opcode === 1) {
        messages.push(payload.toString('utf8'));
      }
      if (opcode === 8) {
        break;
      }
      offset = payloadOffset + payloadLength;
    }
    return { messages, remaining: buffer.slice(offset) };
  };

  const sendWsMessage = (socket: any, message: string) => {
    if (!socket) return;
    socket.write(encodeWsMessage(message));
  };

  const sendWsEvent = (packet: Record<string, unknown>, targetId?: string) => {
    const entries = targetId
      ? Array.from(wsClients.values()).filter((client) => client.userId === targetId)
      : Array.from(wsClients.values());
    entries.forEach((client) => {
      sendWsMessage(client.socket, JSON.stringify({ ...packet, recipient: targetId ?? client.userId }));
    });
  };

  const sendRealtimeEvent = (packet: Record<string, unknown>, targetId?: string) => {
    sendSseEvent(packet, targetId);
    sendWsEvent(packet, targetId);
  };

  lobby.events.on('queueChanged', (state) => {
    sendRealtimeEvent({ type: 'queueChanged', payload: state });
  });

  const parseBody = async (req: any) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      let data = '';
      req.on('data', (chunk: string) => {
        data += chunk;
      });
      req.on('end', () => {
        if (!data) return resolve({});
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });

  const respondJson = (res: any, status: number, payload: unknown) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(payload));
  };

  const notFound = (res: any) => respondJson(res, 404, { error: 'Not found' });

  const cloneReplayPublicState = (publicState: GameStateDoc['public']) =>
    JSON.parse(JSON.stringify(publicState ?? {})) as GameStateDoc['public'];

  const buildReplayPlayers = (match: MatchDoc, game: GameDoc): ReplayPlayerDoc[] => {
    const characterNameByUserId = new Map<string, string>();
    const characters = ensureBaselineCharacters(game.state.public);
    characters.forEach((character) => {
      if (character?.userId && character?.characterName) {
        characterNameByUserId.set(character.userId, character.characterName);
      }
    });
    return match.players.map((player) => ({
      userId: player.userId,
      username: player.username,
      characterId: player.characterId,
      characterName: characterNameByUserId.get(player.userId),
    }));
  };

  const buildReplaySummary = (replay: ReplayDoc) => ({
    id: replay.id,
    sourceGameId: replay.sourceGameId,
    sourceMatchId: replay.sourceMatchId ?? null,
    players: replay.players,
    createdAt: replay.createdAt,
  });

  const buildReplayDetail = (replay: ReplayDoc) => ({
    ...buildReplaySummary(replay),
    state: replay.state,
  });

  const saveReplay = async (body: Record<string, unknown>): Promise<ReplayResponse> => {
    const userId = (body.userId as string) || (body.userID as string);
    const gameId = (body.gameId as string) || (body.gameID as string);
    if (!userId || !gameId) {
      return { ok: false, status: 400, error: 'Invalid replay payload' };
    }
    const game = await db.findGame(gameId);
    if (!game) {
      return { ok: false, status: 404, error: 'Game not found' };
    }
    const match = await db.findMatch(game.matchId);
    if (!match) {
      return { ok: false, status: 404, error: 'Match not found' };
    }
    const isParticipant = match.players.some((player) => player.userId === userId);
    if (!isParticipant) {
      return { ok: false, status: 403, error: 'User not in match' };
    }
    const outcome = game.state?.public?.matchOutcome ?? null;
    if (!outcome) {
      return { ok: false, status: 409, error: 'Game is not complete yet' };
    }
    const existing = await db.findReplayByGameId(game.id);
    if (existing) {
      return { ok: true, status: 200, payload: buildReplayDetail(existing) };
    }
    const replay = await db.createReplay({
      sourceGameId: game.id,
      sourceMatchId: game.matchId,
      players: buildReplayPlayers(match, game),
      state: {
        public: cloneReplayPublicState(game.state.public),
      },
    });
    return { ok: true, status: 201, payload: buildReplayDetail(replay) };
  };

  const buildDeckStatesForMatch = async (match: MatchDoc, game: GameDoc) => {
    const catalog = await loadCardCatalog();
    const deckStates = new Map<string, DeckState>();
    match.players.forEach((player) => {
      const deck = queuedDecks.get(player.userId) ?? buildDefaultDeckDefinition(catalog);
      deckStates.set(
        player.userId,
        createDeckState(deck, { baseMaxHandSize: getCharacterMaxHandSize(player.characterId) ?? undefined }),
      );
    });
    gameDeckStates.set(game.id, deckStates);
    return deckStates;
  };

  const ensureDeckStatesForGame = async (game: GameDoc, match?: MatchDoc) => {
    const existing = gameDeckStates.get(game.id);
    if (existing) return existing;
    if (match) {
      return buildDeckStatesForMatch(match, game);
    }
    const catalog = await loadCardCatalog();
    const deckStates = new Map<string, DeckState>();
    const characters = game.state?.public ? ensureBaselineCharacters(game.state.public) : [];
    characters.forEach((character) => {
      const deck = queuedDecks.get(character.userId) ?? buildDefaultDeckDefinition(catalog);
      deckStates.set(
        character.userId,
        createDeckState(deck, { baseMaxHandSize: getCharacterMaxHandSize(character.characterId) ?? undefined }),
      );
    });
    gameDeckStates.set(game.id, deckStates);
    return deckStates;
  };

  const buildGameViewForPlayer = (game: GameDoc, userId: string, deckStates?: Map<string, DeckState>) => {
    const resolvedDeckStates = deckStates ?? gameDeckStates.get(game.id);
    if (resolvedDeckStates) {
      const focusInteractions = game.state?.public?.customInteractions ?? [];
      syncFocusedCardsFromInteractions(resolvedDeckStates, focusInteractions);
    }
    const playerDeckState = resolvedDeckStates?.get(userId) ?? null;
    const playerCards = playerDeckState ? buildPlayerCardState(playerDeckState) : null;
    const publicState = game.state.public;
    const beats = publicState.beats ?? publicState.timeline ?? [];
    const characters = ensureBaselineCharacters(publicState);
    applyAbilityHandCountMarkers(beats, characters, resolvedDeckStates);
    const charactersWithAbilityCounts = attachAbilityHandCountsToCharacters(characters, resolvedDeckStates);
    const baseInteractions = Array.isArray(publicState.customInteractions) ? publicState.customInteractions : [];
    const customInteractions = baseInteractions.map((interaction) => {
      if (!interaction || typeof interaction !== 'object') return interaction;
      const next = { ...interaction };
      if (interaction.type === 'discard') {
        if (interaction.actorUserId === userId && playerDeckState) {
          const { abilityDiscardCount, movementDiscardCount } = getDiscardRequirements(
            playerDeckState,
            interaction.discardCount ?? 0,
          );
          next.discardAbilityCount = abilityDiscardCount;
          next.discardMovementCount = movementDiscardCount;
        }
        return next;
      }
      if (interaction.type === 'hand-trigger') {
        if (interaction.actorUserId === userId && playerDeckState && interaction.status === 'pending') {
          const cardId = interaction.cardId ?? interaction.abilityCardId;
          const definition = cardId ? HAND_TRIGGER_BY_ID.get(cardId) : null;
          if (definition?.cardType === 'ability') {
            const { movementDiscardCount } = getDiscardRequirements(playerDeckState, definition.discardCount);
            next.discardMovementCount = movementDiscardCount;
            next.discardAbilityCount = 0;
          } else if (definition?.cardType === 'movement') {
            const abilityRequired = playerDeckState.abilityHand.length > 0 ? 1 : 0;
            next.discardAbilityCount = abilityRequired;
            next.discardMovementCount = 0;
          }
        }
        return next;
      }
      return next;
    });
    const handTriggerOrder = buildHandTriggerOrder(
      customInteractions,
      beats,
      charactersWithAbilityCounts,
      publicState.land ?? [],
      resolvedDeckStates,
    );
    if (handTriggerOrder.size) {
      customInteractions.forEach((interaction) => {
        if (interaction?.type !== 'hand-trigger' || interaction.status !== 'pending') return;
        const order = handTriggerOrder.get(interaction.id);
        if (order != null) {
          interaction.handTriggerOrder = order;
        }
      });
    }
    return {
      ...game,
      state: {
        public: {
          ...publicState,
          characters: charactersWithAbilityCounts,
          beats,
          timeline: beats,
          customInteractions,
        },
        secret: game.state.secret,
        player: { cards: playerCards },
      },
    };
  };

  const getPresenceSnapshot = async () => {
    const snapshot = lobby.serialize();
    const connectedIds = Array.from(sseClients.keys());
    const connectedUsers = await Promise.all(
      connectedIds.map(async (userId) => {
        const user = await upsertUserFromRequest(userId);
        return { userId, username: user.username };
      }),
    );
    return {
      connected: connectedUsers,
      quickplayQueue: [...snapshot.quickplayQueue],
      inGame: [...snapshot.inGame],
    };
  };

  const upsertUserFromRequest = async (userId?: string, username?: string, characterId?: CharacterId) => {
    const normalizedUsername = normalizeUsername(username);
    if (userId) {
      const existing = await db.findUser(userId);
      if (existing) {
        const nextUsername =
          normalizedUsername && existing.username !== normalizedUsername ? normalizedUsername : existing.username;
        const nextCharacterId = characterId ?? existing.characterId;
        if (nextUsername !== existing.username || nextCharacterId !== existing.characterId) {
          return db.upsertUser({
            id: userId,
            username: nextUsername,
            characterId: nextCharacterId,
            elo: existing.elo,
          });
        }
        return existing;
      }
    }
    return db.upsertUser({
      id: userId,
      username: normalizedUsername || nextAnonymousName(),
      elo: 1000,
      characterId,
    });
  };

  const ensureUserCharacter = async (user: { id: string; username: string; characterId?: CharacterId }) => {
    if (user.characterId) return user;
    return db.upsertUser({
      id: user.id,
      username: user.username,
      characterId: pickRandomCharacterId(),
    });
  };

  const pickBotLoadout = async (): Promise<{ deck: DeckDefinition; characterId: CharacterId; deckIndex: number }> => {
    const catalog = await loadCardCatalog();
    const baseDecks = Array.isArray(catalog.decks)
      ? catalog.decks.slice(0, BOT_BASE_DECK_CHARACTERS.length)
      : [];
    if (!baseDecks.length) {
      return {
        deck: buildDefaultDeckDefinition(catalog),
        characterId: pickRandomCharacterId(),
        deckIndex: -1,
      };
    }
    const deckIndex = Math.floor(Math.random() * baseDecks.length);
    const selectedDeck = baseDecks[deckIndex] ?? buildDefaultDeckDefinition(catalog);
    return {
      deck: {
        movement: Array.isArray(selectedDeck.movement) ? [...selectedDeck.movement] : [],
        ability: Array.isArray(selectedDeck.ability) ? [...selectedDeck.ability] : [],
      },
      characterId: BOT_BASE_DECK_CHARACTERS[deckIndex] ?? pickRandomCharacterId(),
      deckIndex,
    };
  };

  const createBotMatchForUser = async (user: { id: string; username: string }, botQueue: BotQueueName) => {
    const queueConfig = BOT_QUEUE_CONFIGS[botQueue] ?? BOT_DEFAULT_CONFIG;
    const loadout = await pickBotLoadout();
    const botId = `${queueConfig.idPrefix}-${randomUUID()}`;
    const bot = await db.upsertUser({
      id: botId,
      username: queueConfig.username,
      elo: 1000,
      characterId: loadout.characterId,
      isBot: true,
      botDifficulty: queueConfig.difficulty,
    });
    queuedDecks.set(bot.id, loadout.deck);
    console.log(`${LOG_PREFIX} bot:match-create`, {
      humanUserId: user.id,
      botUserId: bot.id,
      botUsername: bot.username,
      botDifficulty: queueConfig.difficulty,
      botCharacterId: loadout.characterId,
      deckIndex: loadout.deckIndex,
      queue: botQueue,
    });
    writeDevTempEvent(BOT_TEMP_EVENT_CHANNEL, {
      stage: 'match-create',
      humanUserId: user.id,
      botUserId: bot.id,
      botUsername: bot.username,
      botDifficulty: queueConfig.difficulty,
      botCharacterId: loadout.characterId,
      deckIndex: loadout.deckIndex,
      queue: botQueue,
      deck: loadout.deck,
    });
    try {
      await createMatchWithUsers([
        { id: user.id, username: user.username },
        { id: bot.id, username: bot.username },
      ]);
    } finally {
      queuedDecks.delete(bot.id);
    }
  };

  const getPendingInteractionRecipientId = (interaction?: CustomInteraction | null): string | null => {
    if (!interaction) return null;
    if (interaction.type === 'discard') {
      const target = interaction.actorUserId ?? interaction.targetUserId;
      return target ? `${target}` : null;
    }
    return interaction.actorUserId ? `${interaction.actorUserId}` : null;
  };

  const getBotUserIdsForMatch = async (match?: MatchDoc): Promise<Set<string>> => {
    const botIds = new Set<string>();
    if (!match) return botIds;
    for (const player of match.players) {
      const user = await db.findUser(player.userId);
      if (user?.isBot) {
        botIds.add(player.userId);
      }
    }
    return botIds;
  };

  const ensureBotUsersForGame = async (game: GameDoc, match?: MatchDoc): Promise<Set<string>> => {
    const cached = botUsersByGame.get(game.id);
    if (cached?.size) return cached;
    const resolvedMatch = match ?? (await db.findMatch(game.matchId));
    const botIds = await getBotUserIdsForMatch(resolvedMatch);
    if (botIds.size) {
      botUsersByGame.set(game.id, botIds);
    }
    return botIds;
  };

  const emitBotError = (
    match: MatchDoc,
    gameId: string,
    botUserId: string,
    message: string,
    extra: Record<string, unknown> = {},
  ) => {
    console.error(`${LOG_PREFIX} bot:error`, { gameId, botUserId, message, ...extra });
    writeDevTempEvent(BOT_TEMP_EVENT_CHANNEL, {
      stage: 'error',
      gameId,
      botUserId,
      message,
      ...extra,
    });
    match.players.forEach((player) => {
      if (player.userId === botUserId) return;
      sendRealtimeEvent({ type: 'bot:error', payload: { gameId, botUserId, message } }, player.userId);
    });
  };

  const formatChoiceDistribution = <T extends { score: number }>(
    distribution: Array<{ item: T; probability: number; weight: number }>,
    formatter: (item: T) => Record<string, unknown>,
  ) =>
    distribution.map((entry) => ({
      probability: Number(entry.probability.toFixed(4)),
      weight: Number(entry.weight.toFixed(4)),
      score: Number(entry.item.score.toFixed(4)),
      ...formatter(entry.item),
    }));

  const resolveBotDecisionContext = async (botUserId: string) => {
    const botUser = await db.findUser(botUserId);
    const botDifficulty = normalizeBotDifficulty(botUser?.botDifficulty);
    const fallbackConfig = BOT_FALLBACK_CONFIG_BY_DIFFICULTY[botDifficulty] ?? BOT_DEFAULT_CONFIG;
    return {
      botDifficulty,
      botName: botUser?.username || fallbackConfig.username,
    };
  };

  const getBotSelectionParams = (botDifficulty: BotDifficulty, candidateCount: number) => {
    const rules = BOT_SELECTION_RULES[botDifficulty] ?? BOT_SELECTION_RULES[BOT_DEFAULT_CONFIG.difficulty];
    const normalizedCount = Math.max(0, Math.floor(candidateCount));
    const topLimit = rules.topLimit === 'all' ? normalizedCount : Math.min(normalizedCount, rules.topLimit);
    return {
      removeTop: Math.max(0, Math.floor(rules.removeTop)),
      topLimit: Math.max(1, topLimit || 1),
    };
  };

  const buildBotChoiceOrder = <T extends { score: number }>(candidates: T[], botDifficulty: BotDifficulty) => {
    const selectionParams = getBotSelectionParams(botDifficulty, candidates.length);
    let topDistribution = buildTopWeightedDistribution(
      candidates,
      selectionParams.topLimit,
      selectionParams.removeTop,
    );
    let orderedCandidates = buildWeightedChoiceOrder(
      candidates,
      Math.random,
      selectionParams.topLimit,
      selectionParams.removeTop,
    );
    let fallbackToAll = false;
    if (!orderedCandidates.length && candidates.length) {
      fallbackToAll = true;
      topDistribution = buildTopWeightedDistribution(candidates, candidates.length, 0);
      orderedCandidates = buildWeightedChoiceOrder(candidates, Math.random, candidates.length, 0);
    }
    return {
      topDistribution,
      orderedCandidates,
      selectionParams,
      fallbackToAll,
    };
  };

  const scheduleBotRun = (gameId: string, reason: string) => {
    if (!gameId) return;
    if (botRunsInProgress.has(gameId)) {
      botRunsQueued.add(gameId);
      return;
    }
    if (botRunsQueued.has(gameId)) return;
    botRunsQueued.add(gameId);
    setTimeout(() => {
      void runBotsForGame(gameId, reason);
    }, 0);
  };

  const runBotsForGame = async (gameId: string, reason: string) => {
    if (!gameId) return;
    if (botRunsInProgress.has(gameId)) {
      botRunsQueued.add(gameId);
      return;
    }
    botRunsQueued.delete(gameId);
    botRunsInProgress.add(gameId);
    writeDevTempEvent(BOT_TEMP_EVENT_CHANNEL, { stage: 'run:start', gameId, reason });
    try {
      for (let step = 0; step < BOT_MAX_RUN_STEPS; step += 1) {
        const game = await db.findGame(gameId);
        if (!game) return;
        if (game.state?.public?.matchOutcome) return;
        const match = await db.findMatch(game.matchId);
        if (!match || match.state === 'complete') return;
        const botIds = await ensureBotUsersForGame(game, match);
        if (!botIds.size) return;

        const publicState = game.state.public;
        const beats = publicState.beats ?? publicState.timeline ?? [];
        const characters = ensureBaselineCharacters(publicState);
        const firstPendingInteraction = (publicState.customInteractions ?? []).find(
          (interaction) => interaction?.status === 'pending',
        );

        if (firstPendingInteraction) {
          const botUserId = getPendingInteractionRecipientId(firstPendingInteraction);
          if (!botUserId || !botIds.has(botUserId)) return;
          const { botDifficulty, botName } = await resolveBotDecisionContext(botUserId);
          const deckStates = await ensureDeckStatesForGame(game, match);
          const catalog = await loadCardCatalog();
          const interactionCandidates = buildEasyBotInteractionCandidates(
            {
              botUserId,
              publicState,
              deckStates,
              catalog,
            },
            firstPendingInteraction,
          );
          if (!interactionCandidates.length) {
            emitBotError(match, gameId, botUserId, `${botName} could not find a legal interaction choice.`, {
              interactionType: firstPendingInteraction.type,
              interactionId: firstPendingInteraction.id,
              botDifficulty,
            });
            return;
          }

          const { topDistribution, orderedCandidates, selectionParams, fallbackToAll } = buildBotChoiceOrder(
            interactionCandidates,
            botDifficulty,
          );
          writeDevTempEvent(BOT_TEMP_EVENT_CHANNEL, {
            stage: 'interaction:choices',
            gameId,
            botUserId,
            botName,
            botDifficulty,
            interactionId: firstPendingInteraction.id,
            interactionType: firstPendingInteraction.type,
            candidateCount: interactionCandidates.length,
            selection: selectionParams,
            fallbackToAll,
            top: formatChoiceDistribution(topDistribution, (choice) => ({
              payload: choice.payload,
              scoreIndex: choice.scoreIndex,
            })),
          });

          let success = false;
          const attempts = Math.min(orderedCandidates.length, BOT_MAX_DECISION_ATTEMPTS);
          for (let attempt = 0; attempt < attempts; attempt += 1) {
            const candidate = orderedCandidates[attempt];
            const result = await resolveInteraction({
              userId: botUserId,
              gameId,
              interactionId: firstPendingInteraction.id,
              ...candidate.payload,
            });
            writeDevTempEvent(BOT_TEMP_EVENT_CHANNEL, {
              stage: 'interaction:attempt',
              gameId,
              botUserId,
              botDifficulty,
              botName,
              interactionId: firstPendingInteraction.id,
              attempt: attempt + 1,
              ok: result.ok,
              status: result.status,
              code: result.code ?? null,
              error: result.error ?? null,
              payload: candidate.payload,
              score: candidate.score,
            });
            if (result.ok) {
              success = true;
              break;
            }
          }

          if (!success) {
            emitBotError(
              match,
              gameId,
              botUserId,
              `${botName} failed to resolve interaction after ${BOT_MAX_DECISION_ATTEMPTS} attempts.`,
              {
                interactionType: firstPendingInteraction.type,
                interactionId: firstPendingInteraction.id,
                botDifficulty,
              },
            );
            return;
          }
          continue;
        }

        const pending = publicState.pendingActions;
        let botUserId: string | null = null;
        if (pending) {
          const submitted = new Set(pending.submittedUserIds ?? []);
          botUserId =
            pending.requiredUserIds.find((candidateId) => botIds.has(candidateId) && !submitted.has(candidateId)) ??
            null;
          if (!botUserId) return;
        } else {
          const atBat = getCharactersAtEarliestE(beats, characters);
          botUserId = atBat.map((character) => character.userId).find((candidateId) => botIds.has(candidateId)) ?? null;
          if (!botUserId) return;
        }
        const { botDifficulty, botName } = await resolveBotDecisionContext(botUserId);

        const deckStates = await ensureDeckStatesForGame(game, match);
        const catalog = await loadCardCatalog();
        const actionCandidates = buildEasyBotActionCandidates({
          botUserId,
          publicState,
          deckStates,
          catalog,
        });
        if (!actionCandidates.length) {
          emitBotError(match, gameId, botUserId, `${botName} could not find a legal action set.`, {
            botDifficulty,
          });
          return;
        }

        const { topDistribution, orderedCandidates, selectionParams, fallbackToAll } = buildBotChoiceOrder(
          actionCandidates,
          botDifficulty,
        );
        writeDevTempEvent(BOT_TEMP_EVENT_CHANNEL, {
          stage: 'action:choices',
          gameId,
          botUserId,
          botName,
          botDifficulty,
          candidateCount: actionCandidates.length,
          selection: selectionParams,
          fallbackToAll,
          top: formatChoiceDistribution(topDistribution, (choice) => ({
            activeCardId: choice.activeCardId,
            passiveCardId: choice.passiveCardId,
            rotation: choice.rotation,
            scoreIndex: choice.scoreIndex,
          })),
        });

        let success = false;
        const attempts = Math.min(orderedCandidates.length, BOT_MAX_DECISION_ATTEMPTS);
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const candidate = orderedCandidates[attempt];
          const result = await submitActionSet({
            userId: botUserId,
            gameId,
            activeCardId: candidate.activeCardId,
            passiveCardId: candidate.passiveCardId,
            rotation: candidate.rotation,
          });
          writeDevTempEvent(BOT_TEMP_EVENT_CHANNEL, {
            stage: 'action:attempt',
            gameId,
            botUserId,
            botName,
            botDifficulty,
            attempt: attempt + 1,
            ok: result.ok,
            status: result.status,
            code: result.code ?? null,
            error: result.error ?? null,
            activeCardId: candidate.activeCardId,
            passiveCardId: candidate.passiveCardId,
            rotation: candidate.rotation,
            score: candidate.score,
          });
          if (result.ok) {
            success = true;
            break;
          }
        }

        if (!success) {
          emitBotError(
            match,
            gameId,
            botUserId,
            `${botName} failed to submit a legal move after ${BOT_MAX_DECISION_ATTEMPTS} attempts.`,
            { botDifficulty },
          );
          return;
        }
      }
      console.warn(`${LOG_PREFIX} bot:step-limit`, { gameId, limit: BOT_MAX_RUN_STEPS });
      writeDevTempEvent(BOT_TEMP_EVENT_CHANNEL, { stage: 'run:step-limit', gameId, limit: BOT_MAX_RUN_STEPS });
    } finally {
      botRunsInProgress.delete(gameId);
      if (botRunsQueued.has(gameId)) {
        botRunsQueued.delete(gameId);
        setTimeout(() => {
          void runBotsForGame(gameId, 'queued');
        }, 0);
      }
    }
  };

  const formatGameLog = (game: GameDoc, match?: MatchDoc) => {
    const usernameById = new Map<string, string>();
    match?.players.forEach((player) => {
      usernameById.set(player.userId, player.username);
    });
    const characters = game.state?.public ? ensureBaselineCharacters(game.state.public) : [];
    const beats = game.state?.public?.beats ?? [];
    const lines = ['[game:update] Player locations:'];
    if (!characters.length) {
      lines.push('- (none)');
    } else {
      characters.forEach((character) => {
        const name = usernameById.get(character.userId) ?? character.userId;
        const characterLabel = character.characterName ?? character.characterId ?? 'unknown';
        const position = character.position ? `q=${character.position.q} r=${character.position.r}` : 'unknown position';
        const facing = Number.isFinite(character.facing) ? ` facing=${character.facing}` : '';
        lines.push(`- ${name} [${characterLabel}]: ${position}${facing}`);
      });
    }
    lines.push('[game:update] Timeline:');
    lines.push(JSON.stringify(beats, null, 2));
    return lines.join('\n');
  };

  const logGameState = (game: GameDoc, match?: MatchDoc) => {
    console.log(formatGameLog(game, match));
  };

  const sendInputRequests = (match: MatchDoc | undefined, game: GameDoc) => {
    if (!match) return;
    const publicState = game.state.public;
    if (publicState.matchOutcome) return;
    const botIds = botUsersByGame.get(game.id) ?? new Set<string>();
    const pending = publicState.pendingActions;
    const interactions = publicState.customInteractions ?? [];
    const pendingInteraction = interactions.find((interaction) => interaction.status === 'pending');
    if (pendingInteraction) {
      const recipientId = getPendingInteractionRecipientId(pendingInteraction);
      if (!recipientId) return;
      const payload = {
        gameId: game.id,
        beatIndex: pendingInteraction.beatIndex,
        requiredUserIds: [recipientId],
        interactionId: pendingInteraction.id,
      };
      if (botIds.has(recipientId)) {
        scheduleBotRun(game.id, 'pending-interaction');
      } else {
        sendRealtimeEvent({ type: 'input:request', payload }, recipientId);
      }
      return;
    }
    if (pending) {
      const submitted = new Set(pending.submittedUserIds ?? []);
      pending.requiredUserIds.forEach((userId) => {
        if (!submitted.has(userId)) {
          if (botIds.has(userId)) {
            scheduleBotRun(game.id, 'pending-actions');
          } else {
            sendRealtimeEvent({ type: 'input:request', payload: { ...pending, gameId: game.id } }, userId);
          }
        }
      });
      return;
    }
    const beats = publicState.beats ?? publicState.timeline ?? [];
    const characters = ensureBaselineCharacters(publicState);
    const earliestIndex = getTimelineEarliestEIndex(beats, characters);
    const atBatCharacters = getCharactersAtEarliestE(beats, characters);
    const requiredUserIds = Array.from(new Set(atBatCharacters.map((candidate) => candidate.userId).filter(Boolean)));
    if (!requiredUserIds.length) return;
    requiredUserIds.forEach((userId) => {
      if (botIds.has(userId)) {
        scheduleBotRun(game.id, 'at-bat');
      } else {
        sendRealtimeEvent(
          { type: 'input:request', payload: { gameId: game.id, beatIndex: earliestIndex, requiredUserIds } },
          userId,
        );
      }
    });
  };

  const sendGameUpdate = (match: MatchDoc | undefined, game: GameDoc, deckStates?: Map<string, DeckState>) => {
    if (!match) return;
    const exited = matchExitUsers.get(game.id);
    match.players.forEach((player) => {
      if (exited?.has(player.userId)) return;
      const view = buildGameViewForPlayer(game, player.userId, deckStates);
      sendRealtimeEvent({ type: 'game:update', payload: view }, player.userId);
    });
    sendInputRequests(match, game);
  };

  const applyMatchOutcome = (game: GameDoc, deckStates?: Map<string, DeckState>) => {
    if (game.state.public.matchOutcome) return false;
    const beats = game.state.public.beats ?? game.state.public.timeline ?? [];
    const characters = ensureBaselineCharacters(game.state.public);
    const land = game.state.public.land ?? [];
    const resolvedDeckStates = deckStates ?? gameDeckStates.get(game.id);
    if (!resolvedDeckStates) return false;
    const outcome = evaluateMatchOutcome(beats, characters, resolvedDeckStates, land);
    if (!outcome) return false;
    applyMatchOutcomeToBeats(beats, characters, outcome, land);
    game.state.public.timeline = beats;
    game.state.public.beats = beats;
    game.state.public.matchOutcome = outcome;
    game.state.public.pendingActions = undefined;
    pendingActionSets.delete(game.id);
    return true;
  };

  const applyExplicitOutcome = (game: GameDoc, outcome: GameStateDoc['public']['matchOutcome']) => {
    if (!outcome) return;
    const beats = game.state.public.beats ?? game.state.public.timeline ?? [];
    const characters = ensureBaselineCharacters(game.state.public);
    const land = game.state.public.land ?? [];
    applyMatchOutcomeToBeats(beats, characters, outcome, land);
    game.state.public.beats = beats;
    game.state.public.timeline = beats;
    game.state.public.pendingActions = undefined;
    const interactions = Array.isArray(game.state.public.customInteractions) ? game.state.public.customInteractions : [];
    interactions.forEach((interaction) => {
      if (!interaction || interaction.status !== 'pending') return;
      interaction.status = 'resolved';
      interaction.resolution = { ...(interaction.resolution ?? {}), cancelledByOutcome: true };
    });
    game.state.public.customInteractions = interactions;
    game.state.public.matchOutcome = outcome;
    pendingActionSets.delete(game.id);
  };
  const handleJoin = async (body: Record<string, unknown>) => {
    const characterId = normalizeCharacterId(body.characterId || body.characterID);
    const user = await upsertUserFromRequest(body.userId as string, body.username as string, characterId);
    const assignedUser = await ensureUserCharacter(user);
    if (body.deck) {
      const catalog = await loadCardCatalog();
      const parsed = parseDeckDefinition(body.deck, catalog);
      if (!parsed.deck || parsed.errors.length) {
        const detail = parsed.errors.map((error) => error.message).join(' ');
        throw new Error(detail || 'Invalid deck payload');
      }
      if (parsed.deck.movement.length !== 4 || parsed.deck.ability.length !== 12) {
        throw new Error('Deck must include 4 movement cards and 12 ability cards.');
      }
      queuedDecks.set(assignedUser.id, parsed.deck);
    } else {
      queuedDecks.delete(assignedUser.id);
    }
    const queue = (body.queue as QueueName) || 'quickplayQueue';
    lobby.addToQueue(assignedUser.id, queue);
    if (queue === 'quickplayQueue') {
      console.log(`[lobby] ${assignedUser.username} (${assignedUser.id}) joined quickplay queue`);
    }
    if (isBotQueue(queue)) {
      const queueConfig = BOT_QUEUE_CONFIGS[queue] ?? BOT_DEFAULT_CONFIG;
      console.log(
        `[lobby] ${assignedUser.username} (${assignedUser.id}) requested ${queueConfig.username} (${queueConfig.difficulty}) match`,
      );
      try {
        await createBotMatchForUser({ id: assignedUser.id, username: assignedUser.username }, queue);
      } catch (err) {
        lobby.removeFromQueue(assignedUser.id, queue);
        const message = err instanceof Error ? err.message : `Failed to create ${queueConfig.username} match.`;
        throw new Error(message);
      }
    }
    return { user: assignedUser, lobby: lobby.serialize() };
  };

  const handleLeave = async (body: Record<string, unknown>) => {
    if (body.userId) {
      lobby.removeFromQueue(body.userId as string, body.queue as any);
      queuedDecks.delete(body.userId as string);
    }
    return { lobby: lobby.serialize() };
  };

  const createSkeletonGame = async (match: MatchDoc) =>
    db.createGame({
      matchId: match.id,
      players: match.players.map((player, index) => ({
        userId: player.userId,
        ready: true,
        turn: index === 0,
      })),
      timers: { turnSeconds: 60, incrementSeconds: 0 },
      outcome: undefined,
      state: await createInitialGameState(
        match.players.map((player) => ({
          userId: player.userId,
          username: player.username,
          characterId: player.characterId,
        })),
      ),
    });

  const notifyMatchPlayers = (match: MatchDoc, game: GameDoc) => {
    logGameState(game, match);
    const deckStates = gameDeckStates.get(game.id);
    match.players.forEach((player) => {
      sendRealtimeEvent({ type: 'match:created', payload: match }, player.userId);
      const view = buildGameViewForPlayer(game, player.userId, deckStates);
      sendRealtimeEvent({ type: 'game:update', payload: view }, player.userId);
    });
    sendInputRequests(match, game);
  };

  const createMatchWithUsers = async (users: Array<{ id: string; username?: string }>) => {
    const resolved = await Promise.all(users.map((user) => upsertUserFromRequest(user.id, user.username)));
    const withCharacters = await Promise.all(resolved.map((user) => ensureUserCharacter(user)));
    const matchUsernames = assignMatchUsernames(
      withCharacters.map((user) => ({
        id: user.id,
        username: user.username,
      })),
    );
    lobby.markInGame(withCharacters.map((user) => user.id));
    const match = await db.createMatch({
      players: withCharacters.map((user, index) => ({
        userId: user.id,
        username: matchUsernames[index] ?? user.username,
        score: 0,
        eloChange: 0,
        characterId: (user.characterId ?? pickRandomCharacterId()) as CharacterId,
      })),
      gameId: '',
      winsRequired,
      state: 'in-progress',
      winnerId: undefined,
      completedAt: undefined,
    });
    const game = await createSkeletonGame(match);
    const updatedMatch = await db.updateMatch(match.id, { gameId: game.id });
    const finalMatch = updatedMatch ?? match;
    await buildDeckStatesForMatch(finalMatch, game);
    const botIds = await getBotUserIdsForMatch(finalMatch);
    if (botIds.size) {
      botUsersByGame.set(game.id, botIds);
    } else {
      botUsersByGame.delete(game.id);
    }
    notifyMatchPlayers(finalMatch, game);
    return { match: finalMatch, game };
  };

  const createCustomMatch = async (body: Record<string, unknown>) =>
    createMatchWithUsers([
      { id: body.hostId as string, username: (body.hostName as string) || (body.hostId as string) },
      { id: body.guestId as string, username: (body.guestName as string) || (body.guestId as string) },
    ]);

  let matchmakeInProgress = false;
  const matchmakeQuickplay = async () => {
    if (matchmakeInProgress) return;
    matchmakeInProgress = true;
    try {
      let snapshot = lobby.serialize();
      while (snapshot.quickplayQueue.length >= 2) {
        const [first, second] = snapshot.quickplayQueue;
        if (!first || !second) break;
        await createMatchWithUsers([{ id: first }, { id: second }]);
        snapshot = lobby.serialize();
      }
    } finally {
      matchmakeInProgress = false;
    }
  };

  const sendActiveMatchState = async (userId: string) => {
    const match = await db.findActiveMatchByUser(userId);
    if (!match) return;
    if (match.gameId) {
      const exited = matchExitUsers.get(match.gameId);
      if (exited?.has(userId)) return;
    }
    sendRealtimeEvent({ type: 'match:created', payload: match }, userId);
    if (match.gameId) {
      const game = await db.findGame(match.gameId);
      if (game) {
        await ensureBotUsersForGame(game, match);
        const deckStates = await ensureDeckStatesForGame(game, match);
        logGameState(game, match);
        const view = buildGameViewForPlayer(game, userId, deckStates);
        sendRealtimeEvent({ type: 'game:update', payload: view }, userId);
        sendInputRequests(match, game);
      }
    }
  };

  const completeMatch = async (matchId: string, body: Record<string, unknown>) => {
    const match = await db.updateMatch(matchId, {
      state: 'complete',
      winnerId: body.winnerId as string,
      completedAt: new Date(),
    });
    if (!match) return undefined;
    const winner = match.players.find((player) => player.userId === body.winnerId);
    if (winner) {
      const delta = 15;
      match.players.forEach((player) => {
        const change = player.userId === winner.userId ? delta : -delta;
        player.eloChange = change;
      });
      for (const player of match.players) {
        const user = await db.findUser(player.userId);
        if (user) {
          user.elo += player.eloChange;
          user.updatedAt = new Date();
        }
      }
    }
    match.players.forEach((player) => lobby.removeFromQueue(player.userId));
    sendRealtimeEvent({ type: 'match:ended', payload: match });
    if (match.gameId) {
      gameDeckStates.delete(match.gameId);
      drawOfferCooldownByGame.delete(match.gameId);
      matchExitUsers.delete(match.gameId);
      botUsersByGame.delete(match.gameId);
      botRunsInProgress.delete(match.gameId);
      botRunsQueued.delete(match.gameId);
    }
    return match;
  };

  const serveEvents = async (req: any, res: any) => {
    const { query } = parse(req.url || '', true);
    const requestedUserId = (query?.userId as string) || randomUUID();
    const requestedUsername = typeof query?.username === 'string' ? query.username : undefined;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    const user = await upsertUserFromRequest(requestedUserId, requestedUsername);
    res.write(
      `data: ${JSON.stringify({ type: 'connected', payload: { userId: user.id, username: user.username, lobby: lobby.serialize() } })}\n\n`,
    );
    sseClients.set(user.id, res);
    pendingInvites.delete(user.id);
    void sendActiveMatchState(user.id);
    req.on('close', () => {
      sseClients.delete(user.id);
      matchDisconnects.forEach((set) => set.delete(user.id));
    });
  };

  const handleStatic = (res: any, path: string) => {
    const decodedPath = (() => {
      try {
        return decodeURIComponent(path);
      } catch {
        return path;
      }
    })();
    const resolved =
      decodedPath === '/'
        ? '/public/index.html'
        : decodedPath === '/admin' || decodedPath === '/admin/'
          ? '/public/admin.html'
          : decodedPath === '/cards' || decodedPath === '/cards/'
            ? '/public/cards.html'
            : decodedPath.startsWith('/public/')
              ? decodedPath
              : `/public${decodedPath}`;
    readFile(process.cwd() + resolved, (err, data) => {
      if (err) {
        notFound(res);
      } else {
        let type = 'text/plain';
        if (resolved.endsWith('.html')) type = 'text/html';
        if (resolved.endsWith('.css')) type = 'text/css';
        if (resolved.endsWith('.js') || resolved.endsWith('.mjs')) type = 'text/javascript';
        res.writeHead(200, { 'Content-Type': type });
        if (IS_DEV_RUNTIME && resolved.endsWith('.html')) {
          const html = data.toString('utf8').replaceAll(PROD_FAVICON_PATH, DEV_FAVICON_PATH);
          res.end(html);
          return;
        }
        res.end(data);
      }
    });
  };
  const submitActionSet = async (body: Record<string, unknown>): Promise<ActionSetResponse> => {
    const userId = (body.userId as string) || (body.userID as string);
    const gameId = (body.gameId as string) || (body.gameID as string);
    const activeCardId = (body.activeCardId as string) || (body.activeCardID as string);
    const passiveCardId = (body.passiveCardId as string) || (body.passiveCardID as string);
    const rotation = (body.rotation as string) ?? (body.rotationLabel as string);
    console.log(`${LOG_PREFIX} action:set request`, {
      userId,
      gameId,
      activeCardId,
      passiveCardId,
      rotation,
    });
    if (!userId || !gameId) {
      return { ok: false, status: 400, error: 'Invalid action set payload' };
    }
    const game = await db.findGame(gameId);
    if (!game) {
      return { ok: false, status: 404, error: 'Not found' };
    }
    const logActionSetEvent = (
      stage: string,
      extra: Record<string, unknown> = {},
      deckStates?: Map<string, DeckState>,
    ) => {
      writeDevTempEvent('action-set', {
        stage,
        userId,
        gameId,
        request: {
          activeCardId: activeCardId ?? null,
          passiveCardId: passiveCardId ?? null,
          rotation: rotation ?? '',
        },
        ...extra,
        publicState: buildPublicStateSnapshotForLog(game.state?.public),
        deckStates: buildDeckStatesSnapshotForLog(deckStates),
      });
    };
    logActionSetEvent('request');
    if (game.state?.public?.matchOutcome) {
      console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'match-ended' });
      logActionSetEvent('rejected', { reason: 'match-ended' });
      return { ok: false, status: 409, error: 'Match is already over' };
    }
    const characters = game.state?.public ? ensureBaselineCharacters(game.state.public) : [];
    const isPlayer = game.players.some((player) => player.userId === userId);
    const hasCharacter = characters.some((character) => character.userId === userId);
    if (!isPlayer || !hasCharacter) {
      console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'not-in-game' });
      logActionSetEvent('rejected', { reason: 'not-in-game' });
      return { ok: false, status: 403, error: 'User not in game' };
    }
    let interactions = game.state?.public?.customInteractions ?? [];
    const hasPendingInteractions = interactions.some((interaction) => interaction.status === 'pending');
    if (hasPendingInteractions) {
      console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'pending-interaction' });
      logActionSetEvent('rejected', { reason: 'pending-interaction' });
      return { ok: false, status: 409, error: 'Action set rejected: pending interaction in progress' };
    }
      const beats = game.state?.public?.beats ?? game.state?.public?.timeline ?? [];
      const character = characters.find((candidate) => candidate.userId === userId);
      const normalizedActiveCardId = typeof activeCardId === 'string' ? activeCardId.trim() : '';
      if (normalizedActiveCardId === WHIRLWIND_CARD_ID) {
        const resolvedIndex = getTimelineResolvedIndex(beats);
        const currentDamage =
          character && resolvedIndex >= 0
            ? getCharacterDamageAtIndex(beats, character, resolvedIndex)
            : character?.damage ?? 0;
        if (currentDamage < WHIRLWIND_MIN_DAMAGE) {
        console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'whirlwind-damage' });
        logActionSetEvent('rejected', { reason: 'whirlwind-damage', currentDamage });
        return {
          ok: false,
          status: 409,
          error: `Whirlwind requires at least ${WHIRLWIND_MIN_DAMAGE} damage to play.`,
          code: 'whirlwind-damage',
        };
        }
      }
      console.log(`${LOG_PREFIX} action:set pre`, {
        userId,
        gameId,
        earliestIndex: getTimelineEarliestEIndex(beats, characters),
      timeline: buildTimelineSummary(beats, characters),
      pendingActions: game.state?.public?.pendingActions ?? null,
    });
    if (!isCharacterAtEarliestE(beats, characters, character)) {
      console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'behind-earliest-e' });
      logActionSetEvent('rejected', { reason: 'behind-earliest-e' });
      return {
        ok: false,
        status: 409,
        error: 'Action set rejected: player is behind the earliest timeline beat',
      };
    }
    const earliestIndex = getTimelineEarliestEIndex(beats, characters);
    const atBatCharacters = getCharactersAtEarliestE(beats, characters);
    const atBatUserIds = Array.from(new Set(atBatCharacters.map((candidate) => candidate.userId).filter(Boolean)));
    const comboInteraction = findComboContinuation(interactions, userId, earliestIndex);
    const comboRequired = Boolean(comboInteraction);
    const match = await db.findMatch(game.matchId);
    const catalog = await loadCardCatalog();
    const deckStates = await ensureDeckStatesForGame(game, match);
    syncFocusedCardsFromInteractions(deckStates, interactions);
    const land = game.state?.public?.land ?? [];
    resolveLandRefreshes(
      deckStates,
      beats,
      characters,
      land,
      interactions,
      game.state?.public?.pendingActions,
      game.state?.public?.boardTokens ?? [],
    );
    const deckState = deckStates.get(userId);
    if (!deckState) {
      console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'missing-deck-state' });
      logActionSetEvent('rejected', { reason: 'missing-deck-state' }, deckStates);
      return { ok: false, status: 500, error: 'Missing deck state for player' };
    }
    if (atBatUserIds.length <= 1) {
      const validation = validateActionSubmission({ activeCardId, passiveCardId, rotation }, deckState, catalog);
      if (isActionValidationFailure(validation)) {
        console.log(`${LOG_PREFIX} action:set validation-failed`, {
          userId,
          gameId,
          error: validation.error,
        });
        return { ok: false, status: 400, error: validation.error.message, code: validation.error.code };
      }
      if (comboRequired) {
        const activeCard = catalog.cardsById.get(activeCardId ?? '');
        if (!cardHasCombo(activeCard)) {
          console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'combo-required' });
          return {
            ok: false,
            status: 409,
            error: 'Action set rejected: active card must include a Co step for combo follow-up',
            code: 'combo-required',
          };
        }
      }
      const actionList = comboRequired ? withComboStarter(validation.actionList) : validation.actionList;
      logActionSetEvent(
        'before-execute-single',
        {
          comboRequired,
          atBatUserIds,
          actionList: actionList.map((item) => ({
            action: item.action,
            rotation: item.rotation,
            priority: item.priority,
            cardId: item.cardId ?? null,
            passiveCardId: item.passiveCardId ?? null,
            interaction: item.interaction?.type ?? null,
          })),
        },
        deckStates,
      );
      console.log(`${LOG_PREFIX} action:set actionList`, {
        userId,
        gameId,
        actionList: actionList.map((item) => ({
          action: item.action,
          rotation: item.rotation,
          priority: item.priority,
          interaction: item.interaction?.type ?? null,
        })),
      });
      const pendingResult = applyCardUse(deckState, {
        movementCardId: validation.movementCardId,
        abilityCardId: validation.abilityCardId,
        activeCardId,
        passiveCardId,
      });
      if (!pendingResult.ok) {
        const error = (pendingResult as { error: { message: string; code: string } }).error;
        console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: error.code, error });
        return { ok: false, status: 409, error: error.message, code: error.code };
      }
      if (comboInteraction) {
        interactions = interactions.filter((item) => item.id !== comboInteraction.id);
        game.state.public.customInteractions = interactions;
      }
      const actionListWithHandCount = withAbilityHandCountAtActionStart(actionList, deckState.abilityHand.length);
      pendingActionSets.delete(game.id);
      game.state.public.pendingActions = undefined;
      const actionPlay = {
        type: 'action-set',
        activeCardId: activeCardId ?? null,
        passiveCardId: passiveCardId ?? null,
        rotation: rotation ?? '',
      };
      const updatedBeats = applyActionSetToBeats(beats, characters, userId, actionListWithHandCount, [actionPlay]);
      const comboAvailability = buildComboAvailability(deckStates, catalog);
      const handTriggerAvailability = buildHandTriggerAvailability(deckStates);
      const guardContinueAvailability = buildGuardContinueAvailability(deckStates);
      const executed = executeWithForcedRewindReturns({
        beats: updatedBeats,
        characters,
        interactions,
        land,
        comboAvailability,
        handTriggerAvailability,
        guardContinueAvailability,
        deckStates,
        initialTokens: game.state.public.boardTokens ?? [],
      });
      game.state.public.beats = executed.beats;
      game.state.public.timeline = executed.beats;
      resetCharactersToBaseline(game.state.public);
      game.state.public.customInteractions = executed.interactions;
      game.state.public.boardTokens = executed.boardTokens;
      applyDrawInteractions(deckStates, executed.interactions);
      resolveLandRefreshes(
        deckStates,
        executed.beats,
        executed.characters,
        land,
        executed.interactions,
        undefined,
        game.state.public.boardTokens ?? [],
      );
      applyMatchOutcome(game, deckStates);
      console.log(`${LOG_PREFIX} action:set post`, {
        userId,
        gameId,
        timeline: buildTimelineSummary(executed.beats, executed.characters),
        lastCalculated: executed.lastCalculated,
        pendingInteractions: executed.interactions.filter((item) => item.status === 'pending').length,
      });
      logActionSetEvent(
        'after-execute-single',
        {
          lastCalculated: executed.lastCalculated,
          pendingInteractions: executed.interactions.filter((item) => item.status === 'pending').length,
        },
        deckStates,
      );
      const updatedGame = (await db.updateGame(game.id, { state: game.state })) ?? game;
      sendGameUpdate(match, updatedGame, deckStates);
      const view = buildGameViewForPlayer(updatedGame, userId, deckStates);
      return { ok: true, status: 200, payload: view };
    }

    let batch = pendingActionSets.get(game.id);
    if (!batch || batch.beatIndex !== earliestIndex) {
      batch = { beatIndex: earliestIndex, requiredUserIds: atBatUserIds, submitted: new Map() };
      pendingActionSets.set(game.id, batch);
    }
    if (!batch.requiredUserIds.includes(userId)) {
      console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'not-required' });
      return { ok: false, status: 409, error: 'Action set rejected: player is not required for current beat' };
    }
    if (batch.submitted.has(userId)) {
      console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'already-submitted' });
      return { ok: false, status: 409, error: 'Action set already submitted for this beat' };
    }
    const validation = validateActionSubmission({ activeCardId, passiveCardId, rotation }, deckState, catalog);
    if (isActionValidationFailure(validation)) {
      console.log(`${LOG_PREFIX} action:set validation-failed`, {
        userId,
        gameId,
        error: validation.error,
      });
      return { ok: false, status: 400, error: validation.error.message, code: validation.error.code };
    }
    if (comboRequired) {
      const activeCard = catalog.cardsById.get(activeCardId ?? '');
      if (!cardHasCombo(activeCard)) {
        console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: 'combo-required' });
        return {
          ok: false,
          status: 409,
          error: 'Action set rejected: active card must include a Co step for combo follow-up',
          code: 'combo-required',
        };
      }
    }
    const actionList = comboRequired ? withComboStarter(validation.actionList) : validation.actionList;
    console.log(`${LOG_PREFIX} action:set actionList`, {
      userId,
      gameId,
      actionList: actionList.map((item) => ({
        action: item.action,
        rotation: item.rotation,
        priority: item.priority,
        interaction: item.interaction?.type ?? null,
      })),
    });
    const pendingResult = applyCardUse(deckState, {
      movementCardId: validation.movementCardId,
      abilityCardId: validation.abilityCardId,
      activeCardId,
      passiveCardId,
    });
    if (!pendingResult.ok) {
      const error = (pendingResult as { error: { message: string; code: string } }).error;
      console.log(`${LOG_PREFIX} action:set rejected`, { userId, gameId, reason: error.code, error });
      return { ok: false, status: 409, error: error.message, code: error.code };
    }
    if (comboInteraction) {
      interactions = interactions.filter((item) => item.id !== comboInteraction.id);
      game.state.public.customInteractions = interactions;
    }
    const actionListWithHandCount = withAbilityHandCountAtActionStart(actionList, deckState.abilityHand.length);
    const actionPlay = {
      type: 'action-set',
      activeCardId: activeCardId ?? null,
      passiveCardId: passiveCardId ?? null,
      rotation: rotation ?? '',
    };
    batch.submitted.set(userId, { actionList: actionListWithHandCount, play: [actionPlay] });
    game.state.public.pendingActions = {
      beatIndex: batch.beatIndex,
      requiredUserIds: [...batch.requiredUserIds],
      submittedUserIds: Array.from(batch.submitted.keys()),
    };
    logActionSetEvent(
      'pending-batch',
      {
        beatIndex: batch.beatIndex,
        requiredUserIds: [...batch.requiredUserIds],
        submittedUserIds: Array.from(batch.submitted.keys()),
      },
      deckStates,
    );
    console.log(`${LOG_PREFIX} action:set pending`, {
      gameId,
      beatIndex: batch.beatIndex,
      requiredUserIds: batch.requiredUserIds,
      submittedUserIds: Array.from(batch.submitted.keys()),
    });
    const pendingGame = (await db.updateGame(game.id, { state: game.state })) ?? game;
    sendGameUpdate(match, pendingGame, deckStates);
    if (batch.submitted.size < batch.requiredUserIds.length) {
      const view = buildGameViewForPlayer(pendingGame, userId, deckStates);
      return { ok: true, status: 200, payload: view };
    }
    let updatedBeats = beats;
    logActionSetEvent(
      'before-execute-batch',
      {
        beatIndex: batch.beatIndex,
        requiredUserIds: [...batch.requiredUserIds],
        submittedUserIds: Array.from(batch.submitted.keys()),
      },
      deckStates,
    );
    batch.requiredUserIds.forEach((requiredId) => {
      const submission = batch?.submitted.get(requiredId);
      if (submission) {
        updatedBeats = applyActionSetToBeats(updatedBeats, characters, requiredId, submission.actionList, submission.play);
      }
    });
    const comboAvailability = buildComboAvailability(deckStates, catalog);
    const handTriggerAvailability = buildHandTriggerAvailability(deckStates);
    const guardContinueAvailability = buildGuardContinueAvailability(deckStates);
    const executed = executeWithForcedRewindReturns({
      beats: updatedBeats,
      characters,
      interactions,
      land,
      comboAvailability,
      handTriggerAvailability,
      guardContinueAvailability,
      deckStates,
      initialTokens: game.state.public.boardTokens ?? [],
    });
    game.state.public.beats = executed.beats;
    game.state.public.timeline = executed.beats;
    resetCharactersToBaseline(game.state.public);
    game.state.public.customInteractions = executed.interactions;
    game.state.public.boardTokens = executed.boardTokens;
    applyDrawInteractions(deckStates, executed.interactions);
    resolveLandRefreshes(
      deckStates,
      executed.beats,
      executed.characters,
      land,
      executed.interactions,
      undefined,
      game.state.public.boardTokens ?? [],
    );
    game.state.public.pendingActions = undefined;
    pendingActionSets.delete(game.id);
    applyMatchOutcome(game, deckStates);
    console.log(`${LOG_PREFIX} action:set post`, {
      userId,
      gameId,
      timeline: buildTimelineSummary(executed.beats, executed.characters),
      lastCalculated: executed.lastCalculated,
      pendingInteractions: executed.interactions.filter((item) => item.status === 'pending').length,
    });
    logActionSetEvent(
      'after-execute-batch',
      {
        beatIndex: batch.beatIndex,
        lastCalculated: executed.lastCalculated,
        pendingInteractions: executed.interactions.filter((item) => item.status === 'pending').length,
      },
      deckStates,
    );
    const updatedGame = (await db.updateGame(game.id, { state: game.state })) ?? game;
    sendGameUpdate(match, updatedGame, deckStates);
    const view = buildGameViewForPlayer(updatedGame, userId, deckStates);
    return { ok: true, status: 200, payload: view };
  };

  const submitForfeit = async (body: Record<string, unknown>): Promise<ActionSetResponse> => {
    const userId = (body.userId as string) || (body.userID as string);
    const gameId = (body.gameId as string) || (body.gameID as string);
    if (!userId || !gameId) {
      return { ok: false, status: 400, error: 'Invalid forfeit payload' };
    }
    const game = await db.findGame(gameId);
    if (!game) return { ok: false, status: 404, error: 'Not found' };
    if (game.state?.public?.matchOutcome) {
      return { ok: false, status: 409, error: 'Match is already over' };
    }
    const characters = game.state?.public ? ensureBaselineCharacters(game.state.public) : [];
    const loser = characters.find((character) => character.userId === userId || character.username === userId);
    if (!loser) {
      return { ok: false, status: 403, error: 'User not in game' };
    }
    const winner = characters.find((character) => character.userId !== loser.userId);
    if (!winner) {
      return { ok: false, status: 409, error: 'Unable to resolve forfeit winner' };
    }
    const beats = game.state.public.beats ?? game.state.public.timeline ?? [];
    const beatIndex = Math.max(0, getTimelineEarliestEIndex(beats, characters));
    const outcome: GameStateDoc['public']['matchOutcome'] = {
      winnerUserId: winner.userId,
      loserUserId: loser.userId,
      reason: 'forfeit',
      beatIndex,
    };
    applyExplicitOutcome(game, outcome);
    const interactions = game.state.public.customInteractions ?? [];
    interactions.forEach((interaction) => {
      if (!interaction || interaction.status !== 'pending') return;
      if (interaction.type !== DRAW_OFFER_INTERACTION_TYPE) return;
      interaction.status = 'resolved';
      interaction.resolution = { ...(interaction.resolution ?? {}), accepted: false, supersededByForfeit: true };
    });
    game.state.public.customInteractions = interactions;
    const match = await db.findMatch(game.matchId);
    const deckStates = await ensureDeckStatesForGame(game, match);
    const updatedGame = (await db.updateGame(game.id, { state: game.state })) ?? game;
    sendGameUpdate(match, updatedGame, deckStates);
    const view = buildGameViewForPlayer(updatedGame, userId, deckStates);
    return { ok: true, status: 200, payload: view };
  };

  const submitDrawOffer = async (body: Record<string, unknown>): Promise<ActionSetResponse> => {
    const userId = (body.userId as string) || (body.userID as string);
    const gameId = (body.gameId as string) || (body.gameID as string);
    if (!userId || !gameId) {
      return { ok: false, status: 400, error: 'Invalid draw offer payload' };
    }
    const game = await db.findGame(gameId);
    if (!game) return { ok: false, status: 404, error: 'Not found' };
    if (game.state?.public?.matchOutcome) {
      return { ok: false, status: 409, error: 'Match is already over' };
    }
    const characters = game.state?.public ? ensureBaselineCharacters(game.state.public) : [];
    const offerer = characters.find((character) => character.userId === userId || character.username === userId);
    if (!offerer) {
      return { ok: false, status: 403, error: 'User not in game' };
    }
    const opponent = characters.find((character) => character.userId !== offerer.userId);
    if (!opponent) {
      return { ok: false, status: 409, error: 'Unable to find draw offer recipient' };
    }
    const opponentUser = await db.findUser(opponent.userId);
    const nowMs = Date.now();
    const remainingSeconds = getDrawOfferCooldownRemainingSeconds(game.id, offerer.userId, nowMs);
    if (remainingSeconds > 0) {
      return {
        ok: false,
        status: 429,
        error: `You cannot offer draw so soon again, please wait ${remainingSeconds} seconds.`,
        code: 'draw-offer-cooldown',
        details: { remainingSeconds },
      };
    }
    const interactions = game.state.public.customInteractions ?? [];
    const pendingOffer = interactions.find(
      (interaction) => interaction?.type === DRAW_OFFER_INTERACTION_TYPE && interaction?.status === 'pending',
    );
    if (pendingOffer) {
      return { ok: false, status: 409, error: 'A draw offer is already pending.', code: 'draw-offer-pending' };
    }
    const beats = game.state.public.beats ?? game.state.public.timeline ?? [];
    const beatIndex = Math.max(0, getTimelineEarliestEIndex(beats, characters));
    const interactionId = `${DRAW_OFFER_INTERACTION_TYPE}:${beatIndex}:${offerer.userId}:${opponent.userId}:${randomUUID()}`;
    if (opponentUser?.isBot) {
      const botDifficulty = normalizeBotDifficulty(opponentUser?.botDifficulty);
      const botDamage = getCharacterDamageAtIndex(beats, opponent, beatIndex);
      const playerDamage = getCharacterDamageAtIndex(beats, offerer, beatIndex);
      const accepted = shouldBotAcceptDrawOffer(botDifficulty, botDamage, playerDamage);
      interactions.push({
        id: interactionId,
        type: DRAW_OFFER_INTERACTION_TYPE,
        beatIndex,
        actorUserId: opponent.userId,
        targetUserId: opponent.userId,
        sourceUserId: offerer.userId,
        status: 'resolved',
        resolution: {
          offererUserId: offerer.userId,
          accepted,
          autoResolvedByBot: true,
          botDifficulty,
          botDamage,
          playerDamage,
        },
      });
      if (accepted) {
        const drawUserIds = Array.from(new Set([offerer.userId, opponent.userId]));
        applyExplicitOutcome(game, {
          reason: 'draw-agreement',
          beatIndex,
          drawUserIds,
        });
        interactions.forEach((candidate) => {
          if (!candidate || candidate.id === interactionId) return;
          if (candidate.type !== DRAW_OFFER_INTERACTION_TYPE || candidate.status !== 'pending') return;
          candidate.status = 'resolved';
          candidate.resolution = { ...(candidate.resolution ?? {}), accepted: false, supersededByDraw: true };
        });
      }
    } else {
      interactions.push({
        id: interactionId,
        type: DRAW_OFFER_INTERACTION_TYPE,
        beatIndex,
        actorUserId: opponent.userId,
        targetUserId: opponent.userId,
        sourceUserId: offerer.userId,
        status: 'pending',
        resolution: { offererUserId: offerer.userId },
      });
    }
    game.state.public.customInteractions = interactions;
    setDrawOfferCooldown(game.id, offerer.userId, nowMs);
    const match = await db.findMatch(game.matchId);
    const deckStates = await ensureDeckStatesForGame(game, match);
    const updatedGame = (await db.updateGame(game.id, { state: game.state })) ?? game;
    sendGameUpdate(match, updatedGame, deckStates);
    const view = buildGameViewForPlayer(updatedGame, userId, deckStates);
    return { ok: true, status: 200, payload: view };
  };

  const resolveInteraction = async (body: Record<string, unknown>): Promise<ActionSetResponse> => {
    const userId = (body.userId as string) || (body.userID as string);
    const gameId = (body.gameId as string) || (body.gameID as string);
    const interactionId = (body.interactionId as string) || (body.interactionID as string);
    const directionIndex = (body.directionIndex as number) ?? (body.direction as number);
    console.log(`${LOG_PREFIX} interaction:resolve request`, { userId, gameId, interactionId, directionIndex });
    if (!userId || !gameId || !interactionId) {
      return { ok: false, status: 400, error: 'Invalid interaction payload' };
    }
    const game = await db.findGame(gameId);
    if (!game) {
      return { ok: false, status: 404, error: 'Not found' };
    }
    const logInteractionEvent = (
      stage: string,
      extra: Record<string, unknown> = {},
      deckStates?: Map<string, DeckState>,
    ) => {
      writeDevTempEvent('interaction-resolve', {
        stage,
        userId,
        gameId,
        interactionId,
        request: {
          directionIndex: directionIndex ?? null,
        },
        ...extra,
        publicState: buildPublicStateSnapshotForLog(game.state?.public),
        deckStates: buildDeckStatesSnapshotForLog(deckStates),
      });
    };
    logInteractionEvent('request');
    if (game.state?.public?.matchOutcome) {
      console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'match-ended' });
      logInteractionEvent('rejected', { reason: 'match-ended' });
      return { ok: false, status: 409, error: 'Match is already over' };
    }
    const characters = game.state?.public ? ensureBaselineCharacters(game.state.public) : [];
    const isPlayer = game.players.some((player) => player.userId === userId);
    const hasCharacter = characters.some((character) => character.userId === userId);
    if (!isPlayer || !hasCharacter) {
      console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'not-in-game' });
      logInteractionEvent('rejected', { reason: 'not-in-game' });
      return { ok: false, status: 403, error: 'User not in game' };
    }
    const interactions = game.state?.public?.customInteractions ?? [];
    const interaction = interactions.find((item) => item.id === interactionId);
    if (!interaction || interaction.status !== 'pending') {
      console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'not-pending' });
      logInteractionEvent('rejected', { reason: 'not-pending' });
      return { ok: false, status: 409, error: 'Interaction is no longer pending' };
    }
    if (interaction.actorUserId !== userId) {
      console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'not-authorized' });
      logInteractionEvent('rejected', { reason: 'not-authorized' });
      return { ok: false, status: 403, error: 'User is not authorized to resolve this interaction' };
    }
    const beats = game.state?.public?.beats ?? game.state?.public?.timeline ?? [];
    const land = game.state?.public?.land ?? [];
    const match = await db.findMatch(game.matchId);
    const deckStates = await ensureDeckStatesForGame(game, match);
    syncFocusedCardsFromInteractions(deckStates, interactions);
    const catalog = await loadCardCatalog();
    const comboAvailability = buildComboAvailability(deckStates, catalog);
    logInteractionEvent(
      'before-resolve',
      {
        interactionType: interaction.type,
        interactionStatus: interaction.status,
      },
      deckStates,
    );

    if (interaction.type === DRAW_OFFER_INTERACTION_TYPE) {
      const rawAccept = (body as { acceptDraw?: unknown; accept?: unknown; continue?: unknown; continueDraw?: unknown })
        ?.acceptDraw;
      const altAccept = (body as { accept?: unknown })?.accept;
      const altContinue = (body as { continue?: unknown; continueDraw?: unknown })?.continue;
      const altContinueDraw = (body as { continueDraw?: unknown })?.continueDraw;
      const resolvedAccept =
        typeof rawAccept === 'boolean'
          ? rawAccept
          : typeof altAccept === 'boolean'
            ? altAccept
            : typeof altContinue === 'boolean'
              ? altContinue
              : typeof altContinueDraw === 'boolean'
                ? altContinueDraw
                : null;
      if (resolvedAccept === null) {
        console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'invalid-draw-offer-choice' });
        return { ok: false, status: 400, error: 'Invalid draw choice' };
      }
      const offererUserId = `${interaction.sourceUserId ?? interaction.resolution?.offererUserId ?? ''}`.trim();
      interaction.status = 'resolved';
      interaction.resolution = {
        ...(interaction.resolution ?? {}),
        accepted: resolvedAccept,
        offererUserId: offererUserId || undefined,
      };
      if (resolvedAccept) {
        const drawUserIds = Array.from(
          new Set(
            [interaction.actorUserId, offererUserId]
              .map((value) => `${value ?? ''}`.trim())
              .filter((value) => Boolean(value)),
          ),
        );
        const beatIndex = Math.max(0, getTimelineEarliestEIndex(beats, characters));
        applyExplicitOutcome(game, {
          reason: 'draw-agreement',
          beatIndex,
          drawUserIds,
        });
        interactions.forEach((candidate) => {
          if (!candidate || candidate.id === interaction.id) return;
          if (candidate.type !== DRAW_OFFER_INTERACTION_TYPE || candidate.status !== 'pending') return;
          candidate.status = 'resolved';
          candidate.resolution = { ...(candidate.resolution ?? {}), accepted: false, supersededByDraw: true };
        });
      }
      const updatedGame = (await db.updateGame(game.id, { state: game.state })) ?? game;
      sendGameUpdate(match, updatedGame, deckStates);
      const view = buildGameViewForPlayer(updatedGame, userId, deckStates);
      return { ok: true, status: 200, payload: view };
    } else if (interaction.type === 'throw') {
      const resolvedDirection = Number(directionIndex);
      if (!Number.isFinite(resolvedDirection) || resolvedDirection < 0 || resolvedDirection > 5) {
        console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'invalid-direction' });
        return { ok: false, status: 400, error: 'Invalid throw direction' };
      }
      interaction.status = 'resolved';
      interaction.resolution = { directionIndex: Math.round(resolvedDirection) };
    } else if (
      interaction.type === 'combo' ||
      interaction.type === GUARD_CONTINUE_INTERACTION_TYPE ||
      interaction.type === REWIND_RETURN_INTERACTION_TYPE
    ) {
      const rawContinue = (body as { continueCombo?: unknown; comboContinue?: unknown })?.continueCombo;
      const altContinue = (body as { comboContinue?: unknown })?.comboContinue;
      const rawGuardContinue = (body as { continueGuard?: unknown; guardContinue?: unknown })?.continueGuard;
      const altGuardContinue = (body as { guardContinue?: unknown })?.guardContinue;
      const rawRewindReturn = (body as { returnToAnchor?: unknown; rewindReturn?: unknown })?.returnToAnchor;
      const altRewindReturn = (body as { rewindReturn?: unknown })?.rewindReturn;
      const fallbackContinue = (body as { continue?: unknown })?.continue;
      const fallbackReturn = (body as { return?: unknown })?.return;
      const resolvedContinue =
        typeof rawContinue === 'boolean'
          ? rawContinue
          : typeof altContinue === 'boolean'
            ? altContinue
            : typeof rawGuardContinue === 'boolean'
              ? rawGuardContinue
              : typeof altGuardContinue === 'boolean'
                ? altGuardContinue
                : typeof fallbackContinue === 'boolean'
                  ? fallbackContinue
                  : typeof rawRewindReturn === 'boolean'
                    ? rawRewindReturn
                    : typeof altRewindReturn === 'boolean'
                      ? altRewindReturn
                      : typeof fallbackReturn === 'boolean'
                        ? fallbackReturn
                        : null;
      if (resolvedContinue === null) {
        const reason =
          interaction.type === 'combo'
            ? 'invalid-combo-choice'
            : interaction.type === GUARD_CONTINUE_INTERACTION_TYPE
              ? 'invalid-guard-choice'
              : 'invalid-rewind-choice';
        const error =
          interaction.type === 'combo'
            ? 'Invalid combo choice'
            : interaction.type === GUARD_CONTINUE_INTERACTION_TYPE
              ? 'Invalid guard choice'
              : 'Invalid rewind choice';
        console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason });
        return { ok: false, status: 400, error };
      }
      interaction.status = 'resolved';
      if (interaction.type === REWIND_RETURN_INTERACTION_TYPE) {
        interaction.resolution = {
          ...(interaction.resolution ?? {}),
          returnToAnchor: resolvedContinue,
        };
      } else {
        interaction.resolution = { continue: resolvedContinue };
      }
    } else if (interaction.type === 'haven-platform') {
      const rawTargetHex = (body as { targetHex?: unknown })?.targetHex;
      const fallbackQ = (body as { q?: unknown; targetQ?: unknown; hexQ?: unknown })?.q ??
        (body as { targetQ?: unknown })?.targetQ ??
        (body as { hexQ?: unknown })?.hexQ;
      const fallbackR = (body as { r?: unknown; targetR?: unknown; hexR?: unknown })?.r ??
        (body as { targetR?: unknown })?.targetR ??
        (body as { hexR?: unknown })?.hexR;
      const parsedTarget = (() => {
        if (rawTargetHex && typeof rawTargetHex === 'object') {
          const raw = rawTargetHex as { q?: unknown; r?: unknown };
          const q = Number(raw.q);
          const r = Number(raw.r);
          if (Number.isFinite(q) && Number.isFinite(r)) {
            return { q: Math.round(q), r: Math.round(r) };
          }
        }
        const q = Number(fallbackQ);
        const r = Number(fallbackR);
        if (Number.isFinite(q) && Number.isFinite(r)) {
          return { q: Math.round(q), r: Math.round(r) };
        }
        return null;
      })();
      if (!parsedTarget) {
        console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'invalid-target-hex' });
        return { ok: false, status: 400, error: 'Invalid ethereal platform target.' };
      }

      const actor = characters.find((candidate) => candidate.userId === userId || candidate.username === userId);
      if (!actor) {
        console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'missing-actor' });
        return { ok: false, status: 400, error: 'Missing interaction actor.' };
      }
      const interactionBeat = Number.isFinite(interaction.beatIndex) ? Math.max(0, Math.round(interaction.beatIndex)) : 0;
      const beat = beats[interactionBeat] ?? [];
      const beatEntry =
        beat.find((entry) => {
          const key = entry?.username ?? entry?.userId ?? entry?.userID;
          return key === actor.userId || key === actor.username;
        }) ?? null;
      const actorOrigin =
        beatEntry?.location ??
        getCharacterLocationAtIndex(beats, actor, interactionBeat) ??
        actor.position;
      const touching = [
        { q: Math.round(actorOrigin.q), r: Math.round(actorOrigin.r) },
        ...AXIAL_DIRECTIONS.map((direction) => ({
          q: Math.round(actorOrigin.q + direction.q),
          r: Math.round(actorOrigin.r + direction.r),
        })),
      ];
      const touchingKeys = new Set(touching.map((coord) => `${coord.q},${coord.r}`));
      const targetKey = `${parsedTarget.q},${parsedTarget.r}`;
      if (!touchingKeys.has(targetKey)) {
        console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'out-of-range-target-hex' });
        return { ok: false, status: 400, error: 'Target must be touching your character.' };
      }

      interaction.status = 'resolved';
      interaction.touchingHexes = touching;
      interaction.resolution = {
        ...(interaction.resolution ?? {}),
        targetHex: parsedTarget,
      };
    } else if (interaction.type === 'draw') {
      const deckState = deckStates.get(userId);
      if (!deckState) {
        console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'missing-deck-state' });
        return { ok: false, status: 500, error: 'Missing deck state for player' };
      }
      const drawCount = Number.isFinite(interaction.drawCount) ? Math.max(0, Math.floor(interaction.drawCount)) : 0;
      const requirement = getDrawSelectionRequirement(deckState, drawCount);
      const movementCardIds =
        (body as { movementCardIds?: unknown; movementIds?: unknown; movementCardIDs?: unknown })?.movementCardIds ??
        (body as { movementIds?: unknown })?.movementIds ??
        (body as { movementCardIDs?: unknown })?.movementCardIDs ??
        [];
      const movementList = Array.isArray(movementCardIds) ? movementCardIds : [];
      if (requirement.requiredRestore !== movementList.length) {
        console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'draw-count-mismatch' });
        return { ok: false, status: 400, error: 'Incorrect number of movement cards selected to draw.' };
      }
      const drawResult = drawAbilityCards(deckState, drawCount, {
        restoreMovementIds: movementList,
        mode: requirement.requiredRestore > 0 ? 'strict' : 'auto',
      });
      if ('error' in drawResult) {
        console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: drawResult.error.code });
        return { ok: false, status: 400, error: drawResult.error.message, code: drawResult.error.code };
      }
      interaction.status = 'resolved';
      interaction.resolution = {
        ...(interaction.resolution ?? {}),
        applied: true,
        movementCardIds: drawResult.movement.restored,
        abilityCardIds: drawResult.drawn,
      };
    } else if (interaction.type === 'hand-trigger') {
      const rawUse = (body as { use?: unknown; accept?: unknown; ignite?: unknown; burn?: unknown })?.use;
      const altUse = (body as { accept?: unknown })?.accept;
      const igniteUse = (body as { ignite?: unknown; burn?: unknown })?.ignite;
      const burnUse = (body as { burn?: unknown })?.burn;
      const resolvedUse =
        typeof rawUse === 'boolean'
          ? rawUse
          : typeof altUse === 'boolean'
            ? altUse
            : typeof igniteUse === 'boolean'
              ? igniteUse
              : typeof burnUse === 'boolean'
                ? burnUse
                : null;
      if (resolvedUse === null) {
        console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'invalid-hand-trigger' });
        return { ok: false, status: 400, error: 'Invalid hand trigger choice' };
      }
      if (!resolvedUse) {
        interaction.status = 'resolved';
        interaction.resolution = { use: false };
      } else {
        const deckState = deckStates.get(userId);
        if (!deckState) {
          console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'missing-deck-state' });
          return { ok: false, status: 500, error: 'Missing deck state for player' };
        }
        const cardId = interaction.cardId ?? interaction.abilityCardId;
        const definition = cardId ? HAND_TRIGGER_BY_ID.get(cardId) : null;
        if (!cardId || !definition) {
          console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'unknown-hand-trigger' });
          return { ok: false, status: 400, error: 'Unknown hand trigger card' };
        }
        if (definition.cardType === 'ability') {
          if (!deckState.abilityHand.includes(cardId)) {
            console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'card-not-in-hand' });
            return { ok: false, status: 400, error: 'Card is not in hand.' };
          }
          const { movementDiscardCount } = getDiscardRequirements(deckState, definition.discardCount);
          const movementCardIds =
            (body as { movementCardIds?: unknown; movementIds?: unknown; movementCardIDs?: unknown })?.movementCardIds ??
            (body as { movementIds?: unknown })?.movementIds ??
            (body as { movementCardIDs?: unknown })?.movementCardIDs ??
            [];
          const movementList = Array.isArray(movementCardIds) ? movementCardIds : [];
          if (movementDiscardCount !== movementList.length) {
            console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'discard-count-mismatch' });
            return { ok: false, status: 400, error: 'Incorrect number of movement cards selected for discard.' };
          }
          const discardResult: AbilityDiscardResult = discardAbilityCards(deckState, [cardId], {
            discardMovementIds: movementList,
            mode: 'strict',
          });
          if (isAbilityDiscardFailure(discardResult)) {
            console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: discardResult.error.code });
            return { ok: false, status: 400, error: discardResult.error.message, code: discardResult.error.code };
          }
          if (cardId === 'vengeance') {
            const drawCount = Number.isFinite(interaction.drawCount) ? Math.max(0, Math.floor(interaction.drawCount)) : 0;
            if (drawCount > 0) {
              const drawResult = drawAbilityCards(deckState, drawCount, { mode: 'auto' });
              if ('error' in drawResult) {
                console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: drawResult.error.code });
                return { ok: false, status: 400, error: drawResult.error.message, code: drawResult.error.code };
              }
            }
          }
          interaction.status = 'resolved';
          interaction.resolution = {
            use: true,
            movementCardIds: discardResult.movement.discarded,
            abilityCardIds: discardResult.discarded,
          };
        } else if (definition.cardType === 'movement') {
          const movementHand = getMovementHandIds(deckState);
          if (!movementHand.includes(cardId)) {
            console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'card-not-in-hand' });
            return { ok: false, status: 400, error: 'Card is not in hand.' };
          }
          if (!deckState.abilityHand.length) {
            console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'missing-ability' });
            return { ok: false, status: 400, error: 'Ability card required for discard.' };
          }
          const abilityCardIds =
            (body as { abilityCardIds?: unknown; abilityIds?: unknown; abilityCardIDs?: unknown })?.abilityCardIds ??
            (body as { abilityIds?: unknown })?.abilityIds ??
            (body as { abilityCardIDs?: unknown })?.abilityCardIDs ??
            [];
          const abilityList = Array.isArray(abilityCardIds) ? abilityCardIds : [];
          if (abilityList.length !== 1) {
            console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'discard-count-mismatch' });
            return { ok: false, status: 400, error: 'Incorrect number of ability cards selected for discard.' };
          }
          const { movementDiscardCount } = getDiscardRequirements(deckState, 1);
          if (movementDiscardCount !== 1) {
            console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'movement-discard-required' });
            return { ok: false, status: 400, error: 'Movement discard must follow hand size rules.' };
          }
          const discardResult: AbilityDiscardResult = discardAbilityCards(deckState, abilityList, {
            discardMovementIds: [cardId],
            mode: 'strict',
          });
          if (isAbilityDiscardFailure(discardResult)) {
            console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: discardResult.error.code });
            return { ok: false, status: 400, error: discardResult.error.message, code: discardResult.error.code };
          }
          interaction.status = 'resolved';
          interaction.resolution = {
            use: true,
            movementCardIds: discardResult.movement.discarded,
            abilityCardIds: discardResult.discarded,
          };
        } else {
          console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'hand-trigger-type' });
          return { ok: false, status: 400, error: 'Unsupported hand trigger type' };
        }
      }
    } else if (interaction.type === 'discard') {
      const deckState = deckStates.get(userId);
      if (!deckState) {
        console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'missing-deck-state' });
        return { ok: false, status: 500, error: 'Missing deck state for player' };
      }
      const { abilityDiscardCount, movementDiscardCount } = getDiscardRequirements(
        deckState,
        interaction.discardCount ?? 0,
      );
      const abilityCardIds =
        (body as { abilityCardIds?: unknown; abilityIds?: unknown; abilityCardIDs?: unknown })?.abilityCardIds ??
        (body as { abilityIds?: unknown })?.abilityIds ??
        (body as { abilityCardIDs?: unknown })?.abilityCardIDs ??
        [];
      const movementCardIds =
        (body as { movementCardIds?: unknown; movementIds?: unknown; movementCardIDs?: unknown })?.movementCardIds ??
        (body as { movementIds?: unknown })?.movementIds ??
        (body as { movementCardIDs?: unknown })?.movementCardIDs ??
        [];
      const abilityList = Array.isArray(abilityCardIds) ? abilityCardIds : [];
      const movementList = Array.isArray(movementCardIds) ? movementCardIds : [];
      if (abilityDiscardCount !== abilityList.length) {
        console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'discard-count-mismatch' });
        return { ok: false, status: 400, error: 'Incorrect number of ability cards selected for discard.' };
      }
      if (movementDiscardCount !== movementList.length) {
        console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'discard-count-mismatch' });
        return { ok: false, status: 400, error: 'Incorrect number of movement cards selected for discard.' };
      }
      const discardResult: AbilityDiscardResult = discardAbilityCards(deckState, abilityList, {
        discardMovementIds: movementList,
        mode: 'strict',
      });
      if (isAbilityDiscardFailure(discardResult)) {
        console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: discardResult.error.code });
        return { ok: false, status: 400, error: discardResult.error.message, code: discardResult.error.code };
      }
      interaction.status = 'resolved';
      interaction.resolution = {
        abilityCardIds: discardResult.discarded,
        movementCardIds: discardResult.movement.discarded,
      };
    } else {
      console.log(`${LOG_PREFIX} interaction:resolve rejected`, { userId, gameId, reason: 'unsupported-type' });
      return { ok: false, status: 400, error: 'Unsupported interaction type' };
    }

    const handTriggerAvailability = buildHandTriggerAvailability(deckStates);
    const guardContinueAvailability = buildGuardContinueAvailability(deckStates);
    logInteractionEvent('before-execute', { interactionType: interaction.type }, deckStates);
    const executed = executeWithForcedRewindReturns({
      beats,
      characters,
      interactions,
      land,
      comboAvailability,
      handTriggerAvailability,
      guardContinueAvailability,
      deckStates,
      initialTokens: game.state.public.boardTokens ?? [],
    });
    game.state.public.beats = executed.beats;
    game.state.public.timeline = executed.beats;
    resetCharactersToBaseline(game.state.public);
    game.state.public.customInteractions = executed.interactions;
    game.state.public.boardTokens = executed.boardTokens;
    applyDrawInteractions(deckStates, executed.interactions);
    resolveLandRefreshes(
      deckStates,
      executed.beats,
      executed.characters,
      land,
      executed.interactions,
      undefined,
      game.state.public.boardTokens ?? [],
    );
    applyMatchOutcome(game, deckStates);
    console.log(`${LOG_PREFIX} interaction:resolve post`, {
      userId,
      gameId,
      timeline: buildTimelineSummary(executed.beats, executed.characters),
      lastCalculated: executed.lastCalculated,
    });
    logInteractionEvent(
      'after-execute',
      {
        interactionType: interaction.type,
        lastCalculated: executed.lastCalculated,
        pendingInteractions: executed.interactions.filter((item) => item.status === 'pending').length,
      },
      deckStates,
    );
    const updatedGame = (await db.updateGame(game.id, { state: game.state })) ?? game;
    sendGameUpdate(match, updatedGame, deckStates);
    const view = buildGameViewForPlayer(updatedGame, userId, deckStates);
    return { ok: true, status: 200, payload: view };
  };
  const handleWsMessage = async (client: WsClient, raw: string) => {
    let message: { type?: string; payload?: Record<string, unknown> } | null = null;
    try {
      message = JSON.parse(raw);
    } catch (err) {
      sendWsEvent({ type: 'error', payload: { message: 'Invalid JSON payload' } }, client.userId);
      return;
    }
    if (!message || typeof message !== 'object') return;
    const { type, payload } = message;
    if (!type) return;
    if (type === 'input:submit') {
      const submission = { ...(payload ?? {}) } as Record<string, unknown>;
      if (!submission.userId) {
        submission.userId = client.userId;
      }
      const result = await submitActionSet(submission);
      if (result.ok) {
        sendWsEvent({ type: 'input:ack', payload: result.payload }, client.userId);
      } else {
        sendWsEvent({ type: 'error', payload: { message: result.error, code: result.code } }, client.userId);
      }
      return;
    }
    if (type === 'interaction:resolve') {
      const submission = { ...(payload ?? {}) } as Record<string, unknown>;
      if (!submission.userId) {
        submission.userId = client.userId;
      }
      const result = await resolveInteraction(submission);
      if (result.ok) {
        sendWsEvent({ type: 'interaction:ack', payload: result.payload }, client.userId);
      } else {
        sendWsEvent({ type: 'error', payload: { message: result.error, code: result.code } }, client.userId);
      }
    }
  };

  const handleWsUpgrade = async (req: any, socket: any) => {
    const { pathname, query } = parse(req.url || '', true);
    if (pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.end();
      return;
    }
    const key = req.headers?.['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.end();
      return;
    }
    const accept = buildWsAccept(key);
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n'),
    );
    const requestedUserId = typeof query?.userId === 'string' ? query.userId : undefined;
    const requestedUsername = typeof query?.username === 'string' ? query.username : undefined;
    const user = await upsertUserFromRequest(requestedUserId, requestedUsername);
    const clientId = randomUUID();
    const client: WsClient = {
      id: clientId,
      userId: user.id,
      socket,
      buffer: Buffer.alloc(0),
    };
    wsClients.set(clientId, client);
    sendWsEvent(
      { type: 'connected', payload: { userId: user.id, username: user.username, lobby: lobby.serialize() } },
      user.id,
    );
    void sendActiveMatchState(user.id);
    socket.on('data', (chunk: Buffer) => {
      const current = wsClients.get(clientId);
      if (!current) return;
      const merged = current.buffer.length ? Buffer.concat([current.buffer, chunk]) : chunk;
      const { messages, remaining } = decodeWsMessages(merged);
      current.buffer = remaining;
      messages.forEach((rawMessage) => {
        void handleWsMessage(current, rawMessage);
      });
    });
    const cleanup = () => {
      wsClients.delete(clientId);
    };
    socket.on('close', cleanup);
    socket.on('end', cleanup);
    socket.on('error', cleanup);
  };

  const server = createServer(async (req: any, res: any) => {
    const { pathname } = parse(req.url || '', true);
    if (!pathname) return notFound(res);
    if (req.method === 'GET' && pathname === '/events') {
      return serveEvents(req, res);
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }
    if (pathname.startsWith('/api/v1/lobby')) {
      if (req.method === 'GET' && pathname === '/api/v1/lobby/state') {
        return respondJson(res, 200, lobby.serialize());
      }
      if (req.method === 'GET' && pathname === '/api/v1/lobby/admin') {
        return respondJson(res, 200, await getPresenceSnapshot());
      }
      if (req.method === 'POST' && pathname === '/api/v1/lobby/join') {
        try {
          const body = await parseBody(req);
          const result = await handleJoin(body);
          return respondJson(res, 200, result);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Invalid join payload';
          return respondJson(res, 400, { error: message });
        }
      }
      if (req.method === 'POST' && pathname === '/api/v1/lobby/leave') {
        const body = await parseBody(req);
        const result = await handleLeave(body);
        return respondJson(res, 200, result);
      }
      if (req.method === 'POST' && pathname === '/api/v1/lobby/clear') {
        lobby.clearQueues();
        queuedDecks.clear();
        drawOfferCooldownByGame.clear();
        botUsersByGame.clear();
        botRunsInProgress.clear();
        botRunsQueued.clear();
        return respondJson(res, 200, lobby.serialize());
      }
    }
    if (pathname.startsWith('/api/v1/match')) {
      if (req.method === 'POST' && pathname === '/api/v1/match/custom') {
        const body = await parseBody(req);
        const result = await createCustomMatch(body);
        return respondJson(res, 200, result);
      }
      if (req.method === 'POST' && pathname.startsWith('/api/v1/match/') && pathname.endsWith('/exit')) {
        const matchId = pathname.split('/')[4];
        const body = await parseBody(req);
        const userId = (body.userId as string) || (body.userID as string);
        if (!matchId || !userId) {
          return respondJson(res, 400, { error: 'Invalid exit payload' });
        }
        const match = await db.findMatch(matchId);
        if (!match) return notFound(res);
        if (!match.players.some((player) => player.userId === userId)) {
          return respondJson(res, 403, { error: 'User not in match' });
        }
        if (match.gameId) {
          const exitSet = matchExitUsers.get(match.gameId) ?? new Set<string>();
          exitSet.add(userId);
          matchExitUsers.set(match.gameId, exitSet);
        }
        lobby.removeFromQueue(userId);
        return respondJson(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname.startsWith('/api/v1/match/') && pathname.endsWith('/end')) {
        const matchId = pathname.split('/')[4];
        const body = await parseBody(req);
        const match = await completeMatch(matchId, body);
        if (!match) return notFound(res);
        return respondJson(res, 200, match);
      }
    }
    if (pathname.startsWith('/api/v1/game')) {
      if (req.method === 'GET' && pathname.startsWith('/api/v1/game/') && pathname.endsWith('/snapshot')) {
        const gameId = pathname.split('/')[4];
        const game = await db.findGame(gameId);
        if (!game) return notFound(res);
        return respondJson(res, 200, {
          gameId: game.id,
          matchId: game.matchId,
          state: { public: game.state.public },
        });
      }
      if (req.method === 'POST' && pathname === '/api/v1/game/forfeit') {
        let body;
        try {
          body = await parseBody(req);
        } catch (err) {
          return respondJson(res, 400, { error: 'Invalid forfeit payload' });
        }
        const result = await submitForfeit(body);
        if (!result.ok) {
          return respondJson(res, result.status, {
            error: result.error,
            code: result.code,
            ...(result.details ?? {}),
          });
        }
        return respondJson(res, result.status, result.payload);
      }
      if (req.method === 'POST' && pathname === '/api/v1/game/draw-offer') {
        let body;
        try {
          body = await parseBody(req);
        } catch (err) {
          return respondJson(res, 400, { error: 'Invalid draw offer payload' });
        }
        const result = await submitDrawOffer(body);
        if (!result.ok) {
          return respondJson(res, result.status, {
            error: result.error,
            code: result.code,
            ...(result.details ?? {}),
          });
        }
        return respondJson(res, result.status, result.payload);
      }
      if (req.method === 'POST' && pathname === '/api/v1/game/action-set') {
        let body;
        try {
          body = await parseBody(req);
        } catch (err) {
          return respondJson(res, 400, { error: 'Invalid action set payload' });
        }
        const result = await submitActionSet(body);
        if (!result.ok) {
          return respondJson(res, result.status, { error: result.error, code: result.code });
        }
        return respondJson(res, result.status, result.payload);
      }
      if (req.method === 'POST' && pathname === '/api/v1/game/interaction') {
        let body;
        try {
          body = await parseBody(req);
        } catch (err) {
          return respondJson(res, 400, { error: 'Invalid interaction payload' });
        }
        const result = await resolveInteraction(body);
        if (!result.ok) {
          return respondJson(res, result.status, { error: result.error, code: result.code });
        }
        return respondJson(res, result.status, result.payload);
      }
    }
    if (pathname.startsWith('/api/v1/replays')) {
      if (req.method === 'GET' && pathname === '/api/v1/replays') {
        const replays = await db.listReplays(200);
        return respondJson(
          res,
          200,
          replays.map((replay) => buildReplaySummary(replay)),
        );
      }
      if (req.method === 'GET' && pathname.startsWith('/api/v1/replays/')) {
        const replaySegment = pathname.split('/')[4] ?? '';
        let replayId = '';
        try {
          replayId = decodeURIComponent(replaySegment);
        } catch {
          return respondJson(res, 400, { error: 'Invalid replay id' });
        }
        if (!replayId) {
          return respondJson(res, 400, { error: 'Replay id is required' });
        }
        const replay = await db.findReplay(replayId);
        if (!replay) {
          return notFound(res);
        }
        return respondJson(res, 200, buildReplayDetail(replay));
      }
      if (req.method === 'POST' && pathname === '/api/v1/replays') {
        let body;
        try {
          body = await parseBody(req);
        } catch (err) {
          return respondJson(res, 400, { error: 'Invalid replay payload' });
        }
        const result = await saveReplay(body);
        if (!result.ok) {
          return respondJson(res, result.status, { error: result.error });
        }
        return respondJson(res, result.status, result.payload);
      }
    }
    if (pathname.startsWith('/api/v1/history')) {
      if (req.method === 'GET' && pathname === '/api/v1/history/matches') {
        return respondJson(res, 200, await db.listMatches());
      }
      if (req.method === 'GET' && pathname === '/api/v1/history/games') {
        return respondJson(res, 200, await db.listGames());
      }
    }
    if (
      pathname === '/' ||
      pathname === '/admin' ||
      pathname === '/admin/' ||
      pathname === '/cards' ||
      pathname === '/cards/' ||
      pathname.startsWith('/public')
    ) {
      return handleStatic(res, pathname);
    }
    return notFound(res);
  });

  server.on('upgrade', (req: any, socket: any) => {
    void handleWsUpgrade(req, socket);
  });

  server.listen(port, () => {
    lobby.clearQueues();
    sendRealtimeEvent({ type: 'queueChanged', payload: lobby.serialize() });
    setInterval(() => {
      void matchmakeQuickplay();
    }, 2000);
  });

  return server;
}
