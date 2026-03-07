import { getTooltipModeEnabled } from '../storage.js';
import { getRulebookSymbolTooltipDefinition } from './symbolTooltips.js';

const SYMBOL_TOOLTIP_ATTRIBUTE = 'data-symbol-tooltips';
const CARD_SELECTOR = '.action-card';
const VIEWPORT_MARGIN = 10;
const STACK_GAP = 12;
const VISUAL_CARD_MIN_SIZE = 24;
const INLINE_TOKEN_PATTERN = /(\{[^}]+\}|\[[^\]]+\])/g;
const DRAW_DISCARD_PATTERN = /^(draw|discard)\s+([0-9]+|x)$/i;
const ADRENALINE_SIGNED_PATTERN = /^adr([+-])\s*([0-9]+|x)$/i;
const ADRENALINE_SUBMITTED_PATTERN = /^adr\s*([0-9]+|x)$/i;
const CARD_HOST_SELECTORS = [
  '.deck-stack-item',
  '.action-slot-drop',
  '.corner-play-item',
  '.deck-spread',
  '.deck-library-card',
  '.action-hand',
  '.action-card-button',
];
const EXCLUDED_CARD_CONTAINERS = ['.timeline-tooltip', '.card-symbol-tooltip-layer'];

const normalizePreviewToken = (token) => {
  const normalized = `${token ?? ''}`.trim();
  if (normalized.toUpperCase() === 'SIGE') return 'SignatureE';
  return normalized || 'empty';
};

const buildImageUrl = (token) => `/public/images/${encodeURIComponent(normalizePreviewToken(token))}.png`;

const createPreviewImage = (token, className = '') => {
  const image = document.createElement('img');
  image.className = className;
  image.src = buildImageUrl(token);
  image.alt = '';
  image.loading = 'eager';
  image.decoding = 'async';
  image.draggable = false;
  return image;
};

const buildPreview = (descriptor) => {
  const kind = `${descriptor?.previewKind ?? 'image'}`.trim().toLowerCase();
  if (kind === 'action') {
    const icon = document.createElement('span');
    icon.className = 'card-symbol-preview card-symbol-preview-action';
    const token = `${descriptor?.previewToken ?? ''}`.trim() || 'empty';
    icon.style.backgroundImage = `url('${buildImageUrl(token)}')`;
    icon.style.backgroundSize = 'contain';
    icon.style.backgroundPosition = 'center';
    icon.style.backgroundRepeat = 'no-repeat';
    return icon;
  }
  if (kind === 'timing') {
    const row = document.createElement('span');
    row.className = 'card-symbol-preview card-symbol-preview-timing';
    ['earlyRules', 'midRules', 'lateRules'].forEach((token) => {
      row.appendChild(createPreviewImage(token, 'card-symbol-preview-timing-icon'));
    });
    return row;
  }
  if (kind === 'stat') {
    const stat = document.createElement('span');
    stat.className = 'card-symbol-preview card-symbol-preview-stat';
    if (descriptor?.muted) {
      stat.classList.add('is-muted');
    }
    stat.style.backgroundImage = `url('${buildImageUrl(descriptor?.previewToken || 'empty')}')`;
    const value = document.createElement('span');
    value.className = 'card-symbol-preview-stat-value';
    value.textContent = `${descriptor?.value ?? ''}`.trim();
    stat.appendChild(value);
    return stat;
  }
  if (kind === 'flow') {
    const flow = document.createElement('span');
    const flowType = `${descriptor?.flowType ?? ''}`.trim().toLowerCase() === 'discard' ? 'discard' : 'draw';
    flow.className = `card-symbol-preview card-symbol-preview-flow is-${flowType}`;
    flow.style.backgroundImage = `url('${buildImageUrl(flowType === 'draw' ? 'DrawIcon' : 'DiscardIcon')}')`;
    const value = document.createElement('span');
    value.className = 'card-symbol-preview-flow-value';
    value.textContent = `${flowType === 'draw' ? '+' : '-'}${`${descriptor?.amount ?? 'X'}`.trim().toUpperCase()}`;
    flow.appendChild(value);
    return flow;
  }
  if (kind === 'adrenaline') {
    const adrenaline = document.createElement('span');
    adrenaline.className = 'card-symbol-preview card-symbol-preview-adrenaline';
    adrenaline.style.backgroundImage = `url('${buildImageUrl('Adrenaline')}')`;
    const value = document.createElement('span');
    value.className = 'card-symbol-preview-adrenaline-value';
    const sign = `${descriptor?.sign ?? ''}`.trim();
    if (sign) {
      const signNode = document.createElement('span');
      signNode.className = 'card-symbol-preview-adrenaline-sign';
      signNode.textContent = sign;
      value.appendChild(signNode);
    }
    const amountNode = document.createElement('span');
    amountNode.className = 'card-symbol-preview-adrenaline-amount';
    amountNode.textContent = `${descriptor?.amount ?? 'X'}`.trim().toUpperCase();
    value.appendChild(amountNode);
    adrenaline.appendChild(value);
    return adrenaline;
  }
  if (kind === 'image') {
    const wrap = document.createElement('span');
    wrap.className = 'card-symbol-preview card-symbol-preview-image';
    const image = createPreviewImage(`${descriptor?.previewToken ?? 'empty'}`.trim() || 'empty');
    if (descriptor?.muted) {
      image.classList.add('is-muted');
    }
    wrap.appendChild(image);
    if (`${descriptor?.badgeText ?? ''}`.trim()) {
      const badge = document.createElement('span');
      badge.className = 'card-symbol-preview-badge';
      badge.textContent = `${descriptor.badgeText}`.trim();
      wrap.appendChild(badge);
    }
    return wrap;
  }
  return createPreviewImage('empty', 'card-symbol-preview card-symbol-preview-fallback');
};

