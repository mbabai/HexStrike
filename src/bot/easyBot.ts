import {
  ActionListItem,
  BeatEntry,
  BoardToken,
  CardCatalog,
  CustomInteraction,
  DeckState,
  GamePublicState,
  HexCoord,
  PublicCharacter,
} from '../types';
import { applyActionSetToBeats } from '../game/actionSets';
import {
  getCharacterLocationAtIndex,
  getCharactersAtEarliestE,
  getLastEntryForCharacter,
  getTimelineEarliestEIndex,
  getTimelineResolvedIndex,
} from '../game/beatTimeline';
import { executeBeatsWithInteractions } from '../game/execute';
import {
  applyCardUse,
  discardAbilityCards,
  drawAbilityCards,
  getDiscardRequirements,
  getMaxAbilityHandSize,
  getMovementHandIds,
  getTargetMovementHandSize,
  isAbilityDiscardFailure,
  isActionValidationFailure,
  resolveLandRefreshes,
  validateActionSubmission,
} from '../game/cardRules';
import { HAND_TRIGGER_DEFINITIONS, HAND_TRIGGER_BY_ID } from '../game/handTriggers';

const WAIT_ACTION = 'W';
const COMBO_ACTION = 'CO';
const GUARD_CONTINUE_INTERACTION_TYPE = 'guard-continue';
const REWIND_RETURN_INTERACTION_TYPE = 'rewind-return';
const HAVEN_PLATFORM_INTERACTION_TYPE = 'haven-platform';
const DRAW_SELECTION_MAX_MOVEMENT = 3;
const ROTATION_LABELS = ['0', 'R1', 'R2', '3', 'L2', 'L1'];
const MAX_ENUM_CHOICES = 512;
const AXIAL_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export interface BotScoreBreakdown {
  centerDistancePenalty: number;
  opponentDamageScore: number;
  endOnLandBonus: number;
  opponentCenterDistanceScore: number;
  handSizeScore: number;
  facingScore: number;
  total: number;
}

interface SimulatedResult {
  beats: BeatEntry[][];
  characters: PublicCharacter[];
  deckStates: Map<string, DeckState>;
  boardTokens: BoardToken[];
  score: number;
  scoreBreakdown: BotScoreBreakdown;
  scoreIndex: number;
}

export interface EasyBotActionCandidate {
  kind: 'action-set';
  activeCardId: string;
  passiveCardId: string;
  rotation: string;
  score: number;
  scoreBreakdown: BotScoreBreakdown;
  scoreIndex: number;
}

export interface EasyBotInteractionCandidate {
  kind: 'interaction';
  interactionId: string;
  interactionType: string;
  payload: Record<string, unknown>;
  score: number;
  scoreBreakdown: BotScoreBreakdown;
  scoreIndex: number;
}

export type EasyBotCandidate = EasyBotActionCandidate | EasyBotInteractionCandidate;

export interface EasyBotDecisionContext {
  botUserId: string;
  publicState: GamePublicState;
  deckStates: Map<string, DeckState>;
  catalog: CardCatalog;
}

const cloneJson = <T>(value: T): T => {
  if (value === undefined || value === null) return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
};

const cloneDeckState = (deckState: DeckState): DeckState => ({
  movement: [...deckState.movement],
  abilityHand: [...deckState.abilityHand],
  abilityDeck: [...deckState.abilityDeck],
  baseMaxHandSize: Number.isFinite(deckState.baseMaxHandSize)
    ? Math.max(0, Math.floor(deckState.baseMaxHandSize as number))
    : undefined,
  focusedAbilityCardIds: new Set(Array.from(deckState.focusedAbilityCardIds ?? [])),
  exhaustedMovementIds: new Set(Array.from(deckState.exhaustedMovementIds ?? [])),
  lastRefreshIndex: Number.isFinite(deckState.lastRefreshIndex as number)
    ? Math.round(deckState.lastRefreshIndex as number)
    : null,
  activeCardId: deckState.activeCardId ?? null,
  passiveCardId: deckState.passiveCardId ?? null,
});

const cloneDeckStates = (deckStates: Map<string, DeckState>): Map<string, DeckState> => {
  const next = new Map<string, DeckState>();
  deckStates.forEach((deckState, userId) => {
    next.set(userId, cloneDeckState(deckState));
  });
  return next;
};

const cloneCharacters = (characters: PublicCharacter[]): PublicCharacter[] =>
  characters.map((character) => ({
    ...character,
    position: { q: character.position.q, r: character.position.r },
  }));

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

