import { loadCardCatalog } from './shared/cardCatalog.js';
import { loadCharacterCatalog } from './shared/characterCatalog.js';
import { buildCardElement, fitAllCardText } from './shared/cardRenderer.js';
import { loadUserDecks, saveUserDecks, createDeckId } from './deckStore.js';
import {
  getOrCreateUserId,
  getSelectedDeckId,
  setSelectedDeckId,
  clearSelectedDeckId,
  getStoredUsername,
  isUsernameCustom,
  setStoredUsername,
} from './storage.js';

const REQUIRED_MOVEMENT = 4;
const REQUIRED_ABILITY = 12;
const REQUIRED_MOVEMENT_CARD_ID = 'step';
const UNIQUE_MOVEMENT_CARD_IDS = new Set(['grappling-hook', 'fleche', 'leap']);
const UNIQUE_MOVEMENT_LIMIT_MESSAGE_HTML =
  'Only one <span class="deck-builder-gold-title">GOLD TITLE</span> card per deck.';

const CHARACTER_OPTIONS_FALLBACK = [
  { id: 'murelious', name: 'Murelious', image: '/public/images/Murelious.png', powerText: '' },
  { id: 'strylan', name: 'Strylan', image: '/public/images/Strylan.png', powerText: '' },
  { id: 'monkey-queen', name: 'Monkey Queen', image: '/public/images/MonkeyQueen.png', powerText: '' },
  { id: 'ryathan', name: 'Ryathan', image: '/public/images/Ryathan.png', powerText: '' },
  { id: 'zenytha', name: 'Zenytha', image: '/public/images/Zenytha.png', powerText: '' },
  { id: 'aumandetta', name: 'Aumandetta', image: '/public/images/Aumandetta.png', powerText: '' },
];

const createIcon = (path, viewBox = '0 0 24 24') => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path);
  shape.setAttribute('fill', 'none');
  shape.setAttribute('stroke', 'currentColor');
  shape.setAttribute('stroke-width', '2');
  shape.setAttribute('stroke-linecap', 'round');
  shape.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(shape);
  return svg;
};

const PENCIL_ICON = createIcon('M3 21l3.5-1 11-11-2.5-2.5-11 11L3 21z M14.5 5.5l2.5 2.5');
const TRASH_ICON = createIcon('M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12');

const createDeckActions = () => {
  const actions = document.createElement('div');
  actions.className = 'deck-card-actions';

  const selectButton = document.createElement('button');
  selectButton.type = 'button';
  selectButton.className = 'deck-action deck-action-select';
  selectButton.setAttribute('aria-label', 'Edit deck');
  selectButton.appendChild(PENCIL_ICON.cloneNode(true));

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'deck-action deck-action-delete';
  deleteButton.setAttribute('aria-label', 'Delete deck');
  deleteButton.appendChild(TRASH_ICON.cloneNode(true));

  actions.appendChild(selectButton);
  actions.appendChild(deleteButton);
  return { actions, selectButton, deleteButton };
};

const buildCardMap = (catalog) => {
  const map = new Map();
  if (catalog?.movement) {
    catalog.movement.forEach((card) => map.set(card.id, card));
  }
  if (catalog?.ability) {
    catalog.ability.forEach((card) => map.set(card.id, card));
  }
  return map;
};

const getBeatCount = (card) => {
  const actions = Array.isArray(card?.actions) ? card.actions.map((action) => `${action}`.trim()).filter(Boolean) : [];
  if (!actions.length) return 0;
  const last = actions[actions.length - 1];
  return last.toUpperCase() === 'E' ? actions.length - 1 : actions.length;
};

const getNumericValue = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(`${value}`);
  return Number.isFinite(parsed) ? parsed : -1;
};

