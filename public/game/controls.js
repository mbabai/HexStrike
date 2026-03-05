import { GAME_CONFIG } from './config.js';
import { getTimeIndicatorHit, getTimeIndicatorLayout } from './timeIndicatorView.js';
import { clamp } from './utils.js';

const PLAY_MODAL_WIDTH = 210;
const PLAY_MODAL_HEIGHT = 297;
const PLAY_MODAL_VISIBLE_BOUNDS = {
  left: 44.212471 / PLAY_MODAL_WIDTH,
  top: 2.2 / PLAY_MODAL_HEIGHT,
  right: 165.787531 / PLAY_MODAL_WIDTH,
  bottom: 293.216609 / PLAY_MODAL_HEIGHT,
};

const PAN_BLOCK_SELECTORS = [
  '.action-card',
  '.action-slot',
  '.action-slot-drop',
  '.action-submit',
  '.adrenaline-meter-track',
  '.adrenaline-meter-knob',
  '.rotation-wheel',
  '.rotation-selector',
  '.throw-arrow',
  '.interaction-overlay',
  '.combo-modal',
  '.game-menu',
  '.game-menu-toggle',
  '.game-menu-panel',
  '.game-menu-modal',
  '.game-menu-modal-overlay',
  '.timeline-speed-control',
];

const isEventWithinRoot = (event, root) => {
  if (!root || !event) return false;
  const rect = root.getBoundingClientRect();
  return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
};

const shouldBlockPan = (target) => {
  if (!target || typeof target.closest !== 'function') return false;
  return PAN_BLOCK_SELECTORS.some((selector) => target.closest(selector));
};

const isPointInRect = (x, y, rect) =>
  Boolean(rect) && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

const getElementRect = (element) => {
  const rect = element?.getBoundingClientRect?.();
  return rect && rect.width > 0 && rect.height > 0 ? rect : null;
};

const getPlayModalVisibleRect = (root) => {
  const shell = root?.querySelector?.('.play-modal-shell');
  const rect = getElementRect(shell);
  if (!rect) return null;
  return {
    left: rect.left + rect.width * PLAY_MODAL_VISIBLE_BOUNDS.left,
    top: rect.top + rect.height * PLAY_MODAL_VISIBLE_BOUNDS.top,
    right: rect.left + rect.width * PLAY_MODAL_VISIBLE_BOUNDS.right,
    bottom: rect.top + rect.height * PLAY_MODAL_VISIBLE_BOUNDS.bottom,
  };
};

const shouldBlockPanByRegion = (event, root) => {
  if (!root || !Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) return false;
  const playModalRect = getPlayModalVisibleRect(root);
  if (isPointInRect(event.clientX, event.clientY, playModalRect)) return true;
  const trackRect = getElementRect(root.querySelector('#adrenalineMeterTrack'));
  if (isPointInRect(event.clientX, event.clientY, trackRect)) return true;
  const knobRect = getElementRect(root.querySelector('#adrenalineMeterKnob'));
  return isPointInRect(event.clientX, event.clientY, knobRect);
};

