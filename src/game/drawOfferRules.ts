export type DrawOfferBotDifficulty = 'easy' | 'medium' | 'hard';

const toDamage = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
};

export const shouldBotAcceptDrawOffer = (
  difficulty: DrawOfferBotDifficulty,
  botDamage: number,
  playerDamage: number,
): boolean => {
  const safeBotDamage = toDamage(botDamage);
  const safePlayerDamage = toDamage(playerDamage);
  if (difficulty === 'easy') return true;
  if (difficulty === 'medium') return safeBotDamage >= safePlayerDamage - 10;
  return safeBotDamage >= safePlayerDamage + 10;
};
