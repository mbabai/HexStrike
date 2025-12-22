export const createTimeIndicatorViewModel = (model) => {
  const state = {
    holdDirection: 0,
    holdStart: 0,
    lastStep: 0,
    pointerId: null,
    isHolding: false,
    isPlaying: true,
  };

  const canStep = (direction) => {
    if (direction < 0) return model.value > model.min;
    if (direction > 0 && typeof model.max === 'number') return model.value < model.max;
    return true;
  };

  const press = (direction, now, pointerId) => {
    if (!canStep(direction)) return false;
    state.holdDirection = direction;
    state.holdStart = now;
    state.lastStep = now;
    state.isHolding = true;
    state.pointerId = pointerId ?? null;
    model.step(direction);
    return true;
  };

  const release = (pointerId) => {
    if (!state.isHolding) return;
    if (pointerId != null && state.pointerId !== pointerId) return;
    state.holdDirection = 0;
    state.isHolding = false;
    state.pointerId = null;
  };

  const update = (now) => {
    if (!state.holdDirection) return;
    const elapsed = now - state.holdStart;
    const interval = Math.max(70, 320 - elapsed * 0.3);
    if (now - state.lastStep >= interval) {
      if (canStep(state.holdDirection)) {
        model.step(state.holdDirection);
      }
      state.lastStep = now;
    }
  };

  return {
    get value() {
      return model.value;
    },
    get min() {
      return model.min;
    },
    get max() {
      return model.max;
    },
    get isHolding() {
      return state.isHolding;
    },
    get pointerId() {
      return state.pointerId;
    },
    get isPlaying() {
      return state.isPlaying;
    },
    canStep,
    step(direction) {
      if (canStep(direction)) model.step(direction);
    },
    setPlaying(next) {
      state.isPlaying = Boolean(next);
    },
    togglePlaying() {
      state.isPlaying = !state.isPlaying;
    },
    press,
    release,
    update,
  };
};
