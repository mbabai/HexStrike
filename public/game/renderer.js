import { GAME_CONFIG } from './config.js';
import { drawTimeIndicator } from './timeIndicatorView.js';
import { CHARACTER_IMAGE_SOURCES, getCharacterTokenMetrics, getFacingArrowPoints } from './characterTokens.mjs';
import { AXIAL_DIRECTIONS, LAND_HEXES, axialToPixel, getHexSize, getWorldBounds } from '../shared/hex.mjs';
import { drawNameCapsule } from './portraitBadges.js';
import { buildAbyssPathLabels, drawAbyssGrid, drawAbyssPathLabels } from './abyssRendering.mjs';

const getTheme = () => {
  const css = getComputedStyle(document.documentElement);
  return {
    abyssFill: css.getPropertyValue('--color-hex-fill').trim(),
    abyssStroke: css.getPropertyValue('--color-hex-stroke').trim(),
    landFill: css.getPropertyValue('--color-hex-land-fill').trim(),
    landStroke: css.getPropertyValue('--color-hex-land-stroke').trim(),
    background: css.getPropertyValue('--color-game-surface').trim(),
    fontBody: css.getPropertyValue('--font-body').trim(),
    panel: css.getPropertyValue('--color-panel-mid').trim(),
    panelStrong: css.getPropertyValue('--color-panel-strong').trim(),
    text: css.getPropertyValue('--color-text').trim(),
    textDark: css.getPropertyValue('--color-text-dark').trim(),
    subtle: css.getPropertyValue('--color-subtle').trim(),
    accent: css.getPropertyValue('--color-accent').trim(),
    accentStrong: css.getPropertyValue('--color-accent-strong').trim(),
    playerAccent: css.getPropertyValue('--color-player-accent').trim(),
    queueLavender: css.getPropertyValue('--color-queue-lavender').trim(),
    nameCapsuleFill: css.getPropertyValue('--color-name-capsule-fill').trim(),
    damage: css.getPropertyValue('--color-damage').trim(),
    damageText: css.getPropertyValue('--color-damage-text').trim(),
    actionAttack: css.getPropertyValue('--color-action-attack').trim(),
    actionMove: css.getPropertyValue('--color-action-move').trim(),
    actionJump: css.getPropertyValue('--color-action-jump').trim(),
    actionBlock: css.getPropertyValue('--color-action-block').trim(),
    cardAbility: css.getPropertyValue('--color-card-ability').trim(),
    cardMovement: css.getPropertyValue('--color-card-movement').trim(),
  };
};

const TOKEN_IMAGE_SOURCES = {
  arrow: '/public/images/ArrowToken.png',
  'fire-hex': '/public/images/FireHexToken.png',
  'ethereal-platform': '/public/images/EtherealPlatform.png',
  'focus-anchor': '/public/images/F.png',
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const coordKey = (coord) => `${coord?.q},${coord?.r}`;

const normalizeActionTag = (action) =>
  typeof action === 'string' ? action.trim().toLowerCase() : '';

const getBeatEntryForCharacter = (beat, character) => {
  if (!Array.isArray(beat) || !character) return null;
  return (
    beat.find((item) => item?.username === character.username || item?.username === character.userId) ?? null
  );
};

const toRgb = (value) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return { r, g, b };
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r, g, b };
    }
    return null;
  }
  const match = trimmed.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  const parts = match[1]
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part));
  if (parts.length < 3) return null;
  return { r: parts[0], g: parts[1], b: parts[2] };
};

