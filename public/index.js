import { initMenu } from './menu.js';
import { initQueue } from './queue.js';
import { initGame } from './game.js';
import { initPresence } from './presence.js';
import { initDecks } from './decks.js';
import { initReplays } from './replays.js';

const buildHistoryDebugMessage = (payload = {}, fallbackError = '') => {
  const errorText = `${payload?.error ?? payload?.lastInitializationError ?? fallbackError ?? ''}`.trim();
  const diagnosticsLine = `mode=${payload?.mode ?? 'unknown'} required=${Boolean(payload?.mongoRequired)} db=${payload?.dbName ?? 'unknown'} collection=${payload?.collectionName ?? 'unknown'} route=${payload?.mongoRoute ?? 'unknown'} source=${payload?.mongoUriSource ?? 'unknown'}`;
  const lines = [
    'HexStrike server history storage check failed.',
    errorText ? `error: ${errorText}` : '',
    diagnosticsLine,
  ].filter(Boolean);
  return lines.join('\n');
};

const checkHistoryStoreStatus = async () => {
  try {
    const response = await fetch('/api/v1/history/status', { method: 'GET', cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    const unavailable =
      !response.ok ||
      (payload?.mongoRequired === true && payload?.mode !== 'mongo') ||
      Boolean(payload?.lastInitializationError);
    if (!unavailable) return;
    window.alert(buildHistoryDebugMessage(payload, `HTTP ${response.status}`));
  } catch (err) {
    const message = err instanceof Error ? err.message : `${err}`;
    window.alert(buildHistoryDebugMessage({}, message || 'Unable to reach /api/v1/history/status'));
  }
};

async function initLobby() {
  await checkHistoryStoreStatus();
  initMenu();
  try {
    await initDecks();
  } catch (err) {
    console.error('Failed to initialize decks', err);
  }
  initQueue();
  initGame();
  initPresence();
  try {
    await initReplays();
  } catch (err) {
    console.error('Failed to initialize replays', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLobby);
} else {
  initLobby();
}
