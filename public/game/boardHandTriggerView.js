import { axialToPixel } from '../shared/hex.mjs';
import { getCharacterTokenMetrics } from './characterTokens.mjs';

const HAND_TRIGGER_TYPE = 'hand-trigger';
const BOARD_TRIGGER_CARD_ASPECT = 0.72;
const BOARD_TRIGGER_CARD_HEIGHT_FACTOR = 1.08;
const BOARD_TRIGGER_STACK_OFFSET_FACTOR = 0.26;
const BOARD_TRIGGER_ANCHOR_X_FACTOR = 1.08;
const BOARD_TRIGGER_ANCHOR_Y_FACTOR = -0.2;

const isFiniteNumber = (value) => Number.isFinite(value);

const getInteractionBeatIndex = (interaction) => {
  const beatIndex = Number(interaction?.beatIndex);
  if (!isFiniteNumber(beatIndex)) return null;
  return Math.max(0, Math.round(beatIndex));
};

export const getHandTriggerInteractionCardId = (interaction) =>
  `${interaction?.cardId ?? interaction?.abilityCardId ?? interaction?.movementCardId ?? ''}`.trim();

export const shouldRenderHandTriggerInteraction = (interaction) => {
  if (!interaction || interaction.type !== HAND_TRIGGER_TYPE) return false;
  if (interaction.status !== 'resolved') return false;
  const use = interaction?.resolution?.use;
  if (typeof use === 'boolean') return use;
  const ignite = interaction?.resolution?.ignite;
  if (typeof ignite === 'boolean') return ignite;
  return false;
};

const getCharacterKeys = (character) => {
  const keys = new Set();
  const userId = `${character?.userId ?? ''}`.trim();
  const username = `${character?.username ?? ''}`.trim();
  if (userId) keys.add(userId);
  if (username) keys.add(username);
  return keys;
};

const getCharacterWorldPosition = (character, size) => {
  if (!character?.position || !isFiniteNumber(size) || size <= 0) return null;
  const base = axialToPixel(character.position.q, character.position.r, size);
  const renderOffset = character.renderOffset ?? null;
  return {
    x: base.x + (renderOffset ? renderOffset.x * size : 0),
    y: base.y + (renderOffset ? renderOffset.y * size : 0),
  };
};

const isPointInRect = (x, y, rect) =>
  Boolean(
    rect &&
      isFiniteNumber(x) &&
      isFiniteNumber(y) &&
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height,
  );

const toScreenRect = (bounds, viewState) => {
  if (!bounds || !viewState) return null;
  const scale = Number(viewState.scale);
  if (!isFiniteNumber(scale) || scale <= 0) return null;
  return {
    x: Number(viewState.offset?.x ?? 0) + bounds.x * scale,
    y: Number(viewState.offset?.y ?? 0) + bounds.y * scale,
    width: bounds.width * scale,
    height: bounds.height * scale,
  };
};

const buildBoardHandTriggerCardLayout = ({ centerX, centerY, tokenRadius, slotIndex, slotCount }) => {
  if (!isFiniteNumber(centerX) || !isFiniteNumber(centerY) || !isFiniteNumber(tokenRadius) || tokenRadius <= 0) {
    return null;
  }
  const count = Number.isFinite(slotCount) ? Math.max(1, Math.floor(slotCount)) : 1;
  const index = Number.isFinite(slotIndex) ? Math.max(0, Math.floor(slotIndex)) : 0;
  const cardHeight = Math.max(14, tokenRadius * BOARD_TRIGGER_CARD_HEIGHT_FACTOR);
  const cardWidth = Math.max(10, cardHeight * BOARD_TRIGGER_CARD_ASPECT);
  const stackOffset = cardHeight * BOARD_TRIGGER_STACK_OFFSET_FACTOR;
  const stackCenterOffset = index - (count - 1) / 2;
  const anchorX = centerX + tokenRadius * BOARD_TRIGGER_ANCHOR_X_FACTOR + cardWidth * 0.5;
  const anchorY = centerY + tokenRadius * BOARD_TRIGGER_ANCHOR_Y_FACTOR;
  const layoutCenterY = anchorY + stackCenterOffset * stackOffset;
  return {
    centerX: anchorX,
    centerY: layoutCenterY,
    width: cardWidth,
    height: cardHeight,
    bounds: {
      x: anchorX - cardWidth / 2,
      y: layoutCenterY - cardHeight / 2,
      width: cardWidth,
      height: cardHeight,
    },
  };
};