export const bindControls = (canvas, viewState, pointerState, config = GAME_CONFIG, timeIndicatorViewModel, root) => {
  const controlRoot = root || canvas;
  const setCapture = (pointerId) => {
    if (!controlRoot?.setPointerCapture) return;
    controlRoot.setPointerCapture(pointerId);
  };
  const releaseCapture = (pointerId) => {
    if (!controlRoot?.hasPointerCapture || !controlRoot?.releasePointerCapture) return;
    if (controlRoot.hasPointerCapture(pointerId)) {
      controlRoot.releasePointerCapture(pointerId);
    }
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    if (shouldBlockPan(event.target)) return;
    if (shouldBlockPanByRegion(event, controlRoot)) return;
    if (timeIndicatorViewModel && event.target === canvas) {
      const rect = canvas.getBoundingClientRect();
      const layout = getTimeIndicatorLayout(
        { width: rect.width, height: rect.height },
        { isExpanded: timeIndicatorViewModel.isTimelineExpanded !== false },
      );
      const hit = getTimeIndicatorHit(layout, event.clientX - rect.left, event.clientY - rect.top);
      if (hit) {
        if (hit === 'timeline-toggle') {
          timeIndicatorViewModel.toggleTimelineExpanded?.();
          return;
        }
        if (hit === 'play') {
          timeIndicatorViewModel.togglePlaying?.();
          return;
        }
        if (hit === 'jump-left') {
          timeIndicatorViewModel.setPlaying?.(false, { persist: false });
          if (typeof timeIndicatorViewModel.jumpToStart === 'function') {
            timeIndicatorViewModel.jumpToStart();
          } else {
            timeIndicatorViewModel.setValue?.(0);
          }
          return;
        }
        if (hit === 'jump-right') {
          timeIndicatorViewModel.setPlaying?.(false, { persist: false });
          if (typeof timeIndicatorViewModel.jumpToEnd === 'function') {
            timeIndicatorViewModel.jumpToEnd();
          } else {
            timeIndicatorViewModel.setValue?.(Number.MAX_SAFE_INTEGER);
          }
          return;
        }
        const direction = hit === 'left' ? -1 : 1;
        const started = timeIndicatorViewModel.press(direction, performance.now(), event.pointerId);
        if (started) {
          setCapture(event.pointerId);
        }
        return;
      }
    }
    viewState.dragging = true;
    viewState.velocity.x = 0;
    viewState.velocity.y = 0;
    pointerState.id = event.pointerId;
    pointerState.x = event.clientX;
    pointerState.y = event.clientY;
    pointerState.time = performance.now();
    setCapture(event.pointerId);
    canvas.classList.add('is-dragging');
  };

  const onPointerMove = (event) => {
    if (!viewState.dragging || pointerState.id !== event.pointerId) return;
    const now = performance.now();
    const dx = event.clientX - pointerState.x;
    const dy = event.clientY - pointerState.y;
    const dt = Math.max(1, now - pointerState.time);
    viewState.offset.x += dx;
    viewState.offset.y += dy;
    viewState.velocity.x = dx / dt;
    viewState.velocity.y = dy / dt;
    pointerState.x = event.clientX;
    pointerState.y = event.clientY;
    pointerState.time = now;
  };

  const endDrag = (event) => {
    if (!viewState.dragging || (event && pointerState.id !== event.pointerId)) return;
    viewState.dragging = false;
    canvas.classList.remove('is-dragging');
    if (event) releaseCapture(event.pointerId);
    pointerState.id = null;
  };

  const endIndicatorHold = (event) => {
    if (!timeIndicatorViewModel?.isHolding) return;
    timeIndicatorViewModel.release(event?.pointerId ?? null);
    if (event) releaseCapture(event.pointerId);
  };

  const onLostPointerCapture = (event) => {
    if (pointerState.id === event.pointerId) {
      viewState.dragging = false;
      canvas.classList.remove('is-dragging');
      pointerState.id = null;
    }
    if (timeIndicatorViewModel?.isHolding) {
      timeIndicatorViewModel.release(event.pointerId);
    }
  };

  const onWheel = (event) => {
    if (!isEventWithinRoot(event, controlRoot)) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const worldX = (mouseX - viewState.offset.x) / viewState.scale;
    const worldY = (mouseY - viewState.offset.y) / viewState.scale;
    const zoom = Math.exp(-event.deltaY * 0.0015);
    const nextScale = clamp(viewState.scale * zoom, config.minScale, config.maxScale);
    viewState.scale = nextScale;
    viewState.offset.x = mouseX - worldX * viewState.scale;
    viewState.offset.y = mouseY - worldY * viewState.scale;
  };

  controlRoot.addEventListener('pointerdown', onPointerDown);
  controlRoot.addEventListener('pointermove', onPointerMove);
  controlRoot.addEventListener('pointerup', endDrag);
  controlRoot.addEventListener('pointercancel', endDrag);
  controlRoot.addEventListener('pointerup', endIndicatorHold);
  controlRoot.addEventListener('pointercancel', endIndicatorHold);
  controlRoot.addEventListener('lostpointercapture', onLostPointerCapture);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('pointerup', endIndicatorHold);
  window.addEventListener('pointercancel', endIndicatorHold);
  controlRoot.addEventListener('wheel', onWheel, { passive: false, capture: true });

  return () => {
    controlRoot.removeEventListener('pointerdown', onPointerDown);
    controlRoot.removeEventListener('pointermove', onPointerMove);
    controlRoot.removeEventListener('pointerup', endDrag);
    controlRoot.removeEventListener('pointercancel', endDrag);
    controlRoot.removeEventListener('pointerup', endIndicatorHold);
    controlRoot.removeEventListener('pointercancel', endIndicatorHold);
    controlRoot.removeEventListener('lostpointercapture', onLostPointerCapture);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    window.removeEventListener('pointerup', endIndicatorHold);
    window.removeEventListener('pointercancel', endIndicatorHold);
    controlRoot.removeEventListener('wheel', onWheel, { capture: true });
  };
};
