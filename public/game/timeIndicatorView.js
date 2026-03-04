import { CHARACTER_IMAGE_SOURCES, CHARACTER_TOKEN_STYLE } from './characterTokens.mjs';
import { getEarliestPendingInteractionIndex, getTimelineStopIndex } from './beatTimeline.js';
import { drawNameCapsule } from './portraitBadges.js';
import { getFfaScoreMapAtBeat, isFfaEnabled, isFfaPlayerInvulnerableAtBeat } from './ffaState.js';
import { resolveActionTiming } from '../shared/timing.js';
import { buildCardElement, fitAllCardText } from '../shared/cardRenderer.js';
import { buildRotationWheel } from './rotationWheel.js';
import { getActionPhaseUserIds, getWaitingForInputUserIds, isCharacterInUserSet } from './inputWaiting.js';

const DEFAULT_BORDER_SIZE = { width: 640, height: 64 };
const DEFAULT_ACTION = 'E';
const ACTION_ICON_FALLBACK = 'empty';
const EMPHASIS_ICON_KEY = 'i';
const COMBO_ICON_KEY = 'Co';
const FOCUS_ICON_KEY = 'F';
const KNOCKBACK_ICON_KEY = 'KnockBackIcon';
const DRAW_ICON_KEY = 'DrawIcon';
const DISCARD_ICON_KEY = 'DiscardIcon';
const REWIND_RETURN_INTERACTION_TYPE = 'rewind-return';
const END_MARKER_ACTIONS = new Set(['Death', 'Victory', 'Handshake']);
const VISIBLE_BEAT_RADIUS = 6;
const TIMELINE_OFFSETS = Array.from({ length: VISIBLE_BEAT_RADIUS * 2 + 1 }, (_, index) => index - VISIBLE_BEAT_RADIUS);
const actionArt = new Map();
const characterArt = new Map();
const cardArt = new Map();
const playedCardBackImage = new Image();
playedCardBackImage.src = '/public/images/CardBack.png';
const playModalImage = new Image();
playModalImage.src = '/public/images/PlayModal.svg';
const playModalBackImage = new Image();
playModalBackImage.src = '/public/images/PlayModalBack.svg';
const damageCardImage = new Image();
damageCardImage.src = '/public/images/DamageCard.png';
const playedCardRevealByActor = new Map();
const cornerPlayRevealByActor = new Map();
const WAITING_PULSE_MS = 1700;
const PREVIEW_PULSE_MS = 1400;
const PREVIEW_ALPHA = 0.5;
const PREVIEW_SCALE_AMPLITUDE = 0.06;
const PLAY_BUTTON_MIN_SIZE = 22;
const TOGGLE_BUTTON_MIN_SIZE = 16;
const COMBO_SKIPPED_ALPHA = 0.35;
const KNOCKBACK_BADGE_OUTSET = 0.25;
const DAMAGE_BADGE_OUTSET = 0.22;
const BADGE_NUDGE_X = 5;
const HAND_TRIGGER_CARD_HEIGHT = 0.62;
const HAND_TRIGGER_CARD_ASPECT = 0.72;
const HAND_TRIGGER_STACK_OFFSET = 0.22;
const MOVEMENT_PICKUP_CARD_HEIGHT = 0.62;
const MOVEMENT_PICKUP_CARD_ASPECT = 0.72;
const MOVEMENT_PICKUP_STACK_OFFSET = 0.22;
const REWIND_RETURN_CARD_HEIGHT = 0.62;
const REWIND_RETURN_CARD_ASPECT = 0.72;
const REWIND_RETURN_STACK_OFFSET = 0.22;
const JUMP_ARROW_MIN_WIDTH = 22;
const JUMP_ARROW_WIDTH_FACTOR = 0.74;
const JUMP_ARROW_OVERLAP_FACTOR = 0.4;
const COLLAPSED_ARROW_GAP_FACTOR = 0.18;
const COLLAPSED_JUMP_GAP_FACTOR = 0.2;
const THREE_PLAYER_TIMELINE_SCALE = 0.9;
const FOUR_PLAYER_TIMELINE_SCALE = 0.75;
const PLAYED_CARD_HEIGHT_FACTOR = 0.9;
const PLAYED_CARD_ASPECT = 0.72;
const PLAYED_CARD_GAP_FACTOR = 0.14;
const PLAYED_CARD_PORTRAIT_GAP_FACTOR = 0.2;
const PLAYED_CARD_HOVER_SCALE = 1;
const PLAYED_CARD_FACE_DOWN_MS = 180;
const PLAYED_CARD_FLIP_MS = 260;
const SHOW_TIMELINE_MINI_CARDS = false;
const PLAY_MODAL_WIDTH = 210;
const PLAY_MODAL_HEIGHT = 297;
const PLAY_MODAL_ASPECT = PLAY_MODAL_WIDTH / PLAY_MODAL_HEIGHT;
const PLAY_ACTIVE_LEFT_RATIO = 0.2288;
const PLAY_ACTIVE_TOP_RATIO = 0.3249;
const PLAY_ACTIVE_WIDTH_RATIO = 0.5429;
const PLAY_ACTIVE_HEIGHT_RATIO = 0.5558;
const PLAY_PASSIVE_LEFT_RATIO = 0.2283;
const PLAY_PASSIVE_TOP_RATIO = 0.8796;
const PLAY_PASSIVE_WIDTH_RATIO = 0.5429;
const PLAY_PASSIVE_HEIGHT_RATIO = 0.1077;
const OPPONENT_PLAY_MODAL_SCALE = 0.65;
const OPPONENT_PLAY_MODAL_MIN_WIDTH = 98;
const OPPONENT_PLAY_MODAL_MAX_WIDTH = 250;
const OPPONENT_PLAY_MODAL_MARGIN = 12;
const OPPONENT_PLAY_MODAL_GAP = 10;
const OPPONENT_PLAY_PORTRAIT_GAP = 8;
const OPPONENT_PLAY_PORTRAIT_RADIUS_FACTOR = 0.14;
const PLAY_ACTIVE_PASSIVE_MASK_COLOR = '#f0c126';
const PLAY_ROTATION_MARKERS = [
  { x: 104.81828 / 210, y: 24.026304 / 297 },
  { x: 77.204193 / 210, y: 38.801598 / 297 },
  { x: 134.02715 / 210, y: 38.801598 / 297 },
  { x: 76.081497 / 210, y: 71.993599 / 297 },
  { x: 132.90443 / 210, y: 71.693336 / 297 },
  { x: 104.78636 / 210, y: 89.211716 / 297 },
];
const ACTION_CARD_BASE_WIDTH = 240;
const ACTION_CARD_BASE_HEIGHT = 336;
const ACTION_CARD_ACTIONS_LEFT = 6;
const ACTION_CARD_ACTION_WIDTH = 44.7678;
const ACTION_CARD_ACTIONS_TOP = 7;
const ACTION_CARD_ACTION_HEIGHT = 39.501;
const PLAY_BEAT_POINTER_ICON_CENTER_Y = 0.65;
const PLAY_CARD_SCALE_MULTIPLIER = 1.1;
const PLAY_BEAT_SLOT_COUNT = 6;
const DAMAGE_ICON_ACTION = 'DamageIcon';
const STUN_CARD_BASE_ID = '__stun-damage-card__';
const STUN_CARD_PREVIEW_CLASS = 'is-stun-card';
const CORNER_PLAY_LAYOUT_DEFAULT = 'default';
const CORNER_PLAY_LAYOUT_REPLAY_CORNERS = 'replay-corners';
const cornerPlayHudNodesByActor = new Map();
let timeIndicatorPlayerCount = 2;
let timeIndicatorLocalUserId = null;
let timeIndicatorCornerLayoutMode = CORNER_PLAY_LAYOUT_DEFAULT;

const getWaitingPulse = (now) => {
  const current = Number.isFinite(now) ? now : performance.now();
  const phase = (current % WAITING_PULSE_MS) / WAITING_PULSE_MS;
  return (Math.sin(phase * Math.PI * 2 - Math.PI / 2) + 1) / 2;
};

export const setTimeIndicatorPlayerCount = (playerCount) => {
  const parsed = Number(playerCount);
  if (!Number.isFinite(parsed)) {
    timeIndicatorPlayerCount = 2;
    return;
  }
  timeIndicatorPlayerCount = Math.max(1, Math.round(parsed));
};

const getTimelineSizeScale = () => {
  if (timeIndicatorPlayerCount >= 4) return FOUR_PLAYER_TIMELINE_SCALE;
  if (timeIndicatorPlayerCount >= 3) return THREE_PLAYER_TIMELINE_SCALE;
  return 1;
};

const getActionArt = (action) => {
  const key = action || ACTION_ICON_FALLBACK;
  if (actionArt.has(key)) return actionArt.get(key);
  const image = new Image();
  image.src = `/public/images/${key}.png`;
  actionArt.set(key, image);
  return image;
};

const getCharacterArt = (characterId) => {
  if (!characterId) return null;
  if (characterArt.has(characterId)) return characterArt.get(characterId);
  const src = CHARACTER_IMAGE_SOURCES[characterId];
  if (!src) return null;
  const image = new Image();
  image.src = src;
  characterArt.set(characterId, image);
  return image;
};

const getCardArt = (cardName) => {
  const key = `${cardName ?? ''}`.trim();
  if (!key) return null;
  if (cardArt.has(key)) return cardArt.get(key);
  const image = new Image();
  image.src = `/public/images/cardart/${encodeURIComponent(key)}.jpg`;
  cardArt.set(key, image);
  return image;
};

const parseActionToken = (raw) => {
  const trimmed = `${raw ?? ''}`.trim();
  if (!trimmed) return { label: ACTION_ICON_FALLBACK, emphasized: false };
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const label = trimmed.slice(1, -1).trim();
    return { label: label || ACTION_ICON_FALLBACK, emphasized: true };
  }
  return { label: trimmed, emphasized: false };
};

const getHitSummary = (entry) => {
  const consequences = Array.isArray(entry?.consequences) ? entry.consequences : [];
  if (!consequences.length) return null;
  let hasHit = false;
  let damageDelta = 0;
  let knockbackDistance = 0;
  consequences.forEach((consequence) => {
    if (!consequence || consequence.type !== 'hit') return;
    hasHit = true;
    const delta = Number.isFinite(consequence.damageDelta) ? Math.round(consequence.damageDelta) : 0;
    const distance = Number.isFinite(consequence.knockbackDistance)
      ? Math.max(0, Math.round(consequence.knockbackDistance))
      : 0;
    damageDelta += delta;
    knockbackDistance += distance;
  });
  if (!hasHit) return null;
  return { damageDelta, knockbackDistance };
};

const matchesPreviewUser = (preview, character) => {
  if (!preview || !character) return false;
  const keys = new Set([preview.userId, preview.username].filter(Boolean));
  if (!keys.size) return false;
  return keys.has(character.userId) || keys.has(character.username);
};

const getPendingPreviewEntry = (preview, character, beatIndex) => {
  if (!matchesPreviewUser(preview, character)) return null;
  const actionList = Array.isArray(preview?.actionList) ? preview.actionList : [];
  if (!actionList.length) return null;
  const startIndex = Number.isFinite(preview?.beatIndex) ? preview.beatIndex : null;
  if (startIndex === null) return null;
  const offset = beatIndex - startIndex;
  if (offset < 0 || offset >= actionList.length) return null;
  return actionList[offset] ?? null;
};

const matchesOutcomeCharacter = (character, outcomeUserId) => {
  if (!character || !outcomeUserId) return false;
  return outcomeUserId === character.userId || outcomeUserId === character.username;
};

const getOutcomeMarkerAction = (matchOutcome, character, beatIndex) => {
  if (!matchOutcome || !character) return null;
  const markerBeat = Number.isFinite(matchOutcome?.beatIndex) ? Math.max(0, Math.round(matchOutcome.beatIndex)) : null;
  if (markerBeat == null || markerBeat !== beatIndex) return null;
  if (matchOutcome.reason === 'draw-agreement') {
    if (Array.isArray(matchOutcome.drawUserIds) && matchOutcome.drawUserIds.length) {
      const allowed = matchOutcome.drawUserIds.some((userId) => matchesOutcomeCharacter(character, userId));
      return allowed ? 'Handshake' : null;
    }
    return 'Handshake';
  }
  if (matchesOutcomeCharacter(character, matchOutcome.loserUserId)) return 'Death';
  if (
    Array.isArray(matchOutcome.loserUserIds) &&
    matchOutcome.loserUserIds.some((userId) => matchesOutcomeCharacter(character, userId))
  ) {
    return 'Death';
  }
  if (matchesOutcomeCharacter(character, matchOutcome.winnerUserId)) return 'Victory';
  return null;
};

const buildActorKeyMap = (characters) => {
  const actorKeyMap = new Map();
  characters.forEach((character) => {
    const key = character.username ?? character.userId;
    if (!key) return;
    actorKeyMap.set(character.userId, key);
    if (character.username) {
      actorKeyMap.set(character.username, key);
    }
  });
  return actorKeyMap;
};

const buildHandTriggerLookup = (interactions, characters) => {
  const lookup = new Map();
  if (!Array.isArray(interactions) || !Array.isArray(characters) || !characters.length) return lookup;
  const actorKeyMap = buildActorKeyMap(characters);
  interactions.forEach((interaction) => {
    if (!interaction || interaction.type !== 'hand-trigger') return;
    if (interaction.status === 'resolved' && interaction.resolution?.use === false) return;
    const beatIndex = Number.isFinite(interaction.beatIndex) ? Math.round(interaction.beatIndex) : null;
    if (beatIndex == null || beatIndex < 0) return;
    const actorKey = actorKeyMap.get(interaction.actorUserId) ?? interaction.actorUserId;
    if (!actorKey) return;
    const key = `${actorKey}:${beatIndex}`;
    const list = lookup.get(key) ?? [];
    list.push(interaction);
    lookup.set(key, list);
  });
  return lookup;
};

const buildRewindReturnLookup = (interactions, characters) => {
  const lookup = new Map();
  if (!Array.isArray(interactions) || !Array.isArray(characters) || !characters.length) return lookup;
  const actorKeyMap = buildActorKeyMap(characters);
  const appliedReturnByFocus = new Set();
  interactions.forEach((interaction) => {
    if (!interaction || interaction.type !== REWIND_RETURN_INTERACTION_TYPE) return;
    if (interaction.status !== 'resolved') return;
    if (!interaction.resolution?.returnToAnchor || !interaction.resolution?.applied) return;
    const actorKey = actorKeyMap.get(interaction.actorUserId) ?? interaction.actorUserId;
    if (!actorKey) return;
    const focusId = `${interaction?.resolution?.focusInteractionId ?? ''}`.trim();
    if (!focusId) return;
    appliedReturnByFocus.add(`${actorKey}:${focusId}`);
  });
  interactions.forEach((interaction) => {
    if (!interaction || interaction.type !== REWIND_RETURN_INTERACTION_TYPE) return;
    if (interaction.status !== 'resolved') return;
    const beatIndex = Number.isFinite(interaction.beatIndex) ? Math.round(interaction.beatIndex) : null;
    if (beatIndex == null || beatIndex < 0) return;
    const actorKey = actorKeyMap.get(interaction.actorUserId) ?? interaction.actorUserId;
    if (!actorKey) return;
    const hasExplicitChoice = typeof interaction?.resolution?.returnToAnchor === 'boolean';
    if (!hasExplicitChoice) return;
    const focusId = `${interaction?.resolution?.focusInteractionId ?? ''}`.trim();
    if (!interaction.resolution.returnToAnchor && focusId && appliedReturnByFocus.has(`${actorKey}:${focusId}`)) {
      return;
    }
    const key = `${actorKey}:${beatIndex}`;
    const list = lookup.get(key) ?? [];
    list.push(interaction);
    lookup.set(key, list);
  });
  return lookup;
};

const toBadgeCount = (value) => {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
};

const getResolvedListCount = (value) => (Array.isArray(value) ? value.length : 0);

const getInteractionBeatIndex = (interaction) => {
  const beatIndex = Number.isFinite(interaction?.beatIndex) ? Math.round(interaction.beatIndex) : null;
  if (beatIndex == null || beatIndex < 0) return null;
  return beatIndex;
};

const getInteractionActorKey = (actorKeyMap, interaction) =>
  actorKeyMap.get(interaction?.actorUserId) ??
  actorKeyMap.get(interaction?.targetUserId) ??
  interaction?.actorUserId ??
  interaction?.targetUserId ??
  null;

