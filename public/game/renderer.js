import { GAME_CONFIG } from './config.js';
import { drawTimeIndicator } from './timeIndicatorView.js';
import { CHARACTER_IMAGE_SOURCES, getCharacterTokenMetrics, getFacingArrowPoints } from './characterTokens.mjs';
import { LAND_HEXES, axialToPixel, getColumnRange, getHexSize, getRowRange, getWorldBounds } from '../shared/hex.mjs';

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
    queueLavender: css.getPropertyValue('--color-queue-lavender').trim(),
    damage: css.getPropertyValue('--color-damage').trim(),
    damageText: css.getPropertyValue('--color-damage-text').trim(),
    actionAttack: css.getPropertyValue('--color-action-attack').trim(),
    actionMove: css.getPropertyValue('--color-action-move').trim(),
    actionJump: css.getPropertyValue('--color-action-jump').trim(),
    actionBlock: css.getPropertyValue('--color-action-block').trim(),
  };
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
  const centerX = x + radius * 0.45;
  const centerY = y + radius * 0.45;
  const capsuleX = centerX - capsuleWidth / 2;
  const capsuleY = centerY - capsuleHeight / 2;

  ctx.beginPath();
  ctx.arc(x, y, radius - 1, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = theme.damage || '#d04840';
  drawRoundedRect(ctx, capsuleX, capsuleY, capsuleWidth, capsuleHeight, capsuleHeight / 2);
  ctx.fill();

  ctx.fillStyle = theme.damageText || '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, centerX, centerY + fontSize * 0.02);
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

const AXIAL_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

const getHexCorners = (x, y, size) => {
  const points = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    points.push({ x: x + size * Math.cos(angle), y: y + size * Math.sin(angle) });
  }
  return points;
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

const drawBlockEdge = (ctx, coord, size, color, alpha, directionIndex) => {
  if (!coord || directionIndex == null) return;
  const edgeIndex = getEdgeIndexForDirection(size, directionIndex);
  const { x, y } = axialToPixel(coord.q, coord.r, size);
  const corners = getHexCorners(x, y, size);
  const start = corners[edgeIndex % 6];
  const end = corners[(edgeIndex + 1) % 6];
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
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
  effects.forEach((effect) => {
    const alpha = typeof effect.alpha === 'number' ? effect.alpha : 0.8;
    if (effect.type === 'attack') {
      drawHexEffect(ctx, effect.coord, size, theme.actionAttack || theme.damage, alpha);
    }
    if (effect.type === 'move') {
      drawHexEffect(ctx, effect.coord, size, theme.actionMove || theme.accent, alpha);
    }
    if (effect.type === 'jump') {
      drawHexEffect(ctx, effect.coord, size, theme.actionJump || theme.queueLavender, alpha);
    }
    if (effect.type === 'charge') {
      drawHexEffect(ctx, effect.coord, size, theme.actionAttack || theme.damage, alpha);
      drawHexEffect(ctx, effect.coord, size, theme.actionMove || theme.accent, alpha, 0.45);
    }
    if (effect.type === 'block') {
      drawBlockEdge(ctx, effect.coord, size, theme.actionBlock || theme.accentStrong, alpha, effect.directionIndex);
    }
  });
};

export const createRenderer = (canvas, config = GAME_CONFIG) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const theme = getTheme();
  const viewport = { width: 0, height: 0, dpr: window.devicePixelRatio || 1 };
  const characterArt = new Map();

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

  const draw = (viewState, gameState, timeIndicatorViewModel, scene) => {
    if (!viewport.width || !viewport.height) return;
    const size = getHexSize(viewport.width, config.hexSizeFactor);
    const bounds = getWorldBounds(viewport, viewState);
    const { rMin, rMax } = getRowRange(bounds, size, config.gridPadding);

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
    ctx.lineWidth = Math.max(0.6, size * 0.06);

    for (let r = rMin; r <= rMax; r += 1) {
      const { qMin, qMax } = getColumnRange(bounds, size, config.gridPadding, r);
      for (let q = qMin; q <= qMax; q += 1) {
        const { x, y } = axialToPixel(q, r, size);
        drawHex(ctx, x, y, size);
      }
    }

    const land = gameState?.state?.public?.land?.length ? gameState.state.public.land : LAND_HEXES;
    if (!land.length) {
      drawTimeIndicator(ctx, viewport, theme, timeIndicatorViewModel, gameState);
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
    drawActionEffects(ctx, effects, size, theme);

    if (renderCharacters.length) {
      const metrics = getCharacterTokenMetrics(size);
      const beats = gameState?.state?.public?.beats ?? [];
      const beatIndex = beats.length ? Math.min(timeIndicatorViewModel?.value ?? 0, beats.length - 1) : -1;
      const beatLookup = beatIndex >= 0 ? beats[beatIndex] : null;
      renderCharacters.forEach((character) => {
        const { x, y } = axialToPixel(character.position.q, character.position.r, size);
        const image = getCharacterArt(character.characterId);

        drawCharacterPortrait(ctx, image, x, y, metrics.radius, theme.panelStrong);
        drawCharacterRing(ctx, x, y, metrics.radius, metrics.borderWidth, theme.accentStrong);

        const arrowPoints = getFacingArrowPoints(x, y, metrics, character.facing);
        drawFacingArrow(ctx, arrowPoints, theme.accentStrong);

        const damage =
          typeof character.damage === 'number'
            ? character.damage
            : Array.isArray(beatLookup)
              ? beatLookup.find((item) => item?.username === character.username || item?.username === character.userId)?.damage ?? 0
              : 0;
        drawDamageCapsule(ctx, x, y, metrics.radius, damage, theme);
      });
    }

    drawTimeIndicator(ctx, viewport, theme, timeIndicatorViewModel, gameState);
  };

  return { resize, draw, viewport };
};
