import { getBeatEntryForCharacter } from './beatTimeline.js';
import { getTimeIndicatorActionTarget, getTimeIndicatorLayout } from './timeIndicatorView.js';
import { extractHandTriggerText } from './handTriggerText.mjs';
import { appendInlineText } from '../shared/cardRenderer.js';
import { axialToPixel, getHexSize } from '../shared/hex.mjs';
import { GAME_CONFIG } from './config.js';
import { getCharacterTokenMetrics } from './characterTokens.mjs';
import { actionHasAttackToken } from './cardText/actionListTransforms.js';

const DAMAGE_ICON_ACTION = 'DamageIcon';
const DEFAULT_ACTION = 'E';

const normalizeSymbolText = (text) => {
  const raw = `${text ?? ''}`.trim();
  if (!raw) return '';
  return raw.replace(/^\s*[:\-]\s*/, '').trim();
};

const normalizeActionLabel = (action) => `${action ?? ''}`.trim().toUpperCase();

const isDamageIconAction = (action) => normalizeActionLabel(action) === DAMAGE_ICON_ACTION.toUpperCase();

const isOpenBeatAction = (action) => normalizeActionLabel(action) === DEFAULT_ACTION;

const cardHasAttack = (card) => {
  if (!card) return false;
  const damage = Number.isFinite(card.damage) ? Number(card.damage) : 0;
  const kbf = Number.isFinite(card.kbf) ? Number(card.kbf) : 0;
  if (damage > 0 || kbf > 0) return true;
  const actions = Array.isArray(card.actions) ? card.actions : [];
  return actions.some((action) => actionHasAttackToken(action));
};

