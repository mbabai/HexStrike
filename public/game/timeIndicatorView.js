import { CHARACTER_IMAGE_SOURCES, CHARACTER_TOKEN_STYLE } from './characterTokens.mjs';
import { getEarliestPendingInteractionIndex, getTimelineStopIndex } from './beatTimeline.js';
import { getActiveHandTriggerId } from './handTriggerOrder.mjs';
import { drawNameCapsule } from './portraitBadges.js';

const DEFAULT_BORDER_SIZE = { width: 640, height: 64 };
const DEFAULT_ACTION = 'E';
const ACTION_ICON_FALLBACK = 'empty';
const EMPHASIS_ICON_KEY = 'i';
const COMBO_ICON_KEY = 'Co';
const FOCUS_ICON_KEY = 'F';
const KNOCKBACK_ICON_KEY = 'KnockBackIcon';
const DISCARD_ICON_KEY = 'DiscardIcon';
const REWIND_RETURN_INTERACTION_TYPE = 'rewind-return';
const END_MARKER_ACTIONS = new Set(['Death', 'Victory', 'Handshake']);
const VISIBLE_BEAT_RADIUS = 6;
const TIMELINE_OFFSETS = Array.from({ length: VISIBLE_BEAT_RADIUS * 2 + 1 }, (_, index) => index - VISIBLE_BEAT_RADIUS);
const actionArt = new Map();
const characterArt = new Map();
const priorityIcon = new Image();
  priorityIcon.src = '/public/images/priority.png';
const PENDING_BLINK_MS = 700;
const PREVIEW_PULSE_MS = 1400;
const PREVIEW_ALPHA = 0.5;
const PREVIEW_SCALE_AMPLITUDE = 0.06;
const PLAY_BUTTON_MIN_SIZE = 22;
const COMBO_SKIPPED_ALPHA = 0.35;
const KNOCKBACK_BADGE_OUTSET = 0.25;
const DAMAGE_BADGE_OUTSET = 0.22;
const BADGE_NUDGE_X = 5;
const HAND_TRIGGER_CARD_HEIGHT = 0.62;
const HAND_TRIGGER_CARD_ASPECT = 0.72;
const HAND_TRIGGER_STACK_OFFSET = 0.22;
const REWIND_RETURN_CARD_HEIGHT = 0.62;
const REWIND_RETURN_CARD_ASPECT = 0.72;
const REWIND_RETURN_STACK_OFFSET = 0.22;

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

const getInteractionDiscardCount = (interaction) => {
  if (!interaction || typeof interaction !== 'object') return 0;
  if (interaction.type === 'discard') {
    const abilityCount = toBadgeCount(interaction.discardAbilityCount);
    const movementCount = toBadgeCount(interaction.discardMovementCount);
    if (abilityCount !== null || movementCount !== null) {
      return (abilityCount ?? 0) + (movementCount ?? 0);
    }
    return toBadgeCount(interaction.discardCount) ?? 0;
  }
  if (interaction.type !== 'hand-trigger') return 0;
  if (interaction.status !== 'resolved' || interaction.resolution?.use !== true) return 0;
  const resolvedCount =
    getResolvedListCount(interaction.resolution?.abilityCardIds) +
    getResolvedListCount(interaction.resolution?.movementCardIds);
  if (resolvedCount > 0) return resolvedCount;
  return toBadgeCount(interaction.discardCount) ?? 0;
};

