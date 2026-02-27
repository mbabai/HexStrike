import { appendInlineText } from './cardRenderer.js';

const ACTION_ICON_FALLBACK = 'W';
const ROTATION_ICON_FALLBACK = 'rotStar';
const PRIORITY_ICON_URL = '/public/images/priority.png';
const ADRENALINE_ICON_URL = '/public/images/Adrenaline.png';
const CARD_ART_BASE_URL = '/public/images/cardart';
const UNIQUE_MOVEMENT_CARD_IDS = new Set(['grappling-hook', 'fleche', 'leap']);
const MANDATORY_MOVEMENT_CARD_IDS = new Set(['step']);

const buildActionIconUrl = (action) => {
  const key = `${action ?? ''}`.trim();
  const name = key || ACTION_ICON_FALLBACK;
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

const stripActionBrackets = (value) => {
  const trimmed = `${value ?? ''}`.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const isAdrenalineAction = (action) => /^adr[+-]\d+$/i.test(`${action ?? ''}`.trim());

const extractAdrenalineActionValue = (action) => {
  const match = /^adr([+-]\d+)$/i.exec(`${action ?? ''}`.trim());
  return match ? match[1] : '';
};

const getSubBeatDescriptor = (subBeat) => {
  if (!subBeat || typeof subBeat !== 'object') return { label: '', isRange: false };
  if (Number.isFinite(subBeat.start) && Number.isFinite(subBeat.end)) {
    return { label: `${Math.round(subBeat.start)}-${Math.round(subBeat.end)}`, isRange: true };
  }
  if (Number.isFinite(subBeat.value)) {
    return { label: `${Math.round(subBeat.value)}`, isRange: false };
  }
  return { label: '', isRange: false };
};

const ensureTerminalEndBeat = (beats) => {
  if (!beats.length) {
    return [{ beat: 1, action: 'E', subBeat: null, text: [] }];
  }
  const last = beats[beats.length - 1];
  if (`${last?.action ?? ''}`.trim().toUpperCase() === 'E') {
    return beats;
  }
  const nextBeat = Number.isFinite(last?.beat) ? Math.max(1, Math.round(last.beat) + 1) : beats.length + 1;
  return [...beats, { beat: nextBeat, action: 'E', subBeat: null, text: [] }];
};

const getCardBeats = (card) => {
  if (Array.isArray(card?.beats) && card.beats.length) {
    const beats = card.beats.map((beat, index) => ({
      beat: Number.isFinite(beat?.beat) ? Math.max(1, Math.round(beat.beat)) : index + 1,
      action: `${beat?.action ?? ''}`.trim() || 'E',
      subBeat: beat?.subBeat && typeof beat.subBeat === 'object' ? beat.subBeat : null,
      text: Array.isArray(beat?.text) ? beat.text : [],
      damage: beat?.damage ?? null,
      kbf: beat?.kbf ?? null,
    }));
    return ensureTerminalEndBeat(beats);
  }
  const actions = Array.isArray(card?.actions) ? card.actions : [];
  const beats = actions.map((action, index) => ({
    beat: index + 1,
    action: `${action ?? ''}`.trim() || 'E',
    subBeat: null,
    text: [],
    damage: null,
    kbf: null,
  }));
  return ensureTerminalEndBeat(beats);
};

const normalizeBeatTextEntry = (entry) => {
  if (!entry) return '';
  if (typeof entry === 'string') return entry.trim();
  if (typeof entry !== 'object') return '';
  const body = typeof entry.text === 'string' ? entry.text.trim() : '';
  if (!body) return '';
  const marker = typeof entry.placeholder === 'string' && entry.placeholder.trim() ? entry.placeholder.trim().toUpperCase() : '';
  if (!marker || marker === 'X1' || marker === 'X2') return body;
  return `{${marker}} ${body}`;
};

const injectAdrenalineTokens = (text) => {
  if (!text) return '';
  let next = `${text}`.replace(/\{X1\}|\{X2\}/gi, ' ');
  next = next.replace(/\{Adr\s*:\s*([^}]+)\}/gi, '{Adrenaline:$1}');
  next = next.replace(/\{Adrenaline\s*:\s*X\s*\}/gi, '{Adrenaline:1}');
  next = next.replace(/\bAdrenaline\s*([<>])\s*(\d+)\s*:\s*/gi, (_full, op, value) => `{Adrenaline:${op}${value}} `);
  next = next.replace(/\bAdrenaline\s*([<>])\s*(\d+)/gi, (_full, op, value) => `{Adrenaline:${op}${value}}`);
  next = next.replace(/\bFor\s+every\s+(\d+)\s+(?:submitted\s+)?Adrenaline\b/gi, (_full, value) => `For every {Adrenaline:${value}}`);
  next = next.replace(/\bFor\s+each\s+(?:submitted\s+)?Adrenaline\b/gi, 'For each {Adrenaline:1}');
  next = next.replace(/\bAdr([+-]\d+)\b/gi, (_full, delta) => `{Adrenaline:${delta}}`);
  next = next.replace(/\s+([,.;:!?])/g, '$1');
  next = next.replace(/[ \t]{2,}/g, ' ').trim();
  return next;
};

const getBeatBodyText = (beat) => {
  const entries = Array.isArray(beat?.text) ? beat.text : [];
  const normalized = entries.map((entry) => normalizeBeatTextEntry(entry)).filter(Boolean).join(' ');
  return `${normalized}`.trim();
};

const buildBeatText = (beat) => {
  const textBody = getBeatBodyText(beat);
  const statParts = [];
  if (beat?.damage !== null && beat?.damage !== undefined) {
    statParts.push(`{Damage:${beat.damage}}`);
  }
  if (beat?.kbf !== null && beat?.kbf !== undefined) {
    statParts.push(`{KBF:${beat.kbf}}`);
  }
  if (!statParts.length) return textBody;
  if (!textBody) return statParts.join('');
  return `${statParts.join('')} | ${textBody}`;
};

const buildAdrenalineBadge = (label, className) => {
  const badge = document.createElement('span');
  badge.className = className;
  badge.style.backgroundImage = `url('${ADRENALINE_ICON_URL}')`;
  if (label) {
    const value = document.createElement('span');
    value.className = `${className}-value`;
    value.textContent = label;
    badge.appendChild(value);
  }
  return badge;
};

const buildBeatIcon = (action, isPlaceholder = false) => {
  const iconWrap = document.createElement('div');
  iconWrap.className = 'action-card-alt-row-icon';
  if (isPlaceholder) {
    iconWrap.classList.add('is-placeholder');
    return iconWrap;
  }
  const normalizedAction = stripActionBrackets(action);
  if (isAdrenalineAction(normalizedAction)) {
    const value = extractAdrenalineActionValue(normalizedAction);
    const adrenaline = buildAdrenalineBadge(value, 'action-card-alt-adrenaline');
    adrenaline.setAttribute('aria-label', `Adrenaline ${value}`);
    iconWrap.appendChild(adrenaline);
    return iconWrap;
  }
  const icon = document.createElement('span');
  icon.className = 'action-card-alt-action-icon';
  icon.style.backgroundImage = `url('${buildActionIconUrl(normalizedAction || ACTION_ICON_FALLBACK)}')`;
  icon.setAttribute('aria-label', normalizedAction || ACTION_ICON_FALLBACK);
  iconWrap.appendChild(icon);
  return iconWrap;
};

const isWaitAction = (action) => stripActionBrackets(action).toUpperCase() === 'W';

const buildSubBeatBadge = (action, subBeat) => {
  const { label, isRange } = getSubBeatDescriptor(subBeat);
  const badge = document.createElement('div');
  badge.className = 'action-card-alt-subbeat';
  if (!label || isWaitAction(action)) {
    badge.classList.add('is-empty');
    return badge;
  }
  badge.style.backgroundImage = `url('${PRIORITY_ICON_URL}')`;
  const value = document.createElement('span');
  value.className = 'action-card-alt-subbeat-value';
  value.classList.add(isRange ? 'is-range' : 'is-single');
  value.textContent = label;
  badge.appendChild(value);
  return badge;
};

const appendTextBlock = (container, text) => {
  const normalized = injectAdrenalineTokens(text);
  appendInlineText(container, normalized);
};

const getCardScale = (element) => {
  if (!element) return 1;
  const scaleValue = Number.parseFloat(getComputedStyle(element).getPropertyValue('--action-card-scale'));
  return Number.isFinite(scaleValue) && scaleValue > 0 ? scaleValue : 1;
};

const fitFontSizeToBounds = ({ element, width, height, baseSize, minSize, maxSize }) => {
  if (!element || !width || !height || !baseSize) return;
  const safeMin = Math.max(0, Math.min(minSize, baseSize));
  const safeMax = Math.max(baseSize, maxSize);
  const epsilon = 0.5;
  const fits = () => element.scrollHeight <= height + epsilon && element.scrollWidth <= width + epsilon;
  let low = safeMin;
  let high = safeMax;
  let best = safeMin;
  for (let step = 0; step < 14; step += 1) {
    const mid = (low + high) / 2;
    element.style.fontSize = `${mid}px`;
    if (fits()) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }
  element.style.fontSize = `${best}px`;
};

const fitTextNode = (element, options = {}) => {
  if (!element || !element.textContent?.trim()) return;
  const {
    minScale = 0.6,
    maxScale = 2.5,
    width = element.clientWidth,
    height = element.clientHeight,
  } = options;
  if (!width || !height) return;
  element.style.fontSize = '';
  const baseSize = Number.parseFloat(getComputedStyle(element).fontSize);
  if (!Number.isFinite(baseSize) || baseSize <= 0) return;
  fitFontSizeToBounds({
    element,
    width,
    height,
    baseSize,
    minSize: baseSize * minScale,
    maxSize: baseSize * maxScale,
  });
};

const getElementContentBox = (element) => {
  if (!element) return { width: 0, height: 0 };
  const styles = getComputedStyle(element);
  const paddingX = (Number.parseFloat(styles.paddingLeft) || 0) + (Number.parseFloat(styles.paddingRight) || 0);
  const paddingY = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0);
  return {
    width: Math.max(0, element.clientWidth - paddingX),
    height: Math.max(0, element.clientHeight - paddingY),
  };
};

