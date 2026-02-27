import { initDecks } from './decks.js';
import { initDeviceProfile } from './shared/deviceProfile.js';
import { loadAlternateCardCatalog } from './shared/cardCatalog.js';
import { CARD_LAYOUT_ALTERNATE } from './shared/cardLayouts.js';

initDeviceProfile();

const openBuilder = () => {
  const createDeckButton = document.getElementById('createDeck');
  if (!(createDeckButton instanceof HTMLButtonElement)) return;
  createDeckButton.click();
};

const renderStatus = (message) => {
  const status = document.getElementById('cardsPageStatus');
  if (!status) return;
  status.textContent = message;
};

const initAltCardsPage = async () => {
  renderStatus('Loading alternate deck builder...');
  try {
    await initDecks({
      onBuilderCloseButton: () => {
        window.location.assign('/');
      },
      loadCatalog: loadAlternateCardCatalog,
      cardLayoutId: CARD_LAYOUT_ALTERNATE,
    });
    renderStatus('Alternate decks ready');
    openBuilder();
  } catch (error) {
    console.error('Failed to initialize alternate deck builder page', error);
    renderStatus('Failed to load');
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void initAltCardsPage();
  });
} else {
  void initAltCardsPage();
}
