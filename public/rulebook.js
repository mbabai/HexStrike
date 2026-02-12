import { loadCardCatalog } from './shared/cardCatalog.js';
import { loadCharacterCatalog } from './shared/characterCatalog.js';
import { buildCardElement, fitAllCardText } from './shared/cardRenderer.js';
import { buildRotationWheel } from './game/rotationWheel.js';

const ACTION_TYPE_SYMBOLS = [
  {
    icon: 'm',
    title: 'Move Action',
    description: 'Step-by-step travel along the path. Stops before entering occupied hexes.',
  },
  {
    icon: '2j',
    title: 'Jump Action',
    description: 'Direct travel to destination. Intermediate occupancy is ignored; occupied landing hexes are invalid.',
  },
  {
    icon: 'a',
    title: 'Attack Action',
    description: 'Targets the destination hex of its path when the token resolves.',
  },
  {
    icon: 'b',
    title: 'Block Action',
    description: 'Creates directional protection from current hex against later matching attacks.',
  },
  {
    icon: 'b-Lb-Rb',
    title: 'Multi-Angle Block',
    description: 'Some block symbols protect multiple angles at once.',
  },
  {
    icon: 'c',
    title: 'Charge Action',
    description: 'Combines attack behavior with movement behavior in one token.',
  },
];

const PATH_SYMBOLS = [
  {
    icon: 'm',
    title: 'Default Forward Path',
    description: 'When a symbol has no path prefix, it resolves one hex forward.',
  },
  {
    icon: 'Ba',
    title: 'Relative Direction Paths',
    description: 'Path geometry is relative to current facing, not absolute board north.',
  },
  {
    icon: '2m',
    title: 'Distance Variants',
    description: 'Numbered variants indicate distance along a direction.',
  },
  {
    icon: 'a-La-Ra',
    title: 'Chained Tokens',
    description: 'Composite symbols resolve left to right within the same beat.',
  },
  {
    icon: 'Bm',
    title: 'Backward Direction Variant',
    description: 'Backward-direction variants are distinct from dedicated block-action symbols.',
  },
];

const SPECIAL_SYMBOLS = [
  {
    icon: 'E',
    title: 'Open Beat',
    description: 'Open beat. Primary insertion point and refresh trigger when on land.',
  },
  {
    icon: 'W',
    title: 'Wait Beat',
    description: 'Wait action.',
  },
  {
    icon: 'F',
    title: 'Focus Beat',
    description: 'Focus/open beat marker used by concentration rules.',
  },
  {
    icon: 'Co',
    title: 'Combo Beat',
    description: 'Combo check beat. May pause for continue/stop decision.',
  },
  {
    icon: 'DamageIcon',
    title: 'Hit Window Marker',
    description: 'Hit-stun/knockback timeline rewrite marker.',
  },
  {
    icon: 'X1',
    title: 'Primary Text Trigger',
    description: 'Card-text trigger step (special effect anchor).',
  },
  {
    icon: 'X2',
    title: 'Secondary Text Trigger',
    description: 'Reserved secondary card-text trigger symbol (available in UI parser; currently unused in base cards).',
  },
  {
    icon: 'i',
    title: 'Bracketed Text Anchor',
    description: 'Text anchor used by bracketed effect steps.',
  },
  {
    icon: 'KnockBackIcon',
    title: 'Knockback Badge',
    description: 'Knockback badge. Throw-indicator cards resolve through throw interaction flow.',
  },
  {
    icon: 'KnockBackIcon',
    title: 'Throw Badge',
    badgeValue: 'T',
    badgeOnIcon: true,
    muted: true,
    description: 'When this badge shows T, that hit uses throw rules instead of normal knockback math.',
  },
  {
    icon: 'DamageIcon',
    title: 'Stun-Only Marker',
    muted: true,
    description: 'A greyed marker means stun timing without movement knockback.',
  },
  {
    icon: 'rotStar',
    title: 'Rotation Selection Badge',
    description: 'Rotation labels in 60-degree steps; applied before action resolution.',
  },
  {
    icon: 'rot0-2',
    title: 'Rotation Restriction Badge',
    description: 'Rotation restriction badge on active cards.',
  },
  {
    icons: ['Victory', 'Death', 'Handshake'],
    title: 'Outcome Markers',
    description: 'Match outcome markers (win/loss/draw) appear on the timeline.',
  },
  {
    icon: 'FireHexToken',
    title: 'Fire Hex Token',
    description: 'Board token that damages characters standing on it each beat.',
  },
  {
    icon: 'ArrowToken',
    title: 'Arrow Token',
    description: 'Board token that advances each beat and resolves as a charge-style hit using damage and knockback stats.',
  },
  {
    icon: 'EtherealPlatform',
    title: 'Ethereal Platform Token',
    description: 'Board token that can temporarily allow land-style refresh over abyss.',
  },
  {
    icon: 'F',
    title: 'Focus Anchor Token',
    description: 'Board token that marks the current focus anchor location.',
  },
];

