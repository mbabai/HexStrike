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

const SORT_KEY_DATE = 'date';
const SORT_KEY_BEATS = 'beats';
const SORT_KEY_ZONE = 'zone';
const SORT_DIRECTION_ASC = 'asc';
const SORT_DIRECTION_DESC = 'desc';

const formatReplayTimestamp = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString();
};

const getReplayTimestamp = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return date.getTime();
};

const normalizeResult = (value) => {
  const normalized = `${value ?? ''}`.trim().toLowerCase();
  if (normalized === 'win' || normalized === 'loss' || normalized === 'draw') return normalized;
  return null;
};

const normalizeSortDirection = (value) => {
  const normalized = `${value ?? ''}`.trim().toLowerCase();
  return normalized === SORT_DIRECTION_ASC ? SORT_DIRECTION_ASC : SORT_DIRECTION_DESC;
};

const getReplayDateValue = (replay) => getReplayTimestamp(replay?.createdAt);

const getReplayBeatsToEnd = (replay) => {
  const summaryValue = Number(replay?.beatsToEnd);
  if (Number.isFinite(summaryValue)) return Math.max(0, Math.round(summaryValue));
  const outcomeBeat = Number(replay?.matchOutcome?.beatIndex);
  if (Number.isFinite(outcomeBeat)) return Math.max(0, Math.round(outcomeBeat) + 1);
  const beats = replay?.state?.public?.beats;
  if (Array.isArray(beats)) return beats.length;
  return 0;
};

const getReplayZoneDistance = (replay) => {
  const summaryValue = Number(replay?.lossZoneDistance);
  if (Number.isFinite(summaryValue)) return Math.max(0, Math.round(summaryValue));
  const lossMethod = `${replay?.lossMethod ?? ''}`.trim().toLowerCase();
  if (!lossMethod.startsWith('zone')) return null;
  const match = lossMethod.match(/zone\s+(\d+)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
};

const getReplayLossMethod = (replay) => {
  const summaryValue = `${replay?.lossMethod ?? ''}`.trim();
  if (summaryValue) return summaryValue;
  const reason = `${replay?.matchOutcome?.reason ?? ''}`.trim().toLowerCase();
  if (reason === 'no-cards-abyss') return 'fall';
  if (reason === 'far-from-land') {
    const zone = getReplayZoneDistance(replay);
    return Number.isFinite(zone) ? `zone ${zone}` : 'zone';
  }
  if (reason === 'forfeit') return 'forfeit';
  if (reason === 'draw-agreement') return 'draw';
  return 'unknown';
};

const normalizeFilterText = (value) => `${value ?? ''}`.trim().toLowerCase();

const matchesPlayerFilter = (replay, filterText) => {
  const normalizedFilter = normalizeFilterText(filterText);
  if (!normalizedFilter) return true;
  // "%text%" semantics: case-insensitive substring match on player usernames.
  const replayPlayers = Array.isArray(replay?.players) ? replay.players : [];
  return replayPlayers.some((player) => {
    const username = `${player?.username ?? ''}`.trim().toLowerCase();
    return username.includes(normalizedFilter);
  });
};

const sortReplayList = (replays, sortKey, sortDirection) => {
  const direction = normalizeSortDirection(sortDirection) === SORT_DIRECTION_ASC ? 1 : -1;
  const list = Array.isArray(replays) ? [...replays] : [];
  list.sort((a, b) => {
    if (sortKey === SORT_KEY_DATE) {
      const dateDelta = getReplayDateValue(a) - getReplayDateValue(b);
      if (dateDelta) return dateDelta * direction;
    } else if (sortKey === SORT_KEY_BEATS) {
      const beatDelta = getReplayBeatsToEnd(a) - getReplayBeatsToEnd(b);
      if (beatDelta) return beatDelta * direction;
    } else if (sortKey === SORT_KEY_ZONE) {
      const zoneA = getReplayZoneDistance(a);
      const zoneB = getReplayZoneDistance(b);
      const hasA = Number.isFinite(zoneA);
      const hasB = Number.isFinite(zoneB);
      if (!hasA && hasB) return 1;
      if (hasA && !hasB) return -1;
      if (hasA && hasB) {
        const zoneDelta = zoneA - zoneB;
        if (zoneDelta) return zoneDelta * direction;
      }
    }
    const fallbackDateDelta = getReplayDateValue(b) - getReplayDateValue(a);
    if (fallbackDateDelta) return fallbackDateDelta;
    return `${a?.id ?? ''}`.localeCompare(`${b?.id ?? ''}`);
  });
  return list;
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
  const filterInput = document.getElementById('savedReplaysPlayerFilter');
  const sortDirectionToggle = document.getElementById('savedReplaysSortDirectionToggle');
  const sortButtons = overlay ? Array.from(overlay.querySelectorAll('.saved-replays-sort-btn')) : [];
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
  let playerFilter = '';
  let sortKey = SORT_KEY_DATE;
  let sortDirection = SORT_DIRECTION_DESC;

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

  const setSortButtonState = () => {
    sortButtons.forEach((button) => {
      const key = `${button.dataset.sortKey ?? ''}`.trim().toLowerCase();
      button.classList.toggle('is-active', key === sortKey);
    });
    if (sortDirectionToggle) {
      sortDirectionToggle.textContent =
        sortDirection === SORT_DIRECTION_ASC ? 'Ascending' : 'Descending';
      sortDirectionToggle.setAttribute(
        'aria-label',
        `Sort order: ${sortDirection === SORT_DIRECTION_ASC ? 'ascending' : 'descending'}`,
      );
    }
  };

  const createMetric = (labelText, valueText) => {
    const metric = document.createElement('p');
    metric.className = 'saved-replay-metric';

    const label = document.createElement('span');
    label.className = 'saved-replay-metric-label';
    label.textContent = labelText;

    const value = document.createElement('span');
    value.className = 'saved-replay-metric-value';
    value.textContent = valueText;

    metric.appendChild(label);
    metric.appendChild(value);
    return metric;
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
    const visibleReplays = sortReplayList(
      replayList.filter((replay) => matchesPlayerFilter(replay, playerFilter)),
      sortKey,
      sortDirection,
    );
    if (!visibleReplays.length) {
      setBusyText(listRoot, 'No games match that player filter.');
      return;
    }
    visibleReplays.forEach((replay) => {
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

      const metrics = document.createElement('div');
      metrics.className = 'saved-replay-metrics';
      metrics.appendChild(createMetric('Date', formatReplayTimestamp(replay?.createdAt)));
      metrics.appendChild(createMetric('Beats', `${getReplayBeatsToEnd(replay)}`));
      metrics.appendChild(createMetric('Termination', getReplayLossMethod(replay)));

      header.appendChild(players);
      header.appendChild(metrics);

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

  if (filterInput) {
    filterInput.addEventListener('input', () => {
      playerFilter = `${filterInput.value ?? ''}`;
      renderReplayList();
    });
  }

  sortButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const requestedKey = `${button.dataset.sortKey ?? ''}`.trim().toLowerCase();
      if (requestedKey !== SORT_KEY_DATE && requestedKey !== SORT_KEY_BEATS && requestedKey !== SORT_KEY_ZONE) {
        return;
      }
      sortKey = requestedKey;
      setSortButtonState();
      renderReplayList();
    });
  });

  if (sortDirectionToggle) {
    sortDirectionToggle.addEventListener('click', () => {
      sortDirection = sortDirection === SORT_DIRECTION_ASC ? SORT_DIRECTION_DESC : SORT_DIRECTION_ASC;
      setSortButtonState();
      renderReplayList();
    });
  }

  setSortButtonState();

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