const withComboStarter = (actionList: ActionListItem[]) =>
  actionList.map((item, index) => (index === 0 ? { ...item, comboStarter: true } : { ...item }));

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

const buildCoordKey = (coord: HexCoord | undefined): string | null => {
  if (!coord) return null;
  const q = Number(coord.q);
  const r = Number(coord.r);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  return `${Math.round(q)},${Math.round(r)}`;
};

const isCoordOnLand = (coord: HexCoord | undefined, land: HexCoord[]): boolean => {
  if (!coord || !Array.isArray(land) || !land.length) return false;
  const key = buildCoordKey(coord);
  if (!key) return false;
  return land.some((tile) => buildCoordKey(tile) === key);
};

const getCharacterDamageAtIndex = (beats: BeatEntry[][], character: PublicCharacter, index: number): number => {
  const entry = getLastEntryForCharacter(beats, character, index);
  if (Number.isFinite(entry?.damage)) return Math.round(entry?.damage as number);
  if (Number.isFinite(character.damage)) return Math.round(character.damage as number);
  return 0;
};

const getCharacterFacingAtIndex = (beats: BeatEntry[][], character: PublicCharacter, index: number): number => {
  const entry = getLastEntryForCharacter(beats, character, index);
  if (Number.isFinite(entry?.facing)) return Number(entry?.facing);
  return Number.isFinite(character.facing) ? character.facing : 0;
};

const normalizeDegrees = (value: number) => {
  const normalized = ((value % 360) + 360) % 360;
  return Number.isFinite(normalized) ? normalized : 0;
};

const getAngleDelta = (a: number, b: number): number => {
  const first = normalizeDegrees(a);
  const second = normalizeDegrees(b);
  let delta = Math.abs(first - second);
  if (delta > 180) delta = 360 - delta;
  return delta;
};

const axialToPoint = (coord: { q: number; r: number }) => ({
  x: Math.sqrt(3) * (coord.q + coord.r / 2),
  y: 1.5 * coord.r,
});

const getDirectionIndex = (delta: { q: number; r: number }): number => {
  let bestIndex = 0;
  let bestDot = Number.NEGATIVE_INFINITY;
  const point = axialToPoint(delta);
  AXIAL_DIRECTIONS.forEach((direction, index) => {
    const axis = axialToPoint(direction);
    const dot = point.x * axis.x + point.y * axis.y;
    if (dot > bestDot) {
      bestDot = dot;
      bestIndex = index;
    }
  });
  return bestIndex;
};

const toFacingDegrees = (directionIndex: number): number => normalizeDegrees(180 + directionIndex * 60);

const buildCombinations = (items: string[], choose: number, limit = MAX_ENUM_CHOICES): string[][] => {
  const safeChoose = Number.isFinite(choose) ? Math.max(0, Math.floor(choose)) : 0;
  if (safeChoose === 0) return [[]];
  if (safeChoose > items.length) return [];
  const results: string[][] = [];
  const stack: string[] = [];
  const visit = (index: number) => {
    if (results.length >= limit) return;
    if (stack.length === safeChoose) {
      results.push([...stack]);
      return;
    }
    for (let i = index; i < items.length; i += 1) {
      stack.push(items[i]);
      visit(i + 1);
      stack.pop();
      if (results.length >= limit) return;
    }
  };
  visit(0);
  return results;
};

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
        return;
      }
    }
    interaction.resolution = { ...(interaction.resolution ?? {}), applied: true };
  });
};

const buildWaitAction = (): ActionListItem[] => [
  {
    action: WAIT_ACTION,
    rotation: '',
    priority: 0,
  },
];

const applyAssumedOpponentWaits = (
  beats: BeatEntry[][],
  characters: PublicCharacter[],
  botUserId: string,
): BeatEntry[][] => {
  const earliestIndex = getTimelineEarliestEIndex(beats, characters);
  const atBat = getCharactersAtEarliestE(beats, characters);
  let next = beats;
  atBat.forEach((character) => {
    if (character.userId === botUserId) return;
    if (getTimelineEarliestEIndex(next, characters) !== earliestIndex) return;
    next = applyActionSetToBeats(next, characters, character.userId, buildWaitAction(), []);
  });
  return next;
};

