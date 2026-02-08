import { AXIAL_DIRECTIONS, axialToPixel, getHexSize } from '../shared/hex.mjs';
import { getCharacterTokenMetrics } from './characterTokens.mjs';

export const HAVEN_PLATFORM_INTERACTION_TYPE = 'haven-platform';

const SQRT3 = Math.sqrt(3);

const toCoordKey = (coord) => `${coord?.q},${coord?.r}`;

export const normalizeHexCoord = (value) => {
  if (!value || typeof value !== 'object') return null;
  const q = Number(value.q);
  const r = Number(value.r);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  return { q: Math.round(q), r: Math.round(r) };
};

const buildTouchingHexes = (origin) => {
  const base = normalizeHexCoord(origin);
  if (!base) return [];
  const unique = new Map();
  const append = (coord) => {
    const normalized = normalizeHexCoord(coord);
    if (!normalized) return;
    unique.set(toCoordKey(normalized), normalized);
  };
  append(base);
  AXIAL_DIRECTIONS.forEach((direction) => {
    append({ q: base.q + direction.q, r: base.r + direction.r });
  });
  return Array.from(unique.values());
};

const roundAxialCoord = (fractional) => {
  const q = Number(fractional?.q);
  const r = Number(fractional?.r);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  const x = q;
  const z = r;
  const y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);
  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz;
  } else if (yDiff > zDiff) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }
  return { q: rx, r: rz };
};

const worldToAxial = (worldX, worldY, size) => {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldY) || !Number.isFinite(size) || size <= 0) return null;
  const q = (SQRT3 / 3 * worldX - (1 / 3) * worldY) / size;
  const r = ((2 / 3) * worldY) / size;
  return roundAxialCoord({ q, r });
};

const getWorldPointFromPointer = (event, canvas, viewState) => {
  if (!event || !canvas || !viewState) return null;
  const rect = canvas.getBoundingClientRect();
  const screenX = event.clientX - rect.left;
  const screenY = event.clientY - rect.top;
  return {
    screenX,
    screenY,
    worldX: (screenX - viewState.offset.x) / viewState.scale,
    worldY: (screenY - viewState.offset.y) / viewState.scale,
  };
};

const getCharacterByUserId = (characters, userId) => {
  if (!userId || !Array.isArray(characters)) return null;
  return characters.find((character) => character?.userId === userId) ?? null;
};

export const getPendingHavenInteraction = (pendingInteraction) =>
  pendingInteraction?.type === HAVEN_PLATFORM_INTERACTION_TYPE ? pendingInteraction : null;

export const getHavenTouchingHexes = (pending, sceneCharacters) => {
  if (!pending) return [];
  const fromInteraction = Array.isArray(pending.touchingHexes)
    ? pending.touchingHexes.map((coord) => normalizeHexCoord(coord)).filter(Boolean)
    : [];
  if (fromInteraction.length) {
    const unique = new Map();
    fromInteraction.forEach((coord) => unique.set(toCoordKey(coord), coord));
    return Array.from(unique.values());
  }
  const actor = Array.isArray(sceneCharacters)
    ? sceneCharacters.find(
        (character) => character?.userId === pending.actorUserId || character?.username === pending.actorUserId,
      )
    : null;
  return buildTouchingHexes(actor?.position);
};

export const buildHavenHighlightState = ({
  pending,
  sceneCharacters,
  interactionSubmitInFlight,
  hoverKey,
  now,
}) => {
  if (!pending || interactionSubmitInFlight) return null;
  const touchingHexes = getHavenTouchingHexes(pending, sceneCharacters);
  if (!touchingHexes.length) return null;
  const hoveredHex = touchingHexes.find((coord) => toCoordKey(coord) === hoverKey) ?? null;
  return {
    touchingHexes,
    hoveredHex,
    pulse: (Math.sin(now / 360) + 1) / 2,
  };
};

export const resolveHavenTargetFromPointer = ({
  event,
  pending,
  sceneCharacters,
  localUserId,
  canvas,
  viewState,
  viewportWidth,
  hexSizeFactor,
}) => {
  const touchingHexes = getHavenTouchingHexes(pending, sceneCharacters);
  if (!touchingHexes.length) return null;
  const touchingByKey = new Map(touchingHexes.map((coord) => [toCoordKey(coord), coord]));
  const point = getWorldPointFromPointer(event, canvas, viewState);
  if (!point) return null;
  const size = getHexSize(viewportWidth || canvas?.clientWidth || 1, hexSizeFactor);

  const localCharacter = getCharacterByUserId(sceneCharacters, localUserId);
  if (localCharacter?.position) {
    const selfKey = toCoordKey(localCharacter.position);
    if (touchingByKey.has(selfKey)) {
      const metrics = getCharacterTokenMetrics(size);
      const selfCenter = axialToPixel(localCharacter.position.q, localCharacter.position.r, size);
      const screenSelfX = viewState.offset.x + selfCenter.x * viewState.scale;
      const screenSelfY = viewState.offset.y + selfCenter.y * viewState.scale;
      const dx = point.screenX - screenSelfX;
      const dy = point.screenY - screenSelfY;
      const radius = metrics.radius * viewState.scale;
      if (dx * dx + dy * dy <= radius * radius) {
        return touchingByKey.get(selfKey) ?? null;
      }
    }
  }

  const nearest = worldToAxial(point.worldX, point.worldY, size);
  if (!nearest) return null;
  return touchingByKey.get(toCoordKey(nearest)) ?? null;
};

export const getHavenHoverKeyFromPointer = (options) => {
  const targetHex = resolveHavenTargetFromPointer(options);
  return targetHex ? toCoordKey(targetHex) : null;
};
