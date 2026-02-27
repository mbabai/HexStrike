import { buildCardElement, fitAllCardText } from './cardRenderer.js';
import { buildAltCardElement, fitAltCardText } from './altCardRenderer.js';

export const CARD_LAYOUT_REGULAR = 'regular';
export const CARD_LAYOUT_ALTERNATE = 'alternate';

const RULESET_REGULAR = 'regular';
const RULESET_ALTERNATE = 'alternate';

const LAYOUT_STYLE_URLS = {
  [CARD_LAYOUT_REGULAR]: [],
  [CARD_LAYOUT_ALTERNATE]: ['/public/shared/altCardLayout.css'],
};

const CARD_LAYOUTS = new Map([
  [
    CARD_LAYOUT_REGULAR,
    {
      id: CARD_LAYOUT_REGULAR,
      buildCardElement,
      fitCardText: fitAllCardText,
    },
  ],
  [
    CARD_LAYOUT_ALTERNATE,
    {
      id: CARD_LAYOUT_ALTERNATE,
      buildCardElement: buildAltCardElement,
      fitCardText: fitAltCardText,
    },
  ],
]);

const normalizeLayoutId = (layoutId) => {
  const normalized = `${layoutId ?? ''}`.trim().toLowerCase();
  return normalized === CARD_LAYOUT_ALTERNATE ? CARD_LAYOUT_ALTERNATE : CARD_LAYOUT_REGULAR;
};

export const normalizeRulesetName = (ruleset) => {
  const normalized = `${ruleset ?? ''}`.trim().toLowerCase();
  return normalized === RULESET_ALTERNATE ? RULESET_ALTERNATE : RULESET_REGULAR;
};

export const getCardLayout = (layoutId) => CARD_LAYOUTS.get(normalizeLayoutId(layoutId)) ?? CARD_LAYOUTS.get(CARD_LAYOUT_REGULAR);

export const getCardLayoutForRuleset = (ruleset) => {
  const normalizedRuleset = normalizeRulesetName(ruleset);
  if (normalizedRuleset === RULESET_ALTERNATE) {
    return getCardLayout(CARD_LAYOUT_ALTERNATE);
  }
  return getCardLayout(CARD_LAYOUT_REGULAR);
};

const ensureLayoutStyleLink = (href) => {
  if (typeof document === 'undefined' || !href) return;
  const existing = document.querySelector(`link[data-card-layout-style="${href}"]`);
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.cardLayoutStyle = href;
  document.head.appendChild(link);
};

export const ensureCardLayoutStyles = (layoutId) => {
  const layout = getCardLayout(layoutId);
  const styleUrls = LAYOUT_STYLE_URLS[layout.id] ?? [];
  styleUrls.forEach((href) => ensureLayoutStyleLink(href));
  return layout;
};

export const ensureCardLayoutStylesForRuleset = (ruleset) => {
  const layout = getCardLayoutForRuleset(ruleset);
  return ensureCardLayoutStyles(layout.id);
};
