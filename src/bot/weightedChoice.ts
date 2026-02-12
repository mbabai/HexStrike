export interface WeightedChoice<T> {
  item: T;
  probability: number;
  weight: number;
}

export const buildTopWeightedDistribution = <T extends { score: number }>(
  candidates: T[],
  topLimit = 5,
): Array<WeightedChoice<T>> => {
  if (!Array.isArray(candidates) || !candidates.length) return [];
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, Math.max(1, topLimit));
  const positiveWeights = top.map((candidate) => Math.max(0, candidate.score));
  let sum = positiveWeights.reduce((acc, value) => acc + value, 0);
  let weights = positiveWeights;
  if (!(sum > 0)) {
    weights = top.map(() => 1);
    sum = weights.length;
  }
  return top.map((candidate, index) => ({
    item: candidate,
    weight: weights[index],
    probability: sum > 0 ? weights[index] / sum : 0,
  }));
};

export const buildWeightedChoiceOrder = <T extends { score: number }>(
  candidates: T[],
  randomFn: () => number = Math.random,
  topLimit = 5,
): T[] => {
  if (!Array.isArray(candidates) || !candidates.length) return [];
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, Math.max(1, topLimit));
  const remainder = sorted.slice(top.length);
  const weightedPool = top.slice();
  const order: T[] = [];

  while (weightedPool.length) {
    const distribution = buildTopWeightedDistribution(weightedPool, weightedPool.length);
    const roll = Math.max(0, Math.min(0.999999, randomFn()));
    let cumulative = 0;
    let chosenIndex = 0;
    for (let i = 0; i < distribution.length; i += 1) {
      cumulative += distribution[i].probability;
      if (roll <= cumulative || i === distribution.length - 1) {
        chosenIndex = i;
        break;
      }
    }
    const chosen = weightedPool.splice(chosenIndex, 1)[0];
    if (chosen) order.push(chosen);
  }

  return [...order, ...remainder];
};
