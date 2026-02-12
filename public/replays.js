import { loadCharacterCatalog } from './shared/characterCatalog.js';
import { buildReplayShareUrl, copyTextToClipboard, parseReplayLinkParams } from './replayShare.mjs';
import { showToast } from './toast.js';

const formatReplayTimestamp = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString();
};

const getReplayName = (replay) => formatReplayTimestamp(replay?.createdAt);

const setOverlayVisible = (overlay, visible) => {
  if (!overlay) return;
  const show = Boolean(visible);
  overlay.hidden = !show;
  overlay.setAttribute('aria-hidden', (!show).toString());
};

const setReplayUrl = (replayId = null, encodedPayload = null) => {
  const url = new URL(window.location.href);
  if (replayId) {
    url.searchParams.set('replay', replayId);
  } else {
    url.searchParams.delete('replay');
  }
  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  if (encodedPayload) {
    hashParams.set('rp', encodedPayload);
  } else {
    hashParams.delete('rp');
  }
  const nextHash = hashParams.toString();
  window.history.replaceState({}, '', `${url.pathname}${url.search}${nextHash ? `#${nextHash}` : ''}`);
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
  const response = await fetch('/api/v1/replays', { method: 'GET' });
  const payload = await response.json().catch(() => []);
  if (!response.ok) {
    const message = payload?.error ? `${payload.error}` : 'Failed to load saved replays.';
    throw new Error(message);
  }
  return Array.isArray(payload) ? payload : [];
};

const fetchReplayDetail = async (replayId) => {
  const response = await fetch(`/api/v1/replays/${encodeURIComponent(replayId)}`, { method: 'GET' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error ? `${payload.error}` : 'Replay not found.';
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
    console.warn('Failed to load character catalog for replay list', err);
  }

  let replayList = [];
  let loadingList = false;

  const openReplay = (replay) => {
    if (!replay?.state?.public) return;
    window.dispatchEvent(new CustomEvent('hexstrike:replay-open', { detail: { replay } }));
  };

  const shareReplay = async (replay) => {
    const detail = replay?.state?.public ? replay : await fetchReplayDetail(replay.id);
    const shareUrl = buildReplayShareUrl(detail, { includePayload: true });
    if (!shareUrl) {
      throw new Error('Unable to build replay link');
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

    badge.appendChild(portrait);
    badge.appendChild(name);
    return badge;
  };

  const renderReplayList = () => {
    listRoot.innerHTML = '';
    if (!replayList.length) {
      setBusyText(listRoot, 'No saved replays yet.');
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
      title.textContent = getReplayName(replay);

      header.appendChild(players);
      header.appendChild(title);

      const actions = document.createElement('div');
      actions.className = 'saved-replay-actions';

      const viewButton = document.createElement('button');
      viewButton.type = 'button';
      viewButton.className = 'btn btn-primary btn-small';
      viewButton.textContent = 'View';
      viewButton.addEventListener('click', async () => {
        viewButton.disabled = true;
        try {
          const detail = await fetchReplayDetail(replay.id);
          setReplayUrl(detail.id, null);
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
    setBusyText(listRoot, 'Loading replays...');
    try {
      replayList = await fetchReplayList();
      renderReplayList();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load saved replays.';
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

  window.addEventListener('hexstrike:replay-saved', () => {
    void refreshReplayList();
  });

  window.addEventListener('hexstrike:replay-closed', () => {
    setReplayUrl(null, null);
  });

  const { replayId, replay: replayFromPayload } = parseReplayLinkParams();
  if (replayFromPayload?.state?.public) {
    openReplay(replayFromPayload);
    return;
  }
  if (replayId) {
    try {
      const replay = await fetchReplayDetail(replayId);
      openReplay(replay);
    } catch (err) {
      console.warn('Replay from URL failed to load', err);
    }
  }
};