const buildInitialDamageByOpponent = (
  beats: BeatEntry[][],
  characters: PublicCharacter[],
  botUserId: string,
): Map<string, number> => {
  const lookup = new Map<string, number>();
  const resolvedIndex = getTimelineResolvedIndex(beats);
  const index = resolvedIndex >= 0 ? resolvedIndex : Math.max(0, beats.length - 1);
  characters.forEach((character) => {
    if (character.userId === botUserId) return;
    lookup.set(character.userId, getCharacterDamageAtIndex(beats, character, index));
  });
  return lookup;
};

const scoreOutcome = ({
  botUserId,
  beats,
  characters,
  land,
  deckState,
  initialDamageByOpponent,
  scoreIndex,
}: {
  botUserId: string;
  beats: BeatEntry[][];
  characters: PublicCharacter[];
  land: HexCoord[];
  deckState: DeckState;
  initialDamageByOpponent: Map<string, number>;
  scoreIndex: number;
}): BotScoreBreakdown => {
  const center = getLandCenter(land);
  const botCharacter = characters.find((character) => character.userId === botUserId);
  const botLocation = botCharacter
    ? getCharacterLocationAtIndex(beats, botCharacter, scoreIndex) ?? botCharacter.position
    : { q: 0, r: 0 };
  const botFacing = botCharacter ? getCharacterFacingAtIndex(beats, botCharacter, scoreIndex) : 0;

  const centerDistance = axialDistance(botLocation, center);
  const centerDistancePenalty = -(centerDistance ** 2);
  const endOnLandBonus = isCoordOnLand(botLocation, land) ? 10 : 0;

  let opponentDamageScore = 0;
  let opponentCenterDistanceScore = 0;
  let nearestOpponent: { position: { q: number; r: number }; distance: number } | null = null;

  characters.forEach((character) => {
    if (character.userId === botUserId) return;
    const opponentLocation = getCharacterLocationAtIndex(beats, character, scoreIndex) ?? character.position;
    const opponentDamage = getCharacterDamageAtIndex(beats, character, scoreIndex);
    const baselineDamage = initialDamageByOpponent.get(character.userId) ?? 0;
    const damageAdded = Math.max(0, opponentDamage - baselineDamage);
    opponentDamageScore += damageAdded * 4;

    const enemyDistanceFromCenter = axialDistance(opponentLocation, center);
    opponentCenterDistanceScore += enemyDistanceFromCenter ** 2;

    const enemyDistanceFromBot = axialDistance(botLocation, opponentLocation);
    if (!nearestOpponent || enemyDistanceFromBot < nearestOpponent.distance) {
      nearestOpponent = {
        position: opponentLocation,
        distance: enemyDistanceFromBot,
      };
    }
  });

  const movementCount = getMovementHandIds(deckState).length;
  const abilityCount = Array.isArray(deckState.abilityHand) ? deckState.abilityHand.length : 0;
  const handSize = movementCount + abilityCount;
  const handSizeScore = handSize ** 2;

  let facingScore = 0;
  if (nearestOpponent) {
    const delta = {
      q: nearestOpponent.position.q - botLocation.q,
      r: nearestOpponent.position.r - botLocation.r,
    };
    const directionIndex = getDirectionIndex(delta);
    const desiredFacing = toFacingDegrees(directionIndex);
    const awayDegrees = getAngleDelta(botFacing, desiredFacing);
    facingScore = (360 - awayDegrees) / 36;
  }

  const total =
    centerDistancePenalty +
    opponentDamageScore +
    endOnLandBonus +
    opponentCenterDistanceScore +
    handSizeScore +
    facingScore;

  return {
    centerDistancePenalty,
    opponentDamageScore,
    endOnLandBonus,
    opponentCenterDistanceScore,
    handSizeScore,
    facingScore,
    total,
  };
};

