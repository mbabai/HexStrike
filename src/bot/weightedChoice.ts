export interface WeightedChoice<T> {
  item: T;
  probability: number;
  weight: number;
}

const getEligibleSortedCandidates = <T extends { score: number }>(candidates: T[], removeTop = 0): T[] => {
  if (!Array.isArray(candidates) || !candidates.length) return [];
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const removeCount = Math.max(0, Math.floor(removeTop));
  if (removeCount <= 0) return sorted;
  return sorted.slice(removeCount);
};

export const buildTopWeightedDistribution = <T extends { score: number }>(
  candidates: T[],
  topLimit = 5,
  removeTop = 0,
): Array<WeightedChoice<T>> => {
  const eligible = getEligibleSortedCandidates(candidates, removeTop);
  if (!eligible.length) return [];
  const normalizedTopLimit = Number.isFinite(topLimit) ? Math.max(1, Math.floor(topLimit)) : eligible.length;
  const top = eligible.slice(0, Math.max(1, normalizedTopLimit));
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
  removeTop = 0,
): T[] => {
  const eligible = getEligibleSortedCandidates(candidates, removeTop);
  if (!eligible.length) return [];
  const normalizedTopLimit = Number.isFinite(topLimit) ? Math.max(1, Math.floor(topLimit)) : eligible.length;
  const top = eligible.slice(0, Math.max(1, normalizedTopLimit));
  const remainder = eligible.slice(top.length);
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
