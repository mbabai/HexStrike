const normalizeActionToken = (token) => {
  const trimmed = `${token ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const actionHasAttackToken = (action) => {
  if (!action) return false;
  return action
    .split('-')
    .map((token) => normalizeActionToken(token))
    .some((token) => {
      if (!token) return false;
      const type = token[token.length - 1]?.toLowerCase();
      return type === 'a' || type === 'c';
    });
};

const THROW_KEYWORD_REGEX = /\bthrow\b/i;
const THROW_IGNORED_CARD_IDS = new Set(['grappling-hook']);
const ACTIVE_THROW_CARD_IDS = new Set(['hip-throw', 'tackle']);
const PASSIVE_THROW_CARD_IDS = new Set(['leap']);

const hasThrowKeyword = (text) => Boolean(text && THROW_KEYWORD_REGEX.test(text));

const cardHasThrowKeyword = (card, role) => {
  if (!card) return false;
  const cardId = card.id;
  if (cardId && THROW_IGNORED_CARD_IDS.has(cardId)) return false;
  if (role === 'active' && cardId && ACTIVE_THROW_CARD_IDS.has(cardId)) return true;
  if (role === 'passive' && cardId && PASSIVE_THROW_CARD_IDS.has(cardId)) return true;
  if (role === 'active') {
    return hasThrowKeyword(card.activeText) || hasThrowKeyword(card.passiveText);
  }
  return hasThrowKeyword(card.passiveText);
};

const buildPendingActionList = (activeCard, passiveCard, rotation) => {
  const actions = Array.isArray(activeCard?.actions) ? activeCard.actions : [];
  if (!actions.length) return [];
  const priority = Number.isFinite(activeCard?.priority) ? activeCard.priority : 0;
  const damage = Number.isFinite(activeCard?.damage) ? activeCard.damage : 0;
  const kbf = Number.isFinite(activeCard?.kbf) ? activeCard.kbf : 0;
  const supportsThrow = cardHasThrowKeyword(activeCard, 'active') || cardHasThrowKeyword(passiveCard, 'passive');
  const rotationLabel = `${rotation ?? ''}`.trim();
  return actions.map((action, index) => ({
    action,
    rotation: index === 0 ? rotationLabel : '',
    priority,
    interaction: supportsThrow && actionHasAttackToken(action) ? { type: 'throw' } : undefined,
    damage,
    kbf,
    cardId: activeCard?.id ?? null,
    passiveCardId: passiveCard?.id ?? null,
  }));
};

const isUserSubmitted = (pending, userId) => {
  if (!pending || !Array.isArray(pending.submittedUserIds)) return false;
  return pending.submittedUserIds.includes(userId);
};

const hasPendingBatch = (pending) => Boolean(pending && Array.isArray(pending.requiredUserIds));

export const createPendingActionPreview = () => {
  let actionList = null;

  const setFromCard = (activeCard, passiveCard, rotation) => {
    const nextList = buildPendingActionList(activeCard, passiveCard, rotation);
    actionList = nextList.length ? nextList : null;
  };

  const clear = () => {
    actionList = null;
  };

  const syncWithState = (gameState, localUserId) => {
    const pending = gameState?.state?.public?.pendingActions ?? null;
    if (!hasPendingBatch(pending) || !isUserSubmitted(pending, localUserId)) {
      clear();
    }
  };

  const getTimelinePreview = (gameState, localUserId) => {
    const pending = gameState?.state?.public?.pendingActions ?? null;
    if (!hasPendingBatch(pending)) return null;
    if (!isUserSubmitted(pending, localUserId)) return null;
    if (pending.submittedUserIds.length >= pending.requiredUserIds.length) return null;
    if (!Array.isArray(actionList) || !actionList.length) return null;
    return {
      userId: localUserId,
      beatIndex: pending.beatIndex,
      actionList,
    };
  };

  return {
    setFromCard,
    clear,
    syncWithState,
    getTimelinePreview,
  };
};
