import { AXIAL_DIRECTIONS, axialToPixel, getColumnRange, getRowRange } from '../shared/hex.mjs';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const ABYSS_BORDER_MAX_DISTANCE = 6;

const axialToCube = (coord) => ({ x: coord.q, z: coord.r, y: -coord.q - coord.r });

const cubeToAxial = (cube) => ({ q: cube.x, r: cube.z });

const cubeLerp = (a, b, t) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

const cubeRound = (cube) => {
  let rx = Math.round(cube.x);
  let ry = Math.round(cube.y);
  let rz = Math.round(cube.z);
  const xDiff = Math.abs(rx - cube.x);
  const yDiff = Math.abs(ry - cube.y);
  const zDiff = Math.abs(rz - cube.z);

  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz;
  } else if (yDiff > zDiff) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  return { x: rx, y: ry, z: rz };
};

const hexDistance = (a, b) => {
  const ac = axialToCube(a);
  const bc = axialToCube(b);
  return Math.max(Math.abs(ac.x - bc.x), Math.abs(ac.y - bc.y), Math.abs(ac.z - bc.z));
};

const getHexLine = (start, end) => {
  const distance = hexDistance(start, end);
  const a = axialToCube(start);
  const b = axialToCube(end);
  const results = [];
  if (!distance) return [start];
  for (let i = 0; i <= distance; i += 1) {
    const t = i / distance;
    results.push(cubeToAxial(cubeRound(cubeLerp(a, b, t))));
  }
  return results;
};

const getNearestLand = (location, land) => {
  if (!location || !Array.isArray(land) || !land.length) return null;
  let best = null;
  let bestDistance = Infinity;
  land.forEach((tile) => {
    const distance = hexDistance(location, tile);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = tile;
    }
  });
  return best ? { tile: best, distance: bestDistance } : null;
};

const getLandInfo = (location, land, cache) => {
  if (!location) return { distance: Infinity, nearest: null };
  const key = `${location.q},${location.r}`;
  if (cache?.has(key)) return cache.get(key);
  const nearest = getNearestLand(location, land);
  const info = {
    distance: nearest?.distance ?? Infinity,
    nearest: nearest?.tile ?? null,
  };
  if (cache) {
    cache.set(key, info);
  }
  return info;
};

const isTopBottomBoundary = (coord, landInfo) => {
  const nearest = landInfo?.nearest;
  if (!coord || !nearest) return false;
  const delta = axialToCube({ q: coord.q - nearest.q, r: coord.r - nearest.r });
  const absX = Math.abs(delta.x);
  const absY = Math.abs(delta.y);
  const absZ = Math.abs(delta.z);
  return absZ >= absX && absZ >= absY;
};

export const getAbyssBorderMetrics = (distance, baseWidth, minWidth) => {
  if (!Number.isFinite(distance)) return { width: baseWidth, alpha: 1 };
  const scale = clamp(1 - distance / ABYSS_BORDER_MAX_DISTANCE, 0, 1);
  const smooth = scale * scale * (3 - 2 * scale);
  const visibility = Math.pow(smooth, 0.6);
  const fallbackMin = baseWidth * 0.12;
  const safeMin = Number.isFinite(minWidth) ? Math.max(minWidth, fallbackMin) : fallbackMin;
  const width = Math.max(safeMin, baseWidth * smooth);
  return { width, alpha: visibility };
};

export const buildAbyssPathLabels = (characters, land) => {
  const labels = new Map();
  if (!Array.isArray(characters) || !characters.length) return labels;
  if (!Array.isArray(land) || !land.length) return labels;
  characters.forEach((character) => {
    const position = character?.position;
    if (!position) return;
    const nearest = getNearestLand(position, land);
    if (!nearest || nearest.distance <= 1) return;
    const path = getHexLine(nearest.tile, position);
    for (let i = 1; i < path.length; i += 1) {
      const coord = path[i];
      const key = `${coord.q},${coord.r}`;
      if (!labels.has(key) || labels.get(key) > i) {
        labels.set(key, i);
      }
    }
  });
  return labels;
};

export const drawAbyssPathLabels = (ctx, labels, size, theme) => {
  if (!labels || labels.size === 0) return;
  const fontSize = Math.max(14, size * 0.9);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${fontSize}px ${theme.fontBody}`;
  labels.forEach((value, key) => {
    const [q, r] = key.split(',').map(Number);
    const { x, y } = axialToPixel(q, r, size);
    ctx.fillText(`${value}`, x, y);
  });
  ctx.restore();
};

export const drawAbyssGrid = ({
  ctx,
  bounds,
  size,
  gridPadding,
  land,
  theme,
  baseLineWidth,
  minLineWidth,
  landInfoCache,
  drawHexPath,
  getHexCorners,
  withAlpha,
}) => {
  const { rMin, rMax } = getRowRange(bounds, size, gridPadding);

  for (let r = rMin; r <= rMax; r += 1) {
    const { qMin, qMax } = getColumnRange(bounds, size, gridPadding, r);
    for (let q = qMin; q <= qMax; q += 1) {
      const { x, y } = axialToPixel(q, r, size);
      drawHexPath(ctx, x, y, size);
      ctx.fill();
      if (!land.length) {
        ctx.lineWidth = baseLineWidth;
        ctx.stroke();
        continue;
      }
      const corners = getHexCorners(x, y, size);
      const coord = { q, r };
      const hereInfo = getLandInfo(coord, land, landInfoCache);
      const distanceHere = hereInfo.distance;
      const isTopBottomSide = isTopBottomBoundary(coord, hereInfo);
      for (let i = 0; i < 6; i += 1) {
        const start = corners[i];
        const end = corners[(i + 1) % 6];
        const neighbor = {
          q: q + AXIAL_DIRECTIONS[i].q,
          r: r + AXIAL_DIRECTIONS[i].r,
        };
        const neighborInfo = getLandInfo(neighbor, land, landInfoCache);
        const distanceNeighbor = neighborInfo.distance;
        const distanceMin = Math.min(distanceHere, distanceNeighbor);
        const distanceMax = Math.max(distanceHere, distanceNeighbor);
        const isVerticalEdge = i === 0 || i === 3;
        const isOuterBoundary =
          distanceMax >= ABYSS_BORDER_MAX_DISTANCE && distanceMin < ABYSS_BORDER_MAX_DISTANCE;
        // Fade outer boundary slants only on the top/bottom so sides keep full hexes.
        const suppressSlants = isOuterBoundary && !isVerticalEdge && isTopBottomSide;
        const edgeDistance = suppressSlants ? distanceMax : distanceMin;
        let edgeMetrics = getAbyssBorderMetrics(edgeDistance, baseLineWidth, minLineWidth);
        if (
          isVerticalEdge &&
          distanceMin < ABYSS_BORDER_MAX_DISTANCE &&
          distanceMax >= ABYSS_BORDER_MAX_DISTANCE
        ) {
          const minAlpha = clamp(minLineWidth / baseLineWidth, 0.08, 0.25);
          if (edgeMetrics.alpha < minAlpha) {
            edgeMetrics = { ...edgeMetrics, alpha: minAlpha };
          }
        }
        if (edgeMetrics.alpha <= 0.001) continue;
        ctx.lineWidth = edgeMetrics.width;
        ctx.strokeStyle = withAlpha(theme.abyssStroke, edgeMetrics.alpha);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
    }
  }
};
