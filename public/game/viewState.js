import { GAME_CONFIG } from './config.js';

export const createViewState = () => ({
  scale: 1,
  offset: { x: 0, y: 0 },
  velocity: { x: 0, y: 0 },
  dragging: false,
});

export const createPointerState = () => ({
  id: null,
  x: 0,
  y: 0,
  time: 0,
});

export const centerView = (viewState, viewport) => {
  viewState.offset.x = viewport.width / 2;
  viewState.offset.y = viewport.height / 2;
};

export const applyMomentum = (viewState, dt, config = GAME_CONFIG) => {
  if (
    !viewState.dragging &&
    (Math.abs(viewState.velocity.x) > config.minVelocity || Math.abs(viewState.velocity.y) > config.minVelocity)
  ) {
    const decay = Math.pow(config.momentumDecay, dt / 16);
    viewState.offset.x += viewState.velocity.x * dt;
    viewState.offset.y += viewState.velocity.y * dt;
    viewState.velocity.x *= decay;
    viewState.velocity.y *= decay;
    return;
  }

  if (!viewState.dragging) {
    viewState.velocity.x = 0;
    viewState.velocity.y = 0;
  }
};
