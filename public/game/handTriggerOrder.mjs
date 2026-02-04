const compareHandTriggerOrder = (a, b) => {
  const orderA = Number.isFinite(a?.handTriggerOrder) ? a.handTriggerOrder : null;
  const orderB = Number.isFinite(b?.handTriggerOrder) ? b.handTriggerOrder : null;
  if (orderA !== null && orderB !== null && orderA !== orderB) return orderA - orderB;
  if (orderA !== null && orderB === null) return -1;
  if (orderB !== null && orderA === null) return 1;
  const beatA = Number.isFinite(a?.beatIndex) ? a.beatIndex : Number.MAX_SAFE_INTEGER;
  const beatB = Number.isFinite(b?.beatIndex) ? b.beatIndex : Number.MAX_SAFE_INTEGER;
  if (beatA !== beatB) return beatA - beatB;
  const actorA = `${a?.actorUserId ?? ''}`;
  const actorB = `${b?.actorUserId ?? ''}`;
  return actorA.localeCompare(actorB);
};

const getActiveHandTriggerId = (interactions) => {
  const pending = (interactions ?? []).filter(
    (interaction) => interaction?.type === 'hand-trigger' && interaction?.status === 'pending',
  );
  if (!pending.length) return null;
  pending.sort(compareHandTriggerOrder);
  return pending[0]?.id ?? null;
};

export { compareHandTriggerOrder, getActiveHandTriggerId };
