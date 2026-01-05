import { CHARACTER_IMAGE_SOURCES, CHARACTER_TOKEN_STYLE } from './characterTokens.mjs';
import { getEarliestPendingInteractionIndex, getTimelineStopIndex } from './beatTimeline.js';
import { drawNameCapsule } from './portraitBadges.js';

const DEFAULT_BORDER_SIZE = { width: 640, height: 64 };
const DEFAULT_ACTION = 'E';
const ACTION_ICON_FALLBACK = 'empty';
const EMPHASIS_ICON_KEY = 'i';
const COMBO_ICON_KEY = 'Co';
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
      const entry = beatLookup[beatIndex]?.get(lookupKey);
      if (!entry) continue;
      const token = parseActionToken(entry.action ?? '');
      const symbol = token.emphasized ? EMPHASIS_ICON_KEY : token.label;
      if (!(token.emphasized || symbol === 'X1' || symbol === 'X2')) continue;
      const xPos = rowCenterX + offset * spacing;
      const bounds = {
        x: xPos - iconSize / 2,
        y: rowCenterY - iconSize / 2,
        width: iconSize,
        height: iconSize,
      };
      if (!isPointInRect(x, y, bounds)) continue;
      return {
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
  const deathUserId = matchOutcome?.loserUserId ?? null;
  const deathIndex = Number.isFinite(matchOutcome?.beatIndex) ? matchOutcome.beatIndex : null;
  const highlightIndex = getTimelineStopIndex(beats, characters, interactions);
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
  interactions.forEach((interaction) => {
    if (!interaction || interaction.status !== 'pending') return;
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
      const isDeathBeat =
        deathIndex !== null &&
        beatIndex === deathIndex &&
        deathUserId &&
        (character.userId === deathUserId || character.username === deathUserId);
      const usePreview =
        !isDeathBeat && previewEntry && (!baseEntry || baseAction === DEFAULT_ACTION);
      const entry = usePreview ? previewEntry : baseEntry;
      const action =
        isDeathBeat && (!baseEntry || baseAction === DEFAULT_ACTION)
          ? 'Death'
          : entry?.action ?? ACTION_ICON_FALLBACK;
      const token = parseActionToken(action);
      const image = getActionArt(token.label);
      if (!image || !image.complete || image.naturalWidth === 0) return;
      const comboSkipped = entry?.comboSkipped && token.label === COMBO_ICON_KEY;
      const xPos = rowCenterX + offset * rowSpacing;
      const drawScale = usePreview ? previewScale : 1;
      const drawSize = iconSize * drawScale;
      const imageX = xPos - drawSize / 2;
      const imageY = rowCenterY - drawSize / 2;
      const shouldFade = fadeAfterIndex !== null && beatIndex > fadeAfterIndex;
      const alpha =
        (shouldFade ? 0.28 : 1) *
        (usePreview ? PREVIEW_ALPHA : 1) *
        (comboSkipped ? COMBO_SKIPPED_ALPHA : 1);
      const restoreAfter = alpha !== 1;
      if (restoreAfter) {
        ctx.save();
        ctx.globalAlpha = alpha;
      }
      if (comboSkipped) {
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
      const actionLabel = token.label;
      if (
        actionLabel &&
        actionLabel !== 'E' &&
        actionLabel !== 'Death' &&
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
