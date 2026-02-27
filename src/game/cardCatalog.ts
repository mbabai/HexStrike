import { readFile } from 'fs';
import { join } from 'path';
import { CardCatalog, CardDefinition, CardType, DeckDefinition, RulesetName } from '../types';

const CARD_DATA_PATH_BY_RULESET: Record<RulesetName, string> = {
  regular: join(process.cwd(), 'public', 'cards', 'cards.json'),
  alternate: join(process.cwd(), 'public', 'cards', 'CardsAlternate.json'),
};

const catalogPromiseByRuleset = new Map<RulesetName, Promise<CardCatalog>>();

const readFileUtf8 = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    readFile(path, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      const raw = typeof data === 'string' ? data : data?.toString?.('utf8') ?? '';
      resolve(raw);
    });
  });

const normalizeCard = (card: unknown, type: CardType, index: number): CardDefinition => {
  if (!card || typeof card !== 'object') {
    return {
      id: `${type}-${index}`,
      name: `${type}-${index}`,
      type,
      priority: 0,
      actions: [],
      rotations: '*',
      damage: 0,
      kbf: 0,
    };
  }
  const raw = card as Record<string, unknown>;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `${type}-${index}`;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;
  const actions = Array.isArray(raw.actions)
    ? raw.actions.map((action) => `${action ?? ''}`.trim()).filter(Boolean)
    : [];
  const rotations = typeof raw.rotations === 'string' && raw.rotations.trim() ? raw.rotations.trim() : '*';
  const priority = Number.isFinite(raw.priority) ? Number(raw.priority) : 0;
  const damage = Number.isFinite(raw.damage) ? Number(raw.damage) : 0;
  const kbf = Number.isFinite(raw.kbf) ? Number(raw.kbf) : 0;
  const activeText = typeof raw.activeText === 'string' ? raw.activeText : undefined;
  const passiveText = typeof raw.passiveText === 'string' ? raw.passiveText : undefined;
  const triggerText = typeof raw.triggerText === 'string' ? raw.triggerText : undefined;
  const cardText = typeof raw.cardText === 'string' ? raw.cardText : undefined;
  return { id, name, type, priority, actions, rotations, damage, kbf, activeText, passiveText, triggerText, cardText };
};

const clampSubBeat = (value: number): number => Math.max(1, Math.min(9, Math.round(value)));

const normalizeSubBeat = (
  subBeat: unknown,
): { value?: number; start?: number; end?: number } | null => {
  if (!subBeat || typeof subBeat !== 'object') return null;
  const raw = subBeat as { value?: unknown; start?: unknown; end?: unknown };
  const start = Number(raw.start);
  const end = Number(raw.end);
  if (Number.isFinite(start) && Number.isFinite(end)) {
    const normalizedStart = clampSubBeat(start);
    const normalizedEnd = clampSubBeat(end);
    return normalizedStart <= normalizedEnd
      ? { start: normalizedStart, end: normalizedEnd }
      : { start: normalizedEnd, end: normalizedStart };
  }
  const value = Number(raw.value);
  if (Number.isFinite(value)) {
    return { value: clampSubBeat(value) };
  }
  return null;
};

type NormalizedBeatTextEntry = { text: string; placeholder?: string };

const normalizeBeatTextEntries = (text: unknown): NormalizedBeatTextEntry[] => {
  if (!Array.isArray(text)) return [];
  const entries: NormalizedBeatTextEntry[] = [];
  text.forEach((entry) => {
      if (typeof entry === 'string') {
        const body = entry.trim();
        if (body) entries.push({ text: body });
        return;
      }
      if (!entry || typeof entry !== 'object') return;
      const raw = entry as { placeholder?: unknown; text?: unknown };
      const body = typeof raw.text === 'string' ? raw.text.trim() : '';
      if (!body) return;
      const placeholder =
        typeof raw.placeholder === 'string' && raw.placeholder.trim() ? raw.placeholder.trim() : undefined;
      entries.push(placeholder ? { placeholder, text: body } : { text: body });
    });
  return entries;
};

const normalizeBeatStat = (value: unknown): number | string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : trimmed;
  }
  return null;
};

const normalizeAlternateBeat = (
  beat: unknown,
  index: number,
): {
  beat: number;
  action: string;
  subBeat?: { value?: number; start?: number; end?: number } | null;
  damage?: number | string | null;
  kbf?: number | string | null;
  text?: Array<{ placeholder?: string; text?: string }>;
} => {
  const raw = beat && typeof beat === 'object' ? (beat as Record<string, unknown>) : {};
  const beatNumber = Number(raw.beat);
  const action = typeof raw.action === 'string' && raw.action.trim() ? raw.action.trim() : 'E';
  const normalized: {
    beat: number;
    action: string;
    subBeat?: { value?: number; start?: number; end?: number } | null;
    damage?: number | string | null;
    kbf?: number | string | null;
    text?: Array<{ placeholder?: string; text?: string }>;
  } = {
    beat: Number.isFinite(beatNumber) ? Math.max(1, Math.round(beatNumber)) : index + 1,
    action,
    subBeat: normalizeSubBeat(raw.subBeat),
    damage: normalizeBeatStat(raw.damage),
    kbf: normalizeBeatStat(raw.kbf),
    text: normalizeBeatTextEntries(raw.text),
  };
  return normalized;
};

