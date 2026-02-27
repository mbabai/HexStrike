import { ActionListItem, CardDefinition, RulesetName } from '../../types';
import { applyActiveCardTextEffects, applyPassiveCardTextEffects } from './index';

const THROW_KEYWORD_REGEX = /\bthrow\b/i;
// Conditional throw logic (ex: grappling hook) is resolved during execution.
const THROW_IGNORED_CARD_IDS = new Set(['grappling-hook']);
const ACTIVE_THROW_CARD_IDS = new Set(['hip-throw', 'tackle']);
const PASSIVE_THROW_CARD_IDS = new Set(['leap']);
const SMOKE_BOMB_CARD_ID = 'smoke-bomb';

const clampSubBeat = (value: number): number => Math.max(1, Math.min(9, Math.round(value)));

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const toOptionalFiniteNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || `${value}`.trim() === '') return undefined;
  const parsed = toFiniteNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const getBeatPriority = (
  defaultPriority: number,
  beat: { subBeat?: { value?: number; start?: number; end?: number } | null } | undefined,
): number => {
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

type NormalizedBeatTextEntry = { text: string; placeholder?: string };

const normalizeBeatTextEntries = (text: unknown): NormalizedBeatTextEntry[] => {
  if (!Array.isArray(text)) return [];
  const entries: NormalizedBeatTextEntry[] = [];
  text.forEach((entry) => {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed) entries.push({ text: trimmed });
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    const rawEntry = entry as { placeholder?: unknown; text?: unknown };
    const body = typeof rawEntry.text === 'string' ? rawEntry.text.trim() : '';
    if (!body) return;
    const placeholder =
      typeof rawEntry.placeholder === 'string' && rawEntry.placeholder.trim()
        ? rawEntry.placeholder.trim()
        : undefined;
    entries.push(placeholder ? { placeholder, text: body } : { text: body });
  });
  return entries;
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

const hasThrowKeyword = (text: string | undefined): boolean => Boolean(text && THROW_KEYWORD_REGEX.test(text));

const cardHasThrowKeyword = (
  card: { id?: string; activeText?: string; passiveText?: string } | undefined,
  role: 'active' | 'passive',
): boolean => {
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

export const buildCardActionList = (
  activeCard: CardDefinition,
  passiveCard: CardDefinition,
  rotationLabel: string,
  options: { allowSmokeSwap?: boolean; ruleset?: RulesetName; submittedAdrenaline?: number } = {},
): ActionListItem[] => {
  const ruleset = options.ruleset ?? 'regular';
  const submittedAdrenaline = Number.isFinite(options.submittedAdrenaline)
    ? Math.max(0, Math.floor(options.submittedAdrenaline as number))
    : 0;
  const supportsThrow = cardHasThrowKeyword(activeCard, 'active') || cardHasThrowKeyword(passiveCard, 'passive');
  const baseActionList: ActionListItem[] =
    ruleset === 'alternate' && Array.isArray(activeCard?.beats) && activeCard.beats.length
      ? activeCard.beats
          .map((beat, index): ActionListItem => {
            const action = typeof beat?.action === 'string' && beat.action.trim() ? beat.action.trim() : 'E';
            const actionHasAttack = actionHasAttackToken(action);
            const rawKbf = beat?.kbf;
            const rawDamage = beat?.damage;
            const hasExplicitStats =
              (rawDamage !== null && rawDamage !== undefined) ||
              (rawKbf !== null && rawKbf !== undefined);
            const isThrowKbf = `${rawKbf ?? ''}`.trim().toUpperCase() === 'T';
            const explicitDamage = toOptionalFiniteNumber(rawDamage);
            const explicitKbf = isThrowKbf ? 0 : toOptionalFiniteNumber(rawKbf);
            return {
              action,
              rotation: index === 0 ? rotationLabel : '',
              rotationSource: index === 0 ? 'selected' : undefined,
              priority: getBeatPriority(activeCard.priority, beat),
              interaction:
                actionHasAttack && (supportsThrow || isThrowKbf) ? { type: 'throw' } : undefined,
              damage: hasExplicitStats ? explicitDamage ?? 0 : undefined,
              kbf: hasExplicitStats ? explicitKbf ?? 0 : undefined,
              cardId: activeCard.id,
              passiveCardId: passiveCard.id,
              submittedAdrenaline: index === 0 ? submittedAdrenaline : undefined,
              cardBeat: Number.isFinite(beat?.beat) ? Math.max(1, Math.round(beat!.beat as number)) : index + 1,
              subBeat: beat?.subBeat && typeof beat.subBeat === 'object' ? beat.subBeat : null,
              textEntries: normalizeBeatTextEntries(beat?.text),
            };
          })
          .filter((entry) => Boolean(entry.action))
      : (() => {
          const actions = Array.isArray(activeCard?.actions) ? activeCard.actions : [];
          if (!actions.length) return [];
          const attackDamage = Number.isFinite(activeCard?.damage) ? activeCard.damage : 0;
          const attackKbf = Number.isFinite(activeCard?.kbf) ? activeCard.kbf : 0;
          return actions.map((action, index) => ({
            action,
            rotation: index === 0 ? rotationLabel : '',
            rotationSource: index === 0 ? 'selected' : undefined,
            priority: activeCard.priority,
            interaction: supportsThrow && actionHasAttackToken(action) ? { type: 'throw' } : undefined,
            damage: attackDamage,
            kbf: attackKbf,
            cardId: activeCard.id,
            passiveCardId: passiveCard.id,
            submittedAdrenaline: index === 0 ? submittedAdrenaline : undefined,
          }));
        })();
  if (!baseActionList.length) return [];
  const activeTextList = applyActiveCardTextEffects(baseActionList, activeCard, rotationLabel);
  const withPassiveText = applyPassiveCardTextEffects(activeTextList, activeCard, passiveCard, rotationLabel);
  const allowSmokeSwap = options.allowSmokeSwap !== false;
  if (!allowSmokeSwap || activeCard.id !== SMOKE_BOMB_CARD_ID) {
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
