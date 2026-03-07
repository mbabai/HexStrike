import { resolveActionTiming } from './timing.js';
import { resolveRulebookSymbolTooltipId } from './symbolTooltips.js';
import { ensureCardSymbolTooltipController } from './cardSymbolTooltips.js';
import { isRefreshActionLabel } from './actionSymbols.js';

const ACTION_ICON_FALLBACK = 'empty';
const ROTATION_ICON_FALLBACK = 'rotStar';
const DAMAGE_ICON_URL = '/public/images/DamageIcon.png';
const KNOCKBACK_ICON_URL = '/public/images/KnockBackIcon.png';
const EMPHASIS_ICON_URL = '/public/images/i.png';
const TIMING_ICON_URLS = {
  early: '/public/images/early.png',
  mid: '/public/images/mid.png',
  late: '/public/images/late.png',
};
const TIMING_PHASES = new Set(['early', 'mid', 'late']);
const DRAW_ICON_URL = '/public/images/DrawIcon.png';
const DISCARD_ICON_URL = '/public/images/DiscardIcon.png';
const ADRENALINE_ICON_URL = '/public/images/Adrenaline.png';
const CARD_ART_BASE_URL = '/public/images/cardart';
const MANDATORY_MOVEMENT_CARD_IDS = new Set(['step']);
const CARD_ART_PRELOAD_MARGIN = '320px 0px';
const INLINE_STYLE_CLASS_BY_TAG = {
  bold: 'card-inline-emphasis card-inline-emphasis-bold',
  u: 'card-inline-emphasis-purple',
  key: 'card-inline-emphasis card-inline-emphasis-key',
  move: 'card-inline-emphasis card-inline-emphasis-move',
  attack: 'card-inline-emphasis card-inline-emphasis-attack',
  guard: 'card-inline-emphasis card-inline-emphasis-guard',
};
const INLINE_STYLE_TOKEN_PATTERN = /(\{[^}]+\}|\[[^\]]+\]|<\/?(?:bold|b|u|key|move|attack|guard)>)/gi;
const MIN_SURFACE_TEXT_PX = 7;
const HARD_MIN_SURFACE_TEXT_PX = 6;
const MAX_ROW_TEXT_GROWTH = 3;

ensureCardSymbolTooltipController();

let cardArtIntersectionObserver = null;

const resolveSymbolImageName = (token) => {
  const normalized = `${token ?? ''}`.trim();
  if (normalized.toUpperCase() === 'SIGE') return 'SignatureE';
  return normalized || ACTION_ICON_FALLBACK;
};

const stripActionBrackets = (value) => {
  const trimmed = `${value ?? ''}`.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const parseActionToken = (raw) => {
  const trimmed = `${raw ?? ''}`.trim();
  if (!trimmed) return { label: ACTION_ICON_FALLBACK, emphasized: false };
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const label = trimmed.slice(1, -1).trim();
    return { label: label || ACTION_ICON_FALLBACK, emphasized: true };
  }
  return { label: trimmed, emphasized: false };
};

const parseAdrenalineToken = (raw) => {
  const normalized = `${raw ?? ''}`.trim();
  if (!normalized) return null;
  const signedMatch = normalized.match(/^adr([+-])\s*([0-9]+|x)$/i);
  if (signedMatch) {
    return {
      sign: signedMatch[1],
      amount: `${signedMatch[2]}`.trim().toUpperCase(),
    };
  }
  const plainMatch = normalized.match(/^adr\s*([0-9]+|x)$/i);
  if (plainMatch) {
    return {
      sign: '',
      amount: `${plainMatch[1]}`.trim().toUpperCase(),
    };
  }
  return null;
};

const buildActionIconUrl = (action) => {
  const key = `${action ?? ''}`.trim();
  const name = resolveSymbolImageName(key);
  return `/public/images/${name}.png`;
};

const buildRotationIconUrl = (rotation) => {
  const key = `${rotation ?? ''}`.trim();
  if (!key || key === '*') return `/public/images/${ROTATION_ICON_FALLBACK}.png`;
  return `/public/images/rot${key}.png`;
};