const getCharacterInteractionsForBeat = (interactions, characterKeys, beatIndex) =>
  interactions.filter((interaction) => {
    if (!shouldRenderHandTriggerInteraction(interaction)) return false;
    const interactionBeat = getInteractionBeatIndex(interaction);
    if (interactionBeat == null || interactionBeat !== beatIndex) return false;
    const actorId = `${interaction?.actorUserId ?? ''}`.trim();
    if (!actorId) return false;
    return characterKeys.has(actorId);
  });

export const buildBoardHandTriggerEntries = ({ sceneCharacters, interactions, beatIndex, size }) => {
  if (!Array.isArray(sceneCharacters) || !sceneCharacters.length) return [];
  if (!Array.isArray(interactions) || !interactions.length) return [];
  if (!isFiniteNumber(size) || size <= 0) return [];
  const safeBeatIndex = Number(beatIndex);
  if (!isFiniteNumber(safeBeatIndex)) return [];
  const roundedBeatIndex = Math.max(0, Math.round(safeBeatIndex));
  const tokenMetrics = getCharacterTokenMetrics(size);
  const entries = [];
  sceneCharacters.forEach((character) => {
    const world = getCharacterWorldPosition(character, size);
    if (!world) return;
    const characterKeys = getCharacterKeys(character);
    if (!characterKeys.size) return;
    const actorInteractions = getCharacterInteractionsForBeat(interactions, characterKeys, roundedBeatIndex);
    if (!actorInteractions.length) return;
    actorInteractions.forEach((interaction, slotIndex) => {
      const layout = buildBoardHandTriggerCardLayout({
        centerX: world.x,
        centerY: world.y,
        tokenRadius: tokenMetrics.radius,
        slotIndex,
        slotCount: actorInteractions.length,
      });
      if (!layout) return;
      entries.push({
        beatIndex: roundedBeatIndex,
        character,
        interaction,
        cardId: getHandTriggerInteractionCardId(interaction),
        cardType: interaction?.cardType ?? null,
        slotIndex,
        slotCount: actorInteractions.length,
        centerX: layout.centerX,
        centerY: layout.centerY,
        width: layout.width,
        height: layout.height,
        bounds: layout.bounds,
      });
    });
  });
  return entries;
};

export const buildBoardHandTriggerRevealKey = (entry) => {
  const actorId =
    `${entry?.character?.userId ?? entry?.character?.username ?? entry?.interaction?.actorUserId ?? ''}`.trim() ||
    'unknown';
  const interactionId = `${entry?.interaction?.id ?? ''}`.trim();
  if (interactionId) return `board-hand-trigger:${actorId}:${interactionId}`;
  const beatIndex = Number.isFinite(entry?.beatIndex) ? Math.round(entry.beatIndex) : 0;
  const cardId = `${entry?.cardId ?? ''}`.trim();
  const slotIndex = Number.isFinite(entry?.slotIndex) ? Math.round(entry.slotIndex) : 0;
  return `board-hand-trigger:${actorId}:${beatIndex}:${cardId}:${slotIndex}`;
};

export const getBoardHandTriggerTarget = ({ entries, pointer, viewState }) => {
  if (!Array.isArray(entries) || !entries.length || !pointer || !viewState) return null;
  const x = Number(pointer.x);
  const y = Number(pointer.y);
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    const screenBounds = toScreenRect(entry?.bounds, viewState);
    if (!screenBounds || !isPointInRect(x, y, screenBounds)) continue;
    const revealKey = buildBoardHandTriggerRevealKey(entry);
    return {
      kind: 'board-hand-trigger',
      beatIndex: entry.beatIndex,
      character: entry.character,
      interaction: entry.interaction,
      cardId: entry.cardId,
      cardType: entry.cardType,
      revealKey,
      center: {
        x: Number(viewState.offset?.x ?? 0) + entry.centerX * Number(viewState.scale),
        y: Number(viewState.offset?.y ?? 0) + entry.centerY * Number(viewState.scale),
      },
      size: Math.max(screenBounds.width, screenBounds.height),
    };
  }
  return null;
};