const withAlpha = (color, alpha) => {
  const rgb = toRgb(color);
  if (!rgb) return color;
  const safe = clamp(alpha, 0, 1);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${safe})`;
};

const drawHexPath = (ctx, x, y, size) => {
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const px = x + size * Math.cos(angle);
    const py = y + size * Math.sin(angle);
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
};

const drawHex = (ctx, x, y, size) => {
  drawHexPath(ctx, x, y, size);
  ctx.fill();
  ctx.stroke();
};

const drawCharacterPortrait = (ctx, image, x, y, radius, fillColor, grayscale = false) => {
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
    if (grayscale) {
      ctx.filter = 'grayscale(1)';
    }
    ctx.drawImage(image, x - drawWidth / 2, y - drawHeight / 2, drawWidth, drawHeight);
    if (grayscale) {
      ctx.filter = 'none';
    }
  }

  ctx.restore();
};

const drawCharacterRing = (ctx, x, y, radius, borderWidth, color) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = borderWidth;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
};

const drawFacingArrow = (ctx, points, color) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(points.tip.x, points.tip.y);
  ctx.lineTo(points.baseTop.x, points.baseTop.y);
  ctx.lineTo(points.baseBottom.x, points.baseBottom.y);
  ctx.closePath();
  ctx.fill();
};

const drawDamageCapsule = (ctx, x, y, radius, damage, theme) => {
  const safeDamage = Number.isFinite(damage) ? Math.max(0, Math.round(damage)) : 0;
  const label = `${safeDamage}`;
  const fontSize = Math.max(10, radius * 0.42);
  const paddingX = Math.max(3, radius * 0.12);
  const paddingY = Math.max(2, radius * 0.08);

  ctx.save();
  ctx.font = `600 ${fontSize}px ${theme.fontBody}`;
  const minWidth = ctx.measureText('88').width + paddingX * 2;
  const textWidth = ctx.measureText(label).width;
  const capsuleWidth = Math.max(textWidth + paddingX * 2, minWidth);
  const capsuleHeight = fontSize + paddingY * 2;
  const centerX = x + radius * 0.75;
  const centerY = y - radius * 0.75;
  const capsuleX = centerX - capsuleWidth / 2;
  const capsuleY = centerY - capsuleHeight / 2;

  ctx.fillStyle = theme.damage || '#d04840';
  drawRoundedRect(ctx, capsuleX, capsuleY, capsuleWidth, capsuleHeight, capsuleHeight / 2);
  ctx.fill();

  ctx.fillStyle = theme.damageText || '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, centerX, centerY + fontSize * 0.02);
  ctx.restore();
};

const drawBoardTokens = (ctx, tokens, size, theme, getTokenArt) => {
  if (!Array.isArray(tokens) || !tokens.length) return;
  const metrics = getCharacterTokenMetrics(size);
  const ringColor = '#000000';
  const hexWidth = size * Math.sqrt(3);
  const hexHeight = size * 2;
  tokens.forEach((token) => {
    if (!token?.position) return;
    const { x, y } = axialToPixel(token.position.q, token.position.r, size);
    const image = getTokenArt(token.type);
    if (token.type === 'focus-anchor') {
      const iconSize = size * 1.05;
      if (image && image.complete && image.naturalWidth > 0) {
        ctx.drawImage(image, x - iconSize / 2, y - iconSize / 2, iconSize, iconSize);
      } else {
        ctx.save();
        ctx.fillStyle = theme.accentStrong || '#d5a34a';
        ctx.font = `700 ${Math.max(12, size * 0.62)}px ${theme.fontBody}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('F', x, y);
        ctx.restore();
      }
      return;
    }
    if (token.type === 'fire-hex' || token.type === 'ethereal-platform') {
      ctx.save();
      drawHexPath(ctx, x, y, size);
      ctx.clip();
      if (image && image.complete && image.naturalWidth > 0) {
        ctx.drawImage(image, x - hexWidth / 2, y - hexHeight / 2, hexWidth, hexHeight);
      } else {
        ctx.fillStyle = theme.panelStrong || '#20303a';
        ctx.fillRect(x - hexWidth / 2, y - hexHeight / 2, hexWidth, hexHeight);
      }
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = Math.max(1, metrics.borderWidth);
      drawHexPath(ctx, x, y, size);
      ctx.stroke();
      ctx.restore();
      return;
    }
    drawCharacterPortrait(ctx, image, x, y, metrics.radius, theme.panelStrong);
    drawCharacterRing(ctx, x, y, metrics.radius, metrics.borderWidth, ringColor);
    const arrowPoints = getFacingArrowPoints(x, y, metrics, token.facing ?? 0);
    drawFacingArrow(ctx, arrowPoints, ringColor);
  });
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