const sortCards = (cards, sortKey) => {
  const list = [...cards];
  if (sortKey === 'beats') {
    return list.sort((a, b) => getBeatCount(b) - getBeatCount(a));
  }
  if (sortKey === 'damage') {
    return list.sort((a, b) => getNumericValue(b.damage) - getNumericValue(a.damage));
  }
  if (sortKey === 'kbf') {
    return list.sort((a, b) => getNumericValue(b.kbf) - getNumericValue(a.kbf));
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
};

const isUniqueMovementCard = (cardId) => UNIQUE_MOVEMENT_CARD_IDS.has(`${cardId ?? ''}`.trim());

const normalizeMovementSelection = (movementIds) => {
  const normalized = [];
  let hasUniqueMovement = false;
  const source = Array.isArray(movementIds) ? movementIds : [];
  source.forEach((rawCardId) => {
    const cardId = `${rawCardId ?? ''}`.trim();
    if (!cardId || cardId === REQUIRED_MOVEMENT_CARD_ID) return;
    if (normalized.includes(cardId)) return;
    if (isUniqueMovementCard(cardId)) {
      if (hasUniqueMovement) return;
      hasUniqueMovement = true;
    }
    normalized.push(cardId);
  });
  return [REQUIRED_MOVEMENT_CARD_ID, ...normalized].slice(0, REQUIRED_MOVEMENT);
};

const hasUniqueMovementConflict = (movementIds, nextCardId) => {
  if (!isUniqueMovementCard(nextCardId)) return false;
  const selected = Array.isArray(movementIds) ? movementIds : [];
  return selected.some((cardId) => isUniqueMovementCard(cardId));
};

export const initDecks = async () => {
  const deckGrid = document.getElementById('deckGrid');
  const createDeckButton = document.getElementById('createDeck');
  const selectedDeckCard = document.getElementById('selectedDeckCard');
  const previewOverlay = document.getElementById('deckPreviewOverlay');
  const previewClose = document.getElementById('deckPreviewClose');
  const previewTitle = document.getElementById('deckPreviewTitle');
  const previewCharacter = document.getElementById('deckPreviewCharacter');
  const previewMovement = document.getElementById('deckPreviewMovement');
  const previewAbility = document.getElementById('deckPreviewAbility');
  const builderOverlay = document.getElementById('deckBuilderOverlay');
  const deckBuilderTitle = document.getElementById('deckBuilderTitle');
  const deckBuilderSubtitle = document.getElementById('deckBuilderSubtitle');
  const builderClose = document.getElementById('deckBuilderClose');
  const deckNameInput = document.getElementById('deckNameInput');
  const characterButton = document.getElementById('deckCharacterButton');
  const characterSummaryPortrait = document.getElementById('deckCharacterSummaryPortrait');
  const characterSummaryName = document.getElementById('deckCharacterSummaryName');
  const characterOverlay = document.getElementById('deckCharacterOverlay');
  const characterPicker = document.getElementById('deckCharacterPicker');
  const characterClose = document.getElementById('deckCharacterClose');
  const characterClear = document.getElementById('deckCharacterClear');
  const deckTypeFilter = document.getElementById('deckTypeFilter');
  const deckSort = document.getElementById('deckSort');
  const libraryRoot = document.getElementById('deckLibrary');
  const selectionStack = document.getElementById('deckSelectionStack');
  const deckSave = document.getElementById('deckSave');
  const playerNameButton = document.getElementById('playerNameButton');
  const playerNameValue = document.getElementById('playerNameValue');
  const playerNameOverlay = document.getElementById('playerNameOverlay');
  const playerNameClose = document.getElementById('playerNameClose');
  const playerNameCancel = document.getElementById('playerNameCancel');
  const playerNameSave = document.getElementById('playerNameSave');
  const playerNameInput = document.getElementById('playerNameInput');

  if (
    !deckGrid ||
    !createDeckButton ||
    !selectedDeckCard ||
    !previewOverlay ||
    !previewClose ||
    !previewTitle ||
    !previewCharacter ||
    !previewMovement ||
    !previewAbility ||
    !builderOverlay ||
    !deckBuilderTitle ||
    !deckBuilderSubtitle ||
    !builderClose ||
    !deckNameInput ||
    !characterButton ||
    !characterSummaryPortrait ||
    !characterSummaryName ||
    !characterOverlay ||
    !characterPicker ||
    !characterClose ||
    !characterClear ||
    !deckTypeFilter ||
    !deckSort ||
    !libraryRoot ||
    !selectionStack ||
    !deckSave ||
    !playerNameButton ||
    !playerNameValue ||
    !playerNameOverlay ||
    !playerNameClose ||
    !playerNameCancel ||
    !playerNameSave ||
    !playerNameInput
  ) {
    return;
  }

  const userId = getOrCreateUserId();
  const catalog = await loadCardCatalog();
  let characterOptions = [...CHARACTER_OPTIONS_FALLBACK];
  try {
    const characterCatalog = await loadCharacterCatalog();
    if (Array.isArray(characterCatalog?.characters) && characterCatalog.characters.length) {
      const fallbackById = new Map(CHARACTER_OPTIONS_FALLBACK.map((entry) => [entry.id, entry]));
      characterOptions = characterCatalog.characters.map((entry) => ({
        ...fallbackById.get(entry.id),
        ...entry,
      }));
    }
  } catch (err) {
    console.warn('Failed to load character catalog for deck picker', err);
  }
  const getCharacterMeta = (characterId) =>
    characterOptions.find((option) => option.id === characterId) || null;
  const cardMap = buildCardMap(catalog);
  let decks = await loadUserDecks(userId);
  let selectedDeckId = getSelectedDeckId();
  if (selectedDeckId && !decks.some((deck) => deck.id === selectedDeckId)) {
    selectedDeckId = null;
    clearSelectedDeckId();
  }

  const builderState = {
    characterId: null,
    movement: normalizeMovementSelection([]),
    ability: [],
    typeFilter: deckTypeFilter.value,
    sort: deckSort.value,
    draggingAbilityId: null,
    suppressClick: false,
    editingDeckId: null,
    editingDeckIsBase: false,
  };

  let builderTextFitRaf = null;
  let builderSubtitleResetTimeout = null;
  let playerName = getStoredUsername() || 'anonymous';
  const builderSubtitleDefaultText =
    `${deckBuilderSubtitle.textContent ?? ''}`.trim() ||
    'Pick a character, 4 movement cards, and 12 ordered ability cards.';

  const fitBuilderCardText = () => {
    if (builderOverlay.hidden) return;
    fitAllCardText(libraryRoot);
    fitAllCardText(selectionStack);
  };

  const scheduleBuilderCardTextFit = () => {
    if (builderOverlay.hidden) return;
    if (builderTextFitRaf !== null) {
      cancelAnimationFrame(builderTextFitRaf);
    }
    builderTextFitRaf = requestAnimationFrame(() => {
      builderTextFitRaf = null;
      fitBuilderCardText();
    });
  };

  const resetBuilderSubtitle = () => {
    if (builderSubtitleResetTimeout !== null) {
      clearTimeout(builderSubtitleResetTimeout);
      builderSubtitleResetTimeout = null;
    }
    deckBuilderSubtitle.textContent = builderSubtitleDefaultText;
  };

  const showBuilderSubtitleMessage = (html, durationMs = 2000) => {
    if (builderSubtitleResetTimeout !== null) {
      clearTimeout(builderSubtitleResetTimeout);
      builderSubtitleResetTimeout = null;
    }
    deckBuilderSubtitle.innerHTML = html;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    builderSubtitleResetTimeout = setTimeout(() => {
      builderSubtitleResetTimeout = null;
      deckBuilderSubtitle.textContent = builderSubtitleDefaultText;
    }, durationMs);
  };

  const pulseBuilderSubtitle = () => {
    deckBuilderSubtitle.classList.remove('is-capacity-pulse');
    void deckBuilderSubtitle.offsetWidth;
    deckBuilderSubtitle.classList.add('is-capacity-pulse');
    setTimeout(() => {
      deckBuilderSubtitle.classList.remove('is-capacity-pulse');
    }, 420);
  };

  const playCapacityShake = (element, options = {}) => {
    const { subtitleHtml = '', subtitleDurationMs = 0 } = options;
    if (subtitleHtml) {
      showBuilderSubtitleMessage(subtitleHtml, subtitleDurationMs);
    }
    pulseBuilderSubtitle();
    if (!element) return;
    element.classList.remove('is-shaking');
    // Force reflow so repeated rejects restart the animation.
    void element.offsetWidth;
    element.classList.add('is-shaking');
    setTimeout(() => {
      element.classList.remove('is-shaking');
    }, 360);
  };

  const renderPlayerName = () => {
    playerNameValue.textContent = playerName;
  };

  const openPlayerNameOverlay = () => {
    playerNameInput.value = playerName;
    playerNameOverlay.hidden = false;
    playerNameInput.focus();
    playerNameInput.select();
  };

  const closePlayerNameOverlay = () => {
    playerNameOverlay.hidden = true;
  };

  const savePlayerName = () => {
    const nextName = setStoredUsername(playerNameInput.value, { custom: true });
    if (!nextName) {
      window.alert('Name cannot be empty.');
      return;
    }
    playerName = nextName;
    renderPlayerName();
    closePlayerNameOverlay();
    window.dispatchEvent(new CustomEvent('hexstrike:username-changed', { detail: { username: playerName } }));
  };

  const dispatchDeckSelected = (deck) => {
    window.dispatchEvent(
      new CustomEvent('hexstrike:deck-selected', {
        detail: deck ? { deckId: deck.id, deck } : { deckId: null, deck: null },
      }),
    );
  };

  const dispatchDecksUpdated = () => {
    window.dispatchEvent(new CustomEvent('hexstrike:decks-updated', { detail: { decks: [...decks] } }));
  };

  const refreshDeckViews = () => {
    renderDeckGrid();
    renderSelectedDeck();
  };

  const isDeckComplete = () =>
    Boolean(builderState.characterId) &&
    builderState.movement.includes(REQUIRED_MOVEMENT_CARD_ID) &&
    builderState.movement.filter((cardId) => isUniqueMovementCard(cardId)).length <= 1 &&
    builderState.movement.length === REQUIRED_MOVEMENT &&
    builderState.ability.length === REQUIRED_ABILITY;

  const normalizeDeckName = () => {
    const trimmed = `${deckNameInput.value ?? ''}`.trim();
    if (trimmed) return trimmed;
    return 'Untitled Deck';
  };

  const isBuilderSaveable = () => Boolean(normalizeDeckName());

  const getDeckCards = (deck) => {
    const movement = deck.movement.map((cardId) => cardMap.get(cardId)).filter(Boolean);
    const ability = deck.ability.map((cardId) => cardMap.get(cardId)).filter(Boolean);
    return { movement, ability };
  };

  const renderSelectedDeck = () => {
    selectedDeckCard.innerHTML = '';
    const deck = decks.find((entry) => entry.id === selectedDeckId) || null;
    if (!deck) {
      selectedDeckCard.classList.add('is-empty');
      const empty = document.createElement('span');
      empty.className = 'selected-deck-empty';
      empty.textContent = 'No deck selected';
      selectedDeckCard.appendChild(empty);
      dispatchDeckSelected(null);
      return;
    }

    selectedDeckCard.classList.remove('is-empty');
    const meta = getCharacterMeta(deck.characterId);
    const portrait = document.createElement('div');
    portrait.className = 'selected-deck-portrait';
    if (meta?.image) {
      const image = document.createElement('img');
      image.src = meta.image;
      image.alt = meta.name;
      image.loading = 'lazy';
      portrait.appendChild(image);
    }
    const label = document.createElement('div');
    label.className = 'selected-deck-name';
    label.textContent = deck.name;
    selectedDeckCard.appendChild(portrait);
    selectedDeckCard.appendChild(label);
    dispatchDeckSelected(deck);
  };

  const setSelectedDeck = (deckId) => {
    if (deckId && deckId === selectedDeckId) return;
    selectedDeckId = deckId || null;
    if (selectedDeckId) {
      setSelectedDeckId(selectedDeckId);
    } else {
      clearSelectedDeckId();
    }
    refreshDeckViews();
  };

  const renderDeckGrid = () => {
    deckGrid.innerHTML = '';
    if (!decks.length) {
      const empty = document.createElement('p');
      empty.className = 'deck-empty';
      empty.textContent = 'No decks saved yet.';
      deckGrid.appendChild(empty);
      return;
    }

    decks.forEach((deck) => {
      const meta = getCharacterMeta(deck.characterId);
      const card = document.createElement('div');
      card.className = 'deck-card';
      if (deck.id === selectedDeckId) {
        card.classList.add('is-selected');
      }

      const previewButton = document.createElement('button');
      previewButton.type = 'button';
      previewButton.className = 'deck-card-button';
      previewButton.setAttribute('aria-label', `Select ${deck.name}`);

      const portrait = document.createElement('div');
      portrait.className = 'deck-card-portrait';
      if (meta?.image) {
        const image = document.createElement('img');
        image.src = meta.image;
        image.alt = meta.name;
        image.loading = 'lazy';
        portrait.appendChild(image);
      }

      const name = document.createElement('div');
      name.className = 'deck-card-name';
      name.textContent = deck.name;

      previewButton.appendChild(portrait);
      previewButton.appendChild(name);

      const { actions, selectButton, deleteButton } = createDeckActions();

      selectButton.addEventListener('click', (event) => {
        event.stopPropagation();
        openBuilder(deck);
      });

      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        decks = decks.filter((entry) => entry.id !== deck.id);
        decks = saveUserDecks(userId, decks);
        if (selectedDeckId === deck.id) {
          selectedDeckId = null;
          clearSelectedDeckId();
        }
        refreshDeckViews();
        dispatchDecksUpdated();
      });

      previewButton.addEventListener('click', () => setSelectedDeck(deck.id));

      card.appendChild(previewButton);
      card.appendChild(actions);
      deckGrid.appendChild(card);
    });
  };

  const openPreview = (deck) => {
    const meta = getCharacterMeta(deck.characterId);
    previewTitle.textContent = deck.name;
    previewCharacter.textContent = meta ? `Character: ${meta.name}` : '';
    previewMovement.innerHTML = '';
    previewAbility.innerHTML = '';
    const cards = getDeckCards(deck);
    cards.movement.forEach((card) => previewMovement.appendChild(buildCardElement(card)));
    cards.ability.forEach((card) => previewAbility.appendChild(buildCardElement(card)));
    previewOverlay.hidden = false;
    fitAllCardText(previewOverlay);
  };

  const closePreview = () => {
    previewOverlay.hidden = true;
    previewMovement.innerHTML = '';
    previewAbility.innerHTML = '';
  };

  const openCharacterOverlay = () => {
    characterButton.setAttribute('aria-expanded', 'true');
    characterOverlay.hidden = false;
  };

  const closeCharacterOverlay = () => {
    characterButton.setAttribute('aria-expanded', 'false');
    characterOverlay.hidden = true;
  };

  const setBuilderFilters = () => {
    deckTypeFilter.value = 'all';
    deckSort.value = 'name';
    builderState.typeFilter = deckTypeFilter.value;
    builderState.sort = deckSort.value;
  };

  const resetBuilder = () => {
    builderState.characterId = null;
    builderState.movement = normalizeMovementSelection([]);
    builderState.ability = [];
    builderState.draggingAbilityId = null;
    builderState.suppressClick = false;
    builderState.editingDeckId = null;
    builderState.editingDeckIsBase = false;
    deckNameInput.value = 'Untitled Deck';
    setBuilderFilters();
  };

  const loadBuilderFromDeck = (deck) => {
    builderState.characterId = deck.characterId || null;
    builderState.movement = normalizeMovementSelection(deck.movement);
    builderState.ability = [...deck.ability];
    builderState.editingDeckId = deck.id;
    builderState.editingDeckIsBase = Boolean(deck.isBase);
    deckNameInput.value = deck.name || '';
  };

  const renderCharacterSummary = () => {
    const meta = getCharacterMeta(builderState.characterId);
    characterSummaryPortrait.innerHTML = '';
    characterSummaryPortrait.classList.toggle('is-empty', !meta);
    if (meta?.image) {
      const image = document.createElement('img');
      image.src = meta.image;
      image.alt = meta.name;
      image.loading = 'lazy';
      characterSummaryPortrait.appendChild(image);
    }
    characterSummaryName.textContent = meta?.name || 'No character selected';
  };

  const renderCharacterPicker = () => {
    characterPicker.innerHTML = '';
    characterOptions.forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'deck-character-card';
      button.setAttribute('aria-label', option.name);
      if (builderState.characterId === option.id) {
        button.classList.add('is-selected');
      }

      const portrait = document.createElement('div');
      portrait.className = 'deck-character-portrait';
      const image = document.createElement('img');
      image.src = option.image;
      image.alt = option.name;
      image.loading = 'lazy';
      portrait.appendChild(image);

      const label = document.createElement('span');
      label.className = 'deck-character-name';
      label.textContent = option.name;
      const power = document.createElement('span');
      power.className = 'deck-character-power';
      power.textContent = option.powerText || '';

      button.appendChild(portrait);
      button.appendChild(label);
      button.appendChild(power);
      button.addEventListener('click', () => {
        builderState.characterId = option.id;
        renderCharacterPicker();
        renderCharacterSummary();
        renderSelection();
        closeCharacterOverlay();
      });
      characterPicker.appendChild(button);
    });
  };

  const renderLibrary = () => {
    const allCards = [...catalog.movement, ...catalog.ability];
    const selected = new Set([...builderState.movement, ...builderState.ability]);
    const filtered = allCards.filter((card) => {
      if (builderState.typeFilter === 'all') return true;
      return card.type === builderState.typeFilter;
    });
    const sorted = sortCards(filtered, builderState.sort);

    libraryRoot.innerHTML = '';
    sorted.forEach((card) => {
      const cardElement = buildCardElement(card, { asButton: true });
      cardElement.classList.add('deck-library-card');
      const isSelected = selected.has(card.id);
      cardElement.classList.toggle('is-selected', isSelected);
      cardElement.disabled = isSelected;
      cardElement.addEventListener('click', () => {
        if (isSelected) return;
        if (card.type === 'movement') {
          if (hasUniqueMovementConflict(builderState.movement, card.id)) {
            playCapacityShake(cardElement, {
              subtitleHtml: UNIQUE_MOVEMENT_LIMIT_MESSAGE_HTML,
              subtitleDurationMs: 2000,
            });
            return;
          }
          if (builderState.movement.length >= REQUIRED_MOVEMENT) {
            playCapacityShake(cardElement);
            return;
          }
          builderState.movement = normalizeMovementSelection([...builderState.movement, card.id]);
        } else if (card.type === 'ability') {
          if (builderState.ability.length >= REQUIRED_ABILITY) {
            playCapacityShake(cardElement);
            return;
          }
          builderState.ability = [...builderState.ability, card.id];
        }
        renderLibrary();
        renderSelection();
      });
      libraryRoot.appendChild(cardElement);
    });
    fitBuilderCardText();
  };

  const removeSelectedCard = (cardId, type, feedbackElement = null) => {
    if (type === 'movement') {
      if (cardId === REQUIRED_MOVEMENT_CARD_ID) {
        playCapacityShake(feedbackElement);
        return;
      }
      builderState.movement = normalizeMovementSelection(
        builderState.movement.filter((id) => id !== cardId),
      );
    } else if (type === 'ability') {
      builderState.ability = builderState.ability.filter((id) => id !== cardId);
    }
    renderLibrary();
    renderSelection();
  };

  const moveAbilityCard = (draggedCardId, targetCardId) => {
    const fromIndex = builderState.ability.indexOf(draggedCardId);
    const toIndex = builderState.ability.indexOf(targetCardId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
    const next = [...builderState.ability];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    builderState.ability = next;
  };

  const buildStackPlaceholder = (text) => {
    const placeholder = document.createElement('div');
    placeholder.className = 'deck-stack-empty';
    placeholder.textContent = text;
    return placeholder;
  };

  const buildStackItem = ({ card, index, cardId, type, allowDrag = false }) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'deck-stack-item';
    wrapper.style.setProperty('--deck-stack-index', `${index}`);
    wrapper.style.setProperty('--deck-stack-z', `${index + 1}`);

    const cardElement = buildCardElement(card);
    cardElement.classList.add('deck-stack-card');
    cardElement.setAttribute('aria-hidden', 'true');

    const hitbox = document.createElement('button');
    hitbox.type = 'button';
    hitbox.className = 'deck-stack-hitbox';
    hitbox.title = card.name;
    hitbox.setAttribute('aria-label', `Remove ${card.name} from deck`);

    hitbox.addEventListener('click', () => {
      if (builderState.suppressClick) return;
      removeSelectedCard(cardId, type, cardElement);
    });

    if (allowDrag) {
      wrapper.classList.add('is-draggable');
      hitbox.draggable = true;
      hitbox.addEventListener('dragstart', (event) => {
        builderState.draggingAbilityId = cardId;
        builderState.suppressClick = true;
        wrapper.classList.add('is-dragging');
        event.dataTransfer?.setData('text/plain', cardId);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
        }
      });
      hitbox.addEventListener('dragend', () => {
        builderState.draggingAbilityId = null;
        wrapper.classList.remove('is-dragging', 'is-drop-target');
        setTimeout(() => {
          builderState.suppressClick = false;
        }, 0);
      });
      hitbox.addEventListener('dragover', (event) => {
        if (!builderState.draggingAbilityId || builderState.draggingAbilityId === cardId) return;
        event.preventDefault();
        wrapper.classList.add('is-drop-target');
      });
      hitbox.addEventListener('dragleave', () => {
        wrapper.classList.remove('is-drop-target');
      });
      hitbox.addEventListener('drop', (event) => {
        event.preventDefault();
        wrapper.classList.remove('is-drop-target');
        if (!builderState.draggingAbilityId || builderState.draggingAbilityId === cardId) return;
        moveAbilityCard(builderState.draggingAbilityId, cardId);
        renderSelection();
      });
    }

    wrapper.appendChild(cardElement);
    wrapper.appendChild(hitbox);
    return wrapper;
  };

  const renderSelection = () => {
    selectionStack.innerHTML = '';
    const orderedEntries = [
      ...builderState.movement.map((cardId) => ({ cardId, type: 'movement' })),
      ...builderState.ability.map((cardId) => ({ cardId, type: 'ability' })),
    ];

    selectionStack.style.setProperty('--deck-stack-count', `${Math.max(orderedEntries.length, 1)}`);

    if (!orderedEntries.length) {
      selectionStack.appendChild(buildStackPlaceholder('No cards selected'));
    } else {
      orderedEntries.forEach((entry, index) => {
        const card = cardMap.get(entry.cardId);
        if (!card) return;
        selectionStack.appendChild(
          buildStackItem({
            card,
            index,
            cardId: entry.cardId,
            type: entry.type,
            allowDrag: entry.type === 'ability',
          }),
        );
      });
    }

    fitBuilderCardText();
  };

  const openBuilder = (deck = null) => {
    resetBuilder();
    resetBuilderSubtitle();
    if (deck) {
      loadBuilderFromDeck(deck);
      deckBuilderTitle.textContent = 'Edit Deck';
    } else {
      deckBuilderTitle.textContent = 'Create a Deck';
    }
    builderOverlay.hidden = false;
    renderCharacterSummary();
    renderCharacterPicker();
    renderLibrary();
    renderSelection();
    scheduleBuilderCardTextFit();
    deckNameInput.focus();
  };

  const closeBuilder = () => {
    closeCharacterOverlay();
    resetBuilderSubtitle();
    builderOverlay.hidden = true;
  };

  const saveDeck = () => {
    const name = normalizeDeckName();
    deckNameInput.value = name;
    if (!name) return;

    const payload = {
      name,
      characterId: builderState.characterId,
      movement: normalizeMovementSelection(builderState.movement),
      ability: [...builderState.ability],
    };

    if (builderState.editingDeckId) {
      const next = [...decks];
      const index = next.findIndex((deck) => deck.id === builderState.editingDeckId);
      const updated = {
        ...(index === -1 ? {} : next[index]),
        id: builderState.editingDeckId,
        isBase: builderState.editingDeckIsBase,
        ...payload,
      };
      if (index === -1) {
        next.push(updated);
      } else {
        next[index] = updated;
      }
      decks = saveUserDecks(userId, next);
    } else {
      const newDeck = {
        id: createDeckId(),
        isBase: false,
        ...payload,
      };
      decks = saveUserDecks(userId, [...decks, newDeck]);
    }

    closeBuilder();
    refreshDeckViews();
    dispatchDecksUpdated();
  };

  renderPlayerName();
  window.addEventListener('hexstrike:connected', (event) => {
    const assignedName = setStoredUsername(event?.detail?.username, { custom: isUsernameCustom() });
    if (!assignedName) return;
    playerName = assignedName;
    renderPlayerName();
    if (!playerNameOverlay.hidden) {
      playerNameInput.value = playerName;
    }
  });

  playerNameButton.addEventListener('click', openPlayerNameOverlay);
  playerNameClose.addEventListener('click', closePlayerNameOverlay);
  playerNameCancel.addEventListener('click', closePlayerNameOverlay);
  playerNameSave.addEventListener('click', savePlayerName);
  playerNameInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    savePlayerName();
  });
  playerNameOverlay.addEventListener('click', (event) => {
    if (event.target === playerNameOverlay) {
      closePlayerNameOverlay();
    }
  });

  previewClose.addEventListener('click', closePreview);
  previewOverlay.addEventListener('click', (event) => {
    if (event.target === previewOverlay) {
      closePreview();
    }
  });

  createDeckButton.addEventListener('click', () => openBuilder());
  builderClose.addEventListener('click', closeBuilder);
  builderOverlay.addEventListener('click', (event) => {
    if (event.target === builderOverlay) {
      closeBuilder();
    }
  });

  characterButton.addEventListener('click', () => openCharacterOverlay());
  characterClose.addEventListener('click', closeCharacterOverlay);
  characterClear.addEventListener('click', () => {
    builderState.characterId = null;
    renderCharacterSummary();
    renderCharacterPicker();
    renderSelection();
    closeCharacterOverlay();
  });
  characterOverlay.addEventListener('click', (event) => {
    if (event.target === characterOverlay) {
      closeCharacterOverlay();
    }
  });

  deckTypeFilter.addEventListener('change', () => {
    builderState.typeFilter = deckTypeFilter.value;
    renderLibrary();
  });

  deckSort.addEventListener('change', () => {
    builderState.sort = deckSort.value;
    renderLibrary();
  });

  deckNameInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    if (!isBuilderSaveable()) return;
    event.preventDefault();
    saveDeck();
  });

  deckSave.addEventListener('click', () => {
    if (!isBuilderSaveable()) return;
    saveDeck();
  });

  refreshDeckViews();
  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !builderOverlay.hidden) {
      if (!isBuilderSaveable()) return;
      event.preventDefault();
      saveDeck();
      return;
    }
    if (event.key !== 'Escape') return;
    if (!playerNameOverlay.hidden) {
      closePlayerNameOverlay();
      return;
    }
    if (!characterOverlay.hidden) {
      closeCharacterOverlay();
      return;
    }
    if (!builderOverlay.hidden) {
      closeBuilder();
    }
  });
  window.addEventListener('resize', () => {
    if (builderOverlay.hidden) return;
    scheduleBuilderCardTextFit();
  });

};