const buildCardArtUrl = (cardName) => {
  const name = `${cardName ?? ''}`.trim();
  return `${CARD_ART_BASE_URL}/${encodeURIComponent(name)}.jpg`;
};

const ensureCardArtIntersectionObserver = () => {
  if (cardArtIntersectionObserver || typeof IntersectionObserver !== 'function') {
    return cardArtIntersectionObserver;
  }
  cardArtIntersectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const image = entry.target;
        if (!(image instanceof HTMLImageElement)) return;
        const deferredSrc = image.dataset.cardArtSrc;
        if (deferredSrc && image.src !== deferredSrc) {
          image.src = deferredSrc;
        }
        image.removeAttribute('data-card-art-src');
        cardArtIntersectionObserver?.unobserve(image);
      });
    },
    { rootMargin: CARD_ART_PRELOAD_MARGIN },
  );
  return cardArtIntersectionObserver;
};

const deferCardArtLoad = (image) => {
  if (!(image instanceof HTMLImageElement)) return;
  const deferredSrc = image.dataset.cardArtSrc;
  if (!deferredSrc) return;
  const observer = ensureCardArtIntersectionObserver();
  if (!observer) {
    image.src = deferredSrc;
    image.removeAttribute('data-card-art-src');
    return;
  }
  observer.observe(image);
};

const buildRotationPreviewToken = (rotation) => {
  const key = `${rotation ?? ''}`.trim();
  return !key || key === '*' ? 'rotStar' : `rot${key}`;
};

const setSymbolTooltips = (element, descriptors) => {
  if (!element || !Array.isArray(descriptors) || !descriptors.length) return;
  const normalized = descriptors
    .map((descriptor) => {
      if (!descriptor || typeof descriptor !== 'object') return null;
      const key = `${descriptor.key ?? ''}`.trim() || resolveRulebookSymbolTooltipId(descriptor.previewToken);
      if (!key) return null;
      return { ...descriptor, key };
    })
    .filter(Boolean);
  if (!normalized.length) return;
  element.setAttribute('data-symbol-tooltips', JSON.stringify(normalized));
};

const ensureActionList = (actions) => {
  const list = Array.isArray(actions) ? [...actions] : [];
  if (!list.length) return ['E'];
  const last = stripActionBrackets(list[list.length - 1]);
  if (!isRefreshActionLabel(last)) {
    list.push('E');
  }
  return list;
};

const formatStatValue = (value) => {
  if (value === null || value === undefined || value === '') return '0';
  const raw = `${value}`.trim();
  if (!raw) return '0';
  return raw.toUpperCase() === 'T' ? 'T' : raw;
};

const actionHasAttackOrChargeToken = (action) => {
  const normalized = stripActionBrackets(action);
  if (!normalized) return false;
  return normalized
    .split('-')
    .map((token) => stripActionBrackets(token).trim())
    .some((token) => {
      if (!token) return false;
      const type = token[token.length - 1]?.toLowerCase();
      return type === 'a' || type === 'c';
    });
};

const buildStatBadge = (type, value, iconUrl) => {
  const stat = document.createElement('span');
  stat.className = `action-card-stat action-card-stat-${type}`;
  stat.style.setProperty('--action-card-stat-icon', `url('${iconUrl}')`);
  const textValue = formatStatValue(value);
  if (type === 'kbf' && textValue === 'T') {
    stat.classList.add('is-throw-indicator');
  }
  stat.setAttribute('aria-label', `${type} ${textValue}`);
  const text = document.createElement('span');
  text.className = 'action-card-stat-value';
  text.textContent = textValue;
  stat.appendChild(text);
  setSymbolTooltips(stat, [
    {
      key: type === 'kbf' && textValue === 'T' ? 'throw-kbf' : type === 'damage' ? 'damage-badge' : 'kbf-badge',
      previewKind: 'stat',
      previewToken: type === 'damage' ? 'DamageIcon' : 'KnockBackIcon',
      value: textValue,
      muted: type === 'kbf' && textValue === 'T',
    },
  ]);
  return stat;
};