const buildMiniCardStackLayout = ({
  row,
  xPos,
  rowSpacing,
  iconSize,
  count,
  heightFactor,
  aspect,
  stackOffsetFactor,
  side = 'left',
  slotIndex = 0,
}) => {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  if (!safeCount || !row?.numberArea) return null;
  const cardHeight = iconSize * heightFactor;
  const cardWidth = cardHeight * aspect;
  const baseCenterX = side === 'right' ? xPos + rowSpacing * 0.5 : xPos - rowSpacing * 0.5;
  const safeSlotIndex = side === 'left' ? Math.max(0, Math.round(slotIndex)) : 0;
  const slotSpacing = cardWidth + Math.max(2, rowSpacing * 0.08);
  const centerX = baseCenterX - safeSlotIndex * slotSpacing;
  const minCenterX = row.numberArea.x + cardWidth / 2;
  const maxCenterX = row.numberArea.x + row.numberArea.width - cardWidth / 2;
  if (centerX < minCenterX || centerX > maxCenterX) return null;
  const stackOffset = cardHeight * stackOffsetFactor;
  const startOffset = -((safeCount - 1) * stackOffset) / 2;
  return {
    count: safeCount,
    centerX,
    cardWidth,
    cardHeight,
    stackOffset,
    startOffset,
  };
};

const getMiniCardStackItemGeometry = (layout, rowCenterY, index) => {
  if (!layout || !Number.isFinite(index)) return null;
  const centerY = rowCenterY + layout.startOffset + index * layout.stackOffset;
  return {
    centerY,
    bounds: {
      x: layout.centerX - layout.cardWidth / 2,
      y: centerY - layout.cardHeight / 2,
      width: layout.cardWidth,
      height: layout.cardHeight,
    },
  };
};

const getInteractionDiscardCount = (interaction) => {
  if (!interaction || typeof interaction !== 'object') return 0;
  if (interaction.type !== 'discard') return 0;
  const abilityCount = toBadgeCount(interaction.discardAbilityCount);
  const movementCount = toBadgeCount(interaction.discardMovementCount);
  if (abilityCount !== null || movementCount !== null) {
    return (abilityCount ?? 0) + (movementCount ?? 0);
  }
  return toBadgeCount(interaction.discardCount) ?? 0;
};

const buildDiscardLookup = (interactions, characters) => {
  const lookup = new Map();
  if (!Array.isArray(interactions) || !Array.isArray(characters) || !characters.length) return lookup;
  const actorKeyMap = buildActorKeyMap(characters);
  interactions.forEach((interaction) => {
    if (!interaction) return;
    if (interaction.type !== 'discard') return;
    const discardCount = getInteractionDiscardCount(interaction);
    if (!discardCount) return;
    const beatIndex = getInteractionBeatIndex(interaction);
    if (beatIndex == null) return;
    const actorKey = getInteractionActorKey(actorKeyMap, interaction);
    if (!actorKey) return;
    const key = `${actorKey}:${beatIndex}`;
    lookup.set(key, (lookup.get(key) ?? 0) + discardCount);
  });
  return lookup;
};

const getInteractionDrawCount = (interaction) => {
  if (!interaction || typeof interaction !== 'object') return 0;
  if (interaction.type !== 'draw') return 0;
  const resolvedCount =
    getResolvedListCount(interaction.resolution?.abilityCardIds) +
    getResolvedListCount(interaction.resolution?.movementCardIds);
  if (resolvedCount > 0) return resolvedCount;
  const abilityCount = toBadgeCount(interaction.drawCount);
  const movementCount = toBadgeCount(interaction.drawMovementCount);
  if (abilityCount !== null || movementCount !== null) {
    return (abilityCount ?? 0) + (movementCount ?? 0);
  }
  return 0;
};

const normalizeCardIdList = (value) =>
  Array.isArray(value)
    ? value
        .map((item) => `${item ?? ''}`.trim())
        .filter(Boolean)
    : [];

const getInteractionMovementPickupIds = (interaction) => {
  if (!interaction || typeof interaction !== 'object') return [];
  if (interaction.type !== 'draw') return [];
  if (interaction.status !== 'resolved') return [];
  return normalizeCardIdList(interaction.resolution?.movementCardIds);
};

const buildMovementPickupLookup = (interactions, characters) => {
  const lookup = new Map();
  if (!Array.isArray(interactions) || !Array.isArray(characters) || !characters.length) return lookup;
  const actorKeyMap = buildActorKeyMap(characters);
  interactions.forEach((interaction) => {
    const movementCardIds = getInteractionMovementPickupIds(interaction);
    if (!movementCardIds.length) return;
    const beatIndex = getInteractionBeatIndex(interaction);
    if (beatIndex == null) return;
    const actorKey = getInteractionActorKey(actorKeyMap, interaction);
    if (!actorKey) return;
    const key = `${actorKey}:${beatIndex}`;
    const existing = lookup.get(key) ?? { movementCardIds: [], interactions: [] };
    const seen = new Set(existing.movementCardIds);
    movementCardIds.forEach((cardId) => {
      if (seen.has(cardId)) return;
      seen.add(cardId);
      existing.movementCardIds.push(cardId);
    });
    existing.interactions.push(interaction);
    lookup.set(key, existing);
  });
  return lookup;
};

const buildDrawLookup = (interactions, characters) => {
  const lookup = new Map();
  if (!Array.isArray(interactions) || !Array.isArray(characters) || !characters.length) return lookup;
  const actorKeyMap = buildActorKeyMap(characters);
  interactions.forEach((interaction) => {
    if (!interaction || interaction.type !== 'draw') return;
    const drawCount = getInteractionDrawCount(interaction);
    if (!drawCount) return;
    const beatIndex = getInteractionBeatIndex(interaction);
    if (beatIndex == null) return;
    const actorKey = getInteractionActorKey(actorKeyMap, interaction);
    if (!actorKey) return;
    const key = `${actorKey}:${beatIndex}`;
    lookup.set(key, (lookup.get(key) ?? 0) + drawCount);
  });
  return lookup;
};

const readCardId = (value) => `${value ?? ''}`.trim();

const isDamagePreviewEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return false;
  const action = `${entry.action ?? ''}`.trim();
  return action === DAMAGE_ICON_ACTION;
};

const buildStunPreviewCard = (stunCount) => {
  const clampedCount = Math.max(1, Math.min(PLAY_BEAT_SLOT_COUNT - 1, Math.round(stunCount || 1)));
  return {
    id: `${STUN_CARD_BASE_ID}:${clampedCount}`,
    type: 'ability',
    name: 'Stunned',
    rotations: '*',
    actions: [...Array.from({ length: clampedCount }, () => DAMAGE_ICON_ACTION), 'E'],
    activeText: '',
    passiveText: '',
    previewClassName: STUN_CARD_PREVIEW_CLASS,
  };
};

const getBeatLookupEntry = (beatLookup, beatIndex, lookupKey) => {
  if (!Array.isArray(beatLookup) || !lookupKey) return null;
  if (!Number.isFinite(beatIndex) || beatIndex < 0 || beatIndex >= beatLookup.length) return null;
  return beatLookup[beatIndex]?.get(lookupKey) ?? null;
};

const findPlayedCardSetStartIndex = (beatLookup, lookupKey, beatIndex, activeCardId, passiveCardId) => {
  let earliest = beatIndex;
  for (let index = beatIndex; index >= 0; index -= 1) {
    const entry = getBeatLookupEntry(beatLookup, index, lookupKey);
    if (!entry) continue;
    const action = `${entry.action ?? ''}`.trim();
    if (index !== beatIndex && action === DEFAULT_ACTION) break;
    const entryActive = readCardId(entry.cardId);
    const entryPassive = readCardId(entry.passiveCardId);
    if ((entryActive && entryActive !== activeCardId) || (entryPassive && entryPassive !== passiveCardId)) {
      break;
    }
    earliest = index;
    const rotationSource = `${entry.rotationSource ?? ''}`.trim();
    const rotation = `${entry.rotation ?? ''}`.trim();
    if (rotationSource === 'selected' || (!rotationSource && rotation)) {
      return index;
    }
  }
  return earliest;
};

const resolvePlayedCardPairForBeat = (beatLookup, lookupKey, beatIndex) => {
  const currentEntry = getBeatLookupEntry(beatLookup, beatIndex, lookupKey);
  if (!currentEntry) return null;
  const currentAction = `${currentEntry.action ?? ''}`.trim();
  if (!currentAction || currentAction === ACTION_ICON_FALLBACK) return null;
  if (currentAction === DEFAULT_ACTION) {
    const currentCardId = readCardId(currentEntry.cardId);
    const currentPassiveCardId = readCardId(currentEntry.passiveCardId);
    if (!currentCardId && !currentPassiveCardId) {
      return null;
    }
  }

  let activeCardId = readCardId(currentEntry.cardId);
  let passiveCardId = readCardId(currentEntry.passiveCardId);
  if (!activeCardId || !passiveCardId) {
    for (let index = beatIndex - 1; index >= 0; index -= 1) {
      const previousEntry = getBeatLookupEntry(beatLookup, index, lookupKey);
      if (!previousEntry) continue;
      const previousAction = `${previousEntry.action ?? ''}`.trim();
      if (previousAction === DEFAULT_ACTION) break;
      if (!activeCardId) activeCardId = readCardId(previousEntry.cardId);
      if (!passiveCardId) passiveCardId = readCardId(previousEntry.passiveCardId);
      if (activeCardId && passiveCardId) break;
    }
  }

  if (!activeCardId || !passiveCardId) return null;
  const startIndex = findPlayedCardSetStartIndex(beatLookup, lookupKey, beatIndex, activeCardId, passiveCardId);
  return {
    kind: 'normal',
    activeCardId,
    passiveCardId,
    startIndex,
    pairKey: `${activeCardId}:${passiveCardId}:${startIndex}`,
  };
};

const resolveStunModalStateForBeat = (beatLookup, lookupKey, beatIndex) => {
  const currentEntry = getBeatLookupEntry(beatLookup, beatIndex, lookupKey);
  // DamageIcon runs (stun or knockback-hit rewrites) use the damage preview card modal.
  if (!isDamagePreviewEntry(currentEntry)) return null;
  let startIndex = beatIndex;
  for (let index = beatIndex - 1; index >= 0; index -= 1) {
    const previous = getBeatLookupEntry(beatLookup, index, lookupKey);
    if (!isDamagePreviewEntry(previous)) break;
    startIndex = index;
  }
  let runCount = 0;
  for (let index = startIndex; index < beatLookup.length; index += 1) {
    const entry = getBeatLookupEntry(beatLookup, index, lookupKey);
    if (!isDamagePreviewEntry(entry)) break;
    runCount += 1;
  }
  const clampedCount = Math.max(1, Math.min(PLAY_BEAT_SLOT_COUNT - 1, runCount));
  return {
    kind: 'stun',
    activeCardId: `${STUN_CARD_BASE_ID}:${lookupKey}:${startIndex}`,
    passiveCardId: null,
    startIndex,
    pairKey: `stun:${lookupKey}:${startIndex}`,
    stunCount: clampedCount,
    previewCard: buildStunPreviewCard(clampedCount),
  };
};

const resolvePlayModalStateForBeat = (beatLookup, lookupKey, beatIndex) => {
  const stunned = resolveStunModalStateForBeat(beatLookup, lookupKey, beatIndex);
  if (stunned) return stunned;
  return resolvePlayedCardPairForBeat(beatLookup, lookupKey, beatIndex);
};

const buildPlayedCardPairLayout = ({ rowCenterY, rowHeight, portraitX, portraitRadius }) => {
  if (!Number.isFinite(rowCenterY) || !Number.isFinite(rowHeight) || !Number.isFinite(portraitX) || !Number.isFinite(portraitRadius)) {
    return null;
  }
  const cardHeight = Math.max(16, rowHeight * PLAYED_CARD_HEIGHT_FACTOR);
  const cardWidth = cardHeight * PLAYED_CARD_ASPECT;
  const cardGap = Math.max(2, cardHeight * PLAYED_CARD_GAP_FACTOR);
  const portraitGap = Math.max(3, cardHeight * PLAYED_CARD_PORTRAIT_GAP_FACTOR);
  const pairWidth = cardWidth * 2 + cardGap;
  const rightEdge = portraitX - portraitRadius - portraitGap;
  const leftEdge = Math.max(2, rightEdge - pairWidth);
  const y = rowCenterY - cardHeight / 2;
  const activeBounds = { x: leftEdge, y, width: cardWidth, height: cardHeight };
  const passiveBounds = { x: leftEdge + cardWidth + cardGap, y, width: cardWidth, height: cardHeight };
  return { cardWidth, cardHeight, activeBounds, passiveBounds };
};

const getScaledRect = (rect, scale = 1) => {
  if (!rect || !Number.isFinite(scale) || scale <= 0) return rect;
  const width = rect.width * scale;
  const height = rect.height * scale;
  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height,
  };
};