const runExecution = ({
  beats,
  characters,
  interactions,
  land,
  deckStates,
  boardTokens,
  catalog,
}: {
  beats: BeatEntry[][];
  characters: PublicCharacter[];
  interactions: CustomInteraction[];
  land: HexCoord[];
  deckStates: Map<string, DeckState>;
  boardTokens: BoardToken[];
  catalog: CardCatalog;
}): {
  beats: BeatEntry[][];
  characters: PublicCharacter[];
  interactions: CustomInteraction[];
  boardTokens: BoardToken[];
  scoreIndex: number;
} => {
  const comboAvailability = buildComboAvailability(deckStates, catalog);
  const handTriggerAvailability = buildHandTriggerAvailability(deckStates);
  const guardContinueAvailability = buildGuardContinueAvailability(deckStates);
  const executed = executeBeatsWithInteractions(
    beats,
    characters,
    interactions,
    land,
    comboAvailability,
    cloneJson(boardTokens),
    handTriggerAvailability,
    guardContinueAvailability,
  );

  applyDrawInteractions(deckStates, executed.interactions);
  resolveLandRefreshes(
    deckStates,
    executed.beats,
    executed.characters,
    land,
    executed.interactions,
    undefined,
    executed.boardTokens,
  );

  const resolvedIndex = getTimelineResolvedIndex(executed.beats);
  let scoreIndex = executed.lastCalculated;
  if (!Number.isFinite(scoreIndex) || scoreIndex < 0) {
    scoreIndex = resolvedIndex;
  }
  if (!Number.isFinite(scoreIndex) || scoreIndex < 0) {
    scoreIndex = Math.max(0, executed.beats.length - 1);
  }
  return {
    beats: executed.beats,
    characters: executed.characters,
    interactions: executed.interactions,
    boardTokens: executed.boardTokens,
    scoreIndex,
  };
};

const findComboContinuation = (
  interactions: CustomInteraction[],
  userId: string,
  beatIndex: number,
): CustomInteraction | null =>
  interactions.find(
    (interaction) =>
      interaction?.type === 'combo' &&
      interaction?.status === 'resolved' &&
      interaction?.actorUserId === userId &&
      interaction?.beatIndex === beatIndex &&
      Boolean(interaction?.resolution?.continue),
  ) ?? null;

const simulateActionChoice = (
  context: EasyBotDecisionContext,
  initialDamageByOpponent: Map<string, number>,
  choice: { activeCardId: string; passiveCardId: string; rotation: string },
): SimulatedResult | null => {
  const deckStates = cloneDeckStates(context.deckStates);
  const deckState = deckStates.get(context.botUserId);
  if (!deckState) return null;

  const beats = cloneJson(context.publicState.beats ?? context.publicState.timeline ?? []);
  const characters = cloneCharacters(context.publicState.characters ?? []);
  const interactions = cloneJson(context.publicState.customInteractions ?? []);
  const land = cloneJson(context.publicState.land ?? []);
  const boardTokens = cloneJson(context.publicState.boardTokens ?? []) as BoardToken[];

  const validation = validateActionSubmission(
    {
      activeCardId: choice.activeCardId,
      passiveCardId: choice.passiveCardId,
      rotation: choice.rotation,
    },
    deckState,
    context.catalog,
  );
  if (isActionValidationFailure(validation)) {
    return null;
  }

  const earliestIndex = getTimelineEarliestEIndex(beats, characters);
  const comboInteraction = findComboContinuation(interactions, context.botUserId, earliestIndex);
  if (comboInteraction) {
    const activeCard = context.catalog.cardsById.get(choice.activeCardId);
    if (!cardHasCombo(activeCard)) {
      return null;
    }
  }
  const actionList = comboInteraction ? withComboStarter(validation.actionList) : validation.actionList;

  const cardUseResult = applyCardUse(deckState, {
    movementCardId: validation.movementCardId,
    abilityCardId: validation.abilityCardId,
    activeCardId: choice.activeCardId,
    passiveCardId: choice.passiveCardId,
  });
  if (!cardUseResult.ok) return null;

  let activeInteractions = interactions;
  if (comboInteraction) {
    activeInteractions = interactions.filter((interaction) => interaction.id !== comboInteraction.id);
  }

  let updatedBeats = applyActionSetToBeats(beats, characters, context.botUserId, actionList, []);
  updatedBeats = applyAssumedOpponentWaits(updatedBeats, characters, context.botUserId);
  const executed = runExecution({
    beats: updatedBeats,
    characters,
    interactions: activeInteractions,
    land,
    deckStates,
    boardTokens,
    catalog: context.catalog,
  });
  const scoreBreakdown = scoreOutcome({
    botUserId: context.botUserId,
    beats: executed.beats,
    characters: executed.characters,
    land,
    deckState,
    initialDamageByOpponent,
    scoreIndex: executed.scoreIndex,
  });

  return {
    beats: executed.beats,
    characters: executed.characters,
    deckStates,
    boardTokens: executed.boardTokens,
    score: scoreBreakdown.total,
    scoreBreakdown,
    scoreIndex: executed.scoreIndex,
  };
};