const buildActionIcon = (action, timing) => {
  const icon = document.createElement('span');
  icon.className = 'action-card-action';
  const { label, emphasized } = parseActionToken(action);
  const adrenaline = parseAdrenalineToken(label);
  const iconUrl = buildActionIconUrl(adrenaline ? 'Adrenaline' : label);
  if (emphasized) {
    icon.classList.add('is-emphasized');
    icon.style.backgroundImage = `url('${EMPHASIS_ICON_URL}'), url('${iconUrl}')`;
    icon.style.backgroundSize = '100% 100%, 80% 80%';
    icon.style.backgroundPosition = 'center, center';
    icon.style.backgroundRepeat = 'no-repeat, no-repeat';
  } else {
    icon.style.backgroundImage = `url('${iconUrl}')`;
  }
  if (adrenaline) {
    const value = document.createElement('span');
    value.className = 'action-card-adrenaline-value';
    if (adrenaline.sign) {
      value.classList.add('is-signed');
      const signNode = document.createElement('span');
      signNode.className = 'action-card-adrenaline-sign';
      signNode.textContent = adrenaline.sign;
      value.appendChild(signNode);
    }
    const amountNode = document.createElement('span');
    amountNode.className = 'action-card-adrenaline-amount';
    amountNode.textContent = adrenaline.amount;
    value.appendChild(amountNode);
    icon.appendChild(value);
  }
  const resolvedTiming = resolveActionTiming(action, timing);
  if (Array.isArray(resolvedTiming) && resolvedTiming.length) {
    const timingWrap = document.createElement('span');
    timingWrap.className = 'action-card-action-timing';
    resolvedTiming.forEach((phase) => {
      const timingUrl = TIMING_ICON_URLS[phase];
      if (!timingUrl) return;
      const timingIcon = document.createElement('img');
      timingIcon.className = 'action-card-action-timing-icon';
      timingIcon.src = timingUrl;
      timingIcon.alt = `${phase} timing`;
      timingIcon.loading = 'eager';
      timingIcon.decoding = 'async';
      setSymbolTooltips(timingIcon, [
        {
          key: 'timing-marker',
          previewKind: 'timing',
        },
      ]);
      timingWrap.appendChild(timingIcon);
    });
    if (timingWrap.childElementCount) {
      icon.appendChild(timingWrap);
    }
  }
  icon.setAttribute('aria-label', label);
  const actionDescriptors = adrenaline
    ? [
        {
          key: adrenaline.sign ? 'adrenaline-modifier' : 'submitted-adrenaline',
          previewKind: 'adrenaline',
          sign: adrenaline.sign,
          amount: adrenaline.amount,
        },
      ]
    : [
        {
          key: resolveRulebookSymbolTooltipId(label),
          previewKind: 'action',
          previewToken: label,
        },
      ];
  if (emphasized) {
    actionDescriptors.push({
      key: 'bracketed-trigger',
      previewKind: 'image',
      previewToken: 'i',
    });
  }
  setSymbolTooltips(icon, actionDescriptors);
  return icon;
};

const normalizeInlineStyleTag = (value) => {
  const normalized = `${value ?? ''}`.trim().toLowerCase();
  if (normalized === 'b') return 'bold';
  return normalized;
};

const buildInlineCardFlowIcon = ({ type, amountLabel, token }) => {
  const icon = document.createElement('span');
  const normalizedType = `${type ?? ''}`.trim().toLowerCase();
  const normalizedAmount = `${amountLabel ?? ''}`.trim().toUpperCase();
  if (!normalizedAmount) return null;
  const isDraw = normalizedType === 'draw';
  if (!isDraw && normalizedType !== 'discard') return null;
  icon.className = `card-inline-flow-icon ${isDraw ? 'is-draw' : 'is-discard'}`;
  icon.style.backgroundImage = `url('${isDraw ? DRAW_ICON_URL : DISCARD_ICON_URL}')`;
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', token);
  const value = document.createElement('span');
  value.className = 'card-inline-flow-value';
  value.textContent = `${isDraw ? '+' : '-'}${normalizedAmount}`;
  icon.appendChild(value);
  setSymbolTooltips(icon, [
    {
      key: isDraw ? 'draw-x' : 'discard-x',
      previewKind: 'flow',
      flowType: isDraw ? 'draw' : 'discard',
      amount: normalizedAmount,
    },
  ]);
  return icon;
};