const buildAttackStatsLine = (card, entry = null) => {
  if (!cardHasAttack(card)) return '';
  const baseDamage = Number.isFinite(card?.damage) ? Number(card.damage) : 0;
  const baseKbf = Number.isFinite(card?.kbf) ? Number(card.kbf) : 0;
  const damage = Number.isFinite(entry?.attackDamage) ? Number(entry.attackDamage) : baseDamage;
  const kbf = Number.isFinite(entry?.attackKbf) ? Number(entry.attackKbf) : baseKbf;
  return `Attack: DMG ${Math.max(0, Math.round(damage))}, KBF ${Math.max(0, Math.round(kbf))}`;
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

const isFirstInterruptedBeat = (beats, character, beatIndex, entry) => {
  if (!Array.isArray(beats) || !character || !entry) return false;
  if (!isDamageIconAction(entry.action)) return false;
  if (beatIndex <= 0) return true;
  const previousEntry = getBeatEntryForCharacter(beats[beatIndex - 1], character);
  if (!previousEntry) return true;
  return !isDamageIconAction(previousEntry.action);
};

const resolveInterruptedCardIds = (beats, character, beatIndex, entry) => {
  let activeCardId = `${entry?.cardId ?? ''}`.trim() || null;
  let passiveCardId = `${entry?.passiveCardId ?? ''}`.trim() || null;
  const interrupted = isFirstInterruptedBeat(beats, character, beatIndex, entry);
  if (!interrupted || beatIndex <= 0 || (activeCardId && passiveCardId)) {
    return { interrupted, activeCardId, passiveCardId };
  }
  const previousEntry = getBeatEntryForCharacter(beats[beatIndex - 1], character);
  if (!previousEntry || isOpenBeatAction(previousEntry.action)) {
    return { interrupted, activeCardId, passiveCardId };
  }
  if (!activeCardId) {
    const candidate = `${previousEntry.cardId ?? ''}`.trim();
    if (candidate) activeCardId = candidate;
  }
  if (!passiveCardId) {
    const candidate = `${previousEntry.passiveCardId ?? ''}`.trim();
    if (candidate) passiveCardId = candidate;
  }
  return { interrupted, activeCardId, passiveCardId };
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

const getCharacterTokenTarget = ({ event, canvas, viewState, sceneCharacters }) => {
  if (!event || !canvas || !viewState || !Array.isArray(sceneCharacters) || !sceneCharacters.length) return null;
  const rect = canvas.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  const size = getHexSize(rect.width || canvas.clientWidth || 1, GAME_CONFIG.hexSizeFactor);
  const metrics = getCharacterTokenMetrics(size);
  const hitRadius = Math.max(12, metrics.radius * viewState.scale);
  let best = null;
  sceneCharacters.forEach((character) => {
    if (!character?.position) return;
    const base = axialToPixel(character.position.q, character.position.r, size);
    const renderOffset = character.renderOffset ?? null;
    const worldX = base.x + (renderOffset ? renderOffset.x * size : 0);
    const worldY = base.y + (renderOffset ? renderOffset.y * size : 0);
    const screenX = viewState.offset.x + worldX * viewState.scale;
    const screenY = viewState.offset.y + worldY * viewState.scale;
    const distance = Math.hypot(pointerX - screenX, pointerY - screenY);
    if (distance > hitRadius) return;
    if (!best || distance < best.distance) {
      best = { distance, character, center: { x: screenX, y: screenY } };
    }
  });
  return best ? { kind: 'character', character: best.character, center: best.center } : null;
};

export const createTimelineTooltip = ({ gameArea, canvas, viewState, timeIndicatorViewModel, getScene } = {}) => {
  if (!gameArea || !canvas) {
    return {
      setCardCatalog: () => {},
      setCharacterCatalog: () => {},
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
  const attackStats = document.createElement('div');
  attackStats.className = 'timeline-tooltip-meta';
  const status = document.createElement('div');
  status.className = 'timeline-tooltip-status';
  const instruction = document.createElement('div');
  instruction.className = 'timeline-tooltip-instruction';
  const divider = document.createElement('div');
  divider.className = 'timeline-tooltip-divider';
  const characterPower = document.createElement('div');
  characterPower.className = 'timeline-tooltip-passive';
  const characterPowerText = document.createElement('div');
  characterPowerText.className = 'timeline-tooltip-passive-text';
  const passive = document.createElement('div');
  passive.className = 'timeline-tooltip-passive';
  const passiveText = document.createElement('div');
  passiveText.className = 'timeline-tooltip-passive-text';
  const focus = document.createElement('div');
  focus.className = 'timeline-tooltip-passive';
  const focusText = document.createElement('div');
  focusText.className = 'timeline-tooltip-passive-text';
  text.append(
    title,
    attackStats,
    status,
    instruction,
    divider,
    characterPower,
    characterPowerText,
    passive,
    passiveText,
    focus,
    focusText,
  );
  tooltip.appendChild(text);
  gameArea.appendChild(tooltip);

  let cardMetadata = { list: [], byId: new Map() };
  let characterMetadata = { byId: new Map() };
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

  const clearSupplementalSections = ({ hideDivider = true } = {}) => {
    divider.hidden = hideDivider;
    characterPower.hidden = true;
    characterPowerText.hidden = true;
    characterPower.textContent = '';
    characterPowerText.textContent = '';
    passive.hidden = true;
    passiveText.hidden = true;
    passive.textContent = '';
    passiveText.textContent = '';
    focus.hidden = true;
    focusText.hidden = true;
    focus.textContent = '';
    focusText.textContent = '';
  };

  const renderAttackStats = (line) => {
    const value = `${line ?? ''}`.trim();
    if (!value) {
      attackStats.hidden = true;
      attackStats.textContent = '';
      return false;
    }
    attackStats.hidden = false;
    attackStats.textContent = value;
    return true;
  };

  const renderStatus = (line) => {
    const value = `${line ?? ''}`.trim();
    if (!value) {
      status.hidden = true;
      status.textContent = '';
      return false;
    }
    status.hidden = false;
    status.textContent = value;
    return true;
  };

  const getCharacterByUserId = (userId) => {
    const normalizedUserId = `${userId ?? ''}`.trim();
    if (!normalizedUserId) return null;
    const characters = Array.isArray(gameState?.state?.public?.characters) ? gameState.state.public.characters : [];
    return characters.find((item) => `${item?.userId ?? ''}`.trim() === normalizedUserId) ?? null;
  };

  const getCharacterPowerDetails = (character) => {
    const characterCatalogEntry = characterMetadata.byId.get(character?.characterId);
    const powerText =
      `${character?.characterPowerText ?? ''}`.trim() ||
      `${characterCatalogEntry?.powerText ?? ''}`.trim();
    const name =
      `${character?.characterName ?? ''}`.trim() ||
      `${characterCatalogEntry?.name ?? ''}`.trim() ||
      `${character?.username ?? character?.userId ?? ''}`.trim();
    return { name, powerText };
  };

  const renderCharacterPowerSection = (details) => {
    const powerText = `${details?.powerText ?? ''}`.trim();
    if (!powerText) {
      characterPower.hidden = true;
      characterPowerText.hidden = true;
      characterPower.textContent = '';
      characterPowerText.textContent = '';
      return false;
    }
    const name = `${details?.name ?? ''}`.trim();
    characterPower.textContent = name ? `Character: ${name}` : 'Character';
    characterPower.hidden = false;
    characterPowerText.hidden = false;
    appendInlineText(characterPowerText, powerText);
    return true;
  };

  const getFocusLineFromCard = (card, options = {}) => {
    const focusInstruction = card?.symbolText?.get('F') ?? '';
    if (focusInstruction) return `{F}: ${focusInstruction}`;
    if (!options.includeActiveTextFallback) return '';
    return `${card?.activeText ?? ''}`.trim();
  };

  const renderFocusSection = (focusTitle, focusLine) => {
    focus.textContent = `${focusTitle ?? 'Focus'}`.trim() || 'Focus';
    focus.hidden = !focusLine;
    if (focusLine) {
      focusText.hidden = false;
      appendInlineText(focusText, focusLine);
      return true;
    }
    focusText.hidden = true;
    focusText.textContent = '';
    return false;
  };

  const renderCharacterPowerTooltip = (target) => {
    const character = target?.character ?? {};
    const { name, powerText } = getCharacterPowerDetails(character);
    if (!powerText) {
      return false;
    }
    const titleText = name || `${character.username ?? character.userId ?? ''}`.trim();
    const key = ['character', character.userId ?? character.username, powerText].join(':');
    if (key !== lastTooltipKey) {
      title.textContent = titleText || 'Character Power';
      title.hidden = false;
      renderAttackStats('');
      renderStatus('');
      instruction.hidden = false;
      appendInlineText(instruction, powerText);
      clearSupplementalSections({ hideDivider: true });
      lastTooltipKey = key;
    }
    tooltip.hidden = false;
    positionTooltip(target.center.x, target.center.y);
    return true;
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
      const sceneCharacters = getScene?.()?.characters ?? gameState?.state?.public?.characters ?? [];
      target = getCharacterTokenTarget({ event, canvas, viewState, sceneCharacters });
    }
    if (!target) {
      hide();
      return;
    }
    if (target.kind === 'character') {
      if (!renderCharacterPowerTooltip(target)) {
        hide();
      }
      return;
    }
    if (target.kind === 'focus-anchor') {
      const cardId = `${target.token?.cardId ?? ''}`.trim();
      const card = cardId ? cardMetadata.byId.get(cardId) : null;
      const character = getCharacterByUserId(target.token?.ownerUserId);
      const characterPowerDetails = getCharacterPowerDetails(character);
      const titleText = card?.name ?? cardId;
      const attackStatsLine = buildAttackStatsLine(card);
      const focusLine = getFocusLineFromCard(card, { includeActiveTextFallback: true });
      if (!titleText && !focusLine && !characterPowerDetails.powerText && !attackStatsLine) {
        hide();
        return;
      }
      const key = [
        'focus-anchor',
        cardId,
        attackStatsLine,
        focusLine,
        character?.userId ?? target.token?.ownerUserId ?? '',
        characterPowerDetails.powerText,
      ].join(':');
      if (key !== lastTooltipKey) {
        title.textContent = titleText;
        title.hidden = !titleText;
        renderAttackStats(attackStatsLine);
        renderStatus('');
        instruction.hidden = true;
        instruction.textContent = '';
        clearSupplementalSections({ hideDivider: true });
        const hasCharacterPower = renderCharacterPowerSection(characterPowerDetails);
        const hasFocus = renderFocusSection('Focus', focusLine);
        divider.hidden = !(hasCharacterPower || hasFocus);
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
      const attackStatsLine = buildAttackStatsLine(card);
      const bodyText = card?.handTriggerText || card?.activeText || '';
      if (!titleText && !bodyText && !attackStatsLine) {
        hide();
        return;
      }
      const key = ['hand-trigger', cardId, target.beatIndex, attackStatsLine, bodyText].join(':');
      if (key !== lastTooltipKey) {
        title.textContent = titleText;
        title.hidden = !titleText;
        renderAttackStats(attackStatsLine);
        renderStatus('');
        if (bodyText) {
          instruction.hidden = false;
          appendInlineText(instruction, bodyText);
        } else {
          instruction.hidden = true;
          instruction.textContent = '';
        }
        clearSupplementalSections({ hideDivider: true });
        lastTooltipKey = key;
      }
      tooltip.hidden = false;
      positionTooltip(target.center.x, target.center.y);
      return;
    }
    if (target.kind === 'rewind-return') {
      const cardId = target.cardId ? `${target.cardId}` : 'rewind';
      const card = cardId ? cardMetadata.byId.get(cardId) : null;
      const character = getCharacterByUserId(target.interaction?.actorUserId);
      const characterPowerDetails = getCharacterPowerDetails(character);
      const titleText = card?.name ?? cardId;
      const attackStatsLine = buildAttackStatsLine(card);
      const focusLine = getFocusLineFromCard(card, { includeActiveTextFallback: true });
      const returnToAnchor = Boolean(target.interaction?.resolution?.returnToAnchor);
      const choiceLine = returnToAnchor ? 'Choice: Yes (return to anchor)' : 'Choice: No (stay focused)';
      if (!titleText && !focusLine && !characterPowerDetails.powerText && !attackStatsLine) {
        hide();
        return;
      }
      const key = [
        'rewind-return',
        cardId,
        target.beatIndex,
        returnToAnchor,
        attackStatsLine,
        focusLine,
        character?.userId ?? target.interaction?.actorUserId ?? '',
        characterPowerDetails.powerText,
      ].join(':');
      if (key !== lastTooltipKey) {
        title.textContent = titleText;
        title.hidden = !titleText;
        renderAttackStats(attackStatsLine);
        renderStatus('');
        instruction.hidden = false;
        appendInlineText(instruction, choiceLine);
        clearSupplementalSections({ hideDivider: true });
        const hasCharacterPower = renderCharacterPowerSection(characterPowerDetails);
        const hasFocus = renderFocusSection('Focus', focusLine);
        divider.hidden = !(hasCharacterPower || hasFocus);
        lastTooltipKey = key;
      }
      tooltip.hidden = false;
      positionTooltip(target.center.x, target.center.y);
      return;
    }

    const beats = gameState?.state?.public?.beats ?? [];
    const entry = target.entry;
    const interruptedContext = resolveInterruptedCardIds(beats, target.character, target.beatIndex, entry);
    const activeCardId = interruptedContext.activeCardId;
    const passiveCardId = interruptedContext.passiveCardId;
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
    const activeTitle = interruptedContext.interrupted && activeName ? `${activeName} (Interrupted)` : activeName;
    const attackStatsLine = buildAttackStatsLine(activeCard, entry);
    const interruptedLine = interruptedContext.interrupted ? 'Interrupted before resolution.' : '';
    const passiveName = passiveCard?.name ?? '';
    const instructionText = activeCard?.symbolText?.get(target.symbol) ?? '';
    const instructionLine = instructionText ? `{${target.symbol}}: ${instructionText}` : '';
    const passiveTextValue = passiveCard?.passiveText ?? '';
    const focusLine = getFocusLineFromCard(focusCard, { includeActiveTextFallback: true });
    const characterPowerDetails = getCharacterPowerDetails(target.character);
    const characterPowerLine = focusCardId ? characterPowerDetails.powerText : '';
    if (
      !activeTitle &&
      !passiveName &&
      !instructionLine &&
      !passiveTextValue &&
      !focusLine &&
      !characterPowerLine &&
      !attackStatsLine &&
      !interruptedLine
    ) {
      hide();
      return;
    }
    const key = [
      target.character.userId ?? target.character.username,
      target.beatIndex,
      target.symbol,
      activeCardId ?? 'none',
      passiveCardId ?? 'none',
      activeTitle,
      attackStatsLine,
      interruptedLine,
      instructionLine,
      passiveTextValue,
      characterPowerLine,
      focusCardId ?? 'none',
      focusLine,
    ].join(':');
    if (key !== lastTooltipKey) {
      title.textContent = activeTitle;
      title.hidden = !activeTitle;
      renderAttackStats(attackStatsLine);
      renderStatus(interruptedLine);
      if (instructionLine) {
        instruction.hidden = false;
        appendInlineText(instruction, instructionLine);
      } else {
        instruction.hidden = true;
        instruction.textContent = '';
      }
      const hasCharacterPower = renderCharacterPowerSection({
        ...characterPowerDetails,
        powerText: characterPowerLine,
      });
      const hasFocus = renderFocusSection(focusCard?.name ? `Focus: ${focusCard.name}` : 'Focus', focusLine);
      const showDivider = Boolean(hasCharacterPower || passiveName || passiveTextValue || hasFocus);
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

  const setCharacterCatalog = (catalog) => {
    const list = Array.isArray(catalog?.characters) ? catalog.characters : [];
    characterMetadata = { byId: new Map(list.map((item) => [item.id, item])) };
  };

  const setGameState = (state) => {
    gameState = state;
  };

  return {
    setCardCatalog,
    setCharacterCatalog,
    setGameState,
    update,
    hide,
  };
};
