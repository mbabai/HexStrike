import { getBeatEntryForCharacter } from './beatTimeline.js';
import { getTimeIndicatorActionTarget, getTimeIndicatorLayout } from './timeIndicatorView.js';
import { extractHandTriggerText } from './handTriggerText.mjs';
import { appendInlineText } from '../shared/cardRenderer.js';
import { axialToPixel, getHexSize } from '../shared/hex.mjs';
import { GAME_CONFIG } from './config.js';

const normalizeSymbolText = (text) => {
  const raw = `${text ?? ''}`.trim();
  if (!raw) return '';
  return raw.replace(/^\s*[:\-]\s*/, '').trim();
};

const splitParagraphs = (text) => {
  const raw = `${text ?? ''}`;
  if (!raw.trim()) return [];
  return raw.split(/\r?\n\s*\r?\n/g).filter((paragraph) => paragraph.trim());
};

const parseSymbolInstructions = (text) => {
  const map = new Map();
  const paragraphs = splitParagraphs(text);
  if (!paragraphs.length) return map;
  const pattern = /\{(X1|X2|i|F)\}/g;
  for (const paragraph of paragraphs) {
    pattern.lastIndex = 0;
    let match = pattern.exec(paragraph);
    if (!match) continue;
    let lastSymbol = null;
    let lastIndex = 0;
    while (match) {
      if (lastSymbol) {
        const segment = paragraph.slice(lastIndex, match.index);
        const cleaned = normalizeSymbolText(segment);
        if (cleaned) {
          map.set(lastSymbol, cleaned);
        }
      }
      lastSymbol = match[1];
      lastIndex = pattern.lastIndex;
      match = pattern.exec(paragraph);
    }
    if (lastSymbol) {
      const segment = paragraph.slice(lastIndex);
      const cleaned = normalizeSymbolText(segment);
      if (cleaned) {
        map.set(lastSymbol, cleaned);
      }
    }
  }
  return map;
};