const buildAdrenalineValueContent = ({ sign = '', amount }) => {
  const value = document.createElement('span');
  value.className = 'card-inline-adrenaline-value';
  if (sign) {
    const signNode = document.createElement('span');
    signNode.className = 'card-inline-adrenaline-sign';
    signNode.textContent = sign;
    value.appendChild(signNode);
  }
  const amountNode = document.createElement('span');
  amountNode.className = 'card-inline-adrenaline-amount';
  amountNode.textContent = amount;
  value.appendChild(amountNode);
  return value;
};

const buildInlineAdrenalineIcon = ({ sign = '', amountLabel, token }) => {
  const normalizedSign = sign === '-' ? '-' : sign === '+' ? '+' : '';
  const normalizedAmount = `${amountLabel ?? ''}`.trim().toUpperCase();
  if (!normalizedAmount) return null;
  const isNumeric = /^[0-9]+$/.test(normalizedAmount);
  if (!isNumeric && normalizedAmount !== 'X') return null;
  const icon = document.createElement('span');
  icon.className = 'card-inline-adrenaline-icon';
  if (normalizedSign) {
    icon.classList.add('is-signed');
  }
  icon.style.backgroundImage = `url('${ADRENALINE_ICON_URL}')`;
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', token);
  icon.appendChild(buildAdrenalineValueContent({ sign: normalizedSign, amount: normalizedAmount }));
  setSymbolTooltips(icon, [
    {
      key: normalizedSign ? 'adrenaline-modifier' : 'submitted-adrenaline',
      previewKind: 'adrenaline',
      sign: normalizedSign,
      amount: normalizedAmount,
    },
  ]);
  return icon;
};

const queueCardTextRefit = (parent) => {
  const card = parent?.closest?.('.action-card');
  if (!card || card.dataset.refitQueued === '1') return;
  card.dataset.refitQueued = '1';
  requestAnimationFrame(() => {
    card.dataset.refitQueued = '0';
    fitAllCardText(card);
  });
};

const appendInlineImage = (parent, imageName, alt) => {
  const image = document.createElement('img');
  image.className = 'card-inline-icon';
  image.src = `/public/images/${resolveSymbolImageName(imageName)}.png`;
  image.alt = alt;
  image.loading = 'eager';
  image.decoding = 'async';
  image.addEventListener('load', () => queueCardTextRefit(parent));
  parent.appendChild(image);
  const key = resolveRulebookSymbolTooltipId(imageName);
  if (key) {
    setSymbolTooltips(image, [{ key, previewKind: 'image', previewToken: imageName }]);
  }
  return image;
};

const parseInlineIconToken = (part) => {
  if (typeof part !== 'string' || part.length < 3) return null;
  const isCurly = part.startsWith('{') && part.endsWith('}');
  const isBracket = part.startsWith('[') && part.endsWith(']');
  if (!isCurly && !isBracket) return null;
  const token = part.slice(1, -1).trim();
  if (!token) return null;
  return token;
};

const getInlineTimingPhase = (part) => {
  const token = parseInlineIconToken(part);
  if (!token) return null;
  const normalized = token.toLowerCase();
  return TIMING_PHASES.has(normalized) ? normalized : null;
};

const isInlineActionToken = (token) => {
  const normalized = `${token ?? ''}`.trim();
  if (!normalized || /\s/.test(normalized)) return false;
  return normalized.split('-').every((part) => {
    const label = `${part ?? ''}`.trim();
    if (!label) return false;
    const upper = label.toUpperCase();
    if (upper === 'W' || isRefreshActionLabel(upper)) return true;
    const type = label[label.length - 1]?.toLowerCase();
    return type === 'a' || type === 'm' || type === 'j' || type === 'c' || type === 'b';
  });
};

