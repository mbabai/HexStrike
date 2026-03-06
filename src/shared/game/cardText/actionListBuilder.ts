import type { ActionListItem, CardDefinition } from '../../../types';
import { applyActiveCardTextEffects, applyPassiveCardTextEffects } from './index';
import { getTimingPriority, resolveActionTiming } from '../timing';
import { cardProvidesThrowInteraction } from '../throwSpecs';
const SMOKE_BOMB_CARD_ID = 'smoke-bomb';

const normalizeActionLabel = (action: string): string => {
  const trimmed = `${action ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const normalizeActionToken = (token: string) => {
  const trimmed = `${token ?? ''}`.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const actionHasAttackToken = (action: string): boolean => {
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

export const buildCardActionList = (
  activeCard: CardDefinition,
  passiveCard: CardDefinition,
  rotationLabel: string,
  options: { allowSmokeSwap?: boolean; submittedAdrenaline?: number } = {},
): ActionListItem[] => {
  const actions = Array.isArray(activeCard?.actions) ? activeCard.actions : [];
  const cardTimings = Array.isArray(activeCard?.timings) ? activeCard.timings : [];
  if (!actions.length) return [];
  const submittedAdrenaline = Number.isFinite(options.submittedAdrenaline)
    ? Math.max(0, Math.min(10, Math.round(options.submittedAdrenaline as number)))
    : 0;
  const supportsThrow =
    cardProvidesThrowInteraction(activeCard, 'active') || cardProvidesThrowInteraction(passiveCard, 'passive');
  const attackDamage = Number.isFinite(activeCard?.damage) ? activeCard.damage : 0;
  const attackKbf = Number.isFinite(activeCard?.kbf) ? activeCard.kbf : 0;
  const baseActionList: ActionListItem[] = actions.map((action, index) => ({
    action,
    rotation: index === 0 ? rotationLabel : '',
    rotationSource: index === 0 ? 'selected' : undefined,
    timing: resolveActionTiming(action, cardTimings[index]),
    priority: getTimingPriority(resolveActionTiming(action, cardTimings[index])),
    actionSetStep: index + 1,
    interaction: supportsThrow && actionHasAttackToken(action) ? { type: 'throw' } : undefined,
    damage: attackDamage,
    kbf: attackKbf,
    cardId: activeCard.id,
    passiveCardId: passiveCard.id,
  }));
  const activeTextList = applyActiveCardTextEffects(baseActionList, activeCard, rotationLabel, submittedAdrenaline);
  const withPassiveText = applyPassiveCardTextEffects(activeTextList, activeCard, passiveCard, rotationLabel);
  const allowSmokeSwap = options.allowSmokeSwap !== false;
  if (!allowSmokeSwap || activeCard.id !== SMOKE_BOMB_CARD_ID) {
    return withPassiveText.map((entry, index) => {
      const timing = resolveActionTiming(entry.action, entry.timing);
      return {
        ...entry,
        timing,
        priority: getTimingPriority(timing),
        actionSetStep: index + 1,
      };
    });
  }
  const swapIndex = withPassiveText.findIndex(
    (entry) => normalizeActionLabel(entry.action).toUpperCase() === 'X1',
  );
  if (swapIndex < 0) return withPassiveText;
  const swappedList = buildCardActionList(passiveCard, activeCard, rotationLabel, {
    allowSmokeSwap: false,
    submittedAdrenaline,
  });
  if (!swappedList.length) return withPassiveText;
  return [...withPassiveText.slice(0, swapIndex), ...swappedList].map((entry, index) => {
    const timing = resolveActionTiming(entry.action, entry.timing);
    return {
      ...entry,
      timing,
      priority: getTimingPriority(timing),
      actionSetStep: index + 1,
    };
  });
};