const getPlayedCardHoverSlot = (pairLayout, pointer) => {
  if (!pairLayout || !pointer || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return null;
  const activeHoverBounds = getScaledRect(pairLayout.activeBounds, PLAYED_CARD_HOVER_SCALE);
  const passiveHoverBounds = getScaledRect(pairLayout.passiveBounds, PLAYED_CARD_HOVER_SCALE);
  const activeHit = isPointInRect(pointer.x, pointer.y, activeHoverBounds);
  const passiveHit = isPointInRect(pointer.x, pointer.y, passiveHoverBounds);
  if (activeHit && passiveHit) {
    const activeCenter = {
      x: pairLayout.activeBounds.x + pairLayout.activeBounds.width / 2,
      y: pairLayout.activeBounds.y + pairLayout.activeBounds.height / 2,
    };
    const passiveCenter = {
      x: pairLayout.passiveBounds.x + pairLayout.passiveBounds.width / 2,
      y: pairLayout.passiveBounds.y + pairLayout.passiveBounds.height / 2,
    };
    const activeDistance = Math.hypot(pointer.x - activeCenter.x, pointer.y - activeCenter.y);
    const passiveDistance = Math.hypot(pointer.x - passiveCenter.x, pointer.y - passiveCenter.y);
    return activeDistance <= passiveDistance ? 'active' : 'passive';
  }
  if (activeHit) return 'active';
  if (passiveHit) return 'passive';
  return null;
};

const prunePlayedCardRevealState = (activeActorKeys) => {
  const keep = activeActorKeys instanceof Set ? activeActorKeys : new Set();
  playedCardRevealByActor.forEach((_, key) => {
    if (!keep.has(key)) {
      playedCardRevealByActor.delete(key);
    }
  });
};

const clearPlayedCardRevealState = (actorKey) => {
  if (!actorKey) return;
  playedCardRevealByActor.delete(actorKey);
};

const getPlayedCardRevealState = (actorKey, pairKey, now) => {
  if (!actorKey || !pairKey) return null;
  const currentTime = Number.isFinite(now) ? now : performance.now();
  const existing = playedCardRevealByActor.get(actorKey);
  if (!existing || existing.pairKey !== pairKey) {
    const created = { pairKey, startTime: currentTime };
    playedCardRevealByActor.set(actorKey, created);
    return { phase: 'back', flipScaleX: 1 };
  }
  const elapsed = Math.max(0, currentTime - existing.startTime);
  if (elapsed < PLAYED_CARD_FACE_DOWN_MS) {
    return { phase: 'back', flipScaleX: 1 };
  }
  const flipElapsed = elapsed - PLAYED_CARD_FACE_DOWN_MS;
  if (flipElapsed < PLAYED_CARD_FLIP_MS) {
    const t = flipElapsed / PLAYED_CARD_FLIP_MS;
    if (t < 0.5) {
      const localT = t / 0.5;
      return { phase: 'back', flipScaleX: Math.max(0.06, 1 - localT) };
    }
    const localT = (t - 0.5) / 0.5;
    return { phase: 'front', flipScaleX: Math.max(0.06, localT) };
  }
  return { phase: 'front', flipScaleX: 1 };
};

const pruneCornerPlayRevealState = (activeActorKeys) => {
  const keep = activeActorKeys instanceof Set ? activeActorKeys : new Set();
  cornerPlayRevealByActor.forEach((_, key) => {
    if (!keep.has(key)) {
      cornerPlayRevealByActor.delete(key);
    }
  });
};

const clearCornerPlayRevealState = (actorKey) => {
  if (!actorKey) return;
  cornerPlayRevealByActor.delete(actorKey);
};

const getCornerPlayRevealState = (actorKey, pairKey, now) => {
  if (!actorKey || !pairKey) return null;
  const currentTime = Number.isFinite(now) ? now : performance.now();
  const existing = cornerPlayRevealByActor.get(actorKey);
  if (!existing || existing.pairKey !== pairKey) {
    const created = { pairKey, startTime: currentTime };
    cornerPlayRevealByActor.set(actorKey, created);
    return { phase: 'back', flipScaleX: 1 };
  }
  const elapsed = Math.max(0, currentTime - existing.startTime);
  if (elapsed < PLAYED_CARD_FACE_DOWN_MS) {
    return { phase: 'back', flipScaleX: 1 };
  }
  const flipElapsed = elapsed - PLAYED_CARD_FACE_DOWN_MS;
  if (flipElapsed < PLAYED_CARD_FLIP_MS) {
    const t = flipElapsed / PLAYED_CARD_FLIP_MS;
    if (t < 0.5) {
      const localT = t / 0.5;
      return { phase: 'back', flipScaleX: Math.max(0.06, 1 - localT) };
    }
    const localT = (t - 0.5) / 0.5;
    return { phase: 'front', flipScaleX: Math.max(0.06, localT) };
  }
  return { phase: 'front', flipScaleX: 1 };
};

const getOpponentCharacters = (characters, localUserId, options = {}) => {
  const includeLocalPlayer = Boolean(options?.includeLocalPlayer);
  const localKey = `${localUserId ?? ''}`.trim();
  if (!Array.isArray(characters) || !characters.length) return [];
  const everyone = characters.filter((character) => Boolean(character));
  if (includeLocalPlayer) return everyone;
  if (!localKey) return everyone;
  return everyone.filter((character) => {
    if (!character) return false;
    const userId = `${character.userId ?? ''}`.trim();
    const username = `${character.username ?? ''}`.trim();
    return userId !== localKey && username !== localKey;
  });
};

const getReferencePlayModalWidth = (viewport) => {
  const width = Number.isFinite(viewport?.width) ? viewport.width : 0;
  if (!Number.isFinite(width) || width <= 0) return 266;
  return Math.max(266, Math.min(342, width * 0.228));
};

const getPlayModalSlotBounds = (modal) => {
  if (!modal) return null;
  const activeBounds = {
    x: modal.x + modal.width * PLAY_ACTIVE_LEFT_RATIO,
    y: modal.y + modal.height * PLAY_ACTIVE_TOP_RATIO,
    width: modal.width * PLAY_ACTIVE_WIDTH_RATIO,
    height: modal.height * PLAY_ACTIVE_HEIGHT_RATIO,
  };
  const passiveBounds = {
    x: modal.x + modal.width * PLAY_PASSIVE_LEFT_RATIO,
    y: modal.y + modal.height * PLAY_PASSIVE_TOP_RATIO,
    width: modal.width * PLAY_PASSIVE_WIDTH_RATIO,
    height: modal.height * PLAY_PASSIVE_HEIGHT_RATIO,
  };
  return { activeBounds, passiveBounds };
};

const buildLinearOpponentPlayHudLayout = (viewport, opponentCharacters = []) => {
  const opponents = Array.isArray(opponentCharacters) ? opponentCharacters : [];
  if (!opponents.length) return [];
  const margin = OPPONENT_PLAY_MODAL_MARGIN;
  const gap = OPPONENT_PLAY_MODAL_GAP;
  const desiredWidth = Math.max(
    OPPONENT_PLAY_MODAL_MIN_WIDTH,
    Math.min(OPPONENT_PLAY_MODAL_MAX_WIDTH, getReferencePlayModalWidth(viewport) * OPPONENT_PLAY_MODAL_SCALE),
  );
  const availableWidth = Math.max(0, viewport.width - margin * 2 - gap * Math.max(0, opponents.length - 1));
  const fitWidth = opponents.length ? availableWidth / opponents.length : desiredWidth;
  const width = Math.max(56, Math.min(desiredWidth, fitWidth || desiredWidth));
  const height = width / PLAY_MODAL_ASPECT;
  const portraitRadius = Math.max(10, width * OPPONENT_PLAY_PORTRAIT_RADIUS_FACTOR);
  const portraitY = margin + portraitRadius;
  const modalY = portraitY + portraitRadius + OPPONENT_PLAY_PORTRAIT_GAP;
  return opponents.map((character, index) => {
    const x = margin + index * (width + gap);
    const modal = { x, y: modalY, width, height };
    const slots = getPlayModalSlotBounds(modal);
    return {
      character,
      modal,
      portrait: { x: x + width / 2, y: portraitY, radius: portraitRadius },
      activeBounds: slots.activeBounds,
      passiveBounds: slots.passiveBounds,
    };
  });
};

const buildReplayCornerOpponentPlayHudLayout = (viewport, opponentCharacters = []) => {
  const opponents = Array.isArray(opponentCharacters) ? opponentCharacters : [];
  if (!opponents.length) return [];
  const margin = OPPONENT_PLAY_MODAL_MARGIN;
  const gap = OPPONENT_PLAY_MODAL_GAP;
  const desiredWidth = Math.max(
    OPPONENT_PLAY_MODAL_MIN_WIDTH,
    Math.min(OPPONENT_PLAY_MODAL_MAX_WIDTH, getReferencePlayModalWidth(viewport) * OPPONENT_PLAY_MODAL_SCALE),
  );
  const columns = Math.min(2, opponents.length);
  const availableWidth = Math.max(0, viewport.width - margin * 2 - gap * Math.max(0, columns - 1));
  const fitWidth = columns ? availableWidth / columns : desiredWidth;
  let widthLimit = fitWidth || desiredWidth;
  if (opponents.length > 2) {
    const rowGap = gap + OPPONENT_PLAY_PORTRAIT_GAP;
    const availableHeight = Math.max(0, viewport.height - margin * 2 - rowGap);
    const blockHeight = availableHeight / 2;
    const widthByHeight =
      (blockHeight - OPPONENT_PLAY_PORTRAIT_GAP) /
      (1 / PLAY_MODAL_ASPECT + OPPONENT_PLAY_PORTRAIT_RADIUS_FACTOR * 2);
    if (Number.isFinite(widthByHeight) && widthByHeight > 0) {
      widthLimit = Math.min(widthLimit, widthByHeight);
    }
  }
  const width = Math.max(56, Math.min(desiredWidth, widthLimit || desiredWidth));
  const height = width / PLAY_MODAL_ASPECT;
  const portraitRadius = Math.max(10, width * OPPONENT_PLAY_PORTRAIT_RADIUS_FACTOR);
  const leftX = margin;
  const rightX = Math.max(margin, viewport.width - margin - width);
  const topPortraitY = margin + portraitRadius;
  const topModalY = topPortraitY + portraitRadius + OPPONENT_PLAY_PORTRAIT_GAP;
  const bottomModalY = Math.max(margin, viewport.height - margin - height);
  const bottomPortraitY = Math.max(portraitRadius, bottomModalY - OPPONENT_PLAY_PORTRAIT_GAP - portraitRadius);
  const corners = [
    { x: leftX, modalY: topModalY, portraitY: topPortraitY },
    { x: rightX, modalY: topModalY, portraitY: topPortraitY },
    { x: leftX, modalY: bottomModalY, portraitY: bottomPortraitY },
    { x: rightX, modalY: bottomModalY, portraitY: bottomPortraitY },
  ];
  return opponents.map((character, index) => {
    const corner = corners[index];
    if (!corner) return null;
    const modal = { x: corner.x, y: corner.modalY, width, height };
    const slots = getPlayModalSlotBounds(modal);
    return {
      character,
      modal,
      portrait: { x: corner.x + width / 2, y: corner.portraitY, radius: portraitRadius },
      activeBounds: slots.activeBounds,
      passiveBounds: slots.passiveBounds,
    };
  }).filter(Boolean);
};

const buildOpponentPlayHudLayout = (viewport, opponentCharacters = [], layoutMode = CORNER_PLAY_LAYOUT_DEFAULT) => {
  if (layoutMode === CORNER_PLAY_LAYOUT_REPLAY_CORNERS && Array.isArray(opponentCharacters) && opponentCharacters.length <= 4) {
    return buildReplayCornerOpponentPlayHudLayout(viewport, opponentCharacters);
  }
  return buildLinearOpponentPlayHudLayout(viewport, opponentCharacters);
};

const getRotationMarkerPoint = (modal, slotIndex) => {
  if (!modal || !Number.isFinite(slotIndex)) return null;
  const rounded = Math.max(0, Math.min(PLAY_ROTATION_MARKERS.length - 1, Math.round(slotIndex)));
  const marker = PLAY_ROTATION_MARKERS[rounded];
  if (!marker) return null;
  return {
    x: modal.x + modal.width * marker.x,
    y: modal.y + modal.height * marker.y,
  };
};

const getPlayCardBoundsInModal = (modal) => {
  if (!modal) return null;
  const activeBounds = {
    x: modal.x + modal.width * PLAY_ACTIVE_LEFT_RATIO,
    y: modal.y + modal.height * PLAY_ACTIVE_TOP_RATIO,
    width: modal.width * PLAY_ACTIVE_WIDTH_RATIO,
    height: modal.height * PLAY_ACTIVE_HEIGHT_RATIO,
  };
  const cardScale = (activeBounds.width / ACTION_CARD_BASE_WIDTH) * PLAY_CARD_SCALE_MULTIPLIER;
  const cardWidth = ACTION_CARD_BASE_WIDTH * cardScale;
  const cardHeight = ACTION_CARD_BASE_HEIGHT * cardScale;
  return {
    x: activeBounds.x + (activeBounds.width - cardWidth) / 2,
    y: activeBounds.y + activeBounds.height - cardHeight,
    width: cardWidth,
    height: cardHeight,
  };
};

const getPlayBeatRailPoint = (modal, slotIndex) => {
  if (!modal || !Number.isFinite(slotIndex)) return null;
  const cardBounds = getPlayCardBoundsInModal(modal);
  if (!cardBounds) return null;
  const rounded = Math.max(0, Math.min(PLAY_BEAT_SLOT_COUNT - 1, Math.round(slotIndex)));
  const iconXRatio = (ACTION_CARD_ACTIONS_LEFT + ACTION_CARD_ACTION_WIDTH * 0.32) / ACTION_CARD_BASE_WIDTH;
  const iconTopRatio =
    (ACTION_CARD_ACTIONS_TOP + ACTION_CARD_ACTION_HEIGHT * PLAY_BEAT_POINTER_ICON_CENTER_Y) / ACTION_CARD_BASE_HEIGHT;
  const iconStepRatio = ACTION_CARD_ACTION_HEIGHT / ACTION_CARD_BASE_HEIGHT;
  return {
    x: cardBounds.x + cardBounds.width * iconXRatio,
    y: cardBounds.y + cardBounds.height * (iconTopRatio + iconStepRatio * rounded),
  };
};

const toRotationSlotIndex = (rotationLabel) => {
  const value = `${rotationLabel ?? ''}`.trim().toUpperCase();
  if (!value) return null;
  if (value === '0') return 0;
  if (value === 'L1') return 1;
  if (value === 'R1') return 2;
  if (value === 'L2') return 3;
  if (value === 'R2') return 4;
  if (value === '3') return 5;
  return null;
};

const resolveSelectedRotationForPair = (beatLookup, lookupKey, playedPair, beatIndex) => {
  if (!Array.isArray(beatLookup) || !lookupKey || !playedPair) return '';
  const startIndex = Number.isFinite(playedPair.startIndex) ? Math.max(0, Math.round(playedPair.startIndex)) : null;
  if (startIndex == null) return '';
  const maxIndex = Number.isFinite(beatIndex) ? Math.max(startIndex, Math.round(beatIndex)) : startIndex;
  for (let index = startIndex; index <= maxIndex; index += 1) {
    const entry = getBeatLookupEntry(beatLookup, index, lookupKey);
    if (!entry) continue;
    const action = `${entry.action ?? ''}`.trim();
    if (action === DEFAULT_ACTION && index > startIndex) break;
    const rotation = `${entry.rotation ?? ''}`.trim();
    const rotationSource = `${entry.rotationSource ?? ''}`.trim();
    if (rotationSource === 'selected') return rotation;
    if (!rotationSource && rotation) return rotation;
  }
  return '';
};

const resolvePlayBeatSlotForValue = (playedPair, value) => {
  if (!playedPair || !Number.isFinite(value)) return null;
  const startIndex = Number.isFinite(playedPair.startIndex) ? playedPair.startIndex : null;
  if (startIndex == null) return null;
  const offset = Math.max(0, Math.round(value) - Math.round(startIndex));
  return Math.max(0, Math.min(PLAY_BEAT_SLOT_COUNT - 1, offset));
};

export const getPlayBeatSlotForCharacter = (beats, character, beatIndex) => {
  if (!Array.isArray(beats) || !beats.length || !character || !Number.isFinite(beatIndex)) return null;
  const lookupKey = character.username ?? character.userId;
  if (!lookupKey) return null;
  const safeBeat = Math.max(0, Math.min(beats.length - 1, Math.round(beatIndex)));
  const beatLookup = buildBeatLookup(beats);
  const playedPair = resolvePlayModalStateForBeat(beatLookup, lookupKey, safeBeat);
  return resolvePlayBeatSlotForValue(playedPair, safeBeat);
};

export const getPlayedCardPairForCharacterAtBeat = (beats, character, beatIndex) => {
  if (!Array.isArray(beats) || !beats.length || !character || !Number.isFinite(beatIndex)) return null;
  const lookupKey = character.username ?? character.userId;
  if (!lookupKey) return null;
  const safeBeat = Math.max(0, Math.min(beats.length - 1, Math.round(beatIndex)));
  const beatLookup = buildBeatLookup(beats);
  return resolvePlayModalStateForBeat(beatLookup, lookupKey, safeBeat);
};

export const getPlayedRotationForCharacterAtBeat = (beats, character, beatIndex) => {
  if (!Array.isArray(beats) || !beats.length || !character || !Number.isFinite(beatIndex)) return '';
  const lookupKey = character.username ?? character.userId;
  if (!lookupKey) return '';
  const safeBeat = Math.max(0, Math.min(beats.length - 1, Math.round(beatIndex)));
  const beatLookup = buildBeatLookup(beats);
  const playedPair = resolvePlayModalStateForBeat(beatLookup, lookupKey, safeBeat);
  if (playedPair?.kind === 'stun') return '';
  return resolveSelectedRotationForPair(beatLookup, lookupKey, playedPair, safeBeat);
};

export const getTimeIndicatorLayout = (viewport, options = {}) => {
  const isExpanded = options?.isExpanded !== false;
  const playerCount = Number.isFinite(options?.playerCount)
    ? Math.max(1, Math.round(options.playerCount))
    : Math.max(1, timeIndicatorPlayerCount);
  const padding = viewport.width < 520 ? 8 : 12;
  const topToggleGap = viewport.width < 520 ? 4 : 6;
  const speedControlGap = viewport.width < 520 ? 8 : 10;
  const maxWidth = Math.max(180, viewport.width - padding * 4);
  const borderWidth = DEFAULT_BORDER_SIZE.width;
  const borderHeight = DEFAULT_BORDER_SIZE.height;
  const timelineSizeScale = getTimelineSizeScale();
  let scale = Math.min(1, maxWidth / borderWidth);
  let width = borderWidth * scale * timelineSizeScale;
  let actionHeight = borderHeight * scale * timelineSizeScale;
  let timeHeight = actionHeight * 0.7;
  let portraitOverlap = Math.max(2, actionHeight * 0.8);
  let groupWidth = width + actionHeight - portraitOverlap;
  const maxGroupWidth = Math.max(0, viewport.width - padding * 2);

  if (maxGroupWidth && groupWidth > maxGroupWidth) {
    const adjust = maxGroupWidth / groupWidth;
    scale *= adjust;
    width = borderWidth * scale * timelineSizeScale;
    actionHeight = borderHeight * scale * 1.5 * timelineSizeScale;
    timeHeight = actionHeight * 0.5;
    portraitOverlap = Math.max(2, actionHeight * 0.08);
    groupWidth = width + actionHeight - portraitOverlap;
  }

  const groupX = (viewport.width - groupWidth) / 2;
  let x = groupX + actionHeight - portraitOverlap;
  const topOffset = Math.max(0, topToggleGap + Math.max(TOGGLE_BUTTON_MIN_SIZE, timeHeight * 0.4));
  const y = padding + topOffset;
  const arrowWidth = Math.max(30, actionHeight * 0.25);
  const innerPadding = Math.max(6, actionHeight * 0.12);
  let numberArea = {
    x: x + arrowWidth * 0.7,
    y,
    width: width - arrowWidth * 1.4,
    height: timeHeight,
  };
  let leftArrow = { x, y, width: arrowWidth, height: timeHeight };
  let rightArrow = {
    x: x + width - arrowWidth,
    y,
    width: arrowWidth,
    height: timeHeight,
  };
  const jumpArrowWidth = Math.max(JUMP_ARROW_MIN_WIDTH, arrowWidth * JUMP_ARROW_WIDTH_FACTOR);
  const jumpArrowOverlap = jumpArrowWidth * JUMP_ARROW_OVERLAP_FACTOR;
  let leftJumpArrow = {
    x: leftArrow.x - jumpArrowWidth + jumpArrowOverlap,
    y,
    width: jumpArrowWidth,
    height: timeHeight,
  };
  let rightJumpArrow = {
    x: rightArrow.x + rightArrow.width - jumpArrowOverlap,
    y,
    width: jumpArrowWidth,
    height: timeHeight,
  };
  const portraitRadius = actionHeight / 2;
  const portraitBorderWidth = Math.max(1.5, portraitRadius * CHARACTER_TOKEN_STYLE.borderFactor);
  const playSize = Math.max(PLAY_BUTTON_MIN_SIZE, timeHeight * 0.8);
  const playCenterX = x + width / 2;
  const playCenterY = y + timeHeight / 2;
  const playButton = {
    x: playCenterX - playSize / 2,
    y: playCenterY - playSize / 2,
    size: playSize,
    centerX: playCenterX,
    centerY: playCenterY,
    radius: playSize / 2,
  };
  const toggleSize = Math.max(TOGGLE_BUTTON_MIN_SIZE, timeHeight * 0.4);
  const toggleCenterY = y - topToggleGap - toggleSize / 2;
  const toggleButton = {
    x: playCenterX - toggleSize / 2,
    y: toggleCenterY - toggleSize / 2,
    width: toggleSize,
    height: toggleSize,
    centerX: playCenterX,
    centerY: toggleCenterY,
    radius: toggleSize / 2,
  };

  if (!isExpanded) {
    const collapsedArrowWidth = Math.max(24, arrowWidth * 0.84);
    const collapsedJumpArrowWidth = Math.max(JUMP_ARROW_MIN_WIDTH, jumpArrowWidth * 0.8);
    const arrowGap = Math.max(8, timeHeight * COLLAPSED_ARROW_GAP_FACTOR);
    const jumpGap = Math.max(10, timeHeight * COLLAPSED_JUMP_GAP_FACTOR);
    leftArrow = {
      x: playButton.x - arrowGap - collapsedArrowWidth,
      y,
      width: collapsedArrowWidth,
      height: timeHeight,
    };
    rightArrow = {
      x: playButton.x + playButton.size + arrowGap,
      y,
      width: collapsedArrowWidth,
      height: timeHeight,
    };
    leftJumpArrow = {
      x: leftArrow.x - jumpGap - collapsedJumpArrowWidth,
      y,
      width: collapsedJumpArrowWidth,
      height: timeHeight,
    };
    rightJumpArrow = {
      x: rightArrow.x + rightArrow.width + jumpGap,
      y,
      width: collapsedJumpArrowWidth,
      height: timeHeight,
    };

    const collapsedStartX = Math.min(leftJumpArrow.x, leftArrow.x, playButton.x);
    const collapsedEndX = Math.max(
      rightJumpArrow.x + rightJumpArrow.width,
      rightArrow.x + rightArrow.width,
      playButton.x + playButton.size,
    );
    const collapsedPadding = Math.max(8, timeHeight * 0.3);
    x = collapsedStartX - collapsedPadding;
    width = collapsedEndX - collapsedStartX + collapsedPadding * 2;
    numberArea = {
      x: x + arrowWidth * 0.25,
      y,
      width: Math.max(0, width - arrowWidth * 0.5),
      height: timeHeight,
    };
  }
  const timelineBottom = y + timeHeight + (isExpanded ? playerCount * actionHeight : 0);

  return {
    isExpanded,
    x,
    y,
    width,
    timeHeight,
    actionHeight,
    leftArrow,
    rightArrow,
    leftJumpArrow,
    rightJumpArrow,
    numberArea,
    arrowWidth,
    innerPadding,
    portraitOverlap,
    portraitSize: actionHeight,
    portraitBorderWidth,
    playButton,
    toggleButton,
    timelineBottom,
    speedControlGap,
  };
};

const getRowLayout = (layout, rowIndex) => {
  const rowHeight = rowIndex === 0 ? layout.timeHeight : layout.actionHeight;
  const y = rowIndex === 0 ? layout.y : layout.y + layout.timeHeight + (rowIndex - 1) * layout.actionHeight;
  const defaultNumberArea = {
    x: layout.x + layout.arrowWidth * 0.7,
    y,
    width: layout.width - layout.arrowWidth * 1.4,
    height: rowHeight,
  };
  const defaultLeftArrow = { x: layout.x, y, width: layout.arrowWidth, height: rowHeight };
  const defaultRightArrow = {
    x: layout.x + layout.width - layout.arrowWidth,
    y,
    width: layout.arrowWidth,
    height: rowHeight,
  };
  const numberArea = rowIndex === 0 && layout.numberArea ? { ...layout.numberArea } : defaultNumberArea;
  const leftArrow = rowIndex === 0 && layout.leftArrow ? { ...layout.leftArrow } : defaultLeftArrow;
  const rightArrow = rowIndex === 0 && layout.rightArrow ? { ...layout.rightArrow } : defaultRightArrow;
  const leftJumpArrow = rowIndex === 0 ? layout.leftJumpArrow ?? null : null;
  const rightJumpArrow = rowIndex === 0 ? layout.rightJumpArrow ?? null : null;

  return { y, rowHeight, numberArea, leftArrow, rightArrow, leftJumpArrow, rightJumpArrow };
};

export const getTimeIndicatorHit = (layout, x, y) => {
  if (!layout) return null;
  if (layout.toggleButton && isPointInCircle(x, y, layout.toggleButton)) return 'timeline-toggle';
  if (layout.playButton && isPointInCircle(x, y, layout.playButton)) return 'play';
  if (layout.leftJumpArrow && isPointInRect(x, y, layout.leftJumpArrow)) return 'jump-left';
  if (layout.rightJumpArrow && isPointInRect(x, y, layout.rightJumpArrow)) return 'jump-right';
  if (isPointInRect(x, y, layout.leftArrow)) return 'left';
  if (isPointInRect(x, y, layout.rightArrow)) return 'right';
  return null;
};

export const getTimeIndicatorActionTarget = (layout, viewModel, gameState, x, y, options = {}) => {
  if (!layout) return null;
  const viewport = {
    width: Number.isFinite(options?.viewport?.width)
      ? Math.max(0, options.viewport.width)
      : Math.max(0, layout.x * 2 + layout.width),
    height: Number.isFinite(options?.viewport?.height) ? Math.max(0, options.viewport.height) : 0,
  };
  const publicState = gameState?.state?.public ?? null;
  const characters = gameState?.state?.public?.characters ?? [];
  setTimeIndicatorPlayerCount(characters.length || 2);
  const beats = gameState?.state?.public?.beats ?? [];
  const interactions = gameState?.state?.public?.customInteractions ?? [];
  const matchOutcome = gameState?.state?.public?.matchOutcome ?? null;
  const canvasRect = options?.canvasRect ?? null;
  if (!characters.length || !beats.length) return null;
  const highlightIndex = getTimelineStopIndex(beats, characters, interactions);
  const beatLookup = buildBeatLookup(beats);
  const actionPhaseUserIds = getActionPhaseUserIds(publicState);
  const value = viewModel?.value ?? 0;
  const localCharacter =
    characters.find(
      (character) => character?.userId === timeIndicatorLocalUserId || character?.username === timeIndicatorLocalUserId,
    ) ?? null;
  const localLookupKey = localCharacter ? localCharacter.username ?? localCharacter.userId : '';
  const localPlayedPair = localLookupKey ? resolvePlayModalStateForBeat(beatLookup, localLookupKey, value) : null;
  const includeLocalInCornerHud = timeIndicatorCornerLayoutMode === CORNER_PLAY_LAYOUT_REPLAY_CORNERS;
  const hidePlayedCardsWhileSelecting = !includeLocalInCornerHud;
  const opponentItems = buildOpponentPlayHudItems({
    viewport,
    characters,
    localUserId: timeIndicatorLocalUserId,
    value,
    beatLookup,
    actionSelectionUserIds: actionPhaseUserIds,
    selectionBeatIndex: highlightIndex,
    includeLocalPlayer: includeLocalInCornerHud,
    cornerLayoutMode: timeIndicatorCornerLayoutMode,
    hidePlayedCardsWhileSelecting,
  });
  for (let i = 0; i < opponentItems.length; i += 1) {
    const item = opponentItems[i];
    if (!item.playedPair || !item.lookupKey) continue;
    const reveal = getCornerPlayRevealState(`corner:${item.lookupKey}`, item.playedPair.pairKey, performance.now());
    if (reveal?.phase !== 'front') continue;
    const slot = getOpponentPlayHoverSlot(item, { x, y });
    if (!slot) continue;
    const bounds = slot === 'active' ? item.activeBounds : item.passiveBounds;
    return {
      kind: 'played-card',
      beatIndex: value,
      character: item.character,
      cardRole: slot,
      cardId: slot === 'active' ? item.playedPair.activeCardId : item.playedPair.passiveCardId,
      activeCardId: item.playedPair.activeCardId,
      passiveCardId: item.playedPair.passiveCardId,
      center: {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      },
      size: Math.max(bounds.width, bounds.height),
    };
  }
  const localPlayedHoverTarget = getLocalPlayedPreviewHoverTarget({
    x,
    y,
    beatIndex: value,
    canvasRect,
    character: localCharacter,
    playedPair: localPlayedPair,
  });
  if (localPlayedHoverTarget) {
    return localPlayedHoverTarget;
  }
  if (layout.isExpanded === false) return null;
  const offsets = TIMELINE_OFFSETS;
  const topRow = getRowLayout(layout, 0);
  const spacingTarget = Math.max(26, layout.actionHeight * 0.72);
  const spacing = Math.min(spacingTarget, topRow.numberArea.width / (offsets.length - 1));
  const handTriggerLookup = SHOW_TIMELINE_MINI_CARDS ? buildHandTriggerLookup(interactions, characters) : new Map();
  const movementPickupLookup = SHOW_TIMELINE_MINI_CARDS
    ? buildMovementPickupLookup(interactions, characters)
    : new Map();
  const rewindReturnLookup = SHOW_TIMELINE_MINI_CARDS ? buildRewindReturnLookup(interactions, characters) : new Map();

  for (let rowIndex = 0; rowIndex < characters.length; rowIndex += 1) {
    const character = characters[rowIndex];
    const row = getRowLayout(layout, rowIndex + 1);
    const rowCenterX = row.numberArea.x + row.numberArea.width / 2;
    const rowCenterY = row.numberArea.y + row.numberArea.height / 2;
    const iconSize = Math.min(row.numberArea.height * 0.82, spacing * 0.8);
    const lookupKey = character.username ?? character.userId;
    const portraitRadius = layout.portraitSize / 2;
    const portraitX = layout.x - portraitRadius + layout.portraitOverlap;
    const playedPair = resolvePlayedCardPairForBeat(beatLookup, lookupKey, value);
    const playedPairLayout =
      playedPair && lookupKey
        ? buildPlayedCardPairLayout({
            rowCenterY,
            rowHeight: row.numberArea.height,
            portraitX,
            portraitRadius,
          })
        : null;
    const playedSlot =
      playedPairLayout && playedPair ? getPlayedCardHoverSlot(playedPairLayout, { x, y }) : null;
    if (playedPair && playedPairLayout && playedSlot) {
      const bounds = playedSlot === 'passive' ? playedPairLayout.passiveBounds : playedPairLayout.activeBounds;
      return {
        kind: 'played-card',
        beatIndex: value,
        character,
        cardRole: playedSlot,
        cardId: playedSlot === 'passive' ? playedPair.passiveCardId : playedPair.activeCardId,
        activeCardId: playedPair.activeCardId,
        passiveCardId: playedPair.passiveCardId,
        center: {
          x: bounds.x + bounds.width / 2,
          y: bounds.y + bounds.height / 2,
        },
        size: Math.max(bounds.width, bounds.height),
      };
    }
    for (let offsetIndex = 0; offsetIndex < offsets.length; offsetIndex += 1) {
      const offset = offsets[offsetIndex];
      const beatIndex = value + offset;
      if (beatIndex < 0) continue;
      const baseEntry = beatLookup[beatIndex]?.get(lookupKey);
      const baseAction = `${baseEntry?.action ?? ''}`.trim();
      const outcomeAction = getOutcomeMarkerAction(matchOutcome, character, beatIndex);
      const implicitOpenBeat = !baseEntry && beatIndex === highlightIndex;
      const action =
        outcomeAction && (!baseEntry || baseAction === DEFAULT_ACTION)
          ? outcomeAction
          : baseEntry?.action ?? (implicitOpenBeat ? DEFAULT_ACTION : ACTION_ICON_FALLBACK);
      const entry = baseEntry
        ? { ...baseEntry, action }
        : action && action !== ACTION_ICON_FALLBACK
          ? { action }
          : null;
      const xPos = rowCenterX + offset * spacing;
      if (SHOW_TIMELINE_MINI_CARDS) {
        const movementPickupKey = `${lookupKey}:${beatIndex}`;
        const movementPickup = movementPickupLookup.get(movementPickupKey) ?? null;
        const movementPickupIds = Array.isArray(movementPickup?.movementCardIds)
          ? movementPickup.movementCardIds
          : [];
        const movementPickupLayout = buildMiniCardStackLayout({
          row,
          xPos,
          rowSpacing: spacing,
          iconSize,
          count: movementPickupIds.length,
          heightFactor: MOVEMENT_PICKUP_CARD_HEIGHT,
          aspect: MOVEMENT_PICKUP_CARD_ASPECT,
          stackOffsetFactor: MOVEMENT_PICKUP_STACK_OFFSET,
          side: 'left',
          slotIndex: 0,
        });
        if (movementPickupLayout) {
          for (let i = 0; i < movementPickupLayout.count; i += 1) {
            const geometry = getMiniCardStackItemGeometry(movementPickupLayout, rowCenterY, i);
            if (!geometry || !isPointInRect(x, y, geometry.bounds)) continue;
            return {
              kind: 'movement-pickup',
              beatIndex,
              character,
              interactions: movementPickup.interactions,
              movementCardIds: [...movementPickupIds],
              center: { x: movementPickupLayout.centerX, y: geometry.centerY },
              size: Math.max(movementPickupLayout.cardWidth, movementPickupLayout.cardHeight),
            };
          }
        }
        const rewindReturnKey = `${lookupKey}:${beatIndex}`;
        const rewindReturns = rewindReturnLookup.get(rewindReturnKey) ?? [];
        const rewindSlotIndex = movementPickupIds.length ? 1 : 0;
        const rewindReturnLayout = buildMiniCardStackLayout({
          row,
          xPos,
          rowSpacing: spacing,
          iconSize,
          count: rewindReturns.length,
          heightFactor: REWIND_RETURN_CARD_HEIGHT,
          aspect: REWIND_RETURN_CARD_ASPECT,
          stackOffsetFactor: REWIND_RETURN_STACK_OFFSET,
          side: 'left',
          slotIndex: rewindSlotIndex,
        });
        if (rewindReturnLayout) {
          for (let i = 0; i < rewindReturnLayout.count; i += 1) {
            const geometry = getMiniCardStackItemGeometry(rewindReturnLayout, rowCenterY, i);
            if (!geometry || !isPointInRect(x, y, geometry.bounds)) continue;
            const interaction = rewindReturns[i];
            const cardId =
              interaction?.cardId ?? interaction?.abilityCardId ?? interaction?.movementCardId ?? 'rewind';
            return {
              kind: 'rewind-return',
              beatIndex,
              character,
              interaction,
              cardId,
              cardType: interaction?.cardType ?? null,
              center: { x: rewindReturnLayout.centerX, y: geometry.centerY },
              size: Math.max(rewindReturnLayout.cardWidth, rewindReturnLayout.cardHeight),
            };
          }
        }
        const handTriggerKey = `${lookupKey}:${beatIndex}`;
        const handTriggers = handTriggerLookup.get(handTriggerKey) ?? [];
        const handTriggerLayout = buildMiniCardStackLayout({
          row,
          xPos,
          rowSpacing: spacing,
          iconSize,
          count: handTriggers.length,
          heightFactor: HAND_TRIGGER_CARD_HEIGHT,
          aspect: HAND_TRIGGER_CARD_ASPECT,
          stackOffsetFactor: HAND_TRIGGER_STACK_OFFSET,
          side: 'right',
        });
        if (handTriggerLayout) {
          for (let i = 0; i < handTriggerLayout.count; i += 1) {
            const geometry = getMiniCardStackItemGeometry(handTriggerLayout, rowCenterY, i);
            if (!geometry || !isPointInRect(x, y, geometry.bounds)) continue;
            const interaction = handTriggers[i];
            const cardId =
              interaction?.cardId ?? interaction?.abilityCardId ?? interaction?.movementCardId ?? '';
            return {
              kind: 'hand-trigger',
              beatIndex,
              character,
              interaction,
              cardId,
              cardType: interaction?.cardType ?? null,
              center: { x: handTriggerLayout.centerX, y: geometry.centerY },
              size: Math.max(handTriggerLayout.cardWidth, handTriggerLayout.cardHeight),
            };
          }
        }
      }
      if (!entry) continue;
      const token = parseActionToken(action);
      const symbol = token.emphasized ? EMPHASIS_ICON_KEY : token.label;
      if (token.label === ACTION_ICON_FALLBACK) continue;
      const bounds = {
        x: xPos - iconSize / 2,
        y: rowCenterY - iconSize / 2,
        width: iconSize,
        height: iconSize,
      };
      if (!isPointInRect(x, y, bounds)) continue;
      return {
        kind: 'action',
        beatIndex,
        character,
        entry,
        symbol,
        center: { x: xPos, y: rowCenterY },
        size: iconSize,
      };
    }
  }

  return null;
};

export const drawTimeIndicator = (
  ctx,
  viewport,
  theme,
  viewModel,
  gameState,
  localUserId,
  pendingPreview,
  cardLookup = null,
  timelinePointer = null,
  options = {},
) => {
  const replayMode = Boolean(options?.replayMode);
  const includeLocalInCornerHud = replayMode;
  const hidePlayedCardsWhileSelecting = !replayMode;
  timeIndicatorCornerLayoutMode = replayMode ? CORNER_PLAY_LAYOUT_REPLAY_CORNERS : CORNER_PLAY_LAYOUT_DEFAULT;
  timeIndicatorLocalUserId = `${localUserId ?? ''}`.trim() || null;
  const publicState = gameState?.state?.public ?? null;
  const characters = gameState?.state?.public?.characters ?? [];
  setTimeIndicatorPlayerCount(characters.length || 2);
  const layout = getTimeIndicatorLayout(viewport, {
    isExpanded: viewModel?.isTimelineExpanded !== false,
    playerCount: characters.length || 2,
  });
  if (!layout) {
    clearCornerPlayHudDom();
    return;
  }
  const isExpanded = layout.isExpanded !== false;

  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);

  const value = viewModel?.value ?? 0;
  const renderNow = performance.now();
  const isPlaying = Boolean(viewModel?.isPlaying);
  const leftDisabled = viewModel?.canStep ? !viewModel.canStep(-1) : value === 0;
  const rightDisabled = viewModel?.canStep ? !viewModel.canStep(1) : false;
  const offsets = TIMELINE_OFFSETS;

  const beats = publicState?.beats ?? [];
  const interactions = publicState?.customInteractions ?? [];
  const matchOutcome = publicState?.matchOutcome ?? null;
  const ffaEnabled = isFfaEnabled(publicState);
  const ffaScoreByUserId = ffaEnabled ? getFfaScoreMapAtBeat(publicState, beats, characters, value) : null;
  const highlightIndex = getTimelineStopIndex(beats, characters, interactions);
  const handTriggerLookup = SHOW_TIMELINE_MINI_CARDS ? buildHandTriggerLookup(interactions, characters) : new Map();
  const movementPickupLookup = SHOW_TIMELINE_MINI_CARDS
    ? buildMovementPickupLookup(interactions, characters)
    : new Map();
  const rewindReturnLookup = SHOW_TIMELINE_MINI_CARDS ? buildRewindReturnLookup(interactions, characters) : new Map();
  const discardLookup = buildDiscardLookup(interactions, characters);
  const drawLookup = buildDrawLookup(interactions, characters);
  const interactionStopIndex = getEarliestPendingInteractionIndex(interactions);
  const fadeAfterIndex =
    interactionStopIndex !== null && interactionStopIndex <= highlightIndex ? interactionStopIndex : null;
  const waitingUserIds = getWaitingForInputUserIds(publicState);
  const actionPhaseUserIds = getActionPhaseUserIds(publicState);
  const waitingPulse = getWaitingPulse(renderNow);
  const waitingRingAlpha = 0.62 + waitingPulse * 0.38;
  const previewPhase = (performance.now() % PREVIEW_PULSE_MS) / PREVIEW_PULSE_MS;
  const previewScale = 1 + PREVIEW_SCALE_AMPLITUDE * Math.sin(previewPhase * Math.PI * 2);
  const beatLookup = buildBeatLookup(beats);
  const topRow = getRowLayout(layout, 0);
  if (isExpanded) {
    drawNumberWell(ctx, topRow.numberArea, theme.queueLavender || theme.panel);
  }

  const fontSize = Math.max(12, topRow.numberArea.height * 0.47);
  ctx.font = `${fontSize}px ${theme.fontBody}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const centerX = topRow.numberArea.x + topRow.numberArea.width / 2;
  const centerY = topRow.numberArea.y + topRow.numberArea.height / 2;
  const spacingTarget = Math.max(26, layout.actionHeight * 0.72);
  const spacing = Math.min(spacingTarget, topRow.numberArea.width / (offsets.length - 1));
  if (isExpanded) {
    offsets.forEach((offset) => {
      const target = value + offset;
      if (target < 0) return;
      const xPos = centerX + offset * spacing;
      if (offset === 0) {
        drawPlayButton(ctx, layout.playButton, theme, isPlaying);
        return;
      }
      ctx.fillStyle = target === highlightIndex ? theme.accentStrong : theme.text;
      ctx.fillText(`${target}`.padStart(2, '0'), xPos, centerY);
    });
  } else {
    drawPlayButton(ctx, layout.playButton, theme, isPlaying);
  }
  ctx.fillStyle = value === highlightIndex ? theme.accentStrong : theme.text;
  ctx.font = `${Math.max(10, topRow.numberArea.height * (isExpanded ? 0.27 : 0.32))}px ${theme.fontBody}`;
  ctx.fillText(`${value}`.padStart(2, '0'), centerX, topRow.numberArea.y + topRow.numberArea.height * 0.84);

  ctx.globalAlpha = 1;
  if (leftDisabled && isExpanded) {
    ctx.strokeStyle = theme.subtle;
    ctx.lineWidth = Math.max(1, topRow.numberArea.height * 0.04);
    ctx.beginPath();
    ctx.moveTo(topRow.numberArea.x + 2, topRow.numberArea.y + topRow.numberArea.height * 0.2);
    ctx.lineTo(topRow.numberArea.x + 2, topRow.numberArea.y + topRow.numberArea.height * 0.8);
    ctx.stroke();
  }

  const arrowColor = theme.accentStrong || '#d5a34a';
  if (topRow.leftJumpArrow) {
    drawDoubleArrow(ctx, topRow.leftJumpArrow, 'left', arrowColor, leftDisabled ? 0.35 : 0.95);
  }
  drawArrow(ctx, topRow.leftArrow, 'left', arrowColor, leftDisabled ? 0.35 : 0.95);
  drawArrow(ctx, topRow.rightArrow, 'right', arrowColor, rightDisabled ? 0.35 : 0.95);
  if (topRow.rightJumpArrow) {
    drawDoubleArrow(ctx, topRow.rightJumpArrow, 'right', arrowColor, rightDisabled ? 0.35 : 0.95);
  }
  drawTimelineToggleButton(ctx, layout.toggleButton, theme, isExpanded);

  if (!isExpanded) {
    playedCardRevealByActor.clear();
    drawOpponentPlayHud({
      ctx,
      viewport,
      theme,
      characters,
      localUserId,
      value,
      beatLookup,
      waitingUserIds,
      actionSelectionUserIds: actionPhaseUserIds,
      selectionBeatIndex: highlightIndex,
      timelinePointer,
      cardLookup,
      now: renderNow,
      waitingRingAlpha,
      includeLocalPlayer: includeLocalInCornerHud,
      cornerLayoutMode: timeIndicatorCornerLayoutMode,
      hidePlayedCardsWhileSelecting,
    });
    return;
  }

  if (!characters.length) {
    playedCardRevealByActor.clear();
    pruneCornerPlayRevealState(new Set());
    clearCornerPlayHudDom();
    return;
  }
  prunePlayedCardRevealState(
    new Set(
      characters
        .map((character) => character?.username ?? character?.userId)
        .filter((key) => typeof key === 'string' && key.trim()),
    ),
  );

  let previousSeparator = { numberArea: topRow.numberArea, y: topRow.y + topRow.rowHeight };

  characters.forEach((character, index) => {
    const row = getRowLayout(layout, index + 1);
    if (previousSeparator) {
      drawRowSeparator(ctx, layout, previousSeparator.numberArea, previousSeparator.y, theme.accentStrong);
    }
    drawNumberWell(ctx, row.numberArea, theme.queueLavender || theme.panel);

    const rowCenterX = row.numberArea.x + row.numberArea.width / 2;
    const rowCenterY = row.numberArea.y + row.numberArea.height / 2;
    const rowSpacing = spacing;
    const iconSize = Math.min(row.numberArea.height * 0.82, rowSpacing * 0.8);
    const lookupKey = character.username ?? character.userId;
    const portraitRadius = layout.portraitSize / 2;
    const portraitX = layout.x - portraitRadius + layout.portraitOverlap;
    const portraitY = row.y + layout.actionHeight / 2;
    const playedPair = resolvePlayedCardPairForBeat(beatLookup, lookupKey, value);
    const playedPairLayout =
      playedPair && lookupKey
        ? buildPlayedCardPairLayout({
            rowCenterY,
            rowHeight: row.numberArea.height,
            portraitX,
            portraitRadius,
          })
        : null;
    const hoveredPlayedSlot =
      playedPairLayout && timelinePointer ? getPlayedCardHoverSlot(playedPairLayout, timelinePointer) : null;

    offsets.forEach((offset) => {
      const beatIndex = value + offset;
      if (beatIndex < 0) return;
      const baseEntry = beatLookup[beatIndex]?.get(lookupKey);
      const baseAction = baseEntry?.action ?? ACTION_ICON_FALLBACK;
      const previewEntry = getPendingPreviewEntry(pendingPreview, character, beatIndex);
      const outcomeMarkerAction = getOutcomeMarkerAction(matchOutcome, character, beatIndex);
      const usePreview =
        !outcomeMarkerAction && previewEntry && (!baseEntry || baseAction === DEFAULT_ACTION);
      const entry = usePreview ? previewEntry : baseEntry;
      const implicitOpenBeat = !entry && beatIndex === highlightIndex;
      const action =
        outcomeMarkerAction && (!baseEntry || baseAction === DEFAULT_ACTION)
          ? outcomeMarkerAction
          : entry?.action ?? (implicitOpenBeat ? DEFAULT_ACTION : ACTION_ICON_FALLBACK);
      const xPos = rowCenterX + offset * rowSpacing;
      const shouldFade = fadeAfterIndex !== null && beatIndex > fadeAfterIndex;
      const movementPickupKey = `${lookupKey}:${beatIndex}`;
      const movementPickup = movementPickupLookup.get(movementPickupKey) ?? null;
      const movementPickupIds =
        SHOW_TIMELINE_MINI_CARDS && Array.isArray(movementPickup?.movementCardIds) ? movementPickup.movementCardIds : [];
      if (SHOW_TIMELINE_MINI_CARDS && movementPickupIds.length) {
        const cardAlpha = shouldFade ? 0.28 : 1;
        drawMovementPickupCards(ctx, row, xPos, rowCenterY, rowSpacing, iconSize, movementPickupIds, theme, cardAlpha);
      }
      const handTriggerKey = `${lookupKey}:${beatIndex}`;
      const handTriggers = handTriggerLookup.get(handTriggerKey) ?? [];
      if (SHOW_TIMELINE_MINI_CARDS && handTriggers.length) {
        const cardAlpha = shouldFade ? 0.28 : 1;
        drawHandTriggerCards(ctx, row, xPos, rowCenterY, rowSpacing, iconSize, handTriggers, theme, cardAlpha);
      }
      const rewindReturnKey = `${lookupKey}:${beatIndex}`;
      const rewindReturns = rewindReturnLookup.get(rewindReturnKey) ?? [];
      if (SHOW_TIMELINE_MINI_CARDS && rewindReturns.length) {
        const cardAlpha = shouldFade ? 0.28 : 1;
        const rewindSlotIndex = movementPickupIds.length ? 1 : 0;
        drawRewindReturnCards(
          ctx,
          row,
          xPos,
          rowCenterY,
          rowSpacing,
          iconSize,
          rewindReturns,
          theme,
          cardAlpha,
          rewindSlotIndex,
        );
      }
      const discardKey = `${lookupKey}:${beatIndex}`;
      const discardCount = discardLookup.get(discardKey) ?? 0;
      const drawCount = drawLookup.get(discardKey) ?? 0;
      const token = parseActionToken(action);
      const image = getActionArt(token.label);
      if (!image || !image.complete || image.naturalWidth === 0) return;
      const comboSkipped = entry?.comboSkipped && token.label === COMBO_ICON_KEY;
      const stunOnlyHit = Boolean(entry?.stunOnly) && token.label === 'DamageIcon';
      const drawScale = usePreview ? previewScale : 1;
      const drawSize = iconSize * drawScale;
      const imageX = xPos - drawSize / 2;
      const imageY = rowCenterY - drawSize / 2;
      const alpha =
        (shouldFade ? 0.28 : 1) *
        (usePreview ? PREVIEW_ALPHA : 1) *
        (comboSkipped ? COMBO_SKIPPED_ALPHA : 1);
      const restoreAfter = alpha !== 1 || comboSkipped || stunOnlyHit;
      if (restoreAfter) {
        ctx.save();
        ctx.globalAlpha = alpha;
      }
      if (comboSkipped || stunOnlyHit) {
        ctx.filter = 'grayscale(1)';
      }
      if (token.label === 'Death') {
        drawDeathBackdrop(ctx, xPos, rowCenterY, drawSize);
      }
      const emphasisImage = token.emphasized ? getActionArt(EMPHASIS_ICON_KEY) : null;
      if (token.emphasized && emphasisImage && emphasisImage.complete && emphasisImage.naturalWidth > 0) {
        ctx.drawImage(emphasisImage, imageX, imageY, drawSize, drawSize);
        const overlaySize = drawSize * 0.8;
        ctx.drawImage(
          image,
          xPos - overlaySize / 2,
          rowCenterY - overlaySize / 2,
          overlaySize,
          overlaySize,
        );
      } else {
        ctx.drawImage(image, imageX, imageY, drawSize, drawSize);
      }
      if (entry?.focusCardId) {
        drawFocusBadge(ctx, imageX, imageY, drawSize);
      }
      if (entry?.comboStarter) {
        const comboBadge = getActionArt(COMBO_ICON_KEY);
        if (comboBadge && comboBadge.complete && comboBadge.naturalWidth > 0) {
          const comboSize = drawSize * 0.36;
          const comboPadding = drawSize * 0.04;
          const comboX = imageX + comboPadding;
          const comboY = imageY + drawSize - comboSize - comboPadding;
          ctx.drawImage(comboBadge, comboX, comboY, comboSize, comboSize);
        }
      }
      if (isFfaPlayerInvulnerableAtBeat(publicState, character.userId, beatIndex)) {
        drawShieldBadge(ctx, imageX, imageY, drawSize);
      }
      const hitSummary = getHitSummary(entry);
      if (hitSummary) {
        drawKnockbackBadge(ctx, imageX, imageY, drawSize, hitSummary.knockbackDistance, theme);
        drawDamageDeltaBadge(ctx, imageX, imageY, drawSize, hitSummary.damageDelta, theme);
      }
      if (discardCount > 0) {
        drawDiscardBadge(ctx, imageX, imageY, drawSize, discardCount, theme);
      }
      if (drawCount > 0) {
        drawDrawBadge(ctx, imageX, imageY, drawSize, drawCount, theme, discardCount > 0 ? 1 : 0);
      }
      const actionLabel = token.label;
      if (
        actionLabel &&
        actionLabel !== 'E' &&
        !END_MARKER_ACTIONS.has(actionLabel) &&
        actionLabel !== ACTION_ICON_FALLBACK &&
        actionLabel !== 'DamageIcon'
      ) {
        drawTimingBadges(ctx, imageX, imageY, drawSize, entry);
      }
      const rotation = entry?.rotation;
      if (rotation !== undefined && rotation !== null && rotation !== '') {
        drawRotationBadge(ctx, imageX, imageY, drawSize, `${rotation}`, theme);
      }
      if (restoreAfter) {
        ctx.restore();
      }
    });

    if (playedPair && playedPairLayout && lookupKey) {
      drawPlayedCardPair(
        ctx,
        playedPairLayout,
        playedPair,
        lookupKey,
        cardLookup,
        theme,
        renderNow,
        hoveredPlayedSlot,
      );
    } else {
      clearPlayedCardRevealState(lookupKey);
    }

    const portraitImage = getCharacterArt(character.characterId);
    const isLocalPlayer = localUserId && character.userId === localUserId;
    const isWaiting = isCharacterInUserSet(waitingUserIds, character);
    const ringColor = isLocalPlayer ? theme.playerAccent || '#7dcfff' : theme.accentStrong;
    drawCharacterPortrait(ctx, portraitImage, portraitX, portraitY, portraitRadius, theme.panelStrong);
    drawCharacterRing(
      ctx,
      portraitX,
      portraitY,
      portraitRadius,
      layout.portraitBorderWidth,
      ringColor,
      isWaiting ? waitingRingAlpha : 1,
    );
    drawNameCapsule(ctx, portraitX, portraitY, portraitRadius, character.username || character.userId, theme);
    if (ffaEnabled) {
      drawFfaScoreBadges(ctx, portraitX, portraitY, portraitRadius, ffaScoreByUserId?.get(character.userId) ?? 0);
    }

    if (index === characters.length - 1) return;
    previousSeparator = { numberArea: row.numberArea, y: row.y + row.rowHeight };
  });

  const lastRow = getRowLayout(layout, characters.length);
  const nowLeft = centerX - spacing / 2;
  const nowRight = centerX + spacing / 2;
  ctx.strokeStyle = theme.accentStrong;
  ctx.lineWidth = layout.portraitBorderWidth;
  ctx.beginPath();
  ctx.moveTo(nowLeft, topRow.numberArea.y);
  ctx.lineTo(nowLeft, lastRow.numberArea.y + lastRow.rowHeight);
  ctx.moveTo(nowRight, topRow.numberArea.y);
  ctx.lineTo(nowRight, lastRow.numberArea.y + lastRow.rowHeight);
  ctx.stroke();
  drawOpponentPlayHud({
    ctx,
    viewport,
    theme,
    characters,
    localUserId,
    value,
    beatLookup,
    waitingUserIds,
    actionSelectionUserIds: actionPhaseUserIds,
    selectionBeatIndex: highlightIndex,
    timelinePointer,
    cardLookup,
    now: renderNow,
    waitingRingAlpha,
    includeLocalPlayer: includeLocalInCornerHud,
    cornerLayoutMode: timeIndicatorCornerLayoutMode,
    hidePlayedCardsWhileSelecting,
  });
};

const drawCharacterPortrait = (ctx, image, x, y, radius, fillColor) => {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.clip();

  if (image && image.complete && image.naturalWidth > 0) {
    const minSide = Math.min(image.naturalWidth, image.naturalHeight);
    const scale = (radius * 2) / minSide;
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    ctx.drawImage(image, x - drawWidth / 2, y - drawHeight / 2, drawWidth, drawHeight);
  }

  ctx.restore();
};

const drawCharacterRing = (ctx, x, y, radius, borderWidth, color, alpha = 1) => {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.strokeStyle = color;
  ctx.lineWidth = borderWidth;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
};

const drawNumberWell = (ctx, numberArea, fillColor) => {
  ctx.fillStyle = fillColor || '#000000';
  drawRoundedRect(
    ctx,
    numberArea.x,
    numberArea.y,
    numberArea.width,
    numberArea.height,
    Math.min(12, numberArea.height * 0.4),
  );
  ctx.fill();
};

const drawRowSeparator = (ctx, layout, numberArea, y, color) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = layout.portraitBorderWidth;
  ctx.beginPath();
  ctx.moveTo(numberArea.x, y);
  ctx.lineTo(numberArea.x + numberArea.width, y);
  ctx.stroke();
};


const getHandTriggerFill = (interaction, theme) => {
  const cardType = `${interaction?.cardType ?? ''}`.toLowerCase();
  if (cardType === 'movement') {
    return theme.cardMovement || theme.actionMove || theme.accent;
  }
  return theme.cardAbility || theme.actionAttack || theme.accentStrong;
};

const getMovementPickupFill = (theme) => theme.cardMovement || theme.actionMove || '#33d06b';

const getRewindReturnFill = (interaction, theme) => {
  if (interaction?.resolution?.returnToAnchor) {
    return theme.cardMovement || theme.actionMove || theme.accent;
  }
  return theme.cardAbility || theme.actionAttack || theme.accentStrong;
};

const drawMovementPickupCard = (ctx, centerX, centerY, width, height, theme, alpha = 1) => {
  const x = centerX - width / 2;
  const y = centerY - height / 2;
  const radius = Math.max(2, height * 0.18);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.fillStyle = getMovementPickupFill(theme);
  drawRoundedRect(ctx, x, y, width, height, radius);
  ctx.fill();
  ctx.strokeStyle = theme.panelStrong || theme.textDark || '#000000';
  ctx.lineWidth = Math.max(1, height * 0.08);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  drawRoundedRect(ctx, x + width * 0.08, y + height * 0.1, width * 0.84, height * 0.26, radius * 0.8);
  ctx.fill();
  ctx.fillStyle = theme.panelStrong || theme.textDark || '#000000';
  ctx.font = `700 ${Math.max(8, height * 0.45)}px ${theme.fontBody}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('+', x + width * 0.5, y + height * 0.56);
  ctx.restore();
};