const appendInlineActionWithTimingIcon = (parent, actionToken, timingPhase) => {
  const timingUrl = TIMING_ICON_URLS[timingPhase];
  if (!timingUrl) {
    appendInlineImage(parent, actionToken, actionToken);
    return;
  }
  const icon = document.createElement('span');
  icon.className = 'card-inline-action-icon';
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', `${actionToken} (${timingPhase})`);

  const base = document.createElement('img');
  base.className = 'card-inline-action-base';
  base.src = `/public/images/${resolveSymbolImageName(actionToken)}.png`;
  base.alt = actionToken;
  base.loading = 'eager';
  base.decoding = 'async';
  base.addEventListener('load', () => queueCardTextRefit(parent));

  const timing = document.createElement('img');
  timing.className = 'card-inline-action-timing-icon';
  timing.src = timingUrl;
  timing.alt = `${timingPhase} timing`;
  timing.loading = 'eager';
  timing.decoding = 'async';
  timing.addEventListener('load', () => queueCardTextRefit(parent));

  icon.append(base, timing);
  parent.appendChild(icon);
  setSymbolTooltips(icon, [
    {
      key: resolveRulebookSymbolTooltipId(actionToken),
      previewKind: 'image',
      previewToken: actionToken,
    },
  ]);
  setSymbolTooltips(timing, [
    {
      key: 'timing-marker',
      previewKind: 'timing',
    },
  ]);
};

const appendInlineIconToken = (parent, part) => {
  const token = part.slice(1, -1).trim();
  if (!token) return;
  const cardFlowMatch = token.match(/^(draw|discard)\s+([0-9]+|x)$/i);
  if (cardFlowMatch) {
    const icon = buildInlineCardFlowIcon({
      type: cardFlowMatch[1],
      amountLabel: cardFlowMatch[2],
      token,
    });
    if (icon) {
      parent.appendChild(icon);
      return;
    }
  }
  const adrenalineMatch = token.match(/^adr([+-])\s*([0-9]+|x)$/i);
  if (adrenalineMatch) {
    const icon = buildInlineAdrenalineIcon({
      sign: adrenalineMatch[1],
      amountLabel: adrenalineMatch[2],
      token,
    });
    if (icon) {
      parent.appendChild(icon);
      return;
    }
  }
  const adrenalineThresholdMatch = token.match(/^adr\s*([0-9]+)$/i);
  if (adrenalineThresholdMatch) {
    const icon = buildInlineAdrenalineIcon({
      sign: '',
      amountLabel: adrenalineThresholdMatch[1],
      token,
    });
    if (icon) {
      parent.appendChild(icon);
      return;
    }
  }
  const submittedAdrenalineMatch = token.match(/^adr\s*x$/i);
  if (submittedAdrenalineMatch) {
    const icon = buildInlineAdrenalineIcon({
      sign: '',
      amountLabel: 'X',
      token,
    });
    if (icon) {
      parent.appendChild(icon);
      return;
    }
  }
  const normalizedToken = token.toLowerCase();
  if (normalizedToken === 'red damage capsule') {
    const capsule = document.createElement('span');
    capsule.className = 'card-inline-damage-capsule';
    capsule.textContent = '12';
    capsule.setAttribute('aria-label', token);
    parent.appendChild(capsule);
    setSymbolTooltips(capsule, [
      {
        key: 'damage-badge',
        previewKind: 'stat',
        previewToken: 'DamageIcon',
        value: '12',
      },
    ]);
    return;
  }
  if (normalizedToken === 'throw kbf icon') {
    const throwKbf = document.createElement('span');
    throwKbf.className = 'card-inline-throw-kbf';
    throwKbf.setAttribute('role', 'img');
    throwKbf.setAttribute('aria-label', token);
    const throwText = document.createElement('span');
    throwText.className = 'card-inline-throw-kbf-value';
    throwText.textContent = 'T';
    throwKbf.appendChild(throwText);
    parent.appendChild(throwKbf);
    setSymbolTooltips(throwKbf, [
      {
        key: 'throw-kbf',
        previewKind: 'stat',
        previewToken: 'KnockBackIcon',
        value: 'T',
        muted: true,
      },
    ]);
    return;
  }
  appendInlineImage(parent, token, token);
};

