export const createTimeIndicatorModel = () => {
  let value = 0;
  let min = 0;
  let max = null;

  const clamp = (next) => {
    const lower = Math.max(min, next);
    if (typeof max !== 'number') return lower;
    return Math.min(max, lower);
  };

  return {
    get value() {
      return value;
    },
    get min() {
      return min;
    },
    get max() {
      return max;
    },
    setBounds(nextMin, nextMax) {
      min = Number.isFinite(nextMin) ? nextMin : min;
      max = Number.isFinite(nextMax) ? nextMax : null;
      value = clamp(value);
    },
    setMax(nextMax) {
      max = Number.isFinite(nextMax) ? nextMax : null;
      value = clamp(value);
    },
    setValue(next) {
      value = clamp(next);
    },
    step(direction) {
      value = clamp(value + direction);
    },
  };
};