const buildCardMetadata = (catalog) => {
  const list = [];
  const byId = new Map();
  const addCard = (card) => {
    if (!card?.id) return;
    const handTriggerText = extractHandTriggerText(card.activeText);
    const enriched = { ...card, symbolText: parseSymbolInstructions(card.activeText), handTriggerText };
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
    const rotationSource = `${entry.rotationSource ?? ''}`.trim();
    if (rotationSource === 'selected') return i;
    if (!rotationSource && rotation) return i;
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

const getFocusAnchorTarget = ({ event, canvas, viewState, sceneTokens }) => {
  if (!event || !canvas || !viewState || !Array.isArray(sceneTokens) || !sceneTokens.length) return null;
  const focusTokens = sceneTokens.filter((token) => token?.type === 'focus-anchor' && token?.position);
  if (!focusTokens.length) return null;
  const rect = canvas.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  const size = getHexSize(rect.width || canvas.clientWidth || 1, GAME_CONFIG.hexSizeFactor);
  const hitRadius = Math.max(10, size * viewState.scale * 0.55);
  let best = null;
  focusTokens.forEach((token) => {
    const world = axialToPixel(token.position.q, token.position.r, size);
    const screenX = viewState.offset.x + world.x * viewState.scale;
    const screenY = viewState.offset.y + world.y * viewState.scale;
    const dx = pointerX - screenX;
    const dy = pointerY - screenY;
    const distance = Math.hypot(dx, dy);
    if (distance > hitRadius) return;
    if (!best || distance < best.distance) {
      best = {
        distance,
        token,
        center: { x: screenX, y: screenY },
      };
    }
  });
  return best ? { kind: 'focus-anchor', token: best.token, center: best.center } : null;
};

export const createTimelineTooltip = ({ gameArea, canvas, viewState, timeIndicatorViewModel, getScene } = {}) => {
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
  const focus = document.createElement('div');
  focus.className = 'timeline-tooltip-passive';
  const focusText = document.createElement('div');
  focusText.className = 'timeline-tooltip-passive-text';
  text.append(title, instruction, divider, passive, passiveText, focus, focusText);
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
    let target = getTimeIndicatorActionTarget(
      layout,
      timeIndicatorViewModel,
      gameState,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    if (!target) {
      const sceneTokens = getScene?.()?.boardTokens ?? gameState?.state?.public?.boardTokens ?? [];
      target = getFocusAnchorTarget({ event, canvas, viewState, sceneTokens });
    }
    if (!target) {
      hide();
      return;
    }
    if (target.kind === 'focus-anchor') {
      const cardId = `${target.token?.cardId ?? ''}`.trim();
      const card = cardId ? cardMetadata.byId.get(cardId) : null;
      const titleText = card?.name ?? cardId;
      const focusInstruction = card?.symbolText?.get('F') ?? '';
      const focusLine = focusInstruction ? `{F}: ${focusInstruction}` : card?.activeText ?? '';
      if (!titleText && !focusLine) {
        hide();
        return;
      }
      const key = ['focus-anchor', cardId, focusLine].join(':');
      if (key !== lastTooltipKey) {
        title.textContent = titleText;
        title.hidden = !titleText;
        instruction.hidden = true;
        instruction.textContent = '';
        divider.hidden = false;
        passive.hidden = true;
        passiveText.hidden = true;
        passive.textContent = '';
        passiveText.textContent = '';
        focus.textContent = 'Focus';
        focus.hidden = false;
        if (focusLine) {
          focusText.hidden = false;
          appendInlineText(focusText, focusLine);
        } else {
          focusText.hidden = true;
          focusText.textContent = '';
        }
        lastTooltipKey = key;
      }
      tooltip.hidden = false;
      positionTooltip(target.center.x, target.center.y);
      return;
    }
    if (target.kind === 'hand-trigger') {
      const cardId = target.cardId ? `${target.cardId}` : '';
      const card = cardId ? cardMetadata.byId.get(cardId) : null;
      const titleText = card?.name ?? cardId;
      const bodyText = card?.handTriggerText || card?.activeText || '';
      if (!titleText && !bodyText) {
        hide();
        return;
      }
      const key = ['hand-trigger', cardId, target.beatIndex, bodyText].join(':');
      if (key !== lastTooltipKey) {
        title.textContent = titleText;
        title.hidden = !titleText;
        if (bodyText) {
          instruction.hidden = false;
          appendInlineText(instruction, bodyText);
        } else {
          instruction.hidden = true;
          instruction.textContent = '';
        }
        divider.hidden = true;
        passive.hidden = true;
        passiveText.hidden = true;
        passive.textContent = '';
        passiveText.textContent = '';
        focus.hidden = true;
        focusText.hidden = true;
        focus.textContent = '';
        focusText.textContent = '';
        lastTooltipKey = key;
      }
      tooltip.hidden = false;
      positionTooltip(target.center.x, target.center.y);
      return;
    }
    if (target.kind === 'rewind-return') {
      const cardId = target.cardId ? `${target.cardId}` : 'rewind';
      const card = cardId ? cardMetadata.byId.get(cardId) : null;
      const titleText = card?.name ?? cardId;
      const focusInstruction = card?.symbolText?.get('F') ?? '';
      const focusLine = focusInstruction ? `{F}: ${focusInstruction}` : card?.activeText ?? '';
      const returnToAnchor = Boolean(target.interaction?.resolution?.returnToAnchor);
      const choiceLine = returnToAnchor ? 'Choice: Yes (return to anchor)' : 'Choice: No (stay focused)';
      if (!titleText && !focusLine) {
        hide();
        return;
      }
      const key = ['rewind-return', cardId, target.beatIndex, returnToAnchor, focusLine].join(':');
      if (key !== lastTooltipKey) {
        title.textContent = titleText;
        title.hidden = !titleText;
        instruction.hidden = false;
        appendInlineText(instruction, choiceLine);
        divider.hidden = !focusLine;
        passive.hidden = true;
        passiveText.hidden = true;
        passive.textContent = '';
        passiveText.textContent = '';
        focus.textContent = 'Focus';
        focus.hidden = !focusLine;
        if (focusLine) {
          focusText.hidden = false;
          appendInlineText(focusText, focusLine);
        } else {
          focusText.hidden = true;
          focusText.textContent = '';
        }
        lastTooltipKey = key;
      }
      tooltip.hidden = false;
      positionTooltip(target.center.x, target.center.y);
      return;
    }

    const beats = gameState?.state?.public?.beats ?? [];
    const entry = target.entry;
    const activeCardId = entry?.cardId ? `${entry.cardId}` : null;
    const passiveCardId = entry?.passiveCardId ? `${entry.passiveCardId}` : null;
    const focusCardId = entry?.focusCardId ? `${entry.focusCardId}` : null;
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
    const focusCard = focusCardId ? cardMetadata.byId.get(focusCardId) : null;
    const activeName = activeCard?.name ?? '';
    const passiveName = passiveCard?.name ?? '';
    const instructionText = activeCard?.symbolText?.get(target.symbol) ?? '';
    const instructionLine = instructionText ? `{${target.symbol}}: ${instructionText}` : '';
    const passiveTextValue = passiveCard?.passiveText ?? '';
    const focusInstruction = focusCard?.symbolText?.get('F') ?? '';
    const focusLine = focusInstruction ? `{F}: ${focusInstruction}` : '';
    if (!activeName && !passiveName && !instructionLine && !passiveTextValue && !focusLine) {
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
      focusCardId ?? 'none',
      focusLine,
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
      const showDivider = Boolean(passiveName || passiveTextValue || focusLine);
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
      focus.textContent = focusCard?.name ? `Focus: ${focusCard.name}` : 'Focus';
      focus.hidden = !focusLine;
      if (focusLine) {
        focusText.hidden = false;
        appendInlineText(focusText, focusLine);
      } else {
        focusText.hidden = true;
        focusText.textContent = '';
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