export const fitAltCardText = (root = document) => {
  root.querySelectorAll('.action-card-alt .action-card-title').forEach((title) => {
    fitTextNode(title, {
      minScale: 0.6,
      maxScale: 1.9,
      width: title.clientWidth,
      height: title.clientHeight,
    });
  });

  root.querySelectorAll('.action-card-alt-row-text').forEach((rowText) => {
    const row = rowText.closest('.action-card-alt-row');
    fitTextNode(rowText, {
      minScale: 0.22,
      maxScale: 1,
      width: rowText.clientWidth,
      height: (row?.clientHeight || rowText.clientHeight) * 0.9,
    });
  });

  root.querySelectorAll('.action-card-alt-box-body').forEach((boxBody) => {
    const box = boxBody.closest('.action-card-alt-box');
    const bounds = getElementContentBox(box);
    fitTextNode(boxBody, {
      minScale: 0.24,
      maxScale: 1,
      width: bounds.width || boxBody.clientWidth,
      height: bounds.height || boxBody.clientHeight,
    });
  });

  root.querySelectorAll('.action-card-alt-subbeat-value').forEach((value) => {
    const parent = value.parentElement;
    if (!parent) return;
    const scale = getCardScale(parent);
    const baseMin = value.classList.contains('is-range') ? 8.32 : 12.4;
    const baseMax = value.classList.contains('is-range') ? 20 : 32;
    fitTextNode(value, {
      minScale: 0.4,
      maxScale: 1,
      width: parent.clientWidth * 0.8,
      height: parent.clientHeight * 0.62,
    });
    const current = Number.parseFloat(getComputedStyle(value).fontSize) || baseMin * scale;
    const clamped = Math.max(baseMin * scale, Math.min(baseMax * scale, current));
    value.style.fontSize = `${clamped}px`;
  });

  root.querySelectorAll('.action-card-alt-adrenaline-value').forEach((value) => {
    const parent = value.parentElement;
    if (!parent) return;
    fitTextNode(value, {
      minScale: 0.7,
      maxScale: 1.8,
      width: parent.clientWidth * 0.6,
      height: parent.clientHeight * 0.45,
    });
  });
};