const appendInlineActionIconToken = (parent, part) => {
  const token = part.slice(1, -1).trim();
  if (!token) return;
  const image = appendInlineImage(parent, token, token);
  if (!image) return;
  const key = resolveRulebookSymbolTooltipId(token);
  if (!key) return;
  setSymbolTooltips(image, [
    {
      key,
      previewKind: 'image',
      previewToken: token,
    },
  ]);
};

export const appendInlineText = (container, text) => {
  container.textContent = '';
  if (!text) return;
  const lines = `${text}`.split(/\r?\n/);
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      container.appendChild(document.createElement('br'));
    }
    const stack = [container];
    let cursor = 0;
    const pushText = (value) => {
      if (!value) return;
      stack[stack.length - 1].appendChild(document.createTextNode(value));
    };
    const matches = Array.from(line.matchAll(INLINE_STYLE_TOKEN_PATTERN));
    for (let matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
      const match = matches[matchIndex];
      const token = match[0];
      const index = Number.isFinite(match.index) ? match.index : 0;
      if (index > cursor) {
        pushText(line.slice(cursor, index));
      }
      const currentIconToken = parseInlineIconToken(token);
      if (currentIconToken) {
        const nextMatch = matches[matchIndex + 1];
        const nextToken = nextMatch?.[0] ?? '';
        const nextIndex = Number.isFinite(nextMatch?.index) ? nextMatch.index : -1;
        const timingPhase = getInlineTimingPhase(nextToken);
        const onlyWhitespaceBetween = nextIndex >= 0 ? !line.slice(index + token.length, nextIndex).trim() : false;
        if (timingPhase && onlyWhitespaceBetween && isInlineActionToken(currentIconToken)) {
          appendInlineActionWithTimingIcon(stack[stack.length - 1], currentIconToken, timingPhase);
          cursor = nextIndex + nextToken.length;
          matchIndex += 1;
          continue;
        }
      }
      if (token.startsWith('{') && token.endsWith('}')) {
        appendInlineIconToken(stack[stack.length - 1], token);
        cursor = index + token.length;
        continue;
      }
      if (token.startsWith('[') && token.endsWith(']')) {
        appendInlineActionIconToken(stack[stack.length - 1], token);
        cursor = index + token.length;
        continue;
      }
      const isClosing = token.startsWith('</');
      const rawTag = token.replace(/[</>]/g, '');
      const tag = normalizeInlineStyleTag(rawTag);
      if (!isClosing) {
        const className = INLINE_STYLE_CLASS_BY_TAG[tag];
        if (!className) {
          pushText(token);
          cursor = index + token.length;
          continue;
        }
        const span = document.createElement('span');
        span.className = className;
        span.dataset.inlineTag = tag;
        stack[stack.length - 1].appendChild(span);
        stack.push(span);
        cursor = index + token.length;
        continue;
      }
      let foundIndex = -1;
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i]?.dataset?.inlineTag === tag) {
          foundIndex = i;
          break;
        }
      }
      if (foundIndex >= 0) {
        stack.length = foundIndex;
      } else {
        pushText(token);
      }
      cursor = index + token.length;
    }
    if (cursor < line.length) {
      pushText(line.slice(cursor));
    }
  });
};

const getCardScale = (element) => {
  if (!element) return 1;
  const scaleValue = Number.parseFloat(getComputedStyle(element).getPropertyValue('--action-card-scale'));
  return Number.isFinite(scaleValue) && scaleValue > 0 ? scaleValue : 1;
};

