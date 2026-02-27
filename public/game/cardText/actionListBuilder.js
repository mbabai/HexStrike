import { applyActiveCardTextEffects, applyPassiveCardTextEffects } from './index.js';

const THROW_KEYWORD_REGEX = /\bthrow\b/i;
// Conditional throw logic (ex: grappling hook) is resolved during execution.
const THROW_IGNORED_CARD_IDS = new Set(['grappling-hook']);
const ACTIVE_THROW_CARD_IDS = new Set(['hip-throw', 'tackle']);
const PASSIVE_THROW_CARD_IDS = new Set(['leap']);
const SMOKE_BOMB_CARD_ID = 'smoke-bomb';
const RULESET_ALTERNATE = 'alternate';

const clampSubBeat = (value) => Math.max(1, Math.min(9, Math.round(value)));

const toFiniteNumber = (value, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const toOptionalFiniteNumber = (value) => {
  if (value === null || value === undefined || `${value}`.trim() === '') return undefined;
  const parsed = toFiniteNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const getBeatPriority = (defaultPriority, beat) => {
  const subBeat = beat?.subBeat;
  const source =
    subBeat && Number.isFinite(subBeat.value)
      ? Number(subBeat.value)
      : subBeat && Number.isFinite(subBeat.start)
        ? Number(subBeat.start)
        : null;
  if (!Number.isFinite(source)) return defaultPriority;
  return 100 - clampSubBeat(source) * 10;
};

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

const normalizeBeatTextEntries = (text) => {
  if (!Array.isArray(text)) return [];
  const entries = [];
  text.forEach((entry) => {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed) entries.push({ text: trimmed });
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    const body = typeof entry.text === 'string' ? entry.text.trim() : '';
    if (!body) return;
    const placeholder =
      typeof entry.placeholder === 'string' && entry.placeholder.trim()
        ? entry.placeholder.trim()
        : undefined;
    entries.push(placeholder ? { placeholder, text: body } : { text: body });
  });
  return entries;
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
  const ruleset = options.ruleset ?? 'regular';
  const submittedAdrenaline = Number.isFinite(options.submittedAdrenaline)
    ? Math.max(0, Math.floor(options.submittedAdrenaline))
    : 0;
  const supportsThrow = cardHasThrowKeyword(activeCard, 'active') || cardHasThrowKeyword(passiveCard, 'passive');
  const baseActionList =
    ruleset === RULESET_ALTERNATE && Array.isArray(activeCard?.beats) && activeCard.beats.length
      ? activeCard.beats
          .map((beat, index) => {
            const action = typeof beat?.action === 'string' && beat.action.trim() ? beat.action.trim() : 'E';
            const actionHasAttack = actionHasAttackToken(action);
            const rawKbf = beat?.kbf;
            const rawDamage = beat?.damage;
            const hasExplicitStats = (rawDamage !== null && rawDamage !== undefined) || (rawKbf !== null && rawKbf !== undefined);
            const isThrowKbf = `${rawKbf ?? ''}`.trim().toUpperCase() === 'T';
            const explicitDamage = toOptionalFiniteNumber(rawDamage);
            const explicitKbf = isThrowKbf ? 0 : toOptionalFiniteNumber(rawKbf);
            return {
              action,
              rotation: index === 0 ? rotationLabel : '',
              rotationSource: index === 0 ? 'selected' : undefined,
              priority: getBeatPriority(activeCard?.priority ?? 0, beat),
              interaction:
                actionHasAttack && (supportsThrow || isThrowKbf) ? { type: 'throw' } : undefined,
              damage: hasExplicitStats ? explicitDamage ?? 0 : undefined,
              kbf: hasExplicitStats ? explicitKbf ?? 0 : undefined,
              cardId: activeCard?.id ?? null,
              passiveCardId: passiveCard?.id ?? null,
              submittedAdrenaline: index === 0 ? submittedAdrenaline : undefined,
              cardBeat: Number.isFinite(beat?.beat) ? Math.max(1, Math.round(beat.beat)) : index + 1,
              subBeat: beat?.subBeat && typeof beat.subBeat === 'object' ? beat.subBeat : null,
              textEntries: normalizeBeatTextEntries(beat?.text),
            };
          })
          .filter((entry) => Boolean(entry.action))
      : (() => {
          const actions = Array.isArray(activeCard?.actions) ? activeCard.actions : [];
          if (!actions.length) return [];
          const priority = Number.isFinite(activeCard?.priority) ? activeCard.priority : 0;
          const damage = Number.isFinite(activeCard?.damage) ? activeCard.damage : 0;
          const kbf = Number.isFinite(activeCard?.kbf) ? activeCard.kbf : 0;
          return actions.map((action, index) => ({
            action,
            rotation: index === 0 ? rotationLabel : '',
            rotationSource: index === 0 ? 'selected' : undefined,
            priority,
            interaction: supportsThrow && actionHasAttackToken(action) ? { type: 'throw' } : undefined,
            damage,
            kbf,
            cardId: activeCard?.id ?? null,
            passiveCardId: passiveCard?.id ?? null,
            submittedAdrenaline: index === 0 ? submittedAdrenaline : undefined,
          }));
        })();
  if (!baseActionList.length) return [];
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
  const swappedList = buildCardActionList(passiveCard, activeCard, rotationLabel, {
    allowSmokeSwap: false,
    ruleset,
    submittedAdrenaline,
  });
  if (!swappedList.length) return withPassiveText;
  return [...withPassiveText.slice(0, swapIndex), ...swappedList];
};
