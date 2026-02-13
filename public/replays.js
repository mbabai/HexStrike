import { loadCharacterCatalog } from './shared/characterCatalog.js';
import { buildReplayShareUrl, copyTextToClipboard, parseReplayLinkParams } from './replayShare.mjs';
import { showToast } from './toast.js';

const RESULT_ICON_BY_KEY = {
  win: '/public/images/Victory.png',
  loss: '/public/images/Death.png',
  draw: '/public/images/Handshake.png',
};

const RESULT_LABEL_BY_KEY = {
  win: 'Win',
  loss: 'Loss',
  draw: 'Draw',
};

const formatReplayTimestamp = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString();
};

const getReplayLabel = (replay) => `Played ${formatReplayTimestamp(replay?.createdAt)}`;

const normalizeResult = (value) => {
  const normalized = `${value ?? ''}`.trim().toLowerCase();
  if (normalized === 'win' || normalized === 'loss' || normalized === 'draw') return normalized;
  return null;
};

const setOverlayVisible = (overlay, visible) => {
  if (!overlay) return;
  const show = Boolean(visible);
  overlay.hidden = !show;
  overlay.setAttribute('aria-hidden', (!show).toString());
};

const setReplayUrl = (replayId = null) => {
  const url = new URL(window.location.href);
  if (replayId) {
    url.searchParams.set('g', replayId);
    url.searchParams.delete('r');
    url.searchParams.delete('replay');
  } else {
    url.searchParams.delete('g');
    url.searchParams.delete('r');
    url.searchParams.delete('replay');
  }
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);
};

const setBusyText = (listRoot, text) => {
  if (!listRoot) return;
  listRoot.innerHTML = '';
  const empty = document.createElement('p');
  empty.className = 'saved-replays-empty';
  empty.textContent = text;
  listRoot.appendChild(empty);
};

const fetchReplayList = async () => {
  const response = await fetch('/api/v1/history/games', { method: 'GET' });
  const payload = await response.json().catch(() => []);
  if (!response.ok) {
    const message = payload?.error ? `${payload.error}` : 'Failed to load games history.';
    throw new Error(message);
  }
  return Array.isArray(payload) ? payload : [];
};