const getInteractionPayloadKey = (payload: Record<string, unknown>) => {
  try {
    return JSON.stringify(payload);
  } catch {
    return `${payload}`;
  }
};

const appendUniquePayload = (
  target: Array<Record<string, unknown>>,
  payload: Record<string, unknown>,
  seen: Set<string>,
) => {
  const key = getInteractionPayloadKey(payload);
  if (seen.has(key)) return;
  seen.add(key);
  target.push(payload);
};

const normalizeHexCoord = (value: unknown): HexCoord | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { q?: unknown; r?: unknown };
  const q = Number(raw.q);
  const r = Number(raw.r);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  return { q: Math.round(q), r: Math.round(r) };
};

const buildHavenTargets = (
  interaction: CustomInteraction,
  beats: BeatEntry[][],
  characters: PublicCharacter[],
): HexCoord[] => {
  const candidates: HexCoord[] = [];
  if (Array.isArray(interaction.touchingHexes) && interaction.touchingHexes.length) {
    interaction.touchingHexes.forEach((coord) => {
      const normalized = normalizeHexCoord(coord);
      if (normalized) candidates.push(normalized);
    });
  }
  if (candidates.length) return candidates;
  const actor = characters.find(
    (character) => character.userId === interaction.actorUserId || character.username === interaction.actorUserId,
  );
  if (!actor) return [];
  const beatIndex = Number.isFinite(interaction.beatIndex) ? Math.max(0, Math.round(interaction.beatIndex)) : 0;
  const actorLocation = getCharacterLocationAtIndex(beats, actor, beatIndex) ?? actor.position;
  return [
    { q: actorLocation.q, r: actorLocation.r },
    ...AXIAL_DIRECTIONS.map((direction) => ({
      q: Math.round(actorLocation.q + direction.q),
      r: Math.round(actorLocation.r + direction.r),
    })),
  ];
};

const enumerateInteractionPayloads = (
  interaction: CustomInteraction,
  deckState: DeckState,
  beats: BeatEntry[][],
  characters: PublicCharacter[],
): Array<Record<string, unknown>> => {
  const payloads: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  if (interaction.type === 'throw') {
    for (let directionIndex = 0; directionIndex < 6; directionIndex += 1) {
      appendUniquePayload(payloads, { directionIndex }, seen);
    }
    return payloads;
  }

  if (interaction.type === 'combo') {
    appendUniquePayload(payloads, { continue: true, continueCombo: true }, seen);
    appendUniquePayload(payloads, { continue: false, continueCombo: false }, seen);
    return payloads;
  }

  if (interaction.type === GUARD_CONTINUE_INTERACTION_TYPE) {
    appendUniquePayload(payloads, { continue: true, continueGuard: true }, seen);
    appendUniquePayload(payloads, { continue: false, continueGuard: false }, seen);
    return payloads;
  }

  if (interaction.type === REWIND_RETURN_INTERACTION_TYPE) {
    appendUniquePayload(payloads, { returnToAnchor: true, rewindReturn: true }, seen);
    appendUniquePayload(payloads, { returnToAnchor: false, rewindReturn: false }, seen);
    return payloads;
  }

  if (interaction.type === HAVEN_PLATFORM_INTERACTION_TYPE) {
    const targets = buildHavenTargets(interaction, beats, characters);
    targets.forEach((targetHex) => {
      appendUniquePayload(payloads, { targetHex }, seen);
    });
    return payloads;
  }

  if (interaction.type === 'draw') {
    const requiredRestore = Number.isFinite(interaction.drawMovementCount)
      ? Math.max(0, Math.floor(interaction.drawMovementCount as number))
      : getDrawSelectionRequirement(
          deckState,
          Number.isFinite(interaction.drawCount) ? Math.max(0, Math.floor(interaction.drawCount as number)) : 0,
        ).requiredRestore;
    const exhausted = deckState.movement.filter((cardId) => deckState.exhaustedMovementIds.has(cardId));
    const movementCombos = buildCombinations(exhausted, requiredRestore);
    movementCombos.forEach((movementCardIds) => {
      appendUniquePayload(payloads, { movementCardIds }, seen);
    });
    if (!payloads.length) {
      appendUniquePayload(payloads, { movementCardIds: [] }, seen);
    }
    return payloads;
  }

  if (interaction.type === 'discard') {
    const requirement = getDiscardRequirements(
      deckState,
      Number.isFinite(interaction.discardCount) ? Math.max(0, Math.floor(interaction.discardCount as number)) : 0,
    );
    const abilityCombos = buildCombinations(deckState.abilityHand.slice(), requirement.abilityDiscardCount);
    const movementCombos = buildCombinations(getMovementHandIds(deckState), requirement.movementDiscardCount);
    abilityCombos.forEach((abilityCardIds) => {
      movementCombos.forEach((movementCardIds) => {
        appendUniquePayload(payloads, { abilityCardIds, movementCardIds }, seen);
      });
    });
    return payloads;
  }

  if (interaction.type === 'hand-trigger') {
    appendUniquePayload(payloads, { use: false, movementCardIds: [], abilityCardIds: [] }, seen);
    const cardId = `${interaction.cardId ?? interaction.abilityCardId ?? ''}`.trim();
    const definition = HAND_TRIGGER_BY_ID.get(cardId);
    if (!definition) return payloads;

    if (definition.cardType === 'ability') {
      if (!deckState.abilityHand.includes(cardId)) return payloads;
      const requirement = getDiscardRequirements(deckState, definition.discardCount);
      const movementCombos = buildCombinations(getMovementHandIds(deckState), requirement.movementDiscardCount);
      movementCombos.forEach((movementCardIds) => {
        appendUniquePayload(payloads, { use: true, movementCardIds, abilityCardIds: [] }, seen);
      });
      return payloads;
    }

    if (!getMovementHandIds(deckState).includes(cardId)) return payloads;
    if (!deckState.abilityHand.length) return payloads;
    deckState.abilityHand.forEach((abilityCardId) => {
      appendUniquePayload(
        payloads,
        {
          use: true,
          abilityCardIds: [abilityCardId],
          movementCardIds: [cardId],
        },
        seen,
      );
    });
    return payloads;
  }

  return payloads;
};

