import { getBeatEntryForCharacter } from './beatTimeline.js';
import { getTimeIndicatorActionTarget, getTimeIndicatorLayout } from './timeIndicatorView.js';
import { appendInlineText } from '../shared/cardRenderer.js';

const normalizeSymbolText = (text) => {
  const raw = `${text ?? ''}`.trim();
  if (!raw) return '';
  return raw.replace(/^\s*[:\-]\s*/, '').trim();
};

const parseSymbolInstructions = (text) => {
  const map = new Map();
  const raw = `${text ?? ''}`;
  if (!raw.trim()) return map;
  const pattern = /\{(X1|X2|i)\}/g;
  let match = pattern.exec(raw);
  if (!match) return map;
  let lastSymbol = null;
  let lastIndex = 0;
  while (match) {
    if (lastSymbol) {
      const segment = raw.slice(lastIndex, match.index);
      const cleaned = normalizeSymbolText(segment);
      if (cleaned) {
        map.set(lastSymbol, cleaned);
      }
    }
    lastSymbol = match[1];
    lastIndex = pattern.lastIndex;
    match = pattern.exec(raw);
  }
  if (lastSymbol) {
    const segment = raw.slice(lastIndex);
    const cleaned = normalizeSymbolText(segment);
    if (cleaned) {
      map.set(lastSymbol, cleaned);
    }
  }
  return map;
};

const buildCardMetadata = (catalog) => {
  const list = [];
  const byId = new Map();
  const addCard = (card) => {
    if (!card?.id) return;
    const enriched = { ...card, symbolText: parseSymbolInstructions(card.activeText) };
    list.push(enriched);
    byId.set(card.id, enriched);
  };
  if (Array.isArray(catalog?.movement)) {
    catalog.movement.forEach(addCard);
  }
  if (Array.isArray(catalog?.ability)) {
    catalog.ability.forEach(addCard);
  }
  return { list, byId };
};

const findActionSetStartIndex = (beats, character, beatIndex) => {
  if (!Array.isArray(beats) || !character) return null;
  for (let i = beatIndex; i >= 0; i -= 1) {
    const entry = getBeatEntryForCharacter(beats[i], character);
    if (!entry) continue;
    const rotation = `${entry.rotation ?? ''}`.trim();
    if (rotation) return i;
  }
  return null;
};

const findCardForTimelineEntry = (beats, character, beatIndex, priority, cardMetadata) => {
  if (!Array.isArray(beats) || !character || !cardMetadata.length) return null;
  const clampedIndex = Math.min(Math.max(0, beatIndex), Math.max(0, beats.length - 1));
  const startIndex = findActionSetStartIndex(beats, character, clampedIndex);
  if (startIndex === null) return null;
  const hasPriority = Number.isFinite(priority);
  for (const card of cardMetadata) {
    if (hasPriority && card.priority !== priority) continue;
    const actions = Array.isArray(card.actions) ? card.actions : [];
    if (!actions.length) continue;
    let matches = true;
    for (let offset = 0; offset < actions.length; offset += 1) {
      const beat = beats[startIndex + offset];
      if (!beat) {
        matches = false;
        break;
      }
      const entry = getBeatEntryForCharacter(beat, character);
      if (!entry) {
        matches = false;
        break;
      }
      const entryAction = `${entry.action ?? ''}`.trim();
      const cardAction = `${actions[offset] ?? ''}`.trim();
      if (entryAction !== cardAction) {
        matches = false;
        break;
      }
    }
    if (matches) return card;
  }
  return null;
};