const drawHexEffect = (ctx, coord, size, color, alpha, scale = 1) => {
  if (!coord) return;
  const { x, y } = axialToPixel(coord.q, coord.r, size);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.fillStyle = color;
  drawHexPath(ctx, x, y, size * scale);
  ctx.fill();
  ctx.restore();
};

const getHexCorners = (x, y, size) => {
  const points = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    points.push({ x: x + size * Math.cos(angle), y: y + size * Math.sin(angle) });
  }
  return points;
};

const normalizeAngle = (value) => {
  const twoPi = Math.PI * 2;
  return ((value % twoPi) + twoPi) % twoPi;
};

const getArcSpan = (angles) => {
  if (!angles.length) return { start: 0, span: 0 };
  const normalized = angles.map((angle) => normalizeAngle(angle)).sort((a, b) => a - b);
  if (normalized.length === 1) {
    return { start: normalized[0] - Math.PI / 8, span: Math.PI / 4 };
  }
  let maxGap = -Infinity;
  let gapIndex = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    const current = normalized[i];
    const next = i === normalized.length - 1 ? normalized[0] + Math.PI * 2 : normalized[i + 1];
    const gap = next - current;
    if (gap > maxGap) {
      maxGap = gap;
      gapIndex = i;
    }
  }
  const span = Math.max(Math.PI / 8, Math.PI * 2 - maxGap);
  const start = normalized[(gapIndex + 1) % normalized.length];
  return { start, span };
};