const drawHandTriggerCard = (ctx, centerX, centerY, width, height, interaction, theme, alpha = 1) => {
  const x = centerX - width / 2;
  const y = centerY - height / 2;
  const radius = Math.max(2, height * 0.18);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.fillStyle = getHandTriggerFill(interaction, theme);
  drawRoundedRect(ctx, x, y, width, height, radius);
  ctx.fill();
  ctx.strokeStyle = theme.panelStrong || theme.textDark || '#000000';
  ctx.lineWidth = Math.max(1, height * 0.08);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  drawRoundedRect(ctx, x + width * 0.08, y + height * 0.1, width * 0.84, height * 0.26, radius * 0.8);
  ctx.fill();
  ctx.restore();
};

const drawRewindReturnCard = (ctx, centerX, centerY, width, height, interaction, theme, alpha = 1) => {
  const x = centerX - width / 2;
  const y = centerY - height / 2;
  const radius = Math.max(2, height * 0.18);
  const returnToAnchor = Boolean(interaction?.resolution?.returnToAnchor);
  const focusIcon = getActionArt(FOCUS_ICON_KEY);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.fillStyle = getRewindReturnFill(interaction, theme);
  drawRoundedRect(ctx, x, y, width, height, radius);
  ctx.fill();
  ctx.strokeStyle = theme.panelStrong || theme.textDark || '#000000';
  ctx.lineWidth = Math.max(1, height * 0.08);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  drawRoundedRect(ctx, x + width * 0.08, y + height * 0.1, width * 0.84, height * 0.26, radius * 0.8);
  ctx.fill();
  if (focusIcon && focusIcon.complete && focusIcon.naturalWidth > 0) {
    const iconSize = height * 0.46;
    const iconX = x + width * 0.14;
    const iconY = y + (height - iconSize) / 2;
    ctx.drawImage(focusIcon, iconX, iconY, iconSize, iconSize);
  }
  ctx.fillStyle = theme.panelStrong || theme.textDark || '#000000';
  ctx.font = `700 ${Math.max(8, height * 0.4)}px ${theme.fontBody}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(returnToAnchor ? 'Y' : 'N', x + width * 0.74, y + height * 0.54);
  ctx.restore();
};

const drawMiniCardStack = (layout, rowCenterY, drawItem) => {
  if (!layout || !Number.isFinite(rowCenterY) || typeof drawItem !== 'function') return;
  for (let index = 0; index < layout.count; index += 1) {
    const geometry = getMiniCardStackItemGeometry(layout, rowCenterY, index);
    if (!geometry) continue;
    drawItem(geometry, index);
  }
};

const drawHandTriggerCards = (
  ctx,
  row,
  xPos,
  rowCenterY,
  rowSpacing,
  iconSize,
  handTriggers,
  theme,
  alpha = 1,
) => {
  if (!handTriggers.length) return;
  const layout = buildMiniCardStackLayout({
    row,
    xPos,
    rowSpacing,
    iconSize,
    count: handTriggers.length,
    heightFactor: HAND_TRIGGER_CARD_HEIGHT,
    aspect: HAND_TRIGGER_CARD_ASPECT,
    stackOffsetFactor: HAND_TRIGGER_STACK_OFFSET,
    side: 'right',
  });
  drawMiniCardStack(layout, rowCenterY, ({ centerY }, index) => {
    drawHandTriggerCard(
      ctx,
      layout.centerX,
      centerY,
      layout.cardWidth,
      layout.cardHeight,
      handTriggers[index],
      theme,
      alpha,
    );
  });
};

const drawRewindReturnCards = (
  ctx,
  row,
  xPos,
  rowCenterY,
  rowSpacing,
  iconSize,
  rewindReturns,
  theme,
  alpha = 1,
  slotIndex = 0,
) => {
  if (!rewindReturns.length) return;
  const layout = buildMiniCardStackLayout({
    row,
    xPos,
    rowSpacing,
    iconSize,
    count: rewindReturns.length,
    heightFactor: REWIND_RETURN_CARD_HEIGHT,
    aspect: REWIND_RETURN_CARD_ASPECT,
    stackOffsetFactor: REWIND_RETURN_STACK_OFFSET,
    side: 'left',
    slotIndex,
  });
  drawMiniCardStack(layout, rowCenterY, ({ centerY }, index) => {
    drawRewindReturnCard(
      ctx,
      layout.centerX,
      centerY,
      layout.cardWidth,
      layout.cardHeight,
      rewindReturns[index],
      theme,
      alpha,
    );
  });
};

const drawMovementPickupCards = (
  ctx,
  row,
  xPos,
  rowCenterY,
  rowSpacing,
  iconSize,
  movementCardIds,
  theme,
  alpha = 1,
) => {
  if (!Array.isArray(movementCardIds) || !movementCardIds.length) return;
  const layout = buildMiniCardStackLayout({
    row,
    xPos,
    rowSpacing,
    iconSize,
    count: movementCardIds.length,
    heightFactor: MOVEMENT_PICKUP_CARD_HEIGHT,
    aspect: MOVEMENT_PICKUP_CARD_ASPECT,
    stackOffsetFactor: MOVEMENT_PICKUP_STACK_OFFSET,
    side: 'left',
    slotIndex: 0,
  });
  drawMiniCardStack(layout, rowCenterY, ({ centerY }) => {
    drawMovementPickupCard(
      ctx,
      layout.centerX,
      centerY,
      layout.cardWidth,
      layout.cardHeight,
      theme,
      alpha,
    );
  });
};

const drawPlayedCardBack = (ctx, x, y, width, height, theme) => {
  const radius = Math.max(2, height * 0.08);
  ctx.save();
  drawRoundedRect(ctx, x, y, width, height, radius);
  ctx.clip();
  if (playedCardBackImage.complete && playedCardBackImage.naturalWidth > 0) {
    ctx.drawImage(playedCardBackImage, x, y, width, height);
  } else {
    ctx.fillStyle = theme.panelStrong || '#1a1a1a';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    drawRoundedRect(ctx, x + width * 0.08, y + height * 0.12, width * 0.84, height * 0.22, radius * 0.8);
    ctx.fill();
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = theme.panelStrong || theme.textDark || '#000000';
  ctx.lineWidth = Math.max(1, height * 0.06);
  drawRoundedRect(ctx, x, y, width, height, radius);
  ctx.stroke();
  ctx.restore();
};

const drawImageCover = (ctx, image, x, y, width, height) => {
  if (!image || !image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) return false;
  const imageAspect = image.naturalWidth / image.naturalHeight;
  const boxAspect = width / height;
  let srcX = 0;
  let srcY = 0;
  let srcWidth = image.naturalWidth;
  let srcHeight = image.naturalHeight;
  if (imageAspect > boxAspect) {
    srcWidth = image.naturalHeight * boxAspect;
    srcX = (image.naturalWidth - srcWidth) / 2;
  } else {
    srcHeight = image.naturalWidth / boxAspect;
    srcY = (image.naturalHeight - srcHeight) / 2;
  }
  ctx.drawImage(image, srcX, srcY, srcWidth, srcHeight, x, y, width, height);
  return true;
};

const drawPlayedCardArt = (ctx, x, y, width, height, card, cardId, theme, isHovered = false) => {
  const radius = Math.max(2, height * 0.08);
  const fallbackFill = theme.panelStrong || '#1a1a1a';
  const borderColor = isHovered
    ? theme.accentStrong || theme.accent || '#d5a34a'
    : theme.panelStrong || theme.textDark || '#000000';
  const isStunPreview = `${card?.previewClassName ?? ''}`.split(' ').includes(STUN_CARD_PREVIEW_CLASS);
  const cardName = `${card?.name ?? cardId ?? ''}`.trim();
  const artImage = getCardArt(cardName);

  ctx.save();
  ctx.fillStyle = fallbackFill;
  drawRoundedRect(ctx, x, y, width, height, radius);
  ctx.fill();
  ctx.clip();
  let drewArt = false;
  if (isStunPreview && damageCardImage.complete && damageCardImage.naturalWidth > 0 && damageCardImage.naturalHeight > 0) {
    ctx.drawImage(damageCardImage, x, y, width, height);
    drewArt = true;
  } else {
    drewArt = drawImageCover(ctx, artImage, x, y, width, height);
  }
  if (!drewArt) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    drawRoundedRect(ctx, x + width * 0.08, y + height * 0.08, width * 0.84, height * 0.18, radius * 0.7);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = Math.max(1, height * (isHovered ? 0.085 : 0.06));
  drawRoundedRect(ctx, x, y, width, height, radius);
  ctx.stroke();
  ctx.restore();
};

const drawPlayedCardPair = (
  ctx,
  pairLayout,
  playedPair,
  actorKey,
  cardLookup,
  theme,
  now,
  hoveredSlot = null,
) => {
  if (!pairLayout || !playedPair || !actorKey) {
    clearPlayedCardRevealState(actorKey);
    return;
  }

  const reveal = getPlayedCardRevealState(actorKey, playedPair.pairKey, now);
  const activeCard = cardLookup?.get?.(playedPair.activeCardId) ?? null;
  const passiveCard = cardLookup?.get?.(playedPair.passiveCardId) ?? null;

  const drawSlot = (bounds, card, cardId, isHovered = false) => {
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const flipScale = reveal?.flipScaleX ?? 1;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(flipScale, 1);
    const drawX = -bounds.width / 2;
    const drawY = -bounds.height / 2;
    const cardWidth = bounds.width;
    const cardHeight = bounds.height;
    if (reveal?.phase === 'front') {
      drawPlayedCardArt(ctx, drawX, drawY, cardWidth, cardHeight, card, cardId, theme, isHovered);
    } else {
      drawPlayedCardBack(ctx, drawX, drawY, cardWidth, cardHeight, theme);
    }
    ctx.restore();
  };

  if (hoveredSlot === 'active') {
    drawSlot(pairLayout.passiveBounds, passiveCard, playedPair.passiveCardId);
    drawSlot(pairLayout.activeBounds, activeCard, playedPair.activeCardId, true);
    return;
  }
  if (hoveredSlot === 'passive') {
    drawSlot(pairLayout.activeBounds, activeCard, playedPair.activeCardId);
    drawSlot(pairLayout.passiveBounds, passiveCard, playedPair.passiveCardId, true);
    return;
  }
  drawSlot(pairLayout.activeBounds, activeCard, playedPair.activeCardId);
  drawSlot(pairLayout.passiveBounds, passiveCard, playedPair.passiveCardId);
};

const buildBeatLookup = (beats) =>
  (Array.isArray(beats) ? beats : []).map((beat) => {
    const map = new Map();
    if (!Array.isArray(beat)) return map;
    beat.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const username = entry.username ?? entry.userId ?? entry.userID;
      if (!username) return;
      map.set(username, entry);
    });
    return map;
  });

const getOpponentPlayHoverSlot = (item, pointer) => {
  if (!item || !pointer) return null;
  const activeHit = isPointInRect(pointer.x, pointer.y, item.activeBounds);
  const passiveEnabled = item.hasPassiveCard !== false;
  const passiveHit = passiveEnabled && isPointInRect(pointer.x, pointer.y, item.passiveBounds);
  if (activeHit && passiveHit) {
    const activeCenterX = item.activeBounds.x + item.activeBounds.width / 2;
    const passiveCenterX = item.passiveBounds.x + item.passiveBounds.width / 2;
    return Math.abs(pointer.x - activeCenterX) <= Math.abs(pointer.x - passiveCenterX) ? 'active' : 'passive';
  }
  if (activeHit) return 'active';
  if (passiveHit) return 'passive';
  return null;
};

const getRectInCanvasSpace = (element, canvasRect) => {
  if (!(element instanceof HTMLElement) || !canvasRect) return null;
  const rect = element.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: rect.left - canvasRect.left,
    y: rect.top - canvasRect.top,
    width: rect.width,
    height: rect.height,
  };
};

const getLocalPlayedPreviewHoverTarget = ({ x, y, beatIndex, canvasRect, character, playedPair }) => {
  if (typeof document === 'undefined') return null;
  if (!character || !playedPair) return null;
  const actionHud = document.getElementById('actionHud');
  if (!(actionHud instanceof HTMLElement)) return null;
  if (actionHud.hidden || actionHud.classList.contains('is-turn')) return null;

  const activeSlot = document.getElementById('activeSlot');
  const passiveSlot = document.getElementById('passiveSlot');
  if (!(activeSlot instanceof HTMLElement) || !(passiveSlot instanceof HTMLElement)) return null;
  const activePreview = activeSlot.querySelector('.action-card.is-played-preview');
  if (!(activePreview instanceof HTMLElement)) return null;
  const passivePreview = passiveSlot.querySelector('.action-card.is-played-preview');

  const activeBounds = getRectInCanvasSpace(activeSlot, canvasRect);
  const passiveBounds =
    passivePreview instanceof HTMLElement ? getRectInCanvasSpace(passiveSlot, canvasRect) : null;
  if (!activeBounds) return null;

  const activeHit = isPointInRect(x, y, activeBounds);
  const passiveHit = passiveBounds ? isPointInRect(x, y, passiveBounds) : false;
  let cardRole = null;
  if (activeHit && passiveHit && passiveBounds) {
    const activeCenterX = activeBounds.x + activeBounds.width / 2;
    const passiveCenterX = passiveBounds.x + passiveBounds.width / 2;
    cardRole = Math.abs(x - activeCenterX) <= Math.abs(x - passiveCenterX) ? 'active' : 'passive';
  } else if (activeHit) {
    cardRole = 'active';
  } else if (passiveHit) {
    cardRole = 'passive';
  }
  if (!cardRole) return null;

  const activeCardId = readCardId(playedPair.activeCardId) || readCardId(activePreview.dataset.cardId);
  const passiveCardId =
    readCardId(playedPair.passiveCardId) ||
    (passivePreview instanceof HTMLElement ? readCardId(passivePreview.dataset.cardId) : '');
  const cardId = cardRole === 'passive' ? passiveCardId : activeCardId;
  if (!cardId) return null;
  const bounds = cardRole === 'passive' && passiveBounds ? passiveBounds : activeBounds;
  return {
    kind: 'played-card',
    beatIndex,
    character,
    cardRole,
    cardId,
    activeCardId,
    passiveCardId: passiveCardId || null,
    center: {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    },
    size: Math.max(bounds.width, bounds.height),
  };
};

const buildOpponentPlayHudItems = ({
  viewport,
  characters,
  localUserId,
  value,
  beatLookup,
  actionSelectionUserIds,
  selectionBeatIndex = null,
  includeLocalPlayer = false,
  cornerLayoutMode = CORNER_PLAY_LAYOUT_DEFAULT,
  hidePlayedCardsWhileSelecting = true,
}) => {
  const opponents = getOpponentCharacters(characters, localUserId, { includeLocalPlayer });
  const layoutItems = buildOpponentPlayHudLayout(viewport, opponents, cornerLayoutMode);
  const isSelectionBeat = Number.isFinite(selectionBeatIndex) && value === selectionBeatIndex;
  return layoutItems.map((item) => {
    const lookupKey = item.character?.username ?? item.character?.userId ?? '';
    const isSelecting = isCharacterInUserSet(actionSelectionUserIds, item.character);
    const resolvedPair = resolvePlayModalStateForBeat(beatLookup, lookupKey, value);
    const isStunPair = resolvedPair?.kind === 'stun';
    const shouldHideForSelection = hidePlayedCardsWhileSelecting && isSelectionBeat && isSelecting && !isStunPair;
    const playedPair = shouldHideForSelection ? null : resolvedPair;
    const rotation =
      playedPair?.kind === 'stun' ? '' : resolveSelectedRotationForPair(beatLookup, lookupKey, playedPair, value);
    const beatSlot = resolvePlayBeatSlotForValue(playedPair, value);
    return {
      ...item,
      lookupKey,
      playedPair,
      hasPassiveCard: playedPair?.kind !== 'stun',
      rotation,
      beatSlot,
      isSelecting,
      shouldHideForSelection,
    };
  });
};

const getCornerPlayHudRoot = () => {
  if (typeof document === 'undefined') return null;
  const element = document.getElementById('cornerPlayHud');
  return element instanceof HTMLElement ? element : null;
};

const createCornerPlayHudNode = () => {
  if (typeof document === 'undefined') return null;
  const root = document.createElement('div');
  root.className = 'corner-play-item is-back';

  const shell = document.createElement('div');
  shell.className = 'play-modal-shell corner-play-modal-shell';

  const art = document.createElement('div');
  art.className = 'play-modal-art';
  art.setAttribute('aria-hidden', 'true');

  const beatPointer = document.createElement('div');
  beatPointer.className = 'play-modal-beat-pointer corner-play-beat-pointer';
  beatPointer.setAttribute('aria-hidden', 'true');
  beatPointer.hidden = true;

  const rotationWheel = document.createElement('div');
  rotationWheel.className = 'rotation-wheel corner-play-rotation-wheel';
  rotationWheel.setAttribute('aria-hidden', 'true');
  const rotationController = buildRotationWheel(rotationWheel, null);
  rotationController.setAllowedRotations(null);

  const slotRow = document.createElement('div');
  slotRow.className = 'action-slot-row';

  const activeSlot = document.createElement('div');
  activeSlot.className = 'action-slot action-slot-active';
  const activeDrop = document.createElement('div');
  activeDrop.className = 'action-slot-drop';
  activeSlot.appendChild(activeDrop);

  const passiveSlot = document.createElement('div');
  passiveSlot.className = 'action-slot action-slot-passive';
  const passiveDrop = document.createElement('div');
  passiveDrop.className = 'action-slot-drop';
  passiveSlot.appendChild(passiveDrop);

  slotRow.appendChild(activeSlot);
  slotRow.appendChild(passiveSlot);

  shell.appendChild(art);
  shell.appendChild(rotationWheel);
  shell.appendChild(slotRow);
  shell.appendChild(beatPointer);
  root.appendChild(shell);

  return {
    root,
    shell,
    activeSlot,
    passiveSlot,
    activeDrop,
    passiveDrop,
    beatPointer,
    rotationController,
    currentRotation: null,
    activeCardId: null,
    passiveCardId: null,
    activeCardElement: null,
    passiveCardElement: null,
  };
};

const clearCornerPlayHudSlotCard = (node, slotName) => {
  if (!node) return;
  if (slotName === 'active') {
    if (node.activeCardElement?.parentElement) {
      node.activeCardElement.remove();
    }
    node.activeCardElement = null;
    node.activeCardId = null;
    node.activeDrop?.classList?.remove('is-occupied');
    return;
  }
  if (node.passiveCardElement?.parentElement) {
    node.passiveCardElement.remove();
  }
  node.passiveCardElement = null;
  node.passiveCardId = null;
  node.passiveDrop?.classList?.remove('is-occupied');
};

const setCornerPlayHudSlotCard = (node, slotName, card, fallbackCardId = '') => {
  if (!node) return;
  const nextCardId = `${card?.id ?? fallbackCardId ?? ''}`.trim();
  const previewClassName = `${card?.previewClassName ?? ''}`.trim();
  const nextCardKey = `${nextCardId}|${previewClassName}`;
  if (!nextCardId || !card) {
    clearCornerPlayHudSlotCard(node, slotName);
    return;
  }
  if (slotName === 'active') {
    if (node.activeCardId !== nextCardKey || !node.activeCardElement) {
      clearCornerPlayHudSlotCard(node, 'active');
      const className = previewClassName || undefined;
      const element = buildCardElement(card, className ? { className } : undefined);
      node.activeCardElement = element;
      node.activeCardId = nextCardKey;
      node.activeDrop.appendChild(element);
      fitAllCardText(element);
    } else if (node.activeCardElement.parentElement !== node.activeDrop) {
      node.activeDrop.appendChild(node.activeCardElement);
    }
    node.activeDrop.classList.add('is-occupied');
    return;
  }
  if (node.passiveCardId !== nextCardKey || !node.passiveCardElement) {
    clearCornerPlayHudSlotCard(node, 'passive');
    const className = previewClassName || undefined;
    const element = buildCardElement(card, className ? { className } : undefined);
    node.passiveCardElement = element;
    node.passiveCardId = nextCardKey;
    node.passiveDrop.appendChild(element);
    fitAllCardText(element);
  } else if (node.passiveCardElement.parentElement !== node.passiveDrop) {
    node.passiveDrop.appendChild(node.passiveCardElement);
  }
  node.passiveDrop.classList.add('is-occupied');
};

const getOrCreateCornerPlayHudNode = (actorKey) => {
  if (!actorKey) return null;
  const existing = cornerPlayHudNodesByActor.get(actorKey);
  if (existing) return existing;
  const created = createCornerPlayHudNode();
  if (!created) return null;
  cornerPlayHudNodesByActor.set(actorKey, created);
  return created;
};

const pruneCornerPlayHudNodes = (activeKeys = new Set()) => {
  const root = getCornerPlayHudRoot();
  cornerPlayHudNodesByActor.forEach((node, actorKey) => {
    if (activeKeys.has(actorKey)) return;
    node.root?.remove?.();
    cornerPlayHudNodesByActor.delete(actorKey);
  });
  if (root) {
    root.hidden = activeKeys.size === 0;
  }
};

const syncCornerPlayHudDomItem = ({ root, actorKey, item, phase, flipScale, hoveredSlot, cardLookup }) => {
  if (!root || !actorKey || !item) return;
  const node = getOrCreateCornerPlayHudNode(actorKey);
  if (!node) return;
  if (node.root.parentElement !== root) {
    root.appendChild(node.root);
  }

  node.root.style.left = `${item.modal.x}px`;
  node.root.style.top = `${item.modal.y}px`;
  node.root.style.width = `${item.modal.width}px`;
  node.root.style.height = `${item.modal.height}px`;
  node.root.style.setProperty('--play-modal-width', `${item.modal.width}px`);
  node.root.style.setProperty('--play-modal-height', `${item.modal.height}px`);
  node.root.classList.toggle('is-front', phase === 'front');
  node.root.classList.toggle('is-back', phase !== 'front');
  node.shell.style.transform = `scaleX(${Math.max(0.06, flipScale)})`;
  const isStunned = item.playedPair?.kind === 'stun';
  const passiveEnabled = item.hasPassiveCard !== false;
  node.root.classList.toggle('is-stunned', isStunned);
  node.activeSlot.classList.toggle('is-stunned', isStunned);
  node.activeSlot.classList.toggle('is-hovered', hoveredSlot === 'active');
  node.passiveSlot.classList.toggle('is-hovered', passiveEnabled && hoveredSlot === 'passive');

  if (phase === 'front' && item.playedPair) {
    const activeCard =
      isStunned ? item.playedPair.previewCard ?? null : cardLookup?.get?.(item.playedPair.activeCardId) ?? null;
    const passiveCard =
      passiveEnabled && !isStunned ? cardLookup?.get?.(item.playedPair.passiveCardId) ?? null : null;
    setCornerPlayHudSlotCard(node, 'active', activeCard, item.playedPair.activeCardId);
    if (passiveEnabled && passiveCard) {
      setCornerPlayHudSlotCard(node, 'passive', passiveCard, item.playedPair.passiveCardId);
    } else {
      clearCornerPlayHudSlotCard(node, 'passive');
    }

    const beatPoint = item.beatSlot !== null ? getPlayBeatRailPoint(item.modal, item.beatSlot) : null;
    if (beatPoint) {
      const localBeatX = ((beatPoint.x - item.modal.x) / item.modal.width) * 100;
      const localBeatY = ((beatPoint.y - item.modal.y) / item.modal.height) * 100;
      node.beatPointer.style.setProperty('--play-beat-x', `${localBeatX.toFixed(3)}%`);
      node.beatPointer.style.setProperty('--play-beat-y', `${localBeatY.toFixed(3)}%`);
      node.beatPointer.hidden = false;
    } else {
      node.beatPointer.hidden = true;
    }

    const nextRotation = isStunned ? '' : `${item.rotation ?? ''}`.trim();
    if (nextRotation !== node.currentRotation) {
      if (nextRotation) {
        node.rotationController?.setValue?.(nextRotation);
      } else {
        node.rotationController?.clear?.();
      }
      node.currentRotation = nextRotation;
    }
    return;
  }

  clearCornerPlayHudSlotCard(node, 'active');
  clearCornerPlayHudSlotCard(node, 'passive');
  node.root.classList.remove('is-stunned');
  node.activeSlot.classList.remove('is-stunned');
  node.beatPointer.hidden = true;
  node.rotationController?.clear?.();
  node.currentRotation = null;
};

export const clearCornerPlayHudDom = () => {
  pruneCornerPlayHudNodes(new Set());
};

const drawOpponentPlayHud = ({
  ctx,
  viewport,
  theme,
  characters,
  localUserId,
  value,
  beatLookup,
  waitingUserIds,
  actionSelectionUserIds,
  selectionBeatIndex = null,
  timelinePointer,
  cardLookup,
  now,
  waitingRingAlpha,
  includeLocalPlayer = false,
  cornerLayoutMode = CORNER_PLAY_LAYOUT_DEFAULT,
  hidePlayedCardsWhileSelecting = true,
}) => {
  const items = buildOpponentPlayHudItems({
    viewport,
    characters,
    localUserId,
    value,
    beatLookup,
    actionSelectionUserIds,
    selectionBeatIndex,
    includeLocalPlayer,
    cornerLayoutMode,
    hidePlayedCardsWhileSelecting,
  });
  const cornerHudRoot = getCornerPlayHudRoot();
  const activeDomKeys = new Set();
  const activeRevealKeys = new Set();
  items.forEach((item) => {
    const revealKey = item.lookupKey ? `corner:${item.lookupKey}` : '';
    const actorKey = `${item.lookupKey ?? ''}`.trim();
    const isWaiting = isCharacterInUserSet(waitingUserIds, item.character);
    const portraitImage = getCharacterArt(item.character?.characterId);
    drawCharacterPortrait(ctx, portraitImage, item.portrait.x, item.portrait.y, item.portrait.radius, theme.panelStrong);
    drawCharacterRing(
      ctx,
      item.portrait.x,
      item.portrait.y,
      item.portrait.radius,
      Math.max(1.5, item.portrait.radius * CHARACTER_TOKEN_STYLE.borderFactor),
      theme.accentStrong,
      isWaiting ? waitingRingAlpha : 1,
    );
    drawNameCapsule(
      ctx,
      item.portrait.x,
      item.portrait.y,
      item.portrait.radius,
      item.character?.username || item.character?.userId,
      theme,
    );
    const hoveredSlot = timelinePointer ? getOpponentPlayHoverSlot(item, timelinePointer) : null;

    if (!item.playedPair && !item.isSelecting) {
      if (revealKey) clearCornerPlayRevealState(revealKey);
      return;
    }

    const centerX = item.modal.x + item.modal.width / 2;
    const centerY = item.modal.y + item.modal.height / 2;
    let phase = 'back';
    let flipScale = 1;
    if (item.playedPair && revealKey && !item.shouldHideForSelection) {
      activeRevealKeys.add(revealKey);
      const reveal = getCornerPlayRevealState(revealKey, item.playedPair.pairKey, now);
      phase = reveal?.phase ?? 'front';
      flipScale = reveal?.flipScaleX ?? 1;
    }
    if (item.shouldHideForSelection) {
      if (item.playedPair?.kind === 'stun') {
        phase = 'front';
        flipScale = 1;
      } else {
        phase = 'back';
        flipScale = 1;
      }
    }

    if (cornerHudRoot && actorKey) {
      activeDomKeys.add(actorKey);
      syncCornerPlayHudDomItem({
        root: cornerHudRoot,
        actorKey,
        item,
        phase,
        flipScale,
        hoveredSlot,
        cardLookup,
      });
    } else {
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.scale(Math.max(0.06, flipScale), 1);
      const localModal = {
        x: -item.modal.width / 2,
        y: -item.modal.height / 2,
        width: item.modal.width,
        height: item.modal.height,
      };
      drawPlayModalBase(ctx, localModal, theme, phase);
      if (phase === 'front' && item.playedPair) {
        const isStunned = item.playedPair.kind === 'stun';
        const activeCard =
          isStunned ? item.playedPair.previewCard ?? null : cardLookup?.get?.(item.playedPair.activeCardId) ?? null;
        const passiveCard =
          !isStunned && item.hasPassiveCard !== false ? cardLookup?.get?.(item.playedPair.passiveCardId) ?? null : null;
        const activeBounds = {
          x: item.activeBounds.x - item.modal.x - item.modal.width / 2,
          y: item.activeBounds.y - item.modal.y - item.modal.height / 2,
          width: item.activeBounds.width,
          height: item.activeBounds.height,
        };
        const passiveBounds = {
          x: item.passiveBounds.x - item.modal.x - item.modal.width / 2,
          y: item.passiveBounds.y - item.modal.y - item.modal.height / 2,
          width: item.passiveBounds.width,
          height: item.passiveBounds.height,
        };
        drawPlayedCardArt(
          ctx,
          activeBounds.x,
          activeBounds.y,
          activeBounds.width,
          activeBounds.height,
          activeCard,
          item.playedPair.activeCardId,
          theme,
          hoveredSlot === 'active',
        );
        if (passiveCard) {
          drawPlayedCardArt(
            ctx,
            passiveBounds.x,
            passiveBounds.y,
            passiveBounds.width,
            passiveBounds.height,
            passiveCard,
            item.playedPair.passiveCardId,
            theme,
            hoveredSlot === 'passive',
          );
          drawActivePassiveMask(ctx, activeBounds);
        }
        const rotationSlot = toRotationSlotIndex(item.rotation);
        if (rotationSlot !== null) {
          const rotationPoint = getRotationMarkerPoint(localModal, rotationSlot);
          drawPlayModalRotationMarker(ctx, rotationPoint, item.modal.width);
        }
        if (item.beatSlot !== null) {
          const beatPoint = getPlayBeatRailPoint(localModal, item.beatSlot);
          drawPlayModalBeatPointer(ctx, beatPoint, item.modal.width);
        }
      }
      ctx.restore();
    }
  });
  pruneCornerPlayRevealState(activeRevealKeys);
  pruneCornerPlayHudNodes(activeDomKeys);
};

const drawRotationBadge = (ctx, x, y, size, rotation, theme) => {
  const radius = Math.max(6, size * 0.22);
  const padding = Math.max(2, size * 0.05);
  const badgeOffset = Math.max(4, size * 0.25);
  const centerX = x + radius + padding;
  const centerY = y + radius + padding - badgeOffset;
  const fontSize = Math.max(9, radius * 1.1);
  const borderColor = theme.textDark || theme.text;
  const fillColor = theme.text;

  ctx.save();
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = Math.max(1, radius * 0.2);
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = borderColor;
  ctx.font = `600 ${fontSize}px ${theme.fontBody}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(rotation, centerX, centerY + radius * 0.05);
  ctx.restore();
};

