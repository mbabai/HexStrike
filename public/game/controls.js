import { GAME_CONFIG } from './config.js';
import { getTimeIndicatorHit, getTimeIndicatorLayout } from './timeIndicatorView.js';
import { clamp } from './utils.js';

const PAN_BLOCK_SELECTORS = [
  '.action-card',
  '.action-slot',
  '.action-slot-drop',
  '.action-submit',
  '.rotation-wheel',
  '.rotation-selector',
  '.interaction-overlay',
  '.throw-modal',
  '.throw-arrow',
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
    if (timeIndicatorViewModel && event.target === canvas) {
      const rect = canvas.getBoundingClientRect();
      const layout = getTimeIndicatorLayout({ width: rect.width, height: rect.height });
      const hit = getTimeIndicatorHit(layout, event.clientX - rect.left, event.clientY - rect.top);
      if (hit) {
        if (hit === 'play') {
          timeIndicatorViewModel.togglePlaying?.();
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
  controlRoot.addEventListener('wheel', onWheel, { passive: false, capture: true });

  return () => {
    controlRoot.removeEventListener('pointerdown', onPointerDown);
    controlRoot.removeEventListener('pointermove', onPointerMove);
    controlRoot.removeEventListener('pointerup', endDrag);
    controlRoot.removeEventListener('pointercancel', endDrag);
    controlRoot.removeEventListener('pointerup', endIndicatorHold);
    controlRoot.removeEventListener('pointercancel', endIndicatorHold);
    controlRoot.removeEventListener('wheel', onWheel, { capture: true });
  };
};