const applyInteractionChoice = (
  interaction: CustomInteraction,
  choicePayload: Record<string, unknown>,
  deckState: DeckState | undefined,
): { ok: true } | { ok: false; error: string } => {
  if (interaction.type === 'throw') {
    const directionIndex = Number(choicePayload.directionIndex);
    if (!Number.isFinite(directionIndex) || directionIndex < 0 || directionIndex > 5) {
      return { ok: false, error: 'invalid-direction' };
    }
    interaction.status = 'resolved';
    interaction.resolution = { directionIndex: Math.round(directionIndex) };
    return { ok: true };
  }

  if (interaction.type === 'combo') {
    const continueCombo = Boolean(choicePayload.continueCombo ?? choicePayload.continue);
    interaction.status = 'resolved';
    interaction.resolution = { continue: continueCombo };
    return { ok: true };
  }

  if (interaction.type === GUARD_CONTINUE_INTERACTION_TYPE) {
    const continueGuard = Boolean(choicePayload.continueGuard ?? choicePayload.continue);
    interaction.status = 'resolved';
    interaction.resolution = { continue: continueGuard };
    return { ok: true };
  }

  if (interaction.type === REWIND_RETURN_INTERACTION_TYPE) {
    const returnToAnchor = Boolean(choicePayload.returnToAnchor ?? choicePayload.rewindReturn ?? choicePayload.continue);
    interaction.status = 'resolved';
    interaction.resolution = { ...(interaction.resolution ?? {}), returnToAnchor };
    return { ok: true };
  }

  if (interaction.type === HAVEN_PLATFORM_INTERACTION_TYPE) {
    const targetHex = normalizeHexCoord(choicePayload.targetHex);
    if (!targetHex) {
      return { ok: false, error: 'invalid-target-hex' };
    }
    interaction.status = 'resolved';
    interaction.resolution = {
      ...(interaction.resolution ?? {}),
      targetHex,
    };
    return { ok: true };
  }

  if (interaction.type === 'draw') {
    if (!deckState) return { ok: false, error: 'missing-deck-state' };
    const drawCount = Number.isFinite(interaction.drawCount) ? Math.max(0, Math.floor(interaction.drawCount as number)) : 0;
    const movementCardIds = Array.isArray(choicePayload.movementCardIds) ? choicePayload.movementCardIds : [];
    const drawResult = drawAbilityCards(deckState, drawCount, {
      restoreMovementIds: movementCardIds as string[],
      mode: Number.isFinite(interaction.drawMovementCount) && Math.max(0, Math.floor(interaction.drawMovementCount as number)) > 0
        ? 'strict'
        : 'auto',
    });
    if ('error' in drawResult) {
      return { ok: false, error: drawResult.error.code };
    }
    interaction.status = 'resolved';
    interaction.resolution = {
      ...(interaction.resolution ?? {}),
      applied: true,
      movementCardIds: drawResult.movement.restored,
      abilityCardIds: drawResult.drawn,
    };
    return { ok: true };
  }

  if (interaction.type === 'discard') {
    if (!deckState) return { ok: false, error: 'missing-deck-state' };
    const abilityCardIds = Array.isArray(choicePayload.abilityCardIds) ? choicePayload.abilityCardIds : [];
    const movementCardIds = Array.isArray(choicePayload.movementCardIds) ? choicePayload.movementCardIds : [];
    const discardResult = discardAbilityCards(deckState, abilityCardIds, {
      discardMovementIds: movementCardIds as string[],
      mode: 'strict',
    });
    if (isAbilityDiscardFailure(discardResult)) {
      return { ok: false, error: discardResult.error.code };
    }
    interaction.status = 'resolved';
    interaction.resolution = {
      abilityCardIds: discardResult.discarded,
      movementCardIds: discardResult.movement.discarded,
    };
    return { ok: true };
  }

  if (interaction.type === 'hand-trigger') {
    if (!deckState) return { ok: false, error: 'missing-deck-state' };
    const use = Boolean(choicePayload.use);
    if (!use) {
      interaction.status = 'resolved';
      interaction.resolution = { use: false };
      return { ok: true };
    }
    const cardId = `${interaction.cardId ?? interaction.abilityCardId ?? ''}`.trim();
    const definition = HAND_TRIGGER_BY_ID.get(cardId);
    if (!definition) return { ok: false, error: 'unknown-hand-trigger' };

    if (definition.cardType === 'ability') {
      const movementCardIds = Array.isArray(choicePayload.movementCardIds) ? choicePayload.movementCardIds : [];
      const discardResult = discardAbilityCards(deckState, [cardId], {
        discardMovementIds: movementCardIds as string[],
        mode: 'strict',
      });
      if (isAbilityDiscardFailure(discardResult)) {
        return { ok: false, error: discardResult.error.code };
      }
      if (cardId === 'vengeance') {
        const drawCount = Number.isFinite(interaction.drawCount) ? Math.max(0, Math.floor(interaction.drawCount as number)) : 0;
        if (drawCount > 0) {
          const drawResult = drawAbilityCards(deckState, drawCount, { mode: 'auto' });
          if ('error' in drawResult) {
            return { ok: false, error: drawResult.error.code };
          }
        }
      }
      interaction.status = 'resolved';
      interaction.resolution = {
        use: true,
        movementCardIds: discardResult.movement.discarded,
        abilityCardIds: discardResult.discarded,
      };
      return { ok: true };
    }

    const abilityCardIds = Array.isArray(choicePayload.abilityCardIds) ? choicePayload.abilityCardIds : [];
    const movementCardIds = Array.isArray(choicePayload.movementCardIds) ? choicePayload.movementCardIds : [];
    const discardResult = discardAbilityCards(deckState, abilityCardIds, {
      discardMovementIds: movementCardIds as string[],
      mode: 'strict',
    });
    if (isAbilityDiscardFailure(discardResult)) {
      return { ok: false, error: discardResult.error.code };
    }
    interaction.status = 'resolved';
    interaction.resolution = {
      use: true,
      movementCardIds: discardResult.movement.discarded,
      abilityCardIds: discardResult.discarded,
    };
    return { ok: true };
  }

  return { ok: false, error: 'unsupported-interaction' };
};

