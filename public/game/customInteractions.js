import { AXIAL_DIRECTIONS, axialToPixel, getHexSize } from '../shared/hex.mjs';
import { GAME_CONFIG } from './config.js';
import { getBeatEntryForCharacter } from './beatTimeline.js';

const clampNumber = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

const getPendingInteraction = (interactions, userId, beatIndex) => {
  if (!Array.isArray(interactions)) return null;
  return (
    interactions.find(
      (interaction) =>
        interaction &&
        interaction.status === 'pending' &&
        interaction.actorUserId === userId &&
        Number(interaction.beatIndex) === beatIndex,
    ) || null
  );
};

const resolveTargetLocation = (interaction, beats, characters) => {
  if (!interaction) return null;
  const target = characters.find(
    (character) =>
      character.userId === interaction.targetUserId || character.username === interaction.targetUserId,
  );
  if (!target) return null;
  const beat = beats?.[interaction.beatIndex] ?? [];
  const entry = getBeatEntryForCharacter(beat, target);
  return entry?.location ?? target.position ?? null;
};

export const createCustomInteractionController = ({
  gameArea,
  canvas,
  viewState,
  config = GAME_CONFIG,
  onResolve,
} = {}) => {
  const overlay = gameArea?.querySelector?.('#interactionOverlay') || document.getElementById('interactionOverlay');
  const modal = overlay?.querySelector?.('#throwModal') || null;
  const arrows = modal ? Array.from(modal.querySelectorAll('.throw-arrow')) : [];

  if (!overlay || !modal || !canvas || !gameArea || !viewState) {
    return {
      update: () => {},
      hide: () => {},
    };
  }

  let activeInteractionId = null;
  let blockedInteractionId = null;

  const hide = () => {
    overlay.hidden = true;
    activeInteractionId = null;
  };

  const show = () => {
    overlay.hidden = false;
  };

  const updateArrowLayout = (size, scale) => {
    const offsetScale = 0.7;
    arrows.forEach((arrow) => {
      const index = Number(arrow.dataset.dir);
      const direction = AXIAL_DIRECTIONS[index];
      if (!direction) return;
      const delta = axialToPixel(direction.q, direction.r, size);
      const offsetX = delta.x * scale * offsetScale;
      const offsetY = delta.y * scale * offsetScale;
      const angle = (Math.atan2(offsetY, offsetX) * 180) / Math.PI + 90;
      arrow.style.setProperty('--offset-x', `${offsetX}px`);
      arrow.style.setProperty('--offset-y', `${offsetY}px`);
      arrow.style.setProperty('--angle', `${angle}deg`);
    });
  };

  const updateModalPosition = (location) => {
    if (!location) return;
    const viewportWidth = canvas.clientWidth || gameArea.clientWidth || 0;
    const size = getHexSize(viewportWidth, config.hexSizeFactor);
    if (!Number.isFinite(size) || size <= 0) return;
    const { x, y } = axialToPixel(location.q, location.r, size);
    const scale = clampNumber(viewState.scale, 1);
    const offsetX = clampNumber(viewState.offset?.x, 0);
    const offsetY = clampNumber(viewState.offset?.y, 0);
    const canvasRect = canvas.getBoundingClientRect();
    const areaRect = gameArea.getBoundingClientRect();
    const localOffsetX = canvasRect.left - areaRect.left;
    const localOffsetY = canvasRect.top - areaRect.top;
    const anchorX = x * scale + offsetX + localOffsetX;
    const anchorY = y * scale + offsetY + localOffsetY;
    modal.style.left = `${anchorX}px`;
    modal.style.top = `${anchorY}px`;
    const baseSize = Math.max(24, size * scale * 0.32);
    modal.style.setProperty('--throw-width', `${baseSize * 2}px`);
    modal.style.setProperty('--throw-height', `${baseSize * 3}px`);
    modal.style.setProperty('--throw-center-size', `${Math.max(12, size * scale * 0.22)}px`);
    updateArrowLayout(size, scale);
  };

  arrows.forEach((arrow) => {
    arrow.addEventListener('click', () => {
      if (!activeInteractionId) return;
      const directionIndex = Number(arrow.dataset.dir);
      if (!Number.isFinite(directionIndex)) return;
      const interactionId = activeInteractionId;
      console.log('[interaction:throw] selection', {
        interactionId,
        directionIndex,
      });
      blockedInteractionId = interactionId;
      hide();
      if (onResolve) {
        const result = onResolve(interactionId, directionIndex);
        if (result === false) {
          blockedInteractionId = null;
          return;
        }
        if (result && typeof result.then === 'function') {
          result.catch(() => {
            blockedInteractionId = null;
          });
          result.then((ok) => {
            if (ok === false) {
              blockedInteractionId = null;
            }
          });
        }
      }
    });
  });

  const clearBlockedIfResolved = (interactions) => {
    if (!blockedInteractionId) return;
    const stillPending = interactions.some(
      (interaction) =>
        interaction &&
        interaction.id === blockedInteractionId &&
        interaction.status === 'pending',
    );
    if (!stillPending) {
      blockedInteractionId = null;
    }
  };

  const update = ({ gameState, beatIndex, localUserId }) => {
    const interactions = gameState?.state?.public?.customInteractions ?? [];
    clearBlockedIfResolved(interactions);
    const pendingInteraction = getPendingInteraction(interactions, localUserId, beatIndex);
    if (!pendingInteraction || pendingInteraction.type !== 'throw') {
      hide();
      return;
    }
    if (blockedInteractionId && blockedInteractionId === pendingInteraction.id) {
      hide();
      return;
    }
    activeInteractionId = pendingInteraction.id;
    const beats = gameState?.state?.public?.beats ?? [];
    const characters = gameState?.state?.public?.characters ?? [];
    const location = resolveTargetLocation(pendingInteraction, beats, characters);
    if (!location) {
      hide();
      return;
    }
    updateModalPosition(location);
    show();
  };

  return {
    update,
    hide,
  };
};
