const RULEBOOK_SYMBOL_DEFINITIONS = {
  'open-beat': {
    id: 'open-beat',
    text: 'Refresh beat with no committed action.',
  },
  'signature-refresh-beat': {
    id: 'signature-refresh-beat',
    text: 'Signature Refresh beat. Refreshes like [E], but the active card goes to the top of your deck if that refresh happens.',
  },
  'wait-action': {
    id: 'wait-action',
    text: 'Wait action. Characters do nothing here.',
  },
  'move-action': {
    id: 'move-action',
    text:
      'Move action. Characters move straight forward and stop if obstacles are in the way. They move as far as possible before the obstacle. Other geometries of this type can include: [2m], [Bm], and [m-Ba].',
  },
  'jump-action': {
    id: 'jump-action',
    text:
      'Jump action. Unlike move, jump does not stop if obstacles are in the way. However, the jump fails if the target location is occupied. Other geometries of this type can include: [2j] and [3j].',
  },
  'attack-action': {
    id: 'attack-action',
    text:
      'Attack action. Deal damage and knockback to any targets on all red hexes. Other geometries of this type can include: [a-2a], [a-La-Ra], and [a-Bm].',
  },
  'block-action': {
    id: 'block-action',
    text:
      'Block action. Block attacks from the hex directions with the gold lines. Other geometries of this type can include: [Bb], [b-Lb-Rb], and [b-Lb-Rb-BLb-BRb-Bb].',
  },
  'charge-action': {
    id: 'charge-action',
    text:
      'Charge action (attack + movement behavior). First attempts an attack, then attempts a move. Other geometries of this type can include: [2c], [3c], and [c-La-Ra-BLa-BRa-Ba].',
  },
  'focus-marker': {
    id: 'focus-marker',
    text:
      'Focus marker/state reference. Puts the card in "focus" state. This places the card to the side and applies its focus text until that card is removed from focus.',
  },
  'combo-window': {
    id: 'combo-window',
    text:
      'Combo window marker. If the attack before this combo symbol was successful, the player can choose to continue the combo. They discard their current active and passive cards and can play another card with a [Co].',
  },
  'card-text-trigger': {
    id: 'card-text-trigger',
    text: 'Card-text trigger symbols. These mark effect trigger points within an action sequence.',
  },
  'bracketed-trigger': {
    id: 'bracketed-trigger',
    text: "This marks a trigger point in addition to a regular action on a card's timeline.",
  },
  'adrenaline-modifier': {
    id: 'adrenaline-modifier',
    text:
      'Adrenaline modifier add or subtract from your pool of stored adrenaline, to a minimum of 0 and maximum of 10.',
  },
  'timing-marker': {
    id: 'timing-marker',
    text: 'Timing markers. [earlyRules] resolves before [midRules], and [midRules] resolves before [lateRules].',
  },
  'draw-x': {
    id: 'draw-x',
    text:
      '{draw X}: draw X ability cards, then movement hand count syncs to match ability hand size (see hand economy above).',
  },
  'discard-x': {
    id: 'discard-x',
    text:
      '{discard X}: discard X ability cards, then movement hand count syncs to match ability hand size (see hand economy above).',
  },
  'submitted-adrenaline': {
    id: 'submitted-adrenaline',
    text: 'These symbols reference the amount of SUBMITTED {adrX} on this play, and can modify actions.',
  },
  'damage-badge': {
    id: 'damage-badge',
    text: 'Damage badge: indicates how much damage this attack deals.',
  },
  'kbf-badge': {
    id: 'kbf-badge',
    text: 'Knockback factor (KBF) stat marker.',
  },
  'throw-kbf': {
    id: 'throw-kbf',
    text: 'Throw knockback marker (KBF throw). Uses throw rules instead of normal knockback formula.',
  },
  'rotation-badge': {
    id: 'rotation-badge',
    text: 'Rotation limitation badge. Indicates allowed rotation choices for that active card.',
  },
} as const;

export type RulebookSymbolTooltipId = keyof typeof RULEBOOK_SYMBOL_DEFINITIONS;

