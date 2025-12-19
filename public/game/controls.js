import { GAME_CONFIG } from './config.js';
import { getTimeIndicatorHit, getTimeIndicatorLayout } from './timeIndicatorView.js';
import { clamp } from './utils.js';

export const bindControls = (canvas, viewState, pointerState, config = GAME_CONFIG, timeIndicatorViewModel) => {
  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    if (timeIndicatorViewModel) {
      const rect = canvas.getBoundingClientRect();
      const layout = getTimeIndicatorLayout({ width: rect.width, height: rect.height });
      const hit = getTimeIndicatorHit(layout, event.clientX - rect.left, event.clientY - rect.top);
      if (hit) {
        const direction = hit === 'left' ? -1 : 1;
        const started = timeIndicatorViewModel.press(direction, performance.now(), event.pointerId);
        if (started) {
          canvas.setPointerCapture(event.pointerId);
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
    canvas.setPointerCapture(event.pointerId);
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
    if (event && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    pointerState.id = null;
  };

  const endIndicatorHold = (event) => {
    if (!timeIndicatorViewModel?.isHolding) return;
    timeIndicatorViewModel.release(event?.pointerId ?? null);
    if (event && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  const onWheel = (event) => {
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

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerup', endIndicatorHold);
  canvas.addEventListener('pointercancel', endIndicatorHold);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', endDrag);
    canvas.removeEventListener('pointercancel', endDrag);
    canvas.removeEventListener('pointerup', endIndicatorHold);
    canvas.removeEventListener('pointercancel', endIndicatorHold);
    canvas.removeEventListener('wheel', onWheel);
  };
};