const fetchReplayDetail = async (replayId) => {
  const response = await fetch(`/api/v1/history/games/${encodeURIComponent(replayId)}`, { method: 'GET' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error ? `${payload.error}` : 'Game history entry not found.';
    throw new Error(message);
  }
  return payload;
};

export const initReplays = async () => {
  const openButton = document.getElementById('savedReplaysOpen');
  const overlay = document.getElementById('savedReplaysOverlay');
  const closeButton = document.getElementById('savedReplaysClose');
  const listRoot = document.getElementById('savedReplaysList');
  if (!openButton || !overlay || !closeButton || !listRoot) return;

  let characterById = new Map();
  try {
    const catalog = await loadCharacterCatalog();
    characterById = catalog?.byId ?? new Map();
  } catch (err) {
    console.warn('Failed to load character catalog for games history list', err);
  }

  let replayList = [];
  let loadingList = false;

  const openReplay = (replay) => {
    if (!replay?.state?.public) return;
    window.dispatchEvent(new CustomEvent('hexstrike:replay-open', { detail: { replay } }));
  };

  const shareReplay = async (replay) => {
    const serverShareUrl = `${replay?.shareUrl ?? ''}`.trim();
    if (serverShareUrl) {
      await copyTextToClipboard(serverShareUrl);
      return serverShareUrl;
    }
    const replayId = `${replay?.id ?? ''}`.trim();
    const shareUrl = replayId ? buildReplayShareUrl(replayId) : null;
    if (!shareUrl) {
      throw new Error('Unable to build share link');
    }
    await copyTextToClipboard(shareUrl);
    return shareUrl;
  };

  const buildPlayerBadge = (player) => {
    const character = characterById.get(player.characterId);
    const badge = document.createElement('div');
    badge.className = 'saved-replay-player';

    const portrait = document.createElement('span');
    portrait.className = 'saved-replay-player-portrait';
    if (character?.image) {
      const image = document.createElement('img');
      image.src = character.image;
      image.alt = character?.name || player.characterId || 'Character';
      image.loading = 'lazy';
      portrait.appendChild(image);
    } else {
      portrait.textContent = '?';
    }

    const name = document.createElement('span');
    name.className = 'saved-replay-player-name';
    name.textContent = player.username || 'Unknown';

    const result = normalizeResult(player?.result);
    badge.appendChild(portrait);
    badge.appendChild(name);
    if (result) {
      const resultBadge = document.createElement('span');
      resultBadge.className = `saved-replay-player-result is-${result}`;
      resultBadge.title = RESULT_LABEL_BY_KEY[result];
      resultBadge.setAttribute('aria-label', RESULT_LABEL_BY_KEY[result]);
      const resultIcon = document.createElement('img');
      resultIcon.src = RESULT_ICON_BY_KEY[result];
      resultIcon.alt = RESULT_LABEL_BY_KEY[result];
      resultIcon.loading = 'lazy';
      resultBadge.appendChild(resultIcon);
      badge.appendChild(resultBadge);
    }
    return badge;
  };

  const renderReplayList = () => {
    listRoot.innerHTML = '';
    if (!replayList.length) {
      setBusyText(listRoot, 'No games in history yet.');
      return;
    }
    replayList.forEach((replay) => {
      const row = document.createElement('article');
      row.className = 'saved-replay-row panel';

      const header = document.createElement('div');
      header.className = 'saved-replay-header';

      const players = document.createElement('div');
      players.className = 'saved-replay-players';
      const replayPlayers = Array.isArray(replay.players) ? replay.players.slice(0, 2) : [];
      replayPlayers.forEach((player) => {
        players.appendChild(buildPlayerBadge(player));
      });

      const title = document.createElement('p');
      title.className = 'saved-replay-name';
      title.textContent = getReplayLabel(replay);

      header.appendChild(players);
      header.appendChild(title);

      const actions = document.createElement('div');
      actions.className = 'saved-replay-actions';

      const viewButton = document.createElement('button');
      viewButton.type = 'button';
      viewButton.className = 'btn btn-primary btn-small';
      viewButton.textContent = 'Watch Replay';
      viewButton.addEventListener('click', async () => {
        viewButton.disabled = true;
        try {
          const detail = await fetchReplayDetail(replay.id);
          setReplayUrl(detail.id);
          setOverlayVisible(overlay, false);
          openReplay(detail);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to open replay.';
          window.alert(message);
        } finally {
          viewButton.disabled = false;
        }
      });

      const shareButton = document.createElement('button');
      shareButton.type = 'button';
      shareButton.className = 'btn btn-ghost btn-small';
      shareButton.textContent = 'Share';
      shareButton.addEventListener('click', async () => {
        shareButton.disabled = true;
        try {
          await shareReplay(replay);
          showToast('link copied to clipboard', { variant: 'success', durationMs: 2000 });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to share replay.';
          window.alert(message);
        } finally {
          shareButton.disabled = false;
        }
      });

      actions.appendChild(viewButton);
      actions.appendChild(shareButton);
      row.appendChild(header);
      row.appendChild(actions);
      listRoot.appendChild(row);
    });
  };

  const refreshReplayList = async () => {
    if (loadingList) return;
    loadingList = true;
    setBusyText(listRoot, 'Loading games history...');
    try {
      replayList = await fetchReplayList();
      renderReplayList();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load games history.';
      setBusyText(listRoot, message);
    } finally {
      loadingList = false;
    }
  };

  openButton.addEventListener('click', () => {
    setOverlayVisible(overlay, true);
    void refreshReplayList();
  });

  closeButton.addEventListener('click', () => {
    setOverlayVisible(overlay, false);
  });

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      setOverlayVisible(overlay, false);
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (overlay.hidden) return;
    setOverlayVisible(overlay, false);
  });

  window.addEventListener('hexstrike:game-history-updated', () => {
    void refreshReplayList();
  });

  window.addEventListener('hexstrike:replay-closed', () => {
    setReplayUrl(null);
  });

  const { replayId } = parseReplayLinkParams();
  if (replayId) {
    try {
      const replay = await fetchReplayDetail(replayId);
      openReplay(replay);
    } catch (err) {
      console.warn('Replay from URL failed to load', err);
    }
  }
};