const buildDiscardLookup = (interactions, characters) => {
  const lookup = new Map();
  if (!Array.isArray(interactions) || !Array.isArray(characters) || !characters.length) return lookup;
  const actorKeyMap = buildActorKeyMap(characters);
  interactions.forEach((interaction) => {
    if (!interaction) return;
    if (interaction.type !== 'discard' && interaction.type !== 'hand-trigger') return;
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

export const getTimeIndicatorLayout = (viewport) => {
  const padding = viewport.width < 520 ? 8 : 12;
  const maxWidth = Math.max(180, viewport.width - padding * 4);
  const borderWidth = DEFAULT_BORDER_SIZE.width;
  const borderHeight = DEFAULT_BORDER_SIZE.height;
  let scale = Math.min(1, maxWidth / borderWidth);
  let width = borderWidth * scale;
  let actionHeight = borderHeight * scale;
  let timeHeight = actionHeight * 0.7;
  let portraitOverlap = Math.max(2, actionHeight * 0.8);
  let groupWidth = width + actionHeight - portraitOverlap;
  const maxGroupWidth = Math.max(0, viewport.width - padding * 2);

  if (maxGroupWidth && groupWidth > maxGroupWidth) {
    const adjust = maxGroupWidth / groupWidth;
    scale *= adjust;
    width = borderWidth * scale;
    actionHeight = borderHeight * scale * 1.5;
    timeHeight = actionHeight * 0.5;
    portraitOverlap = Math.max(2, actionHeight * 0.08);
    groupWidth = width + actionHeight - portraitOverlap;
  }

  const groupX = (viewport.width - groupWidth) / 2;
  const x = groupX + actionHeight - portraitOverlap;
  const y = padding;
  const arrowWidth = Math.max(30, actionHeight * 0.25);
  const innerPadding = Math.max(6, actionHeight * 0.12);
  const numberArea = {
    x: x + arrowWidth * 0.7,
    y,
    width: width - arrowWidth * 1.4,
    height: timeHeight,
  };
  const leftArrow = { x, y, width: arrowWidth, height: timeHeight };
  const rightArrow = {
    x: x + width - arrowWidth,
    y,
    width: arrowWidth,
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

  return {
    x,
    y,
    width,
    timeHeight,
    actionHeight,
    leftArrow,
    rightArrow,
    numberArea,
    arrowWidth,
    innerPadding,
    portraitOverlap,
    portraitSize: actionHeight,
    portraitBorderWidth,
    playButton,
  };
};

const getRowLayout = (layout, rowIndex) => {
  const rowHeight = rowIndex === 0 ? layout.timeHeight : layout.actionHeight;
  const y = rowIndex === 0 ? layout.y : layout.y + layout.timeHeight + (rowIndex - 1) * layout.actionHeight;
  const numberArea = {
    x: layout.x + layout.arrowWidth * 0.7,
    y,
    width: layout.width - layout.arrowWidth * 1.4,
    height: rowHeight,
  };
  const leftArrow = { x: layout.x, y, width: layout.arrowWidth, height: rowHeight };
  const rightArrow = {
    x: layout.x + layout.width - layout.arrowWidth,
    y,
    width: layout.arrowWidth,
    height: rowHeight,
  };

  return { y, rowHeight, numberArea, leftArrow, rightArrow };
};

export const getTimeIndicatorHit = (layout, x, y) => {
  if (!layout) return null;
  if (layout.playButton && isPointInCircle(x, y, layout.playButton)) return 'play';
  if (isPointInRect(x, y, layout.leftArrow)) return 'left';
  if (isPointInRect(x, y, layout.rightArrow)) return 'right';
  return null;
};

export const getTimeIndicatorActionTarget = (layout, viewModel, gameState, x, y) => {
  if (!layout) return null;
  const characters = gameState?.state?.public?.characters ?? [];
  const beats = gameState?.state?.public?.beats ?? [];
  const interactions = gameState?.state?.public?.customInteractions ?? [];
  const matchOutcome = gameState?.state?.public?.matchOutcome ?? null;
  if (!characters.length || !beats.length) return null;
  const offsets = TIMELINE_OFFSETS;
  const value = viewModel?.value ?? 0;
  const topRow = getRowLayout(layout, 0);
  const spacingTarget = Math.max(26, layout.actionHeight * 0.72);
  const spacing = Math.min(spacingTarget, topRow.numberArea.width / (offsets.length - 1));
  const beatLookup = beats.map((beat) => {
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
  const handTriggerLookup = buildHandTriggerLookup(interactions, characters);
  const rewindReturnLookup = buildRewindReturnLookup(interactions, characters);

  for (let rowIndex = 0; rowIndex < characters.length; rowIndex += 1) {
    const character = characters[rowIndex];
    const row = getRowLayout(layout, rowIndex + 1);
    const rowCenterX = row.numberArea.x + row.numberArea.width / 2;
    const rowCenterY = row.numberArea.y + row.numberArea.height / 2;
    const iconSize = Math.min(row.numberArea.height * 0.82, spacing * 0.8);
    const lookupKey = character.username ?? character.userId;
    for (let offsetIndex = 0; offsetIndex < offsets.length; offsetIndex += 1) {
      const offset = offsets[offsetIndex];
      const beatIndex = value + offset;
      if (beatIndex < 0) continue;
      const baseEntry = beatLookup[beatIndex]?.get(lookupKey);
      const baseAction = `${baseEntry?.action ?? ''}`.trim();
      const outcomeAction = getOutcomeMarkerAction(matchOutcome, character, beatIndex);
      const action =
        outcomeAction && (!baseEntry || baseAction === DEFAULT_ACTION)
          ? outcomeAction
          : baseEntry?.action ?? ACTION_ICON_FALLBACK;
      const entry = baseEntry
        ? { ...baseEntry, action }
        : action && action !== ACTION_ICON_FALLBACK
          ? { action }
          : null;
      const xPos = rowCenterX + offset * spacing;
      const rewindReturnKey = `${lookupKey}:${beatIndex}`;
      const rewindReturns = rewindReturnLookup.get(rewindReturnKey) ?? [];
      if (rewindReturns.length) {
        const cardHeight = iconSize * REWIND_RETURN_CARD_HEIGHT;
        const cardWidth = cardHeight * REWIND_RETURN_CARD_ASPECT;
        const cardCenterX = xPos - spacing * 0.5;
        const minCenterX = row.numberArea.x + cardWidth / 2;
        const maxCenterX = row.numberArea.x + row.numberArea.width - cardWidth / 2;
        if (cardCenterX >= minCenterX && cardCenterX <= maxCenterX) {
          const stackOffset = cardHeight * REWIND_RETURN_STACK_OFFSET;
          const startOffset = -((rewindReturns.length - 1) * stackOffset) / 2;
          for (let i = 0; i < rewindReturns.length; i += 1) {
            const centerY = rowCenterY + startOffset + i * stackOffset;
            const bounds = {
              x: cardCenterX - cardWidth / 2,
              y: centerY - cardHeight / 2,
              width: cardWidth,
              height: cardHeight,
            };
            if (!isPointInRect(x, y, bounds)) continue;
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
              center: { x: cardCenterX, y: centerY },
              size: Math.max(cardWidth, cardHeight),
            };
          }
        }
      }
      const handTriggerKey = `${lookupKey}:${beatIndex}`;
      const handTriggers = handTriggerLookup.get(handTriggerKey) ?? [];
      if (handTriggers.length) {
        const cardHeight = iconSize * HAND_TRIGGER_CARD_HEIGHT;
        const cardWidth = cardHeight * HAND_TRIGGER_CARD_ASPECT;
        const cardCenterX = xPos + spacing * 0.5;
        const minCenterX = row.numberArea.x + cardWidth / 2;
        const maxCenterX = row.numberArea.x + row.numberArea.width - cardWidth / 2;
        if (cardCenterX >= minCenterX && cardCenterX <= maxCenterX) {
          const stackOffset = cardHeight * HAND_TRIGGER_STACK_OFFSET;
          const startOffset = -((handTriggers.length - 1) * stackOffset) / 2;
          for (let i = 0; i < handTriggers.length; i += 1) {
            const centerY = rowCenterY + startOffset + i * stackOffset;
            const bounds = {
              x: cardCenterX - cardWidth / 2,
              y: centerY - cardHeight / 2,
              width: cardWidth,
              height: cardHeight,
            };
            if (!isPointInRect(x, y, bounds)) continue;
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
              center: { x: cardCenterX, y: centerY },
              size: Math.max(cardWidth, cardHeight),
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

export const drawTimeIndicator = (ctx, viewport, theme, viewModel, gameState, localUserId, pendingPreview) => {
  const layout = getTimeIndicatorLayout(viewport);
  if (!layout) return;

  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);

  const value = viewModel?.value ?? 0;
  const isPlaying = Boolean(viewModel?.isPlaying);
  const leftDisabled = viewModel?.canStep ? !viewModel.canStep(-1) : value === 0;
  const rightDisabled = viewModel?.canStep ? !viewModel.canStep(1) : false;
  const offsets = TIMELINE_OFFSETS;

  const characters = gameState?.state?.public?.characters ?? [];
  const beats = gameState?.state?.public?.beats ?? [];
  const interactions = gameState?.state?.public?.customInteractions ?? [];
  const matchOutcome = gameState?.state?.public?.matchOutcome ?? null;
  const highlightIndex = getTimelineStopIndex(beats, characters, interactions);
  const handTriggerLookup = buildHandTriggerLookup(interactions, characters);
  const rewindReturnLookup = buildRewindReturnLookup(interactions, characters);
  const discardLookup = buildDiscardLookup(interactions, characters);
  const drawLookup = buildDrawLookup(interactions, characters);
  const interactionStopIndex = getEarliestPendingInteractionIndex(interactions);
  const fadeAfterIndex =
    interactionStopIndex !== null && interactionStopIndex <= highlightIndex ? interactionStopIndex : null;
  const pending = gameState?.state?.public?.pendingActions ?? null;
  const waitingUserIds = new Set();
  if (pending && pending.beatIndex === highlightIndex && Array.isArray(pending.requiredUserIds)) {
    const submitted = new Set(Array.isArray(pending.submittedUserIds) ? pending.submittedUserIds : []);
    pending.requiredUserIds.forEach((userId) => {
      if (!submitted.has(userId)) {
        waitingUserIds.add(userId);
      }
    });
  }
  const activeHandTriggerId = getActiveHandTriggerId(interactions);
  interactions.forEach((interaction) => {
    if (!interaction || interaction.status !== 'pending') return;
    if (interaction.type === 'hand-trigger' && activeHandTriggerId && interaction.id !== activeHandTriggerId) {
      return;
    }
    if (interaction.actorUserId) {
      waitingUserIds.add(interaction.actorUserId);
    }
  });
  const blinkPhase = (performance.now() % PENDING_BLINK_MS) / PENDING_BLINK_MS;
  const blinkAlpha = 0.4 + 0.6 * Math.sin(blinkPhase * Math.PI * 2) ** 2;
  const previewPhase = (performance.now() % PREVIEW_PULSE_MS) / PREVIEW_PULSE_MS;
  const previewScale = 1 + PREVIEW_SCALE_AMPLITUDE * Math.sin(previewPhase * Math.PI * 2);
  const topRow = getRowLayout(layout, 0);
  drawNumberWell(ctx, topRow.numberArea, theme.queueLavender || theme.panel);

  const fontSize = Math.max(12, topRow.numberArea.height * 0.47);
  ctx.font = `${fontSize}px ${theme.fontBody}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const centerX = topRow.numberArea.x + topRow.numberArea.width / 2;
  const centerY = topRow.numberArea.y + topRow.numberArea.height / 2;
  const spacingTarget = Math.max(26, layout.actionHeight * 0.72);
  const spacing = Math.min(spacingTarget, topRow.numberArea.width / (offsets.length - 1));

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

  ctx.globalAlpha = 1;
  if (leftDisabled) {
    ctx.strokeStyle = theme.subtle;
    ctx.lineWidth = Math.max(1, topRow.numberArea.height * 0.04);
    ctx.beginPath();
    ctx.moveTo(topRow.numberArea.x + 2, topRow.numberArea.y + topRow.numberArea.height * 0.2);
    ctx.lineTo(topRow.numberArea.x + 2, topRow.numberArea.y + topRow.numberArea.height * 0.8);
    ctx.stroke();
  }

  const arrowColor = theme.accentStrong || '#d5a34a';
  drawArrow(ctx, topRow.leftArrow, 'left', arrowColor, leftDisabled ? 0.35 : 0.95);
  drawArrow(ctx, topRow.rightArrow, 'right', arrowColor, rightDisabled ? 0.35 : 0.95);

  if (!characters.length) return;
  const beatLookup = beats.map((beat) => {
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
      const action =
        outcomeMarkerAction && (!baseEntry || baseAction === DEFAULT_ACTION)
          ? outcomeMarkerAction
          : entry?.action ?? ACTION_ICON_FALLBACK;
      const xPos = rowCenterX + offset * rowSpacing;
      const shouldFade = fadeAfterIndex !== null && beatIndex > fadeAfterIndex;
      const handTriggerKey = `${lookupKey}:${beatIndex}`;
      const handTriggers = handTriggerLookup.get(handTriggerKey) ?? [];
      if (handTriggers.length) {
        const cardAlpha = shouldFade ? 0.28 : 1;
        drawHandTriggerCards(ctx, row, xPos, rowCenterY, rowSpacing, iconSize, handTriggers, theme, cardAlpha);
      }
      const rewindReturnKey = `${lookupKey}:${beatIndex}`;
      const rewindReturns = rewindReturnLookup.get(rewindReturnKey) ?? [];
      if (rewindReturns.length) {
        const cardAlpha = shouldFade ? 0.28 : 1;
        drawRewindReturnCards(ctx, row, xPos, rowCenterY, rowSpacing, iconSize, rewindReturns, theme, cardAlpha);
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
        const priorityValue = Number.isFinite(entry?.priority) ? entry.priority : 0;
        drawPriorityBadge(ctx, imageX, imageY, drawSize, priorityValue, theme);
      }
      const rotation = entry?.rotation;
      if (rotation !== undefined && rotation !== null && rotation !== '') {
        drawRotationBadge(ctx, imageX, imageY, drawSize, `${rotation}`, theme);
      }
      if (restoreAfter) {
        ctx.restore();
      }
    });

    const portraitRadius = layout.portraitSize / 2;
    const portraitX = layout.x - portraitRadius + layout.portraitOverlap;
    const portraitY = row.y + layout.actionHeight / 2;
    const portraitImage = getCharacterArt(character.characterId);
    const isLocalPlayer = localUserId && character.userId === localUserId;
    const isWaiting =
      waitingUserIds.has(character.userId) || waitingUserIds.has(character.username);
    const ringColor = isWaiting
      ? theme.actionAttack || theme.damage
      : isLocalPlayer
        ? theme.playerAccent || '#7dcfff'
        : theme.accentStrong;
    drawCharacterPortrait(ctx, portraitImage, portraitX, portraitY, portraitRadius, theme.panelStrong);
    drawCharacterRing(
      ctx,
      portraitX,
      portraitY,
      portraitRadius,
      layout.portraitBorderWidth,
      ringColor,
      isWaiting ? blinkAlpha : 1,
    );
    drawNameCapsule(ctx, portraitX, portraitY, portraitRadius, character.username || character.userId, theme);

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

const getRewindReturnFill = (interaction, theme) => {
  if (interaction?.resolution?.returnToAnchor) {
    return theme.cardMovement || theme.actionMove || theme.accent;
  }
  return theme.cardAbility || theme.actionAttack || theme.accentStrong;
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
  const cardHeight = iconSize * HAND_TRIGGER_CARD_HEIGHT;
  const cardWidth = cardHeight * HAND_TRIGGER_CARD_ASPECT;
  const cardCenterX = xPos + rowSpacing * 0.5;
  const minCenterX = row.numberArea.x + cardWidth / 2;
  const maxCenterX = row.numberArea.x + row.numberArea.width - cardWidth / 2;
  if (cardCenterX < minCenterX || cardCenterX > maxCenterX) return;
  const stackOffset = cardHeight * HAND_TRIGGER_STACK_OFFSET;
  const startOffset = -((handTriggers.length - 1) * stackOffset) / 2;
  handTriggers.forEach((interaction, index) => {
    const centerY = rowCenterY + startOffset + index * stackOffset;
    drawHandTriggerCard(ctx, cardCenterX, centerY, cardWidth, cardHeight, interaction, theme, alpha);
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
) => {
  if (!rewindReturns.length) return;
  const cardHeight = iconSize * REWIND_RETURN_CARD_HEIGHT;
  const cardWidth = cardHeight * REWIND_RETURN_CARD_ASPECT;
  const cardCenterX = xPos - rowSpacing * 0.5;
  const minCenterX = row.numberArea.x + cardWidth / 2;
  const maxCenterX = row.numberArea.x + row.numberArea.width - cardWidth / 2;
  if (cardCenterX < minCenterX || cardCenterX > maxCenterX) return;
  const stackOffset = cardHeight * REWIND_RETURN_STACK_OFFSET;
  const startOffset = -((rewindReturns.length - 1) * stackOffset) / 2;
  rewindReturns.forEach((interaction, index) => {
    const centerY = rowCenterY + startOffset + index * stackOffset;
    drawRewindReturnCard(ctx, cardCenterX, centerY, cardWidth, cardHeight, interaction, theme, alpha);
  });
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

const drawPriorityBadge = (ctx, x, y, size, priority, theme) => {
  const radius = Math.max(6, size * 0.22);
  const padding = Math.max(2, size * 0.05);
  const badgeOffset = Math.max(4, size * 0.25);
  const centerX = x + size - radius - padding;
  const centerY = y + size - radius - padding + badgeOffset;
  const fontSize = Math.max(9, radius * 1.05);

  if (priorityIcon.complete && priorityIcon.naturalWidth > 0) {
    ctx.drawImage(priorityIcon, centerX - radius, centerY - radius, radius * 2, radius * 2);
  }

  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.font = `600 ${fontSize}px ${theme.fontBody}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${priority}`, centerX, centerY + radius * 0.05);
  ctx.restore();
};

const drawFocusBadge = (ctx, x, y, size) => {
  const icon = getActionArt(FOCUS_ICON_KEY);
  if (!icon || !icon.complete || icon.naturalWidth === 0) return;
  const badgeSize = Math.max(10, size * 0.34);
  const badgeX = x + size / 2 - badgeSize / 2;
  const badgeY = y + size - badgeSize * 0.2;
  ctx.drawImage(icon, badgeX, badgeY, badgeSize, badgeSize);
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
  const icon = getActionArt(DISCARD_ICON_KEY);
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

const drawArrow = (ctx, rect, direction, color, alpha) => {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const size = Math.min(rect.width, rect.height) * 0.4;
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
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
  ctx.globalAlpha = 1;
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