const drawTimingBadges = (ctx, x, y, size, entry) => {
  const timing = resolveActionTiming(entry?.action, entry?.timing);
  if (!Array.isArray(timing) || !timing.length) return;
  const icons = timing
    .map((phase) => getActionArt(phase))
    .filter((icon) => icon && icon.complete && icon.naturalWidth > 0);
  if (!icons.length) return;
  // Timing art is authored as full-frame overlays with directional markers.
  // Draw each phase at full action-icon size so markers line up with the base icon.
  icons.forEach((icon) => {
    ctx.drawImage(icon, x, y, size, size);
  });
};

const drawFocusBadge = (ctx, x, y, size) => {
  const icon = getActionArt(FOCUS_ICON_KEY);
  if (!icon || !icon.complete || icon.naturalWidth === 0) return;
  const badgeSize = Math.max(10, size * 0.34);
  const badgeX = x + size / 2 - badgeSize / 2;
  const badgeY = y + size - badgeSize * 0.2;
  ctx.drawImage(icon, badgeX, badgeY, badgeSize, badgeSize);
};

const drawShieldBadge = (ctx, x, y, size) => {
  const icon = getActionArt('shield');
  if (!icon || !icon.complete || icon.naturalWidth === 0) return;
  const badgeSize = Math.max(10, size * 0.34);
  const padding = Math.max(2, size * 0.04);
  const badgeX = x + size - badgeSize - padding;
  const badgeY = y + padding;
  ctx.drawImage(icon, badgeX, badgeY, badgeSize, badgeSize);
};