const simulateInteractionChoice = (
  context: EasyBotDecisionContext,
  initialDamageByOpponent: Map<string, number>,
  interaction: CustomInteraction,
  payload: Record<string, unknown>,
): SimulatedResult | null => {
  const deckStates = cloneDeckStates(context.deckStates);
  const deckState = deckStates.get(context.botUserId);

  const beats = cloneJson(context.publicState.beats ?? context.publicState.timeline ?? []);
  const characters = cloneCharacters(context.publicState.characters ?? []);
  const interactions = cloneJson(context.publicState.customInteractions ?? []);
  const land = cloneJson(context.publicState.land ?? []);
  const boardTokens = cloneJson(context.publicState.boardTokens ?? []) as BoardToken[];

  const mutableInteraction = interactions.find((candidate) => candidate.id === interaction.id && candidate.status === 'pending');
  if (!mutableInteraction) return null;
  if (mutableInteraction.actorUserId !== context.botUserId) return null;

  const applyResult = applyInteractionChoice(mutableInteraction, payload, deckState);
  if (!applyResult.ok) return null;

  const executed = runExecution({
    beats,
    characters,
    interactions,
    land,
    deckStates,
    boardTokens,
    catalog: context.catalog,
  });
  const scoringDeckState = deckStates.get(context.botUserId);
  if (!scoringDeckState) return null;

  const scoreBreakdown = scoreOutcome({
    botUserId: context.botUserId,
    beats: executed.beats,
    characters: executed.characters,
    land,
    deckState: scoringDeckState,
    initialDamageByOpponent,
    scoreIndex: executed.scoreIndex,
  });

  return {
    beats: executed.beats,
    characters: executed.characters,
    deckStates,
    boardTokens: executed.boardTokens,
    score: scoreBreakdown.total,
    scoreBreakdown,
    scoreIndex: executed.scoreIndex,
  };
};

