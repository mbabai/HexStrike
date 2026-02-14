const ACTION_ICON_FALLBACK = 'empty';
const ROTATION_ICON_FALLBACK = 'rotStar';
const PRIORITY_ICON_URL = '/public/images/priority.png';
const DAMAGE_ICON_URL = '/public/images/DamageIcon.png';
const KNOCKBACK_ICON_URL = '/public/images/KnockBackIcon.png';
const EMPHASIS_ICON_URL = '/public/images/i.png';
const CARD_ART_BASE_URL = '/public/images/cardart';

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

const buildActionIconUrl = (action) => {
  const key = `${action ?? ''}`.trim();
  const name = key ? key : ACTION_ICON_FALLBACK;
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

const ensureActionList = (actions) => {
  const list = Array.isArray(actions) ? [...actions] : [];
  if (!list.length) return ['E'];
  const last = stripActionBrackets(list[list.length - 1]);
  if (last.toUpperCase() !== 'E') {
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
  return stat;
};

const buildActionIcon = (action) => {
  const icon = document.createElement('span');
  icon.className = 'action-card-action';
  const { label, emphasized } = parseActionToken(action);
  const iconUrl = buildActionIconUrl(label);
  if (emphasized) {
    icon.classList.add('is-emphasized');
    icon.style.backgroundImage = `url('${EMPHASIS_ICON_URL}'), url('${iconUrl}')`;
    icon.style.backgroundSize = '100% 100%, 80% 80%';
    icon.style.backgroundPosition = 'center, center';
    icon.style.backgroundRepeat = 'no-repeat, no-repeat';
  } else {
    icon.style.backgroundImage = `url('${iconUrl}')`;
  }
  icon.setAttribute('aria-label', label);
  return icon;
};

export const appendInlineText = (container, text) => {
  container.textContent = '';
  if (!text) return;
  const lines = `${text}`.split(/\r?\n/);
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      container.appendChild(document.createElement('br'));
    }
    const parts = line.split(/(\{[^}]+\})/g);
    parts.forEach((part) => {
      if (!part) return;
      if (part.startsWith('{') && part.endsWith('}')) {
        const token = part.slice(1, -1).trim();
        if (!token) return;
        const normalizedToken = token.toLowerCase();
        if (normalizedToken === 'red damage capsule') {
          const capsule = document.createElement('span');
          capsule.className = 'card-inline-damage-capsule';
          capsule.textContent = '12';
          capsule.setAttribute('aria-label', token);
          container.appendChild(capsule);
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
          container.appendChild(throwKbf);
          return;
        }
        const image = document.createElement('img');
        image.className = 'card-inline-icon';
        image.src = `/public/images/${token}.png`;
        image.alt = token;
        image.loading = 'lazy';
        container.appendChild(image);
        return;
      }
      container.appendChild(document.createTextNode(part));
    });
  });
};

const getCardScale = (element) => {
  if (!element) return 1;
  const scaleValue = Number.parseFloat(getComputedStyle(element).getPropertyValue('--action-card-scale'));
  return Number.isFinite(scaleValue) && scaleValue > 0 ? scaleValue : 1;
};

const fitTextToRow = (row) => {
  const text = row.querySelector('.action-card-surface-text');
  if (!text || !text.textContent.trim()) return;
  text.style.fontSize = '';
  const rowHeight = row.clientHeight;
  const rowWidth = row.clientWidth;
  if (!rowHeight || !rowWidth) return;
  let size = Number.parseFloat(getComputedStyle(text).fontSize) || 10;
  const scaleValue = getCardScale(row);
  const minSize = 5 * scaleValue;
  let safety = 0;
  while ((text.scrollHeight > rowHeight || text.scrollWidth > rowWidth) && size > minSize && safety < 32) {
    size = Math.max(minSize, size - 0.5);
    text.style.fontSize = `${size}px`;
    safety += 1;
  }
};

const fitTitleToHeader = (title) => {
  if (!title || !title.textContent.trim()) return;
  title.style.fontSize = '';
  const titleWidth = title.clientWidth;
  const titleHeight = title.clientHeight;
  if (!titleWidth || !titleHeight) return;
  let size = Number.parseFloat(getComputedStyle(title).fontSize) || 10;
  const scaleValue = getCardScale(title);
  const minSize = 6 * scaleValue;
  let safety = 0;
  while ((title.scrollWidth > titleWidth || title.scrollHeight > titleHeight) && size > minSize && safety < 32) {
    size = Math.max(minSize, size - 0.5);
    title.style.fontSize = `${size}px`;
    safety += 1;
  }
};

export const fitAllCardText = (root = document) => {
  root.querySelectorAll('.action-card-title').forEach((title) => fitTitleToHeader(title));
  root.querySelectorAll('.action-card-surface-row').forEach((row) => fitTextToRow(row));
};

export const buildCardElement = (card, options = {}) => {
  const { asButton = false, className = '' } = options;
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
  title.textContent = card.name;
  title.title = card.name;
  header.appendChild(title);

  const badgeRow = document.createElement('div');
  badgeRow.className = 'action-card-badges';

  const rotationBadge = document.createElement('span');
  rotationBadge.className = 'action-card-badge action-card-rotation';
  rotationBadge.style.backgroundImage = `url('${buildRotationIconUrl(card.rotations)}')`;
  rotationBadge.setAttribute('aria-label', `Rotation ${card.rotations ?? '*'}`);
  badgeRow.appendChild(rotationBadge);

  const priorityBadge = document.createElement('span');
  priorityBadge.className = 'action-card-badge action-card-priority';
  priorityBadge.style.backgroundImage = `url('${PRIORITY_ICON_URL}')`;
  const priorityValue = document.createElement('span');
  priorityValue.className = 'action-card-priority-value';
  priorityValue.textContent = `${card.priority ?? 0}`;
  priorityBadge.appendChild(priorityValue);
  badgeRow.appendChild(priorityBadge);

  header.appendChild(badgeRow);

  const body = document.createElement('div');
  body.className = 'action-card-body';

  const actions = document.createElement('div');
  actions.className = 'action-card-actions';
  ensureActionList(card.actions).forEach((action) => {
    actions.appendChild(buildActionIcon(action));
  });

  const surface = document.createElement('div');
  surface.className = 'action-card-surface';

  const emptyRow = document.createElement('div');
  emptyRow.className = 'action-card-surface-row is-empty';
  const art = document.createElement('img');
  art.className = 'action-card-art';
  art.src = buildCardArtUrl(card.name);
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
  surface.appendChild(activeRow);
  surface.appendChild(passiveRow);

  body.appendChild(actions);
  body.appendChild(surface);

  if (card.type === 'ability') {
    const stats = document.createElement('div');
    stats.className = 'action-card-stats';
    stats.appendChild(buildStatBadge('damage', card.damage, DAMAGE_ICON_URL));
    stats.appendChild(buildStatBadge('kbf', card.kbf, KNOCKBACK_ICON_URL));
    body.appendChild(stats);
  }

  element.appendChild(header);
  element.appendChild(body);

  return element;
};
