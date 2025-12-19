const REFRESH_INTERVAL_MS = 2000;

const connectedCount = document.getElementById('connectedCount');
const presenceRows = document.getElementById('presenceRows');

const setCount = (count) => {
  if (!connectedCount) return;
  connectedCount.textContent = `${count} connected`;
};

const renderEmptyState = (message) => {
  if (!presenceRows) return;
  presenceRows.innerHTML = '';
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 3;
  cell.className = 'empty-state';
  cell.textContent = message;
  row.appendChild(cell);
  presenceRows.appendChild(row);
};

const renderRows = (rows) => {
  if (!presenceRows) return;
  presenceRows.innerHTML = '';
  if (!rows.length) {
    renderEmptyState('No active connections.');
    return;
  }

  rows.forEach((rowData) => {
    const row = document.createElement('tr');

    const idCell = document.createElement('td');
    idCell.textContent = rowData.userId;

    const queueCell = document.createElement('td');
    queueCell.className = 'queue-flag';
    queueCell.textContent = rowData.inQuickplay ? 'Q' : '';

    const matchCell = document.createElement('td');
    matchCell.className = 'queue-flag';
    matchCell.textContent = rowData.inMatch ? 'X' : '';

    row.appendChild(idCell);
    row.appendChild(queueCell);
    row.appendChild(matchCell);
    presenceRows.appendChild(row);
  });
};

const fetchPresence = async () => {
  const response = await fetch('/api/v1/lobby/admin');
  if (!response.ok) {
    throw new Error(`Failed to load lobby presence (${response.status})`);
  }
  return response.json();
};

const refresh = async () => {
  if (!presenceRows) return;
  try {
    const data = await fetchPresence();
    const connected = Array.isArray(data.connected) ? data.connected : [];
    const quickplayQueue = Array.isArray(data.quickplayQueue) ? data.quickplayQueue : [];
    const inGame = Array.isArray(data.inGame) ? data.inGame : [];
    const quickplaySet = new Set(quickplayQueue);
    const inGameSet = new Set(inGame);
    const rows = connected
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .map((userId) => ({
        userId,
        inQuickplay: quickplaySet.has(userId),
        inMatch: inGameSet.has(userId),
      }));

    setCount(rows.length);
    renderRows(rows);
  } catch (err) {
    console.error('Failed to refresh lobby presence', err);
    setCount(0);
    renderEmptyState('Unable to load lobby presence.');
  }
};

refresh();
window.setInterval(refresh, REFRESH_INTERVAL_MS);
