export const createTimeIndicatorModel = () => {
  let value = 0;
  const min = 0;

  const clamp = (next) => Math.max(min, next);

  return {
    get value() {
      return value;
    },
    get min() {
      return min;
    },
    setValue(next) {
      value = clamp(next);
    },
    step(direction) {
      value = clamp(value + direction);
    },
  };
};