const createSymbolCard = ({ icon, icons, title, badgeValue, badgeOnIcon, muted, description }) => {
  const card = document.createElement('article');
  card.className = 'symbol-card';

  const header = document.createElement('div');
  header.className = 'symbol-header';

  const iconList = Array.isArray(icons) && icons.length > 0 ? icons : icon ? [icon] : [];
  if (iconList.length > 0) {
    iconList.forEach((iconId, index) => {
      const wrap = document.createElement('span');
      wrap.className = 'symbol-icon-wrap';
      const image = document.createElement('img');
      image.src = `/public/images/${iconId}.png`;
      image.alt = title || 'Symbol icon';
      image.loading = 'lazy';
      if (muted) image.classList.add('is-muted');
      wrap.appendChild(image);
      if (badgeValue && index === 0) {
        const badge = document.createElement('span');
        badge.className = 'symbol-icon-badge';
        if (badgeOnIcon) badge.classList.add('is-on-icon');
        badge.textContent = `${badgeValue}`;
        wrap.appendChild(badge);
      }
      header.appendChild(wrap);
    });
  }

  if (title) {
    const heading = document.createElement('h4');
    heading.className = 'symbol-title';
    heading.textContent = title;
    header.appendChild(heading);
  }

  const body = document.createElement('p');
  body.textContent = description;

  card.appendChild(header);
  card.appendChild(body);
  return card;
};

const renderSymbolGroup = (containerId, entries) => {
  const root = document.getElementById(containerId);
  if (!root) return;
  root.innerHTML = '';
  entries.forEach((entry) => root.appendChild(createSymbolCard(entry)));
};

const renderCharacterRoster = (catalog) => {
  const root = document.getElementById('characterRoster');
  if (!root) return;
  root.innerHTML = '';
  const characters = Array.isArray(catalog?.characters) ? catalog.characters : [];
  characters.forEach((character) => {
    const card = document.createElement('article');
    card.className = 'character-card';

    const portrait = document.createElement('img');
    portrait.src = character.image || '/public/images/empty.png';
    portrait.alt = character.name || character.id;
    portrait.loading = 'lazy';

    const textWrap = document.createElement('div');
    const title = document.createElement('h4');
    title.textContent = character.name || character.id;
    const text = document.createElement('p');
    text.textContent = character.powerText || 'No listed power text.';

    textWrap.appendChild(title);
    textWrap.appendChild(text);
    card.appendChild(portrait);
    card.appendChild(textWrap);
    root.appendChild(card);
  });
};

const findCardById = (catalog, cardId, type) =>
  (Array.isArray(catalog?.[type]) ? catalog[type] : []).find((card) => card.id === cardId) || null;

const renderSampleCards = (catalog) => {
  const movementRoot = document.getElementById('sampleMovementCard');
  const abilityRoot = document.getElementById('sampleAbilityCard');
  if (!movementRoot || !abilityRoot) return;

  const movementCard =
    findCardById(catalog, 'ninja-roll', 'movement') ||
    findCardById(catalog, 'grappling-hook', 'movement') ||
    (catalog.movement || [])[0];
  const abilityCard =
    findCardById(catalog, 'burning-strike', 'ability') ||
    findCardById(catalog, 'jab', 'ability') ||
    (catalog.ability || [])[0];

  movementRoot.innerHTML = '';
  abilityRoot.innerHTML = '';
  if (movementCard) {
    movementRoot.appendChild(buildCardElement(movementCard));
  }
  if (abilityCard) {
    abilityRoot.appendChild(buildCardElement(abilityCard));
  }
};

const renderCardCatalog = (catalog) => {
  const movementRoot = document.getElementById('movementCatalog');
  const abilityRoot = document.getElementById('abilityCatalog');
  if (!movementRoot || !abilityRoot) return;

  movementRoot.innerHTML = '';
  abilityRoot.innerHTML = '';

  (catalog.movement || []).forEach((card) => movementRoot.appendChild(buildCardElement(card)));
  (catalog.ability || []).forEach((card) => abilityRoot.appendChild(buildCardElement(card)));
};

const renderPhaseRotationWheel = () => {
  const container = document.getElementById('phaseRotationWheel');
  if (!container) return;
  const wheel = buildRotationWheel(container, null);
  wheel.setAllowedRotations(['0', 'R1', 'R2', '3', 'L2', 'L1']);
  wheel.setValue('0');
};

const fitCardTextWithFontSync = () => {
  requestAnimationFrame(() => {
    fitAllCardText();
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => requestAnimationFrame(() => fitAllCardText()));
    }
  });
  window.addEventListener('load', () => requestAnimationFrame(() => fitAllCardText()), { once: true });
};

const renderRulebook = async () => {
  renderSymbolGroup('actionTypeGlossary', ACTION_TYPE_SYMBOLS);
  renderSymbolGroup('pathGlossary', PATH_SYMBOLS);
  renderSymbolGroup('specialGlossary', SPECIAL_SYMBOLS);

  const [cardCatalog, characterCatalog] = await Promise.all([loadCardCatalog(), loadCharacterCatalog()]);
  renderCharacterRoster(characterCatalog);
  renderSampleCards(cardCatalog);
  renderCardCatalog(cardCatalog);
  renderPhaseRotationWheel();
  fitCardTextWithFontSync();
};

void renderRulebook().catch((error) => {
  console.error('Failed to render rulebook', error);
});