const drawFfaScoreBadges = (ctx, centerX, centerY, radius, score) => {
  const safeScore = Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
  if (!safeScore) return;
  const icon = getActionArt('Victory');
  const badgeSize = Math.max(20, radius * 1.24);
  const gap = Math.max(1, badgeSize * 0.14);
  const startX = centerX - radius - gap - badgeSize;
  const y = centerY - radius - badgeSize * 0.18;
  for (let index = 0; index < safeScore; index += 1) {
    const x = startX - index * (badgeSize + gap);
    if (icon && icon.complete && icon.naturalWidth > 0) {
      ctx.drawImage(icon, x, y, badgeSize, badgeSize);
      continue;
    }
    ctx.save();
    ctx.fillStyle = '#f6d866';
    ctx.beginPath();
    ctx.arc(x + badgeSize / 2, y + badgeSize / 2, badgeSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
};

const drawDeathBackdrop = (ctx, centerX, centerY, size) => {
  const radius = Math.max(6, size * 0.47);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const drawKnockbackBadge = (ctx, x, y, size, distance, theme) => {
  if (!Number.isFinite(distance)) return;
  const icon = getActionArt(KNOCKBACK_ICON_KEY);
  if (!icon || !icon.complete || icon.naturalWidth === 0) return;
  const badgeSize = Math.max(14, size * 0.5);
  const padding = Math.max(4, size * 0.08);
  const offsetOut = size * KNOCKBACK_BADGE_OUTSET;
  const badgeX = x + size - badgeSize - padding + offsetOut + BADGE_NUDGE_X;
  const badgeY = y + padding - offsetOut;
  ctx.drawImage(icon, badgeX, badgeY, badgeSize, badgeSize);

  ctx.save();
  ctx.fillStyle = theme.damageText || '#ffffff';
  ctx.font = `700 ${Math.max(9, badgeSize * 0.4)}px ${theme.fontBody}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = `${Math.max(0, Math.round(distance))}`;
  ctx.fillText(label, badgeX + badgeSize / 2, badgeY + badgeSize / 2 + badgeSize * 0.05);
  ctx.restore();
};

const drawDamageDeltaBadge = (ctx, x, y, size, delta, theme) => {
  if (!Number.isFinite(delta)) return;
  const safeDelta = Math.round(delta);
  const { x: badgeX, y: badgeY, width, height } = getDamageBadgeRect(x, y, size);
  const fill =
    safeDelta < 0 ? theme.actionMove || '#33d06b' : theme.damage || theme.actionAttack || '#d34b42';
  const textColor = theme.damageText || '#ffffff';

  ctx.save();
  ctx.fillStyle = fill;
  drawRoundedRect(ctx, badgeX, badgeY, width, height, height / 2);
  ctx.fill();
  ctx.fillStyle = textColor;
  ctx.font = `700 ${Math.max(9, height * 0.6)}px ${theme.fontBody}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = safeDelta < 0 ? `${Math.abs(safeDelta)}` : `${safeDelta}`;
  ctx.fillText(label, badgeX + width / 2, badgeY + height / 2 + height * 0.05);
  ctx.restore();
};

const getDamageBadgeRect = (x, y, size) => {
  const badgeSize = Math.max(10, size * 0.34);
  const padding = Math.max(4, size * 0.08);
  const width = Math.max(18, size * 0.42);
  const height = Math.max(12, size * 0.2);
  const offsetOut = size * DAMAGE_BADGE_OUTSET;
  const badgeX = x + size - width - padding + offsetOut + BADGE_NUDGE_X;
  const badgeY = y + padding + badgeSize + padding - offsetOut;
  return { x: badgeX, y: badgeY, width, height };
};

const getCardFlowBadgeRect = (x, y, size, row = 0) => {
  const damageBadge = getDamageBadgeRect(x, y, size);
  const badgeSize = Math.max(14, size * 0.48);
  const gap = Math.max(1, size * 0.03);
  const rightShift = badgeSize * 0.1;
  const rowOffset = Math.max(0, Math.round(row)) * (badgeSize + gap);
  const badgeX = damageBadge.x + damageBadge.width / 2 - badgeSize / 2 + rightShift;
  const badgeY = damageBadge.y + damageBadge.height + gap + rowOffset;
  return { x: badgeX, y: badgeY, size: badgeSize };
};

const drawDiscardBadge = (ctx, x, y, size, discardCount, theme) => {
  const safeCount = Number.isFinite(discardCount) ? Math.max(0, Math.round(discardCount)) : 0;
  if (!safeCount) return;
  const icon = getActionArt(DISCARD_ICON_KEY);
  if (!icon || !icon.complete || icon.naturalWidth === 0) return;
  const rect = getCardFlowBadgeRect(x, y, size, 0);
  ctx.drawImage(icon, rect.x, rect.y, rect.size, rect.size);

  ctx.save();
  ctx.fillStyle = theme.damageText || '#ffffff';
  ctx.font = `700 ${Math.max(9, rect.size * 0.4)}px ${theme.fontBody}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`-${safeCount}`, rect.x + rect.size / 2, rect.y + rect.size / 2 + rect.size * 0.05);
  ctx.restore();
};

const drawDrawBadge = (ctx, x, y, size, drawCount, theme, row = 0) => {
  const safeCount = Number.isFinite(drawCount) ? Math.max(0, Math.round(drawCount)) : 0;
  if (!safeCount) return;
  const icon = getActionArt(DRAW_ICON_KEY);
  if (!icon || !icon.complete || icon.naturalWidth === 0) return;
  const rect = getCardFlowBadgeRect(x, y, size, row);
  ctx.drawImage(icon, rect.x, rect.y, rect.size, rect.size);

  ctx.save();
  ctx.fillStyle = theme.damageText || '#ffffff';
  ctx.font = `700 ${Math.max(9, rect.size * 0.4)}px ${theme.fontBody}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`+${safeCount}`, rect.x + rect.size / 2, rect.y + rect.size / 2 + rect.size * 0.05);
  ctx.restore();
};

const isPointInRect = (x, y, rect) =>
  x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

const isPointInCircle = (x, y, circle) => {
  const dx = x - circle.centerX;
  const dy = y - circle.centerY;
  return dx * dx + dy * dy <= circle.radius * circle.radius;
};

const drawPlayButton = (ctx, playButton, theme, isPlaying) => {
  if (!playButton) return;
  const fill = theme.panelStrong || theme.panel;
  const stroke = theme.accentStrong || theme.accent;
  const size = playButton.size;
  const iconSize = size * 0.4;

  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1.5, size * 0.08);
  ctx.beginPath();
  ctx.arc(playButton.centerX, playButton.centerY, playButton.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = stroke;
  if (isPlaying) {
    const barWidth = Math.max(3, iconSize * 0.32);
    const barHeight = Math.max(10, iconSize * 1.4);
    const gap = barWidth * 0.9;
    const leftX = playButton.centerX - gap;
    const rightX = playButton.centerX + gap;
    const topY = playButton.centerY - barHeight / 2;
    drawRoundedRect(ctx, leftX - barWidth / 2, topY, barWidth, barHeight, barWidth * 0.2);
    ctx.fill();
    drawRoundedRect(ctx, rightX - barWidth / 2, topY, barWidth, barHeight, barWidth * 0.2);
    ctx.fill();
  } else {
    const triWidth = iconSize * 1.1;
    const triHeight = iconSize * 1.3;
    ctx.beginPath();
    ctx.moveTo(playButton.centerX - triWidth * 0.35, playButton.centerY - triHeight / 2);
    ctx.lineTo(playButton.centerX - triWidth * 0.35, playButton.centerY + triHeight / 2);
    ctx.lineTo(playButton.centerX + triWidth * 0.6, playButton.centerY);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
};

const drawPlayModalBase = (ctx, modal, theme, phase = 'front') => {
  const image = phase === 'back' ? playModalBackImage : playModalImage;
  if (image && image.complete && image.naturalWidth > 0) {
    ctx.drawImage(image, modal.x, modal.y, modal.width, modal.height);
    return;
  }
  ctx.save();
  ctx.fillStyle = theme.panelStrong || '#1f232b';
  drawRoundedRect(ctx, modal.x, modal.y, modal.width, modal.height, Math.max(4, modal.width * 0.03));
  ctx.fill();
  ctx.restore();
};

const drawPlayModalBeatPointer = (ctx, point, modalWidth) => {
  if (!point) return;
  const size = Math.max(14, modalWidth * 0.09);
  const tipX = point.x - size * 0.12;
  const leftX = point.x - size;
  ctx.save();
  ctx.fillStyle = '#f7cd2a';
  ctx.beginPath();
  ctx.moveTo(tipX, point.y);
  ctx.lineTo(leftX, point.y - size * 0.56);
  ctx.lineTo(leftX, point.y + size * 0.56);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const drawPlayModalRotationMarker = (ctx, point, modalWidth) => {
  if (!point) return;
  const radius = Math.max(6, modalWidth * 0.043);
  ctx.save();
  ctx.fillStyle = 'rgba(240, 193, 38, 0.34)';
  ctx.strokeStyle = '#f0c126';
  ctx.lineWidth = Math.max(1.2, modalWidth * 0.01);
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
};

const drawActivePassiveMask = (ctx, bounds) => {
  if (!bounds) return;
  const maskHeight = Math.max(5, bounds.height * 0.16);
  const maskY = bounds.y + bounds.height - maskHeight;
  const maskInset = bounds.width * 0.06;
  ctx.save();
  ctx.fillStyle = PLAY_ACTIVE_PASSIVE_MASK_COLOR;
  ctx.fillRect(bounds.x - maskInset, maskY, Math.max(0, bounds.width + maskInset * 2), maskHeight);
  ctx.restore();
};

const drawChevronGlyph = (ctx, cx, cy, size, direction) => {
  const halfWidth = size * 0.9;
  const halfHeight = size * 0.55;
  ctx.beginPath();
  if (direction === 'up') {
    ctx.moveTo(cx - halfWidth, cy + halfHeight * 0.5);
    ctx.lineTo(cx, cy - halfHeight);
    ctx.lineTo(cx + halfWidth, cy + halfHeight * 0.5);
  } else {
    ctx.moveTo(cx - halfWidth, cy - halfHeight * 0.5);
    ctx.lineTo(cx, cy + halfHeight);
    ctx.lineTo(cx + halfWidth, cy - halfHeight * 0.5);
  }
  ctx.stroke();
};

const drawTimelineToggleButton = (ctx, toggleButton, theme, isExpanded) => {
  if (!toggleButton) return;
  const fill = theme.panelStrong || theme.panel;
  const stroke = theme.accentStrong || theme.accent;
  const glyphSize = toggleButton.radius * 0.52;
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1.2, toggleButton.radius * 0.24);
  ctx.beginPath();
  ctx.arc(toggleButton.centerX, toggleButton.centerY, toggleButton.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.6, toggleButton.radius * 0.34);
  drawChevronGlyph(ctx, toggleButton.centerX, toggleButton.centerY, glyphSize, isExpanded ? 'up' : 'down');
  ctx.restore();
};

const drawArrowGlyph = (ctx, cx, cy, size, direction) => {
  ctx.beginPath();
  if (direction === 'left') {
    ctx.moveTo(cx + size * 0.6, cy - size);
    ctx.lineTo(cx - size * 0.6, cy);
    ctx.lineTo(cx + size * 0.6, cy + size);
  } else {
    ctx.moveTo(cx - size * 0.6, cy - size);
    ctx.lineTo(cx + size * 0.6, cy);
    ctx.lineTo(cx - size * 0.6, cy + size);
  }
  ctx.closePath();
  ctx.fill();
};

const drawArrow = (ctx, rect, direction, color, alpha) => {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const size = Math.min(rect.width, rect.height) * 0.4;
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  drawArrowGlyph(ctx, cx, cy, size, direction);
  ctx.restore();
};

const drawDoubleArrow = (ctx, rect, direction, color, alpha) => {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const size = Math.min(rect.width / 3.1, rect.height * 0.31);
  const separation = size * 1.55;
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  drawArrowGlyph(ctx, cx - separation / 2, cy, size, direction);
  drawArrowGlyph(ctx, cx + separation / 2, cy, size, direction);
  ctx.restore();
};

const drawRoundedRect = (ctx, x, y, width, height, radius) => {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};