const toFiniteNumberOrNull = (value: unknown): number | null => {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.trim()) : NaN;
  return Number.isFinite(parsed) ? Number(parsed) : null;
};

const derivePriorityFromBeats = (beats: Array<{ subBeat?: { value?: number; start?: number; end?: number } | null }>): number => {
  if (!Array.isArray(beats) || !beats.length) return 0;
  const first = beats[0];
  const subBeat = first?.subBeat ?? null;
  const sourceValue =
    subBeat && Number.isFinite(subBeat.value)
      ? Number(subBeat.value)
      : subBeat && Number.isFinite(subBeat.start)
        ? Number(subBeat.start)
        : null;
  if (!Number.isFinite(sourceValue)) return 0;
  return 100 - clampSubBeat(sourceValue) * 10;
};

const normalizeAlternateCard = (card: unknown, type: CardType, index: number): CardDefinition => {
  if (!card || typeof card !== 'object') {
    return normalizeCard(card, type, index);
  }
  const raw = card as Record<string, unknown>;
  const base = normalizeCard(card, type, index);
  const beats = Array.isArray(raw.beats)
    ? raw.beats.map((beat, beatIndex) => normalizeAlternateBeat(beat, beatIndex))
    : [];
  const actions = beats.map((beat) => `${beat.action ?? ''}`.trim()).filter(Boolean);
  const priority = Number.isFinite(raw.priority) ? Number(raw.priority) : derivePriorityFromBeats(beats);
  const firstAttackBeat = beats.find((beat) => beat.damage !== null || beat.kbf !== null);
  const damage = toFiniteNumberOrNull(raw.damage) ?? toFiniteNumberOrNull(firstAttackBeat?.damage) ?? 0;
  const kbf = toFiniteNumberOrNull(raw.kbf) ?? toFiniteNumberOrNull(firstAttackBeat?.kbf) ?? 0;
  const activeText =
    typeof raw.activeText === 'string'
      ? raw.activeText
      : typeof raw.cardText === 'string'
        ? raw.cardText
        : undefined;
  const passiveText = typeof raw.passiveText === 'string' ? raw.passiveText : undefined;
  const triggerText = typeof raw.triggerText === 'string' ? raw.triggerText : undefined;
  const cardText = typeof raw.cardText === 'string' ? raw.cardText : undefined;
  return {
    ...base,
    actions,
    priority,
    damage,
    kbf,
    activeText,
    passiveText,
    triggerText,
    cardText,
    beats,
  };
};

const normalizeDeck = (deck: unknown): DeckDefinition => {
  if (!deck || typeof deck !== 'object') {
    return { movement: [], ability: [] };
  }
  const raw = deck as Record<string, unknown>;
  const movement = Array.isArray(raw.movement)
    ? raw.movement.map((cardId) => `${cardId ?? ''}`.trim()).filter(Boolean)
    : [];
  const ability = Array.isArray(raw.ability)
    ? raw.ability.map((cardId) => `${cardId ?? ''}`.trim()).filter(Boolean)
    : [];
  if (!movement.length && !ability.length) {
    return { movement: [], ability: [] };
  }
  return { movement, ability };
};

export const loadCardCatalog = async (ruleset: RulesetName = 'regular'): Promise<CardCatalog> => {
  if (!catalogPromiseByRuleset.has(ruleset)) {
    const sourcePath = CARD_DATA_PATH_BY_RULESET[ruleset] ?? CARD_DATA_PATH_BY_RULESET.regular;
    const promise = readFileUtf8(sourcePath).then((raw) => {
      const data = JSON.parse(raw);
      const movement = Array.isArray(data?.movement) ? data.movement : [];
      const ability = Array.isArray(data?.ability) ? data.ability : [];
      const decks = Array.isArray(data?.decks) ? data.decks : [];
      const normalize = ruleset === 'alternate' ? normalizeAlternateCard : normalizeCard;
      const movementCards = movement.map((card, index) => normalize(card, 'movement', index));
      const abilityCards = ability.map((card, index) => normalize(card, 'ability', index));
      const cardsById = new Map<string, CardDefinition>();
      movementCards.forEach((card) => cardsById.set(card.id, card));
      abilityCards.forEach((card) => cardsById.set(card.id, card));
      return {
        movement: movementCards,
        ability: abilityCards,
        decks: decks.map((deck) => normalizeDeck(deck)),
        cardsById,
      };
    });
    catalogPromiseByRuleset.set(ruleset, promise);
  }
  return catalogPromiseByRuleset.get(ruleset)!;
};