export const createTimelineTooltip = ({ gameArea, canvas, viewState, timeIndicatorViewModel } = {}) => {
  if (!gameArea || !canvas) {
    return {
      setCardCatalog: () => {},
      setGameState: () => {},
      update: () => {},
      hide: () => {},
    };
  }

  const tooltip = document.createElement('div');
  tooltip.className = 'timeline-tooltip';
  tooltip.hidden = true;
  const text = document.createElement('div');
  text.className = 'timeline-tooltip-text';
  const title = document.createElement('div');
  title.className = 'timeline-tooltip-title';
  const instruction = document.createElement('div');
  instruction.className = 'timeline-tooltip-instruction';
  const divider = document.createElement('div');
  divider.className = 'timeline-tooltip-divider';
  const passive = document.createElement('div');
  passive.className = 'timeline-tooltip-passive';
  const passiveText = document.createElement('div');
  passiveText.className = 'timeline-tooltip-passive-text';
  text.append(title, instruction, divider, passive, passiveText);
  tooltip.appendChild(text);
  gameArea.appendChild(tooltip);

  let cardMetadata = { list: [], byId: new Map() };
  let gameState = null;
  let lastTooltipKey = null;

  const hide = () => {
    tooltip.hidden = true;
    lastTooltipKey = null;
  };

  const positionTooltip = (centerX, centerY) => {
    const areaRect = gameArea.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const offsetX = canvasRect.left - areaRect.left;
    const offsetY = canvasRect.top - areaRect.top;
    const x = offsetX + centerX;
    const y = offsetY + centerY;
    const padding = 8;
    const offset = 12;
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    let left = x - width / 2;
    const maxLeft = areaRect.width - width - padding;
    left = Math.max(padding, Math.min(left, maxLeft));
    let top = y - height - offset;
    if (top < padding) {
      top = y + offset;
    }
    const maxTop = areaRect.height - height - padding;
    top = Math.max(padding, Math.min(top, maxTop));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  const update = (event) => {
    if (!gameState || !cardMetadata.list.length) {
      hide();
      return;
    }
    if (viewState?.dragging || timeIndicatorViewModel?.isHolding) {
      hide();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const layout = getTimeIndicatorLayout({ width: rect.width, height: rect.height });
    const target = getTimeIndicatorActionTarget(
      layout,
      timeIndicatorViewModel,
      gameState,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    if (!target) {
      hide();
      return;
    }
    const beats = gameState?.state?.public?.beats ?? [];
    const entry = target.entry;
    const activeCardId = entry?.cardId ? `${entry.cardId}` : null;
    const passiveCardId = entry?.passiveCardId ? `${entry.passiveCardId}` : null;
    let activeCard = activeCardId ? cardMetadata.byId.get(activeCardId) : null;
    if (!activeCard) {
      activeCard = findCardForTimelineEntry(
        beats,
        target.character,
        target.beatIndex,
        entry?.priority,
        cardMetadata.list,
      );
    }
    const passiveCard = passiveCardId ? cardMetadata.byId.get(passiveCardId) : null;
    const activeName = activeCard?.name ?? '';
    const passiveName = passiveCard?.name ?? '';
    const instructionText = activeCard?.symbolText?.get(target.symbol) ?? '';
    const instructionLine = instructionText ? `{${target.symbol}}: ${instructionText}` : '';
    const passiveTextValue = passiveCard?.passiveText ?? '';
    if (!activeName && !passiveName && !instructionLine && !passiveTextValue) {
      hide();
      return;
    }
    const key = [
      target.character.userId ?? target.character.username,
      target.beatIndex,
      target.symbol,
      activeCardId ?? 'none',
      passiveCardId ?? 'none',
      instructionLine,
      passiveTextValue,
    ].join(':');
    if (key !== lastTooltipKey) {
      title.textContent = activeName;
      title.hidden = !activeName;
      if (instructionLine) {
        instruction.hidden = false;
        appendInlineText(instruction, instructionLine);
      } else {
        instruction.hidden = true;
        instruction.textContent = '';
      }
      const showDivider = Boolean(passiveName || passiveTextValue);
      divider.hidden = !showDivider;
      passive.textContent = passiveName;
      passive.hidden = !passiveName;
      if (passiveTextValue) {
        passiveText.hidden = false;
        appendInlineText(passiveText, passiveTextValue);
      } else {
        passiveText.hidden = true;
        passiveText.textContent = '';
      }
      lastTooltipKey = key;
    }
    tooltip.hidden = false;
    positionTooltip(target.center.x, target.center.y);
  };

  const setCardCatalog = (catalog) => {
    cardMetadata = buildCardMetadata(catalog);
  };

  const setGameState = (state) => {
    gameState = state;
  };

  return {
    setCardCatalog,
    setGameState,
    update,
    hide,
  };
};
