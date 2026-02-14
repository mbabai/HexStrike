import { appendInlineText } from '../shared/cardRenderer.js';

const POSITION_CLASS_BY_ID = {
  center: 'is-center',
  timeline: 'is-timeline',
  hand: 'is-hand',
  combo: 'is-combo',
  rotation: 'is-rotation',
};

const MOVEMENT_PASSIVE_IDS = ['step', 'advance', 'fleche', 'backflip'];
const TUTORIAL_TEXT_URL = '/public/game/tutorialText.json';

let tutorialTextCatalog = null;
let tutorialTextCatalogPromise = null;

const normalizeTutorialTextCatalog = (value) => {
  const buttons = value && typeof value.buttons === 'object' ? value.buttons : {};
  const steps = value && typeof value.steps === 'object' ? value.steps : {};
  return {
    buttons,
    steps,
  };
};

const loadTutorialTextCatalog = async () => {
  if (tutorialTextCatalog) return tutorialTextCatalog;
  if (!tutorialTextCatalogPromise) {
    tutorialTextCatalogPromise = fetch(TUTORIAL_TEXT_URL, { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load tutorial text: ${response.status}`);
      }
      const payload = await response.json();
      tutorialTextCatalog = normalizeTutorialTextCatalog(payload);
      return tutorialTextCatalog;
    });
  }
  return tutorialTextCatalogPromise;
};

const TUTORIAL_ACTIONS = {
  open: { activeCardId: 'step', passiveCardIds: ['fumikomi'], rotation: '0' },
  jab: { activeCardId: 'jab', passiveCardIds: ['fleche'], rotation: '0' },
  crossSlash: { activeCardId: 'cross-slash', passiveCardIds: ['step'], rotation: '0' },
  dodge: { activeCardId: 'step', passiveCardIds: ['guard'], rotation: 'R1' },
  hipThrow: { activeCardId: 'hip-throw', passiveCardIds: ['step'], rotation: '3' },
  feintScout: { activeCardId: 'feint', passiveCardIds: ['step'], rotation: '0' },
  finish: { activeCardId: 'smash-attack', passiveCardIds: MOVEMENT_PASSIVE_IDS, rotation: '3' },
};

const normalizeCardId = (value) => `${value ?? ''}`.trim();
const normalizeRotation = (value) => `${value ?? ''}`.trim().toUpperCase();

const normalizeDegrees = (value) => {
  const normalized = ((value % 360) + 360) % 360;
  return Number.isFinite(normalized) ? normalized : 0;
};

const rotateAxialCW = (coord) => ({ q: -coord.r, r: coord.q + coord.r });

const rotateAxial = (coord, steps) => {
  let rotated = { ...coord };
  const normalized = ((steps % 6) + 6) % 6;
  for (let i = 0; i < normalized; i += 1) {
    rotated = rotateAxialCW(rotated);
  }
  return rotated;
};

const getFacingRotationSteps = (facing) => {
  const steps = Math.round((normalizeDegrees(facing) - 180) / 60);
  return ((steps % 6) + 6) % 6;
};

const applyFacingToVector = (vector, facing) => rotateAxial(vector, getFacingRotationSteps(facing));

const AXIAL_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

const getDirectionIndex = (delta) => {
  for (let i = 0; i < AXIAL_DIRECTIONS.length; i += 1) {
    const dir = AXIAL_DIRECTIONS[i];
    if (dir.q === 0 && delta.q !== 0) continue;
    if (dir.r === 0 && delta.r !== 0) continue;
    if (dir.q !== 0) {
      const scale = delta.q / dir.q;
      if (Number.isFinite(scale) && scale > 0 && Math.round(scale) === scale && dir.r * scale === delta.r) return i;
      continue;
    }
    if (dir.r !== 0) {
      const scale = delta.r / dir.r;
      if (Number.isFinite(scale) && scale > 0 && Math.round(scale) === scale && dir.q * scale === delta.q) return i;
    }
  }
  return null;
};

const getBehindDirectionIndex = (facing) => {
  const back = applyFacingToVector({ q: -1, r: 0 }, facing);
  return getDirectionIndex(back);
};

const createNoopGuide = () => ({
  sync: () => {},
  notifyActionSubmitted: () => {},
  notifyInteractionSubmitted: () => {},
  isActive: () => false,
  reset: () => {},
});

export const createTutorialGuide = ({
  gameArea,
  canvas,
  movementHand,
  abilityHand,
  activeSlot,
  passiveSlot,
  rotationWheel,
  comboAccept,
  throwModal,
  localUserId,
  onReturnToLobby,
} = {}) => {
  if (!gameArea || !canvas || !movementHand || !abilityHand || !activeSlot || !passiveSlot || !rotationWheel) {
    return createNoopGuide();
  }

  const overlay = document.createElement('div');
  overlay.className = 'tutorial-overlay';
  overlay.hidden = true;
  overlay.style.display = 'none';
  overlay.setAttribute('aria-hidden', 'true');

  const bubble = document.createElement('div');
  bubble.className = 'tutorial-bubble panel';
  bubble.hidden = true;
  bubble.style.display = 'none';
  bubble.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('div');
  copy.className = 'tutorial-bubble-copy';
  const actions = document.createElement('div');
  actions.className = 'tutorial-bubble-actions';
  const continueButton = document.createElement('button');
  continueButton.type = 'button';
  continueButton.className = 'btn btn-primary';
  actions.appendChild(continueButton);
  bubble.appendChild(copy);
  bubble.appendChild(actions);
  gameArea.appendChild(overlay);
  gameArea.appendChild(bubble);

  const state = {
    enabled: false,
    stepIndex: 0,
    gameId: null,
    active: false,
    currentContext: null,
    highlightedElements: new Set(),
    allowedElements: new Set(),
    highlightBoxes: [],
    highlightPointers: [],
    botUserId: null,
    textCatalog: tutorialTextCatalog,
    textLoadError: null,
  };

  void loadTutorialTextCatalog()
    .then((catalog) => {
      state.textCatalog = catalog;
      state.textLoadError = null;
      if (state.currentContext) {
        sync(state.currentContext);
      }
    })
    .catch((error) => {
      state.textCatalog = null;
      state.textLoadError = error;
      console.error('[tutorial] Failed to load tutorial text catalog.', error);
      if (state.currentContext) {
        sync(state.currentContext);
      }
    });

  const getHandCardById = (cardId) =>
    movementHand.querySelector(`.action-card[data-card-id="${cardId}"]`) ??
    abilityHand.querySelector(`.action-card[data-card-id="${cardId}"]`);

  const getRotationWedge = (rotation) =>
    rotationWheel.querySelector(`.rotation-wedge[data-rotation="${rotation}"]`);

  const getRotationCenter = () => rotationWheel.querySelector('.rotation-center');
  const getSlotDrop = (slot) => slot?.querySelector?.('.action-slot-drop') ?? slot;

  const isCardInSlot = (slot, cardId) => Boolean(slot.querySelector(`.action-card[data-card-id="${cardId}"]`));

  const isRotationSelected = (rotation) =>
    Boolean(rotationWheel.querySelector(`.rotation-wedge.is-selected[data-rotation="${rotation}"]`));

  const getCharacters = (gameState) => gameState?.state?.public?.characters ?? [];

  const getOpponentUserId = (gameState) => {
    const characters = getCharacters(gameState);
    const opponent = characters.find((character) => character?.userId && character.userId !== localUserId);
    return opponent?.userId ?? null;
  };

  const getTimelineEntries = (gameState) => gameState?.state?.public?.beats ?? [];

  const hasActionStarter = (gameState, userId, cardId, passiveCardId = null) => {
    if (!gameState || !userId) return false;
    const characters = getCharacters(gameState);
    const actor = characters.find((character) => character.userId === userId);
    if (!actor) return false;
    const beats = getTimelineEntries(gameState);
    for (let beatIndex = 0; beatIndex < beats.length; beatIndex += 1) {
      const beat = beats[beatIndex] ?? [];
      const entry = beat.find((candidate) => {
        const key = candidate?.userId ?? candidate?.username ?? candidate?.userID;
        return key === userId || key === actor.username;
      });
      if (!entry) continue;
      if (entry.rotationSource !== 'selected') continue;
      if (normalizeCardId(entry.cardId) !== normalizeCardId(cardId)) continue;
      if (passiveCardId && normalizeCardId(entry.passiveCardId) !== normalizeCardId(passiveCardId)) continue;
      return true;
    }
    return false;
  };

  const getPendingInteraction = (gameState) => {
    const interactions = gameState?.state?.public?.customInteractions ?? [];
    return interactions.find(
      (interaction) => interaction?.status === 'pending' && interaction?.actorUserId === localUserId,
    );
  };

  const getThrowBehindDirection = (gameState) => {
    const interaction = getPendingInteraction(gameState);
    if (!interaction || interaction.type !== 'throw') return null;
    const beatIndex = Number.isFinite(interaction.beatIndex) ? Math.max(0, Math.round(interaction.beatIndex)) : 0;
    const beats = getTimelineEntries(gameState);
    const characters = getCharacters(gameState);
    const actor = characters.find((character) => character.userId === localUserId);
    if (!actor) return null;
    let facing = Number.isFinite(actor.facing) ? actor.facing : null;
    for (let index = Math.min(beatIndex, beats.length - 1); index >= 0; index -= 1) {
      const beat = beats[index] ?? [];
      const entry = beat.find((candidate) => {
        const key = candidate?.userId ?? candidate?.username ?? candidate?.userID;
        return key === localUserId || key === actor.username;
      });
      if (entry && Number.isFinite(entry.facing)) {
        facing = entry.facing;
        break;
      }
    }
    if (!Number.isFinite(facing)) return null;
    return getBehindDirectionIndex(facing);
  };

  const resolveTimelineHighlightPointer = () => {
    const gameRect = gameArea.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const targetX = canvasRect.left - gameRect.left + canvasRect.width * 0.48;
    const top = canvasRect.top - gameRect.top + canvasRect.height * 0.142;
    const left = targetX;
    return { left, top, direction: 'right', shiftPercentX: -50 };
  };

  const clearElementClasses = () => {
    state.allowedElements.forEach((element) => {
      element.classList.remove('tutorial-allowed');
    });
    state.allowedElements.clear();
    state.highlightedElements.forEach((element) => {
      element.classList.remove('tutorial-highlight-target');
      element.classList.remove('tutorial-highlight-thick');
    });
    state.highlightedElements.clear();
  };

  const clearHighlightBoxes = () => {
    state.highlightBoxes.forEach((box) => box.remove());
    state.highlightBoxes = [];
  };

  const clearHighlightPointers = () => {
    state.highlightPointers.forEach((pointer) => pointer.remove());
    state.highlightPointers = [];
  };

  const applyHighlightBoxes = (rects) => {
    clearHighlightBoxes();
    rects.forEach((rect) => {
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      const box = document.createElement('div');
      box.className = 'tutorial-highlight-box';
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      overlay.appendChild(box);
      state.highlightBoxes.push(box);
    });
  };

  const applyHighlightPointers = (pointers) => {
    clearHighlightPointers();
    pointers.forEach((pointer) => {
      if (!pointer || !Number.isFinite(pointer.left) || !Number.isFinite(pointer.top)) return;
      const arrow = document.createElement('div');
      arrow.className = 'tutorial-pointer-arrow';
      arrow.dataset.direction = pointer.direction === 'left' ? 'left' : 'right';
      arrow.style.left = `${pointer.left}px`;
      arrow.style.top = `${pointer.top}px`;
      if (Number.isFinite(pointer.scale)) {
        arrow.style.setProperty('--tutorial-pointer-scale', `${pointer.scale}`);
      }
      if (Number.isFinite(pointer.shiftPercentX)) {
        arrow.style.setProperty('--tutorial-pointer-shift-x', `${pointer.shiftPercentX}%`);
      }
      overlay.appendChild(arrow);
      state.highlightPointers.push(arrow);
    });
  };

  const applyElementClasses = ({ allowed = [], highlighted = [], highlightVariant = '' }) => {
    clearElementClasses();
    const allowedSet = new Set(allowed.filter(Boolean));
    allowedSet.forEach((element) => {
      element.classList.add('tutorial-allowed');
      state.allowedElements.add(element);
    });
    const useThickGlow = highlightVariant === 'thick-glow';
    highlighted.filter(Boolean).forEach((element) => {
      element.classList.add('tutorial-highlight-target');
      if (useThickGlow) {
        element.classList.add('tutorial-highlight-thick');
      }
      state.highlightedElements.add(element);
    });
  };

  const setOverlayState = (visible) => {
    const isVisible = Boolean(visible);
    overlay.hidden = !isVisible;
    overlay.style.display = isVisible ? '' : 'none';
    overlay.setAttribute('aria-hidden', (!isVisible).toString());
    bubble.hidden = !isVisible;
    bubble.style.display = isVisible ? '' : 'none';
    bubble.setAttribute('aria-hidden', (!isVisible).toString());
  };

  const setBubblePosition = (positionId) => {
    bubble.classList.remove(...Object.values(POSITION_CLASS_BY_ID));
    const className = POSITION_CLASS_BY_ID[positionId] ?? POSITION_CLASS_BY_ID.center;
    bubble.classList.add(className);
  };

  const setBubbleContent = ({ text = '', buttonLabel = '' }) => {
    appendInlineText(copy, text);
    const showButton = Boolean(buttonLabel);
    actions.hidden = !showButton;
    if (showButton) {
      continueButton.textContent = buttonLabel;
    }
  };

  const advanceStep = () => {
    state.stepIndex += 1;
  };

  const matchesActionExpectation = (expected, payload) => {
    if (!expected) return false;
    const activeCardId = normalizeCardId(payload?.activeCardId);
    const passiveCardId = normalizeCardId(payload?.passiveCardId);
    const rotation = normalizeRotation(payload?.rotation);
    if (activeCardId !== normalizeCardId(expected.activeCardId)) return false;
    if (!Array.isArray(expected.passiveCardIds) || !expected.passiveCardIds.includes(passiveCardId)) return false;
    if (rotation !== normalizeRotation(expected.rotation)) return false;
    return true;
  };

  const currentStep = () => TUTORIAL_STEPS[state.stepIndex] ?? null;

  const getStepText = (textKey) => {
    if (!textKey) return '';
    const value = state.textCatalog?.steps?.[textKey];
    if (typeof value === 'string' && value.trim()) return value;
    return `[Missing tutorial text: ${textKey}]`;
  };

  const getButtonText = (buttonKey) => {
    if (!buttonKey) return '';
    const value = state.textCatalog?.buttons?.[buttonKey];
    if (typeof value === 'string' && value.trim()) return value;
    return `[Missing tutorial button: ${buttonKey}]`;
  };

  const resolveContext = (context) => ({
    gameState: context?.gameState ?? null,
    isReplayMode: Boolean(context?.isReplayMode),
    matchOutcome: context?.gameState?.state?.public?.matchOutcome ?? null,
    pendingInteraction: getPendingInteraction(context?.gameState),
    throwBehindDirection: getThrowBehindDirection(context?.gameState),
  });

  const evaluateAutoAdvance = (resolved) => {
    let updated = true;
    while (updated) {
      updated = false;
      const step = currentStep();
      if (!step) return;
      if (step.kind === 'condition' && step.when(resolved)) {
        advanceStep();
        updated = true;
        continue;
      }
      if (step.kind === 'wait' && step.when(resolved)) {
        advanceStep();
        updated = true;
      }
    }
  };

  const syncStepView = (resolved) => {
    if (!state.textCatalog && !state.textLoadError) {
      setOverlayState(false);
      clearElementClasses();
      clearHighlightBoxes();
      clearHighlightPointers();
      gameArea.classList.remove('tutorial-gating');
      state.active = false;
      return;
    }
    const step = currentStep();
    if (!step) {
      setOverlayState(false);
      clearElementClasses();
      clearHighlightBoxes();
      clearHighlightPointers();
      gameArea.classList.remove('tutorial-gating');
      state.active = false;
      return;
    }
    state.active = true;
    gameArea.classList.add('tutorial-gating');
    const allowElements = typeof step.allow === 'function' ? step.allow(resolved) : [];
    const highlightElements = typeof step.highlightElements === 'function' ? step.highlightElements(resolved) : [];
    const highlightRects = typeof step.highlightRects === 'function' ? step.highlightRects(resolved) : [];
    const highlightPointers = typeof step.highlightPointers === 'function' ? step.highlightPointers(resolved) : [];
    const highlightedCardCount = highlightElements.reduce((count, element) => {
      if (!element || !element.classList || typeof element.classList.contains !== 'function') return count;
      return element.classList.contains('action-card') ? count + 1 : count;
    }, 0);
    const highlightVariant =
      step.highlightVariant ??
      (step.kind === 'condition' && highlightedCardCount === 1 ? 'thick-glow' : '');
    applyElementClasses({
      allowed: allowElements,
      highlighted: highlightElements,
      highlightVariant,
    });
    applyHighlightBoxes(highlightRects);
    applyHighlightPointers(highlightPointers);
    if (step.kind === 'wait') {
      setOverlayState(false);
      return;
    }
    setBubblePosition(step.position ?? 'center');
    let text = getStepText(step.textKey);
    if (step.kind === 'await-action') {
      const expectedRotation = normalizeRotation(step.expectedAction?.rotation);
      text = expectedRotation && isRotationSelected(expectedRotation) ? getButtonText('submit') : text;
    }
    setBubbleContent({ text, buttonLabel: getButtonText(step.buttonLabelKey) });
    setOverlayState(true);
  };

  const reset = () => {
    state.stepIndex = 0;
    state.botUserId = null;
  };

  const hideTutorialUi = () => {
    setOverlayState(false);
    clearElementClasses();
    clearHighlightBoxes();
    clearHighlightPointers();
    gameArea.classList.remove('tutorial-gating');
    state.active = false;
  };

  const shouldEnableTutorial = (gameState, isReplayMode) =>
    Boolean(gameState?.state?.public?.tutorial?.enabled) && !isReplayMode;

  const sync = (context = {}) => {
    state.currentContext = context;
    const gameState = context?.gameState ?? null;
    const isReplayMode = Boolean(context?.isReplayMode);
    const enabled = shouldEnableTutorial(gameState, isReplayMode);
    if (!enabled) {
      state.enabled = false;
      state.gameId = null;
      hideTutorialUi();
      return;
    }

    const gameId = `${gameState?.id ?? ''}`.trim();
    const gameChanged = state.gameId !== gameId;
    if (!state.enabled || gameChanged) {
      reset();
      state.gameId = gameId;
      state.enabled = true;
    }
    state.botUserId = getOpponentUserId(gameState);
    const resolved = resolveContext({ ...context, gameState });
    evaluateAutoAdvance(resolved);
    syncStepView(resolved);
  };

  const notifyActionSubmitted = (payload) => {
    if (!state.enabled) return;
    const step = currentStep();
    if (!step || step.kind !== 'await-action') return;
    if (!matchesActionExpectation(step.expectedAction, payload)) return;
    advanceStep();
    if (state.currentContext) {
      sync(state.currentContext);
    }
  };

  const notifyInteractionSubmitted = ({ type, continueChoice = null, directionIndex = null } = {}) => {
    if (!state.enabled) return;
    const step = currentStep();
    if (!step || step.kind !== 'await-interaction') return;
    if (step.interactionType !== type) return;
    if (step.interactionType === 'combo') {
      if (continueChoice !== true) return;
    } else if (step.interactionType === 'throw') {
      const expectedDirection = state.currentContext
        ? resolveContext(state.currentContext).throwBehindDirection
        : null;
      if (expectedDirection != null && directionIndex !== expectedDirection) return;
    }
    advanceStep();
    if (state.currentContext) {
      sync(state.currentContext);
    }
  };

  const handleContinue = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const step = currentStep();
    if (!step) return;
    if (step.buttonLabelKey === 'returnToLobby') {
      if (onReturnToLobby) {
        onReturnToLobby();
      }
      return;
    }
    if (step.buttonLabelKey) {
      advanceStep();
      if (state.currentContext) {
        sync(state.currentContext);
      }
    }
  };

  continueButton.addEventListener('click', handleContinue);
  continueButton.addEventListener('pointerdown', handleContinue);
  continueButton.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    handleContinue(event);
  });

  const isActive = () => state.active;

  const TUTORIAL_STEPS = [
    {
      kind: 'info',
      position: 'center',
      buttonLabelKey: 'continue',
      textKey: 'introWelcome',
    },
    {
      kind: 'info',
      position: 'timeline',
      buttonLabelKey: 'continue',
      textKey: 'timelineTurn',
      highlightPointers: () => [resolveTimelineHighlightPointer()],
    },
    {
      kind: 'condition',
      position: 'hand',
      textKey: 'selectStepActive',
      allow: () => [getHandCardById('step'), getSlotDrop(activeSlot)],
      highlightElements: () => [getHandCardById('step'), getSlotDrop(activeSlot)],
      highlightVariant: 'thick-glow',
      when: () => isCardInSlot(activeSlot, 'step'),
    },
    {
      kind: 'condition',
      position: 'hand',
      textKey: 'selectFumikomiPassive',
      allow: () => [getHandCardById('fumikomi'), passiveSlot],
      highlightElements: () => [getHandCardById('fumikomi'), passiveSlot],
      when: () => isCardInSlot(passiveSlot, 'fumikomi'),
    },
    {
      kind: 'await-action',
      position: 'rotation',
      textKey: 'selectRotationOpen',
      expectedAction: TUTORIAL_ACTIONS.open,
      allow: () => [getRotationWedge('0'), getRotationCenter(), getHandCardById('step'), getHandCardById('fumikomi'), activeSlot, passiveSlot],
      highlightElements: () => [getRotationWedge('0')],
    },
    {
      kind: 'info',
      position: 'timeline',
      buttonLabelKey: 'continue',
      textKey: 'timelineMoving',
    },
    {
      kind: 'info',
      position: 'hand',
      buttonLabelKey: 'continue',
      textKey: 'cardSymbols',
      highlightElements: () => [movementHand, abilityHand],
      allow: () => [],
    },
    {
      kind: 'condition',
      position: 'hand',
      textKey: 'selectJabActive',
      allow: () => [getHandCardById('jab'), activeSlot],
      highlightElements: () => [getHandCardById('jab')],
      when: () => isCardInSlot(activeSlot, 'jab'),
    },
    {
      kind: 'condition',
      position: 'hand',
      textKey: 'selectFlechePassive',
      allow: () => [getHandCardById('fleche'), passiveSlot],
      highlightElements: () => [getHandCardById('fleche'), passiveSlot],
      when: () => isCardInSlot(passiveSlot, 'fleche'),
    },
    {
      kind: 'await-action',
      position: 'rotation',
      textKey: 'selectRotationJab',
      expectedAction: TUTORIAL_ACTIONS.jab,
      allow: () => [getRotationWedge('0'), getRotationCenter(), getHandCardById('jab'), getHandCardById('fleche'), activeSlot, passiveSlot],
      highlightElements: () => [getRotationWedge('0')],
    },
    {
      kind: 'info',
      position: 'combo',
      buttonLabelKey: 'continue',
      textKey: 'damageAndKbfExplainer',
    },
    {
      kind: 'await-interaction',
      position: 'combo',
      textKey: 'comboYes',
      interactionType: 'combo',
      allow: () => [comboAccept],
      highlightElements: () => [comboAccept],
    },
    {
      kind: 'condition',
      position: 'hand',
      textKey: 'selectCrossSlashActive',
      allow: () => [getHandCardById('cross-slash'), activeSlot],
      highlightElements: () => [getHandCardById('cross-slash')],
      when: () => isCardInSlot(activeSlot, 'cross-slash'),
    },
    {
      kind: 'condition',
      position: 'hand',
      textKey: 'selectStepPassive',
      allow: () => [getHandCardById('step'), passiveSlot],
      highlightElements: () => [getHandCardById('step'), passiveSlot],
      when: () => isCardInSlot(passiveSlot, 'step'),
    },
    {
      kind: 'await-action',
      position: 'rotation',
      textKey: 'selectRotationCrossSlash',
      expectedAction: TUTORIAL_ACTIONS.crossSlash,
      allow: () => [getRotationWedge('0'), getRotationCenter(), getHandCardById('cross-slash'), getHandCardById('step'), activeSlot, passiveSlot],
      highlightElements: () => [getRotationWedge('0')],
    },
    {
      kind: 'info',
      position: 'center',
      buttonLabelKey: 'continue',
      textKey: 'crossSlashResolution',
    },
    {
      kind: 'condition',
      position: 'hand',
      textKey: 'selectFeintActive',
      allow: () => [getHandCardById('step'), activeSlot],
      highlightElements: () => [getHandCardById('step')],
      when: () => isCardInSlot(activeSlot, 'step'),
    },
    {
      kind: 'condition',
      position: 'hand',
      textKey: 'selectFlechePassiveAgain',
      allow: () => [getHandCardById('guard'), passiveSlot],
      highlightElements: () => [getHandCardById('guard')],
      when: () => isCardInSlot(passiveSlot, 'guard'),
    },
    {
      kind: 'await-action',
      position: 'rotation',
      textKey: 'selectRotationDodge',
      expectedAction: TUTORIAL_ACTIONS.dodge,
      allow: () => [getRotationWedge('R1'), getRotationCenter(), getHandCardById('step'), getHandCardById('guard'), activeSlot, passiveSlot],
      highlightElements: () => [getRotationWedge('R1')],
    },
    {
      kind: 'wait',
      when: (resolved) => hasActionStarter(resolved.gameState, state.botUserId, 'advance', 'sinking-shot'),
    },
    {
      kind: 'info',
      position: 'hand',
      buttonLabelKey: 'continue',
      textKey: 'hipThrowIntro',
      highlightElements: () => [getHandCardById('hip-throw')],
    },
    {
      kind: 'condition',
      position: 'hand',
      textKey: 'selectHipThrowActive',
      allow: () => [getHandCardById('hip-throw'), activeSlot],
      highlightElements: () => [getHandCardById('hip-throw')],
      when: () => isCardInSlot(activeSlot, 'hip-throw'),
    },
    {
      kind: 'condition',
      position: 'hand',
      textKey: 'selectStepPassiveHipThrow',
      allow: () => [getHandCardById('step'), passiveSlot],
      highlightElements: () => [getHandCardById('step')],
      when: () => isCardInSlot(passiveSlot, 'step'),
    },
    {
      kind: 'await-action',
      position: 'rotation',
      textKey: 'selectRotationHipThrow',
      expectedAction: TUTORIAL_ACTIONS.hipThrow,
      allow: () => [getRotationWedge('3'), getRotationCenter(), getHandCardById('hip-throw'), getHandCardById('step'), activeSlot, passiveSlot],
      highlightElements: () => [getRotationWedge('3')],
    },
    {
      kind: 'await-interaction',
      position: 'center',
      textKey: 'throwDirection',
      interactionType: 'throw',
      allow: (resolved) => {
        const index = resolved.throwBehindDirection;
        if (!Number.isFinite(index)) return [];
        return [throwModal?.querySelector(`.throw-arrow[data-dir="${index}"]`)];
      },
      highlightElements: (resolved) => {
        const index = resolved.throwBehindDirection;
        if (!Number.isFinite(index)) return [];
        return [throwModal?.querySelector(`.throw-arrow[data-dir="${index}"]`)];
      },
    },
    {
      kind: 'condition',
      position: 'hand',
      textKey: 'selectFeintScoutActive',
      allow: () => [getHandCardById('feint'), activeSlot],
      highlightElements: () => [getHandCardById('feint')],
      when: () => isCardInSlot(activeSlot, 'feint'),
    },
    {
      kind: 'condition',
      position: 'hand',
      textKey: 'selectStepPassiveScout',
      allow: () => [getHandCardById('step'), passiveSlot],
      highlightElements: () => [getHandCardById('step')],
      when: () => isCardInSlot(passiveSlot, 'step'),
    },
    {
      kind: 'await-action',
      position: 'rotation',
      textKey: 'selectRotationScoutFeint',
      expectedAction: TUTORIAL_ACTIONS.feintScout,
      allow: () => [getRotationWedge('0'), getRotationCenter(), getHandCardById('feint'), getHandCardById('step'), activeSlot, passiveSlot],
      highlightElements: () => [getRotationWedge('0')],
    },
    {
      kind: 'info',
      position: 'timeline',
      buttonLabelKey: 'continue',
      textKey: 'finishIntro',
    },
    {
      kind: 'condition',
      position: 'hand',
      textKey: 'selectSmashActive',
      allow: () => [getHandCardById('smash-attack'), activeSlot],
      highlightElements: () => [getHandCardById('smash-attack')],
      when: () => isCardInSlot(activeSlot, 'smash-attack'),
    },
    {
      kind: 'condition',
      position: 'hand',
      textKey: 'selectAnyMovementPassive',
      allow: () => MOVEMENT_PASSIVE_IDS.map((id) => getHandCardById(id)).concat([passiveSlot]),
      highlightElements: () => MOVEMENT_PASSIVE_IDS.map((id) => getHandCardById(id)),
      when: () => MOVEMENT_PASSIVE_IDS.some((id) => isCardInSlot(passiveSlot, id)),
    },
    {
      kind: 'await-action',
      position: 'rotation',
      textKey: 'selectRotationFinish',
      expectedAction: TUTORIAL_ACTIONS.finish,
      allow: () =>
        [getRotationWedge('3'), getRotationCenter(), getHandCardById('smash-attack'), activeSlot, passiveSlot].concat(
          MOVEMENT_PASSIVE_IDS.map((id) => getHandCardById(id)),
        ),
      highlightElements: () => [getRotationWedge('3')],
    },
    {
      kind: 'wait',
      when: (resolved) => Boolean(resolved.matchOutcome),
    },
    {
      kind: 'info',
      position: 'center',
      buttonLabelKey: 'returnToLobby',
      textKey: 'victoryOutro',
    },
  ];

  return {
    sync,
    notifyActionSubmitted,
    notifyInteractionSubmitted,
    isActive,
    reset,
  };
};
