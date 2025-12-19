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
    subtle: css.getPropertyValue('--color-subtle').trim(),
    accent: css.getPropertyValue('--color-accent').trim(),
    accentStrong: css.getPropertyValue('--color-accent-strong').trim(),
    queueLavender: css.getPropertyValue('--color-queue-lavender').trim(),
    damage: css.getPropertyValue('--color-damage').trim(),
    damageText: css.getPropertyValue('--color-damage-text').trim(),
  };
};

const drawHex = (ctx, x, y, size) => {
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

  const draw = (viewState, gameState, timeIndicatorViewModel) => {
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

    const characters = gameState?.state?.public?.characters ?? [];
    if (characters.length) {
      const metrics = getCharacterTokenMetrics(size);
      const beats = gameState?.state?.public?.beats ?? [];
      const beatIndex = beats.length ? Math.min(timeIndicatorViewModel?.value ?? 0, beats.length - 1) : -1;
      const beatLookup = beatIndex >= 0 ? beats[beatIndex] : null;
      characters.forEach((character) => {
        const { x, y } = axialToPixel(character.position.q, character.position.r, size);
        const image = getCharacterArt(character.characterId);

        drawCharacterPortrait(ctx, image, x, y, metrics.radius, theme.panelStrong);
        drawCharacterRing(ctx, x, y, metrics.radius, metrics.borderWidth, theme.accentStrong);

        const arrowPoints = getFacingArrowPoints(x, y, metrics, character.facing);
        drawFacingArrow(ctx, arrowPoints, theme.accentStrong);

        if (Array.isArray(beatLookup)) {
          const lookupKey = character.username ?? character.userId;
          const entry = beatLookup.find((item) => item?.username === lookupKey || item?.username === character.userId);
          const damage = typeof entry?.damage === 'number' ? entry.damage : 0;
          drawDamageCapsule(ctx, x, y, metrics.radius, damage, theme);
        }
      });
    }

    drawTimeIndicator(ctx, viewport, theme, timeIndicatorViewModel, gameState);
  };

  return { resize, draw, viewport };
};
