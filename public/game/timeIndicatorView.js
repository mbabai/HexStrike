const DEFAULT_BORDER_SIZE = { width: 280, height: 64 };

export const getTimeIndicatorLayout = (viewport) => {
  const padding = viewport.width < 520 ? 8 : 12;
  const maxWidth = Math.max(180, viewport.width - padding * 4);
  const borderWidth = DEFAULT_BORDER_SIZE.width;
  const borderHeight = DEFAULT_BORDER_SIZE.height;
  const scale = Math.min(1, maxWidth / borderWidth) * 0.75;
  const width = borderWidth * scale;
  const height = borderHeight * scale;
  const x = (viewport.width - width) / 2;
  const y = padding;
  const arrowWidth = Math.max(24, height * 0.4);
  const innerPadding = Math.max(8, height * 0.16);
  const numberArea = {
    x: x + arrowWidth,
    y: y + innerPadding * 0.5,
    width: width - arrowWidth * 2,
    height: height - innerPadding,
  };
  const leftArrow = { x, y, width: arrowWidth, height };
  const rightArrow = {
    x: x + width - arrowWidth,
    y,
    width: arrowWidth,
    height,
  };

  return { x, y, width, height, leftArrow, rightArrow, numberArea };
};

export const getTimeIndicatorHit = (layout, x, y) => {
  if (!layout) return null;
  if (isPointInRect(x, y, layout.leftArrow)) return 'left';
  if (isPointInRect(x, y, layout.rightArrow)) return 'right';
  return null;
};

export const drawTimeIndicator = (ctx, viewport, theme, viewModel) => {
  const layout = getTimeIndicatorLayout(viewport);
  if (!layout) return;

  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);

  const { x, y, width, height, leftArrow, rightArrow, numberArea } = layout;
  const value = viewModel?.value ?? 0;
  const leftDisabled = viewModel?.canStep ? !viewModel.canStep(-1) : value === 0;

  const numberPadding = Math.max(4, numberArea.height * 0.18);
  const numberBg = {
    x: numberArea.x + numberPadding * 0.2,
    y: numberArea.y + numberPadding * 0.35,
    width: numberArea.width - numberPadding * 0.4,
    height: numberArea.height - numberPadding * 0.7,
  };
  ctx.fillStyle = '#000000';
  drawRoundedRect(ctx, numberBg.x, numberBg.y, numberBg.width, numberBg.height, Math.min(10, numberBg.height * 0.35));
  ctx.fill();

  const fontSize = Math.max(12, numberArea.height * 0.47);
  ctx.font = `${fontSize}px ${theme.fontBody}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const centerX = numberArea.x + numberArea.width / 2;
  const centerY = numberArea.y + numberArea.height / 2;
  const spacing = Math.max(26, numberArea.height * 0.72);
  const offsets = [-2, -1, 0, 1, 2];

  offsets.forEach((offset) => {
    const target = value + offset;
    if (target < 0) return;
    const xPos = centerX + offset * spacing;
    const alpha = offset === 0 ? 1 : 0.28 + Math.max(0, 0.4 - Math.abs(offset) * 0.08);
    ctx.fillStyle = offset === 0 ? theme.accentStrong : theme.subtle;
    ctx.globalAlpha = alpha;
    ctx.fillText(`${target}`.padStart(2, '0'), xPos, centerY);
  });

  ctx.globalAlpha = 1;
  if (leftDisabled) {
    ctx.strokeStyle = theme.subtle;
    ctx.lineWidth = Math.max(1, height * 0.04);
    ctx.beginPath();
    ctx.moveTo(numberArea.x + 2, numberArea.y + numberArea.height * 0.2);
    ctx.lineTo(numberArea.x + 2, numberArea.y + numberArea.height * 0.8);
    ctx.stroke();
  }

  const arrowColor = theme.accentStrong || '#d5a34a';
  drawArrow(ctx, leftArrow, 'left', arrowColor, leftDisabled ? 0.35 : 0.95);
  drawArrow(ctx, rightArrow, 'right', arrowColor, 0.95);
};

const isPointInRect = (x, y, rect) =>
  x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

const drawArrow = (ctx, rect, direction, color, alpha) => {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const size = Math.min(rect.width, rect.height) * 0.25;
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