const fitFontSizeToBounds = ({ element, width, height, minSize, maxSize, hardMinSize }) => {
  if (!element || !width || !height) return;
  const safeMinSize = Number.isFinite(minSize) ? Math.max(0, minSize) : 0;
  const safeHardMinSize = Number.isFinite(hardMinSize)
    ? Math.max(0, Math.min(safeMinSize, hardMinSize))
    : 0;
  const safeMaxSize = Number.isFinite(maxSize) ? Math.max(safeMinSize, maxSize) : safeMinSize;
  if (!safeMaxSize) return;
  const epsilon = 0.75;
  const fits = () => element.scrollHeight <= height + epsilon && element.scrollWidth <= width + epsilon;
  const setSize = (size) => {
    element.style.fontSize = `${Math.max(safeMinSize, Math.min(safeMaxSize, size))}px`;
  };
  setSize(safeMinSize);
  if (!fits()) {
    if (!safeHardMinSize || safeHardMinSize >= safeMinSize) return;
    let low = safeHardMinSize;
    let high = safeMinSize;
    let bestSize = safeHardMinSize;
    setSize(safeHardMinSize);
    if (!fits()) return;
    for (let i = 0; i < 12; i += 1) {
      const mid = (low + high) / 2;
      setSize(mid);
      if (fits()) {
        bestSize = mid;
        low = mid;
      } else {
        high = mid;
      }
    }
    setSize(bestSize);
    return;
  }
  setSize(safeMaxSize);
  if (fits()) return;
  let low = safeMinSize;
  let high = safeMaxSize;
  let bestSize = safeMinSize;
  for (let i = 0; i < 14; i += 1) {
    const mid = (low + high) / 2;
    setSize(mid);
    if (fits()) {
      bestSize = mid;
      low = mid;
    } else {
      high = mid;
    }
  }
  setSize(bestSize);
};

const fitTextToRow = (row) => {
  const text = row.querySelector('.action-card-surface-text');
  if (!text || !text.textContent.trim()) return;
  text.style.fontSize = '';
  const rowHeight = row.clientHeight;
  const rowWidth = row.clientWidth;
  if (!rowHeight || !rowWidth) return;
  const baseSize = Number.parseFloat(getComputedStyle(text).fontSize) || 10;
  const scaleValue = getCardScale(row);
  const minSize = Math.max(MIN_SURFACE_TEXT_PX, MIN_SURFACE_TEXT_PX * scaleValue);
  const hardMinSize = Math.max(HARD_MIN_SURFACE_TEXT_PX, HARD_MIN_SURFACE_TEXT_PX * scaleValue);
  const maxSize = Math.max(minSize, Math.min(baseSize * MAX_ROW_TEXT_GROWTH, rowHeight * 0.82));
  fitFontSizeToBounds({
    element: text,
    width: rowWidth,
    height: rowHeight,
    minSize,
    maxSize,
    hardMinSize,
  });
};

const fitTitleToHeader = (title) => {
  if (!title || !title.textContent.trim()) return;
  title.style.fontSize = '';
  const titleWidth = title.clientWidth;
  const titleHeight = title.clientHeight;
  if (!titleWidth || !titleHeight) return;
  const baseSize = Number.parseFloat(getComputedStyle(title).fontSize) || 10;
  const scaleValue = getCardScale(title);
  const minSize = Math.max(6, 6 * scaleValue);
  fitFontSizeToBounds({ element: title, width: titleWidth, height: titleHeight, minSize, maxSize: baseSize });
};

export const fitAllCardText = (root = document) => {
  root.querySelectorAll('.action-card-title').forEach((title) => fitTitleToHeader(title));
  root.querySelectorAll('.action-card-surface-row').forEach((row) => fitTextToRow(row));
};

const shouldRenderStatBadges = (card) => {
  const actions = Array.isArray(card?.actions) ? card.actions : [];
  return actions.some((action) => actionHasAttackOrChargeToken(action));
};

