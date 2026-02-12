const fitTextToWidth = (ctx, label, fontSize, fontFamily, maxWidth) => {
  ctx.font = `600 ${fontSize}px ${fontFamily}`;
  const measuredWidth = ctx.measureText(label).width;
  if (!measuredWidth || measuredWidth <= maxWidth) {
    return { fontSize, textWidth: measuredWidth };
  }
  const scale = Math.min(1, maxWidth / measuredWidth);
  const nextSize = Math.max(7, fontSize * scale);
  ctx.font = `600 ${nextSize}px ${fontFamily}`;
  return { fontSize: nextSize, textWidth: ctx.measureText(label).width };
};

export const drawNameCapsule = (ctx, x, y, radius, username, theme, config = {}) => {
  if (!username) return null;
  const {
    baseFontScale = 0.44,
    paddingXScale = 0.14,
    paddingYScale = 0.12,
    maxWidthScale = 2.2,
    minWidthScale = 1.1,
    offsetYScale = 0.65,
    borderScale = 0.1,
    fillColor = theme.nameCapsuleFill || '#ffffff',
    borderColor = theme.accentStrong || '#f3c05b',
    textColor = theme.textDark || '#122118',
  } = config;

  const baseFontSize = Math.max(7, radius * baseFontScale);
  const paddingX = Math.max(3, radius * paddingXScale);
  const paddingY = Math.max(2, radius * paddingYScale);
  const maxWidth = radius * maxWidthScale;

  ctx.save();
  const { fontSize, textWidth } = fitTextToWidth(ctx, username, baseFontSize, theme.fontBody, maxWidth);
  const capsuleWidth = Math.max(textWidth + paddingX * 2, radius * minWidthScale);
  const capsuleHeight = fontSize + paddingY * 2;
  const centerX = x;
  const centerY = y + radius * offsetYScale;
  const capsuleX = centerX - capsuleWidth / 2;
  const capsuleY = centerY - capsuleHeight / 2;

  ctx.fillStyle = fillColor;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = Math.max(1, radius * borderScale);
  drawRoundedRect(ctx, capsuleX, capsuleY, capsuleWidth, capsuleHeight, capsuleHeight / 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(username, centerX, centerY + fontSize * 0.02);
  ctx.restore();
  return {
    x: capsuleX,
    y: capsuleY,
    width: capsuleWidth,
    height: capsuleHeight,
    centerX,
    centerY,
    textWidth,
    textLeft: centerX - textWidth / 2,
    textRight: centerX + textWidth / 2,
  };
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
