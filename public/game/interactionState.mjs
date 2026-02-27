import { getActiveHandTriggerId } from './handTriggerOrder.mjs';

const isPendingInteractionVisible = (interaction, resolvedIndex, alwaysAllowTypes) => {
  if (!interaction || interaction.status !== 'pending') return false;
  if (alwaysAllowTypes.has(interaction.type)) return true;
  const beatIndex = Number.isFinite(interaction.beatIndex) ? Math.round(interaction.beatIndex) : null;
  if (beatIndex != null && resolvedIndex >= 0 && beatIndex <= resolvedIndex) return false;
  return true;
};


const buildLocalUserKeys = (localUserId, characters) => {
  const keys = new Set();
  const seed = `${localUserId ?? ''}`.trim();
  if (!seed) return keys;
  keys.add(seed);
  (characters ?? []).forEach((character) => {
    if (!character) return;
    const userId = `${character.userId ?? ''}`.trim();
    const username = `${character.username ?? ''}`.trim();
    if (userId && (userId === seed || username === seed)) {
      keys.add(userId);
      if (username) keys.add(username);
    }
  });
  return keys;
};

const isInteractionForUser = (interaction, localUserKeys) => {
  if (!interaction || !(localUserKeys instanceof Set) || !localUserKeys.size) return false;
  const actorId = `${interaction.actorUserId ?? ''}`.trim();
  if (actorId && localUserKeys.has(actorId)) return true;
  const targetId = `${interaction.targetUserId ?? ''}`.trim();
  if (interaction.type === 'discard' && targetId && localUserKeys.has(targetId)) return true;
  return false;
};

export const selectPendingInteraction = ({
  interactions,
  characters,
  localUserId,
  resolvedIndex,
  alwaysAllowTypes = [
    'throw',
    'combo',
    'discard',
    'hand-trigger',
    'draw',
    'haven-platform',
    'guard-continue',
    'rewind-return',
    'draw-offer',
  ],
}) => {
  const localUserKeys = buildLocalUserKeys(localUserId, characters);
  const allowTypes = new Set(alwaysAllowTypes);
  const activeHandTriggerId = getActiveHandTriggerId(interactions);
  const pending = (interactions ?? []).filter(
    (interaction) =>
      isInteractionForUser(interaction, localUserKeys) &&
      isPendingInteractionVisible(interaction, resolvedIndex, allowTypes),
  );
  const gated = pending.filter((interaction) => {
    if (interaction?.type !== 'hand-trigger') return true;
    if (!activeHandTriggerId) return true;
    return interaction?.id === activeHandTriggerId;
  });
  if (!gated.length) return null;
  const pendingThrows = gated.filter((interaction) => interaction?.type === 'throw');
  if (pendingThrows.length) {
    pendingThrows.sort((a, b) => (a?.beatIndex ?? 0) - (b?.beatIndex ?? 0));
    return pendingThrows[0] ?? null;
  }
  gated.sort((a, b) => (a?.beatIndex ?? 0) - (b?.beatIndex ?? 0));
  return gated[0] ?? null;
};