export const buildCardElement = (card, options = {}) => {
  const { asButton = false, className = '', deferArtLoad = false } = options;
  const element = document.createElement(asButton ? 'button' : 'div');
  if (asButton) {
    element.type = 'button';
  }
  element.className = 'action-card';
  if (className) {
    className
      .split(' ')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => element.classList.add(entry));
  }
  element.dataset.cardId = card.id;
  element.dataset.cardType = card.type;
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', card.name);

  const header = document.createElement('div');
  header.className = 'action-card-header';

  const title = document.createElement('span');
  title.className = 'action-card-title';
  if (MANDATORY_MOVEMENT_CARD_IDS.has(card.id)) {
    title.classList.add('is-mandatory-movement');
  }
  if (card.signatureGroup === 'movement' || card.signatureGroup === 'ability') {
    title.classList.add('is-signature-card');
  }
  title.textContent = card.name;
  title.title = card.name;
  header.appendChild(title);

  const badgeRow = document.createElement('div');
  badgeRow.className = 'action-card-badges';

  const rotationBadge = document.createElement('span');
  rotationBadge.className = 'action-card-badge action-card-rotation';
  rotationBadge.style.backgroundImage = `url('${buildRotationIconUrl(card.rotations)}')`;
  rotationBadge.setAttribute('aria-label', `Rotation ${card.rotations ?? '*'}`);
  setSymbolTooltips(rotationBadge, [
    {
      key: 'rotation-badge',
      previewKind: 'image',
      previewToken: buildRotationPreviewToken(card.rotations),
    },
  ]);
  badgeRow.appendChild(rotationBadge);

  header.appendChild(badgeRow);

  const body = document.createElement('div');
  body.className = 'action-card-body';

  const actions = document.createElement('div');
  actions.className = 'action-card-actions';
  const cardActions = ensureActionList(card.actions);
  const cardTimings = Array.isArray(card?.timings) ? card.timings : [];
  cardActions.forEach((action, index) => {
    actions.appendChild(buildActionIcon(action, cardTimings[index]));
  });

  const surface = document.createElement('div');
  surface.className = 'action-card-surface';
  const triggerTextValue = typeof card?.triggerText === 'string' ? card.triggerText.trim() : '';

  const emptyRow = document.createElement('div');
  emptyRow.className = 'action-card-surface-row is-empty';
  const art = document.createElement('img');
  art.className = 'action-card-art';
  const artUrl = buildCardArtUrl(card.name);
  if (deferArtLoad) {
    art.dataset.cardArtSrc = artUrl;
  } else {
    art.src = artUrl;
  }
  art.alt = `${card.name} art`;
  art.loading = 'lazy';
  art.decoding = 'async';
  art.addEventListener(
    'error',
    () => {
      emptyRow.classList.add('is-missing-art');
      art.remove();
    },
    { once: true },
  );
  emptyRow.appendChild(art);
  if (deferArtLoad) {
    deferCardArtLoad(art);
  }

  let triggerRow = null;
  if (triggerTextValue) {
    triggerRow = document.createElement('div');
    triggerRow.className = 'action-card-surface-row is-trigger';
    const triggerText = document.createElement('div');
    triggerText.className = 'action-card-surface-text';
    triggerRow.appendChild(triggerText);
    appendInlineText(triggerText, triggerTextValue);
    surface.classList.add('has-trigger-text');
  }

  const activeRow = document.createElement('div');
  activeRow.className = 'action-card-surface-row is-active';
  const activeText = document.createElement('div');
  activeText.className = 'action-card-surface-text';
  activeRow.appendChild(activeText);
  appendInlineText(activeText, card.activeText);

  const passiveRow = document.createElement('div');
  passiveRow.className = 'action-card-surface-row is-passive';
  const passiveText = document.createElement('div');
  passiveText.className = 'action-card-surface-text';
  passiveRow.appendChild(passiveText);
  appendInlineText(passiveText, card.passiveText);

  surface.appendChild(emptyRow);
  if (triggerRow) {
    surface.appendChild(triggerRow);
  }
  surface.appendChild(activeRow);
  surface.appendChild(passiveRow);

  body.appendChild(actions);
  body.appendChild(surface);

  if (shouldRenderStatBadges(card)) {
    const stats = document.createElement('div');
    stats.className = 'action-card-stats';
    if (triggerRow) {
      stats.classList.add('has-trigger-text');
    }
    stats.appendChild(buildStatBadge('damage', card.damage, DAMAGE_ICON_URL));
    stats.appendChild(buildStatBadge('kbf', card.kbf, KNOCKBACK_ICON_URL));
    body.appendChild(stats);
  }

  element.appendChild(header);
  element.appendChild(body);

  return element;
};