export type RulebookSymbolTooltipDefinition = {
  id: RulebookSymbolTooltipId;
  text: string;
};

const ADRENALINE_SIGNED_PATTERN = /^adr([+-])\s*([0-9]+|x)$/i;
const ADRENALINE_SUBMITTED_PATTERN = /^adr\s*([0-9]+|x)$/i;
const DRAW_DISCARD_PATTERN = /^(draw|discard)\s+([0-9]+|x)$/i;
const ROTATION_PATTERN = /^rot/i;
const TIMING_PATTERN = /^(early|mid|late)(rules)?$/i;

const stripActionBrackets = (value: unknown): string => {
  const trimmed = `${value ?? ''}`.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const getActionTypeKey = (token: string): RulebookSymbolTooltipId | null => {
  const normalized = stripActionBrackets(token);
  if (!normalized) return null;
  const firstPart = normalized.split('-').map((part) => `${part ?? ''}`.trim()).find(Boolean) ?? '';
  if (!firstPart) return null;
  const actionType = firstPart[firstPart.length - 1]?.toLowerCase();
  if (actionType === 'm') return 'move-action';
  if (actionType === 'j') return 'jump-action';
  if (actionType === 'a') return 'attack-action';
  if (actionType === 'b') return 'block-action';
  if (actionType === 'c') return 'charge-action';
  return null;
};

export const getRulebookSymbolTooltipDefinition = (
  id: unknown,
): RulebookSymbolTooltipDefinition | null => {
  const normalized = `${id ?? ''}`.trim() as RulebookSymbolTooltipId;
  return RULEBOOK_SYMBOL_DEFINITIONS[normalized] ?? null;
};

export const getRulebookSymbolTooltipText = (id: unknown): string | null =>
  getRulebookSymbolTooltipDefinition(id)?.text ?? null;

export const resolveRulebookSymbolTooltipId = (token: unknown): RulebookSymbolTooltipId | null => {
  const normalized = stripActionBrackets(token);
  if (!normalized) return null;
  const timingParts = normalized
    .split(',')
    .map((part) => `${part ?? ''}`.trim())
    .filter(Boolean);
  if (timingParts.length > 1 && timingParts.every((part) => TIMING_PATTERN.test(part))) {
    return 'timing-marker';
  }
  const upper = normalized.toUpperCase();

  if (upper === 'E') return 'open-beat';
  if (upper === 'SIGE') return 'signature-refresh-beat';
  if (upper === 'W') return 'wait-action';
  if (upper === 'F') return 'focus-marker';
  if (upper === 'CO') return 'combo-window';
  if (upper === 'X1' || upper === 'X2') return 'card-text-trigger';
  if (normalized === 'i') return 'bracketed-trigger';
  if (normalized === 'DamageIcon' || normalized === 'red damage capsule') return 'damage-badge';
  if (normalized === 'throw kbf icon') return 'throw-kbf';
  if (normalized === 'KnockBackIcon') return 'kbf-badge';
  if (ROTATION_PATTERN.test(normalized)) return 'rotation-badge';
  if (TIMING_PATTERN.test(normalized)) return 'timing-marker';
  if (DRAW_DISCARD_PATTERN.test(normalized)) {
    return normalized.toLowerCase().startsWith('draw') ? 'draw-x' : 'discard-x';
  }
  if (ADRENALINE_SIGNED_PATTERN.test(normalized)) return 'adrenaline-modifier';
  if (ADRENALINE_SUBMITTED_PATTERN.test(normalized)) return 'submitted-adrenaline';

  return getActionTypeKey(normalized);
};

export const resolveRulebookSymbolTooltip = (
  token: unknown,
): RulebookSymbolTooltipDefinition | null => {
  const id = resolveRulebookSymbolTooltipId(token);
  return id ? getRulebookSymbolTooltipDefinition(id) : null;
};

export const RULEBOOK_SYMBOL_TOOLTIP_IDS = Object.freeze(
  Object.keys(RULEBOOK_SYMBOL_DEFINITIONS) as RulebookSymbolTooltipId[],
);