export const buildEasyBotActionCandidates = (
  context: EasyBotDecisionContext,
): EasyBotActionCandidate[] => {
  const deckState = context.deckStates.get(context.botUserId);
  if (!deckState) return [];
  const beats = context.publicState.beats ?? context.publicState.timeline ?? [];
  const characters = context.publicState.characters ?? [];
  if (!Array.isArray(beats) || !Array.isArray(characters) || !characters.length) return [];
  const atBatIds = new Set(getCharactersAtEarliestE(beats, characters).map((character) => character.userId));
  if (!atBatIds.has(context.botUserId)) return [];

  const movementHand = getMovementHandIds(deckState);
  const abilityHand = deckState.abilityHand.slice();
  if (!movementHand.length || !abilityHand.length) return [];

  const initialDamageByOpponent = buildInitialDamageByOpponent(beats, characters, context.botUserId);
  const dedupe = new Set<string>();
  const candidates: EasyBotActionCandidate[] = [];

  movementHand.forEach((movementCardId) => {
    abilityHand.forEach((abilityCardId) => {
      const options = [
        { activeCardId: movementCardId, passiveCardId: abilityCardId },
        { activeCardId: abilityCardId, passiveCardId: movementCardId },
      ];
      options.forEach((option) => {
        ROTATION_LABELS.forEach((rotation) => {
          const dedupeKey = `${option.activeCardId}|${option.passiveCardId}|${rotation}`;
          if (dedupe.has(dedupeKey)) return;
          dedupe.add(dedupeKey);
          const simulated = simulateActionChoice(context, initialDamageByOpponent, {
            activeCardId: option.activeCardId,
            passiveCardId: option.passiveCardId,
            rotation,
          });
          if (!simulated) return;
          candidates.push({
            kind: 'action-set',
            activeCardId: option.activeCardId,
            passiveCardId: option.passiveCardId,
            rotation,
            score: simulated.score,
            scoreBreakdown: simulated.scoreBreakdown,
            scoreIndex: simulated.scoreIndex,
          });
        });
      });
    });
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
};

export const buildEasyBotInteractionCandidates = (
  context: EasyBotDecisionContext,
  interaction: CustomInteraction,
): EasyBotInteractionCandidate[] => {
  if (!interaction || interaction.status !== 'pending') return [];
  if (interaction.actorUserId !== context.botUserId) return [];
  const deckState = context.deckStates.get(context.botUserId);
  if (!deckState) return [];

  const beats = context.publicState.beats ?? context.publicState.timeline ?? [];
  const characters = context.publicState.characters ?? [];
  if (!Array.isArray(beats) || !Array.isArray(characters) || !characters.length) return [];

  const payloads = enumerateInteractionPayloads(interaction, deckState, beats, characters);
  if (!payloads.length) return [];

  const initialDamageByOpponent = buildInitialDamageByOpponent(beats, characters, context.botUserId);
  const candidates: EasyBotInteractionCandidate[] = [];
  payloads.forEach((payload) => {
    const simulated = simulateInteractionChoice(context, initialDamageByOpponent, interaction, payload);
    if (!simulated) return;
    candidates.push({
      kind: 'interaction',
      interactionId: interaction.id,
      interactionType: interaction.type,
      payload,
      score: simulated.score,
      scoreBreakdown: simulated.scoreBreakdown,
      scoreIndex: simulated.scoreIndex,
    });
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
};