const buildInlineTokenNode = (token) => {
  const normalized = `${token ?? ''}`.trim();
  if (!normalized) return null;
  const flowMatch = normalized.match(DRAW_DISCARD_PATTERN);
  if (flowMatch) {
    const node = buildPreview({
      previewKind: 'flow',
      flowType: flowMatch[1],
      amount: flowMatch[2],
    });
    node.classList.add('is-inline');
    return node;
  }
  const signedAdrenalineMatch = normalized.match(ADRENALINE_SIGNED_PATTERN);
  if (signedAdrenalineMatch) {
    const node = buildPreview({
      previewKind: 'adrenaline',
      sign: signedAdrenalineMatch[1],
      amount: signedAdrenalineMatch[2],
    });
    node.classList.add('is-inline');
    return node;
  }
  const submittedAdrenalineMatch = normalized.match(ADRENALINE_SUBMITTED_PATTERN);
  if (submittedAdrenalineMatch) {
    const node = buildPreview({
      previewKind: 'adrenaline',
      amount: submittedAdrenalineMatch[1],
    });
    node.classList.add('is-inline');
    return node;
  }
  if (normalized.toLowerCase() === 'throw kbf icon') {
    const node = buildPreview({
      previewKind: 'stat',
      previewToken: 'KnockBackIcon',
      value: 'T',
      muted: true,
    });
    node.classList.add('is-inline');
    return node;
  }
  const node = buildPreview({ previewKind: 'image', previewToken: normalized });
  node.classList.add('is-inline');
  return node;
};

const appendTooltipText = (container, text) => {
  container.textContent = '';
  const source = `${text ?? ''}`;
  if (!source) return;
  let cursor = 0;
  const matches = Array.from(source.matchAll(INLINE_TOKEN_PATTERN));
  matches.forEach((match) => {
    const token = match[0];
    const index = Number.isFinite(match.index) ? match.index : 0;
    if (index > cursor) {
      container.appendChild(document.createTextNode(source.slice(cursor, index)));
    }
    const innerToken = token.slice(1, -1).trim();
    const node = buildInlineTokenNode(innerToken);
    if (node) {
      container.appendChild(node);
    } else {
      container.appendChild(document.createTextNode(innerToken));
    }
    cursor = index + token.length;
  });
  if (cursor < source.length) {
    container.appendChild(document.createTextNode(source.slice(cursor)));
  }
};

const parseTooltipDescriptors = (node) => {
  const raw = node?.getAttribute?.(SYMBOL_TOOLTIP_ATTRIBUTE);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Failed to parse card symbol tooltip descriptors', error);
    return [];
  }
};

const collectCardDescriptors = (card) => {
  if (!card) return [];
  const nodes = card.querySelectorAll(`[${SYMBOL_TOOLTIP_ATTRIBUTE}]`);
  const descriptorsByKey = new Map();
  nodes.forEach((node) => {
    parseTooltipDescriptors(node).forEach((descriptor) => {
      const key = `${descriptor?.key ?? ''}`.trim();
      if (!key || descriptorsByKey.has(key)) return;
      const definition = getRulebookSymbolTooltipDefinition(key);
      if (!definition) return;
      descriptorsByKey.set(key, { ...descriptor, key, text: definition.text });
    });
  });
  return [...descriptorsByKey.values()];
};

const findCardWithinHost = (element) => {
  if (!(element instanceof Element)) return null;
  for (const selector of CARD_HOST_SELECTORS) {
    const host = element.closest(selector);
    if (!host) continue;
    const card = host.querySelector(CARD_SELECTOR);
    if (card instanceof HTMLElement) {
      return card;
    }
  }
  return null;
};

