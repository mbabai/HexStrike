import { initDecks } from './decks.js';
import { initDeviceProfile } from './shared/deviceProfile.js';

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

const initCardsPage = async () => {
  renderStatus('Loading deck builder...');
  try {
    await initDecks({
      onBuilderCloseButton: () => {
        window.location.assign('/');
      },
    });
    renderStatus('Decks ready');
    openBuilder();
  } catch (error) {
    console.error('Failed to initialize deck builder page', error);
    renderStatus('Failed to load');
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void initCardsPage();
  });
} else {
  void initCardsPage();
}
