import { GAME_CONFIG } from './config.js';
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

export const createRenderer = (canvas, config = GAME_CONFIG) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const theme = getTheme();
  const viewport = { width: 0, height: 0, dpr: window.devicePixelRatio || 1 };

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

  const draw = (viewState, gameState) => {
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
    if (!land.length) return;

    ctx.fillStyle = theme.landFill;
    ctx.strokeStyle = theme.landStroke;
    ctx.lineWidth = Math.max(1.2, size * 0.08);
    land.forEach((tile) => {
      const { x, y } = axialToPixel(tile.q, tile.r, size);
      drawHex(ctx, x, y, size);
    });

    if (!config.showLandCoords) return;
    ctx.fillStyle = theme.landStroke;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.max(10, size * 0.35)}px ${theme.fontBody}`;
    land.forEach((tile) => {
      const { x, y } = axialToPixel(tile.q, tile.r, size);
      ctx.fillText(`${tile.q},${tile.r}`, x, y);
    });
  };

  return { resize, draw, viewport };
};