const resolveCardFromElement = (element) => {
  if (!(element instanceof Element)) return null;
  if (EXCLUDED_CARD_CONTAINERS.some((selector) => element.closest(selector))) return null;
  const direct = element.closest(CARD_SELECTOR);
  if (direct instanceof HTMLElement) return direct;
  return findCardWithinHost(element);
};

const getNumericZIndex = (element) => {
  if (!(element instanceof Element)) return 0;
  const raw = getComputedStyle(element).zIndex;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getCardVisualPriority = (card) => {
  if (!(card instanceof HTMLElement)) return 0;
  let priority = getNumericZIndex(card);
  let node = card.parentElement;
  while (node) {
    priority = Math.max(priority, getNumericZIndex(node));
    node = node.parentElement;
  }
  return priority;
};

const getVisibleCardsAtPoint = (x, y) => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
  const cards = Array.from(document.querySelectorAll(CARD_SELECTOR));
  return cards
    .map((card, index) => {
      if (!(card instanceof HTMLElement)) return null;
      if (EXCLUDED_CARD_CONTAINERS.some((selector) => card.closest(selector))) return null;
      const rect = card.getBoundingClientRect();
      if (
        rect.width < VISUAL_CARD_MIN_SIZE ||
        rect.height < VISUAL_CARD_MIN_SIZE ||
        x < rect.left ||
        x > rect.right ||
        y < rect.top ||
        y > rect.bottom
      ) {
        return null;
      }
      return {
        card,
        index,
        rect,
        priority: getCardVisualPriority(card),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.priority !== left.priority) {
        return right.priority - left.priority;
      }
      const leftArea = left.rect.width * left.rect.height;
      const rightArea = right.rect.width * right.rect.height;
      if (leftArea !== rightArea) {
        return leftArea - rightArea;
      }
      return right.index - left.index;
    })
    .map((entry) => entry.card);
};

const getVisibleTimelinePreviewCard = () => {
  const previewCards = Array.from(
    document.querySelectorAll('.timeline-tooltip:not([hidden]) .timeline-tooltip-card-preview .action-card'),
  );
  return previewCards.find((card) => card instanceof HTMLElement) ?? null;
};

const resolveCardFromPoint = (x, y) => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const elements = document.elementsFromPoint(x, y);
  for (const element of elements) {
    const card = resolveCardFromElement(element);
    if (card) return card;
  }
  const fallbackCards = getVisibleCardsAtPoint(x, y);
  if (fallbackCards.length) {
    return fallbackCards[0];
  }
  return null;
};

const createTooltipLayer = () => {
  const root = document.createElement('div');
  root.className = 'card-symbol-tooltip-layer';
  root.hidden = true;

  const stack = document.createElement('div');
  stack.className = 'card-symbol-tooltip-stack';
  root.appendChild(stack);
  document.body.appendChild(root);
  return { root, stack };
};

let initialized = false;