const drawTrail = (ctx, path, size, color, alpha, widthScale, taperToEnd) => {
  if (!Array.isArray(path) || path.length < 2) return;
  const safeAlpha = clamp(alpha, 0, 1);
  if (!safeAlpha) return;
  const baseWidth = Math.max(2, size * (widthScale ?? 0.25) * 2);
  const points = path.map((point) => axialToPixel(point.q, point.r, size));
  const lastIndex = points.length - 1;
  const left = [];
  const right = [];

  points.forEach((point, index) => {
    const prev = points[index - 1] ?? point;
    const next = points[index + 1] ?? point;
    const dir = { x: next.x - prev.x, y: next.y - prev.y };
    const length = Math.hypot(dir.x, dir.y) || 1;
    const normal = { x: -dir.y / length, y: dir.x / length };
    const t = lastIndex ? index / lastIndex : 0;
    const width = Math.max(0.5, baseWidth * (taperToEnd ? 0.1 + t * 0.9 : 1 - t * 0.9));
    const half = width / 2;
    left.push({ x: point.x + normal.x * half, y: point.y + normal.y * half });
    right.push({ x: point.x - normal.x * half, y: point.y - normal.y * half });
  });

  ctx.save();
  const startPoint = taperToEnd ? points[lastIndex] : points[0];
  const endPoint = taperToEnd ? points[0] : points[lastIndex];
  const gradient = ctx.createLinearGradient(startPoint.x, startPoint.y, endPoint.x, endPoint.y);
  gradient.addColorStop(0, withAlpha(color, 1));
  gradient.addColorStop(1, withAlpha(color, safeAlpha));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i += 1) {
    ctx.lineTo(left[i].x, left[i].y);
  }
  for (let i = right.length - 1; i >= 0; i -= 1) {
    ctx.lineTo(right[i].x, right[i].y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const drawAttackArc = (ctx, origin, targets, size, color, alpha, progress) => {
  if (!origin || !Array.isArray(targets) || !targets.length) return;
  const safeAlpha = clamp(alpha, 0, 1);
  const safeProgress = clamp(progress, 0, 1);
  if (!safeAlpha || !safeProgress) return;
  const originPixel = axialToPixel(origin.q, origin.r, size);
  const angles = [];
  let maxDistance = 0;
  targets.forEach((target) => {
    const { x, y } = axialToPixel(target.q, target.r, size);
    const dx = x - originPixel.x;
    const dy = y - originPixel.y;
    maxDistance = Math.max(maxDistance, Math.hypot(dx, dy));
    const corners = getHexCorners(x, y, size);
    corners.forEach((corner) => {
      const cornerDx = corner.x - originPixel.x;
      const cornerDy = corner.y - originPixel.y;
      angles.push(Math.atan2(cornerDy, cornerDx));
    });
  });
  const { start, span } = getArcSpan(angles);
  const baseThickness = Math.max(4, size * 0.6 * 3);
  const metrics = getCharacterTokenMetrics(size);
  const outerRadius = Math.max(size * 0.8, maxDistance);
  const minInnerRadius = metrics.radius * 1.08;
  const maxInnerRadius = Math.max(minInnerRadius, outerRadius - baseThickness);
  const arcStart = start + span;
  const arcEnd = arcStart - span * safeProgress;
  const sampleCount = Math.max(6, Math.ceil(span * 8));
  const arcPointsOuter = [];
  const arcPointsInner = [];
  const minTailScale = 0.7;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 0.35;
  for (let i = 0; i <= sampleCount; i += 1) {
    const t = sampleCount ? i / sampleCount : 0;
    const smoothT = t * t * (3 - 2 * t);
    const angle = arcStart - span * safeProgress * t;
    const thicknessScale = 1 - (1 - minTailScale) * smoothT;
    const innerRadius = Math.min(outerRadius - 1, outerRadius - baseThickness * thicknessScale);
    const clampedInner = Math.min(outerRadius - 1, Math.max(maxInnerRadius, innerRadius));
    arcPointsOuter.push({
      x: originPixel.x + Math.cos(angle) * outerRadius,
      y: originPixel.y + Math.sin(angle) * outerRadius,
    });
    arcPointsInner.push({
      x: originPixel.x + Math.cos(angle) * clampedInner,
      y: originPixel.y + Math.sin(angle) * clampedInner,
    });
  }
  const gradient = ctx.createLinearGradient(
    arcPointsOuter[0].x,
    arcPointsOuter[0].y,
    arcPointsOuter[arcPointsOuter.length - 1].x,
    arcPointsOuter[arcPointsOuter.length - 1].y,
  );
  gradient.addColorStop(0, withAlpha(color, 1));
  gradient.addColorStop(0.65, withAlpha(color, safeAlpha));
  gradient.addColorStop(1, withAlpha(color, 1));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(arcPointsOuter[0].x, arcPointsOuter[0].y);
  for (let i = 1; i < arcPointsOuter.length; i += 1) {
    ctx.lineTo(arcPointsOuter[i].x, arcPointsOuter[i].y);
  }
  for (let i = arcPointsInner.length - 1; i >= 0; i -= 1) {
    ctx.lineTo(arcPointsInner[i].x, arcPointsInner[i].y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const getEdgeIndexForDirection = (size, directionIndex) => {
  const dir = AXIAL_DIRECTIONS[((directionIndex % 6) + 6) % 6] ?? AXIAL_DIRECTIONS[0];
  const dirPixel = axialToPixel(dir.q, dir.r, size);
  const length = Math.hypot(dirPixel.x, dirPixel.y) || 1;
  const dirUnit = { x: dirPixel.x / length, y: dirPixel.y / length };
  const corners = getHexCorners(0, 0, size);
  let bestIndex = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < 6; i += 1) {
    const start = corners[i];
    const end = corners[(i + 1) % 6];
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const midLength = Math.hypot(mid.x, mid.y) || 1;
    const midUnit = { x: mid.x / midLength, y: mid.y / midLength };
    const dot = midUnit.x * dirUnit.x + midUnit.y * dirUnit.y;
    if (dot > bestDot) {
      bestDot = dot;
      bestIndex = i;
    }
  }
  return bestIndex;
};

const drawBlockEdge = (ctx, coord, size, color, alpha, directionIndex, offset) => {
  if (!coord || directionIndex == null) return;
  const edgeIndex = getEdgeIndexForDirection(size, directionIndex);
  const { x, y } = axialToPixel(coord.q, coord.r, size);
  const corners = getHexCorners(x, y, size);
  const baseStart = corners[edgeIndex % 6];
  const baseEnd = corners[(edgeIndex + 1) % 6];
  const shake = offset
    ? { x: offset.x * size, y: offset.y * size }
    : { x: 0, y: 0 };
  const start = { x: baseStart.x + shake.x, y: baseStart.y + shake.y };
  const end = { x: baseEnd.x + shake.x, y: baseEnd.y + shake.y };
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, size * 0.2);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.restore();
};

const drawActionEffects = (ctx, effects, size, theme) => {
  if (!Array.isArray(effects) || !effects.length) return;
  const trails = [];
  const arcs = [];
  const blocks = [];

  effects.forEach((effect) => {
    if (effect.type === 'trail') {
      trails.push(effect);
      return;
    }
    if (effect.type === 'attackArc') {
      arcs.push(effect);
      return;
    }
    if (effect.type === 'block') {
      blocks.push(effect);
      return;
    }
  });

  trails.forEach((effect) => {
    const alpha = typeof effect.alpha === 'number' ? effect.alpha : 0.7;
    const trailType = effect.trailType || 'move';
    const trailColor =
      trailType === 'jump'
        ? theme.actionJump || theme.queueLavender
        : trailType === 'knockback'
          ? '#8b8f96'
          : trailType === 'hit'
            ? theme.actionAttack || theme.damage
            : theme.actionMove || theme.accent;
    const widthScale =
      trailType === 'hit' || trailType === 'knockback'
        ? 0.3
        : trailType === 'move'
          ? 0.44
          : 0.44;
    const taperToEnd = true;
    drawTrail(ctx, effect.path, size, trailColor, alpha, widthScale, taperToEnd);
  });

  arcs.forEach((effect) => {
    const alpha = typeof effect.alpha === 'number' ? effect.alpha : 0.85;
    drawAttackArc(
      ctx,
      effect.origin,
      effect.targets,
      size,
      theme.actionAttack || theme.damage,
      alpha,
      effect.progress ?? 1,
    );
  });

  blocks.forEach((effect) => {
    const alpha = typeof effect.alpha === 'number' ? effect.alpha : 0.9;
    drawBlockEdge(
      ctx,
      effect.coord,
      size,
      theme.actionBlock || theme.accentStrong,
      alpha,
      effect.directionIndex,
      effect.shakeOffset,
    );
  });
};

const drawInteractionHexHighlights = (ctx, size, overlayState) => {
  const hexes = Array.isArray(overlayState?.touchingHexes) ? overlayState.touchingHexes : [];
  if (!hexes.length) return;
  const hoverKey = overlayState?.hoveredHex ? coordKey(overlayState.hoveredHex) : null;
  const pulse = Number.isFinite(overlayState?.pulse) ? clamp(overlayState.pulse, 0, 1) : 0;
  hexes.forEach((coord) => {
    if (!coord) return;
    const { x, y } = axialToPixel(coord.q, coord.r, size);
    const isHovered = hoverKey != null && coordKey(coord) === hoverKey;
    const fillAlpha = isHovered ? 0.34 + pulse * 0.2 : 0.16 + pulse * 0.14;
    const strokeAlpha = 0.8;
    const glow = size * 0.52;
    ctx.save();
    ctx.globalAlpha = clamp(fillAlpha, 0, 1);
    ctx.fillStyle = isHovered ? '#ffbc4f' : '#ff8b2f';
    drawHexPath(ctx, x, y, size * (isHovered ? 1.03 : 1));
    ctx.fill();
    ctx.restore();
    if (!isHovered) return;
    ctx.save();
    ctx.shadowColor = 'rgba(255, 188, 79, 0.85)';
    ctx.shadowBlur = glow;
    ctx.strokeStyle = `rgba(255, 153, 51, ${strokeAlpha})`;
    ctx.lineWidth = Math.max(1.5, size * 0.12);
    drawHexPath(ctx, x, y, size * 1.04);
    ctx.stroke();
    ctx.restore();
  });
};

export const createRenderer = (canvas, config = GAME_CONFIG) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const theme = getTheme();
  const viewport = { width: 0, height: 0, dpr: window.devicePixelRatio || 1 };
  const characterArt = new Map();
  const tokenArt = new Map();

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

  const getTokenArt = (tokenType) => {
    if (!tokenType) return null;
    if (tokenArt.has(tokenType)) return tokenArt.get(tokenType);
    const src = TOKEN_IMAGE_SOURCES[tokenType];
    if (!src) return null;
    const image = new Image();
    image.src = src;
    tokenArt.set(tokenType, image);
    return image;
  };

  const resize = () => {
    viewport.width = canvas.clientWidth;
    viewport.height = canvas.clientHeight;
    viewport.dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(viewport.width * viewport.dpr));
    canvas.height = Math.max(1, Math.floor(viewport.height * viewport.dpr));
  };

  const clear = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (theme.background) {
      ctx.fillStyle = theme.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  };

  const draw = (viewState, gameState, timeIndicatorViewModel, scene, localUserId, pendingPreview, interactionOverlayState = null) => {
    if (!viewport.width || !viewport.height) return;
    const size = getHexSize(viewport.width, config.hexSizeFactor);
    const bounds = getWorldBounds(viewport, viewState);
    const land = gameState?.state?.public?.land?.length ? gameState.state.public.land : LAND_HEXES;
    const landInfoCache = new Map();

    clear();

    ctx.setTransform(
      viewport.dpr * viewState.scale,
      0,
      0,
      viewport.dpr * viewState.scale,
      viewState.offset.x * viewport.dpr,
      viewState.offset.y * viewport.dpr,
    );

    ctx.fillStyle = theme.abyssFill;
    ctx.strokeStyle = theme.abyssStroke;
    const baseAbyssLineWidth = Math.max(0.6, size * 0.06);
    const minAbyssLineWidth = Math.max(baseAbyssLineWidth * 0.2, 1 / (viewport.dpr * viewState.scale));
    ctx.lineCap = 'round';

    drawAbyssGrid({
      ctx,
      bounds,
      size,
      gridPadding: config.gridPadding,
      land,
      theme,
      baseLineWidth: baseAbyssLineWidth,
      minLineWidth: minAbyssLineWidth,
      landInfoCache,
      drawHexPath,
      getHexCorners,
      withAlpha,
    });

    if (!land.length) {
      drawTimeIndicator(ctx, viewport, theme, timeIndicatorViewModel, gameState, localUserId, pendingPreview);
      return;
    }

    ctx.fillStyle = theme.landFill;
    ctx.strokeStyle = theme.landStroke;
    ctx.lineWidth = Math.max(1.2, size * 0.08);
    land.forEach((tile) => {
      const { x, y } = axialToPixel(tile.q, tile.r, size);
      drawHex(ctx, x, y, size);
    });

    if (config.showLandCoords) {
      ctx.fillStyle = theme.landStroke;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.max(10, size * 0.35)}px ${theme.fontBody}`;
      land.forEach((tile) => {
        const { x, y } = axialToPixel(tile.q, tile.r, size);
        ctx.fillText(`${tile.q},${tile.r}`, x, y);
      });
    }

    const renderCharacters = scene?.characters ?? gameState?.state?.public?.characters ?? [];
    const effects = scene?.effects ?? [];
    const boardTokens = scene?.boardTokens ?? gameState?.state?.public?.boardTokens ?? [];
    const abyssLabels = buildAbyssPathLabels(renderCharacters, land);
    drawAbyssPathLabels(ctx, abyssLabels, size, theme);
    drawInteractionHexHighlights(ctx, size, interactionOverlayState);
    drawBoardTokens(ctx, boardTokens, size, theme, getTokenArt);
    drawActionEffects(ctx, effects, size, theme);

    if (renderCharacters.length) {
      const metrics = getCharacterTokenMetrics(size);
      const beats = gameState?.state?.public?.beats ?? [];
      const beatIndex = beats.length ? Math.min(timeIndicatorViewModel?.value ?? 0, beats.length - 1) : -1;
      const beatLookup = beatIndex >= 0 ? beats[beatIndex] : null;
      renderCharacters.forEach((character) => {
        const { x, y } = axialToPixel(character.position.q, character.position.r, size);
        const renderOffset = character.renderOffset ?? null;
        const offsetX = renderOffset ? renderOffset.x * size : 0;
        const offsetY = renderOffset ? renderOffset.y * size : 0;
        const drawX = x + offsetX;
        const drawY = y + offsetY;
        const image = getCharacterArt(character.characterId);
        const isLocalPlayer = localUserId && character.userId === localUserId;
        const ringColor = isLocalPlayer ? theme.playerAccent || '#7dcfff' : theme.accentStrong;
        const beatEntry = getBeatEntryForCharacter(beatLookup, character);
        const actionTag = normalizeActionTag(beatEntry?.action);
        const isKnockbackIcon = actionTag === 'knockbackicon' || actionTag === 'damageicon';

        drawCharacterPortrait(ctx, image, drawX, drawY, metrics.radius, theme.panelStrong, isKnockbackIcon);
        if (character.healFlashAlpha) {
          ctx.save();
          ctx.globalAlpha = clamp(character.healFlashAlpha, 0, 1);
          ctx.fillStyle = '#a6ddff';
          ctx.beginPath();
          ctx.arc(drawX, drawY, metrics.radius * 0.9, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        if (character.flashAlpha) {
          ctx.save();
          ctx.globalAlpha = clamp(character.flashAlpha, 0, 1);
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(drawX, drawY, metrics.radius * 0.9, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        drawCharacterRing(ctx, drawX, drawY, metrics.radius, metrics.borderWidth, ringColor);
        if (character.healPulseAlpha) {
          const pulseScale = typeof character.healPulseScale === 'number' ? character.healPulseScale : 1;
          const pulseRadius = metrics.radius * (1.05 + Math.max(0, pulseScale - 1) * 0.9);
          ctx.save();
          ctx.globalAlpha = clamp(character.healPulseAlpha, 0, 1);
          ctx.strokeStyle = '#7fc8ff';
          ctx.lineWidth = Math.max(2, metrics.borderWidth * 0.7);
          ctx.beginPath();
          ctx.arc(drawX, drawY, pulseRadius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        const arrowPoints = getFacingArrowPoints(drawX, drawY, metrics, character.facing);
        drawFacingArrow(ctx, arrowPoints, ringColor);

        const damage =
          typeof character.displayDamage === 'number'
            ? character.displayDamage
            : typeof character.damage === 'number'
              ? character.damage
              : beatEntry?.damage ?? 0;
        drawDamageCapsule(ctx, drawX, drawY, metrics.radius, damage, theme);
        drawNameCapsule(ctx, drawX, drawY, metrics.radius, character.username || character.userId, theme, {
          baseFontScale: 0.3,
          paddingXScale: 0.12,
          paddingYScale: 0.08,
          maxWidthScale: 1.9,
          minWidthScale: 1.05,
          borderScale: 0.08,
        });
      });
    }

    drawTimeIndicator(ctx, viewport, theme, timeIndicatorViewModel, gameState, localUserId, pendingPreview);
  };

  return { resize, draw, viewport };
};
