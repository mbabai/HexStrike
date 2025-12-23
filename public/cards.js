import { loadCardCatalog } from './shared/cardCatalog.js';
import { buildCardElement, fitAllCardText } from './shared/cardRenderer.js';

const renderCards = async () => {
  const table = document.getElementById('cardsTable');
  const count = document.getElementById('cardCount');
  if (!table) return;

  const setEmptyState = (message) => {
    table.innerHTML = '';
    const empty = document.createElement('p');
    empty.className = 'cards-empty';
    empty.textContent = message;
    table.appendChild(empty);
  };

  try {
    const catalog = await loadCardCatalog();
    const cards = [...catalog.movement, ...catalog.ability];
    if (count) {
      count.textContent = `${cards.length} cards`;
    }
    if (!cards.length) {
      setEmptyState('No cards available.');
      return;
    }
    table.innerHTML = '';
    cards.forEach((card) => {
      table.appendChild(buildCardElement(card));
    });
    requestAnimationFrame(() => {
      fitAllCardText();
      if (document.fonts?.ready) {
        document.fonts.ready.then(() => requestAnimationFrame(() => fitAllCardText()));
      }
    });
    window.addEventListener('load', () => requestAnimationFrame(() => fitAllCardText()), { once: true });
  } catch (error) {
    console.error(error);
    if (count) {
      count.textContent = '0 cards';
    }
    setEmptyState('Failed to load cards.');
  }
};

void renderCards();