export const ensureCardSymbolTooltipController = () => {
  if (initialized || typeof document === 'undefined') return;
  initialized = true;

  const layer = createTooltipLayer();
  const state = {
    altPressed: false,
    enabled: Boolean(getTooltipModeEnabled()),
    hoveredCard: null,
    visibleCard: null,
    pointerX: null,
    pointerY: null,
  };
  let altRefreshFrame = 0;

  const shouldShow = () => state.enabled || state.altPressed;

  const setTooltipActive = (active) => {
    document.body?.classList?.toggle('card-symbol-tooltip-active', Boolean(active));
  };

  const hide = () => {
    state.visibleCard = null;
    layer.root.hidden = true;
    layer.stack.innerHTML = '';
    layer.stack.classList.remove('is-left', 'is-right');
    setTooltipActive(false);
  };

  const positionLayer = () => {
    if (!state.visibleCard || layer.root.hidden) return;
    if (!document.body.contains(state.visibleCard)) {
      hide();
      return;
    }
    const rect = state.visibleCard.getBoundingClientRect();
    const stackRect = layer.stack.getBoundingClientRect();
    const rightSpace = window.innerWidth - rect.right - STACK_GAP - VIEWPORT_MARGIN;
    const leftSpace = rect.left - STACK_GAP - VIEWPORT_MARGIN;
    const placeRight = rightSpace >= stackRect.width || rightSpace >= leftSpace;
    const top = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.top, window.innerHeight - stackRect.height - VIEWPORT_MARGIN),
    );
    const left = placeRight
      ? Math.min(rect.right + STACK_GAP, window.innerWidth - stackRect.width - VIEWPORT_MARGIN)
      : Math.max(VIEWPORT_MARGIN, rect.left - STACK_GAP - stackRect.width);
    layer.stack.classList.toggle('is-right', placeRight);
    layer.stack.classList.toggle('is-left', !placeRight);
    layer.stack.style.left = `${Math.round(left)}px`;
    layer.stack.style.top = `${Math.round(top)}px`;
  };

  const showForCard = (card) => {
    if (!card || !shouldShow()) {
      hide();
      return;
    }
    const descriptors = collectCardDescriptors(card);
    if (!descriptors.length) {
      hide();
      return;
    }
    layer.stack.innerHTML = '';
    descriptors.forEach((descriptor) => {
      const item = document.createElement('div');
      item.className = 'card-symbol-tooltip-item';

      const preview = document.createElement('div');
      preview.className = 'card-symbol-tooltip-preview';
      preview.appendChild(buildPreview(descriptor));

      const body = document.createElement('div');
      body.className = 'card-symbol-tooltip-body';
      appendTooltipText(body, descriptor.text);

      item.append(preview, body);
      layer.stack.appendChild(item);
    });

    state.visibleCard = card;
    layer.root.hidden = false;
    setTooltipActive(true);
    positionLayer();
  };

  const refresh = () => {
    if (!shouldShow()) {
      hide();
      return;
    }
    if (!state.hoveredCard && Number.isFinite(state.pointerX) && Number.isFinite(state.pointerY)) {
      state.hoveredCard = resolveCardFromPoint(state.pointerX, state.pointerY);
    }
    if (!state.hoveredCard) {
      state.hoveredCard = getVisibleTimelinePreviewCard() || null;
    }
    if (state.hoveredCard) {
      showForCard(state.hoveredCard);
      return;
    }
    hide();
  };

  const scheduleAltRefresh = () => {
    if (altRefreshFrame) {
      cancelAnimationFrame(altRefreshFrame);
    }
    altRefreshFrame = requestAnimationFrame(() => {
      altRefreshFrame = 0;
      if (Number.isFinite(state.pointerX) && Number.isFinite(state.pointerY)) {
        state.hoveredCard = resolveCardFromPoint(state.pointerX, state.pointerY) || state.hoveredCard;
      }
      if (!state.hoveredCard) {
        state.hoveredCard = getVisibleTimelinePreviewCard() || null;
      }
      refresh();
    });
  };

  document.addEventListener(
    'pointerover',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const nextCard = resolveCardFromElement(event.target);
      if (!nextCard) return;
      state.hoveredCard = nextCard;
      if (shouldShow()) {
        showForCard(nextCard);
      }
    },
    true,
  );

  document.addEventListener(
    'pointermove',
    (event) => {
      state.altPressed = Boolean(event.altKey);
      state.pointerX = event.clientX;
      state.pointerY = event.clientY;
      const nextCard = resolveCardFromPoint(event.clientX, event.clientY);
      if (nextCard === state.hoveredCard) {
        if (shouldShow()) {
          positionLayer();
        } else {
          hide();
        }
        return;
      }
      state.hoveredCard = nextCard;
      if (nextCard && shouldShow()) {
        showForCard(nextCard);
        return;
      }
      hide();
    },
    true,
  );

  document.addEventListener(
    'pointerleave',
    (event) => {
      if (event.target !== document.documentElement && event.target !== document.body) return;
      state.pointerX = null;
      state.pointerY = null;
      state.hoveredCard = null;
      hide();
    },
    true,
  );

  const handleAltKeyDown = (event) => {
    if (event.key !== 'Alt' && event.code !== 'AltLeft' && event.code !== 'AltRight') return;
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
    }
    state.altPressed = true;
    if (Number.isFinite(state.pointerX) && Number.isFinite(state.pointerY)) {
      state.hoveredCard = resolveCardFromPoint(state.pointerX, state.pointerY) || state.hoveredCard;
    }
    if (!state.hoveredCard) {
      state.hoveredCard = getVisibleTimelinePreviewCard() || null;
    }
    refresh();
    scheduleAltRefresh();
  };

  const handleAltKeyUp = (event) => {
    if (event.key !== 'Alt' && event.code !== 'AltLeft' && event.code !== 'AltRight') return;
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
    }
    if (altRefreshFrame) {
      cancelAnimationFrame(altRefreshFrame);
      altRefreshFrame = 0;
    }
    state.altPressed = false;
    refresh();
  };

  document.addEventListener('keydown', handleAltKeyDown, true);
  document.addEventListener('keyup', handleAltKeyUp, true);
  window.addEventListener('keydown', handleAltKeyDown);
  window.addEventListener('keyup', handleAltKeyUp);

  window.addEventListener('blur', () => {
    if (altRefreshFrame) {
      cancelAnimationFrame(altRefreshFrame);
      altRefreshFrame = 0;
    }
    if (!state.altPressed) return;
    state.altPressed = false;
    refresh();
  });

  window.addEventListener('resize', positionLayer);
  window.addEventListener('scroll', positionLayer, true);
  window.addEventListener('hexstrike:tooltip-mode-changed', (event) => {
    state.enabled = Boolean(event?.detail?.enabled);
    refresh();
  });
};
