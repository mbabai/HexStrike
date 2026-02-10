import { applyActiveCardTextEffects, applyPassiveCardTextEffects } from './index.js';

const THROW_KEYWORD_REGEX = /\bthrow\b/i;
// Conditional throw logic (ex: grappling hook) is resolved during execution.
const THROW_IGNORED_CARD_IDS = new Set(['grappling-hook']);
const ACTIVE_THROW_CARD_IDS = new Set(['hip-throw', 'tackle']);
const PASSIVE_THROW_CARD_IDS = new Set(['leap']);
const SMOKE_BOMB_CARD_ID = 'smoke-bomb';

const normalizeActionLabel = (action) => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

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

export const buildCardActionList = (activeCard, passiveCard, rotationLabel, options = {}) => {
  const actions = Array.isArray(activeCard?.actions) ? activeCard.actions : [];
  if (!actions.length) return [];
  const priority = Number.isFinite(activeCard?.priority) ? activeCard.priority : 0;
  const damage = Number.isFinite(activeCard?.damage) ? activeCard.damage : 0;
  const kbf = Number.isFinite(activeCard?.kbf) ? activeCard.kbf : 0;
  const supportsThrow = cardHasThrowKeyword(activeCard, 'active') || cardHasThrowKeyword(passiveCard, 'passive');
  const baseActionList = actions.map((action, index) => ({
    action,
    rotation: index === 0 ? rotationLabel : '',
    rotationSource: index === 0 && rotationLabel ? 'selected' : undefined,
    priority,
    interaction: supportsThrow && actionHasAttackToken(action) ? { type: 'throw' } : undefined,
    damage,
    kbf,
    cardId: activeCard?.id ?? null,
    passiveCardId: passiveCard?.id ?? null,
  }));
  const activeTextList = applyActiveCardTextEffects(baseActionList, activeCard, rotationLabel);
  const withPassiveText = applyPassiveCardTextEffects(activeTextList, activeCard, passiveCard, rotationLabel);
  const allowSmokeSwap = options.allowSmokeSwap !== false;
  if (!allowSmokeSwap || activeCard?.id !== SMOKE_BOMB_CARD_ID) {
    return withPassiveText;
  }
  const swapIndex = withPassiveText.findIndex(
    (entry) => normalizeActionLabel(entry.action).toUpperCase() === 'X1',
  );
  if (swapIndex < 0) return withPassiveText;
  const swappedList = buildCardActionList(passiveCard, activeCard, rotationLabel, { allowSmokeSwap: false });
  if (!swappedList.length) return withPassiveText;
  return [...withPassiveText.slice(0, swapIndex), ...swappedList];
};