export const buildAltCardElement = (card, options = {}) => {
  const { asButton = false, className = '' } = options;
  const element = document.createElement(asButton ? 'button' : 'div');
  if (asButton) element.type = 'button';

  element.className = 'action-card action-card-alt';
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
  header.className = 'action-card-header action-card-alt-header';

  const badges = document.createElement('div');
  badges.className = 'action-card-badges action-card-alt-badges';
  const rotationBadge = document.createElement('span');
  rotationBadge.className = 'action-card-badge action-card-rotation action-card-alt-rotation';
  rotationBadge.style.backgroundImage = `url('${buildRotationIconUrl(card.rotations)}')`;
  rotationBadge.setAttribute('aria-label', `Rotation ${card.rotations ?? '*'}`);
  badges.appendChild(rotationBadge);

  const title = document.createElement('span');
  title.className = 'action-card-title action-card-alt-title';
  if (MANDATORY_MOVEMENT_CARD_IDS.has(card.id)) {
    title.classList.add('is-mandatory-movement');
  }
  if (card.type === 'movement' && UNIQUE_MOVEMENT_CARD_IDS.has(card.id)) {
    title.classList.add('is-unique-movement');
  }
  title.textContent = card.name;
  title.title = card.name;

  header.appendChild(badges);
  header.appendChild(title);

  const body = document.createElement('div');
  body.className = 'action-card-body action-card-alt-body';

  const artLayer = document.createElement('div');
  artLayer.className = 'action-card-alt-art';
  const artImage = document.createElement('img');
  artImage.className = 'action-card-alt-art-image';
  artImage.src = buildCardArtUrl(card.name);
  artImage.alt = `${card.name} art`;
  artImage.loading = 'lazy';
  artImage.decoding = 'async';
  artImage.addEventListener(
    'error',
    () => {
      artLayer.classList.add('is-missing-art');
      artImage.remove();
    },
    { once: true },
  );
  artLayer.appendChild(artImage);
  body.appendChild(artLayer);

  const beatsContainer = document.createElement('div');
  beatsContainer.className = 'action-card-alt-beats';
  const allBeats = getCardBeats(card);
  const hasTerminalEnd = allBeats.length && `${allBeats[allBeats.length - 1].action ?? ''}`.trim().toUpperCase() === 'E';
  const isSixBeatTerminalEnd = allBeats.length === 6 && hasTerminalEnd;
  if (isSixBeatTerminalEnd) {
    beatsContainer.classList.add('is-six-beat-terminal-end');
  }
  const beats =
    allBeats.length <= 6
      ? allBeats
      : hasTerminalEnd
        ? [...allBeats.slice(0, 5), allBeats[allBeats.length - 1]]
        : allBeats.slice(0, 6);
  let previousBeat = null;
  let previousHasBodyText = false;
  for (let index = 0; index < 6; index += 1) {
    const beat = beats[index] ?? null;
    const hasBodyText = beat ? getBeatBodyText(beat).length > 0 : false;
    const row = document.createElement('div');
    row.className = 'action-card-alt-row';
    if (!beat) row.classList.add('is-empty');
    if (`${beat?.action ?? ''}`.trim().toUpperCase() === 'E') {
      row.classList.add('is-end-beat');
    }
    if (beat && previousBeat && (hasBodyText || previousHasBodyText)) {
      row.classList.add('has-divider-before');
    }

    row.appendChild(buildBeatIcon(beat?.action ?? '', !beat));

    const rowText = document.createElement('div');
    rowText.className = 'action-card-alt-row-text';
    if (beat) {
      appendTextBlock(rowText, buildBeatText(beat));
    }
    row.appendChild(rowText);

    row.appendChild(buildSubBeatBadge(beat?.action ?? '', beat?.subBeat));
    beatsContainer.appendChild(row);

    previousBeat = beat;
    previousHasBodyText = hasBodyText;
  }
  body.appendChild(beatsContainer);

  const triggerText = typeof card.triggerText === 'string' ? card.triggerText.trim() : '';
  if (triggerText) {
    const trigger = document.createElement('section');
    trigger.className = 'action-card-alt-box action-card-alt-trigger';
    const triggerBody = document.createElement('div');
    triggerBody.className = 'action-card-alt-box-body';
    appendTextBlock(triggerBody, triggerText);
    trigger.appendChild(triggerBody);
    body.appendChild(trigger);
  }

  const passive = document.createElement('section');
  passive.className = 'action-card-alt-box action-card-alt-passive';
  const passiveBody = document.createElement('div');
  passiveBody.className = 'action-card-alt-box-body';
  const passiveText = typeof card.passiveText === 'string' ? card.passiveText.trim() : '';
  appendTextBlock(passiveBody, passiveText);
  passive.appendChild(passiveBody);
  body.appendChild(passive);

  element.appendChild(header);
  element.appendChild(body);
  return element;
};
