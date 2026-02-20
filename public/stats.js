import { loadCardCatalog } from './shared/cardCatalog.js';
import {
  cardHasThrowText,
  getCardDamageValue,
  getCardFramesToFirstAction,
  getCardKbfValue,
  getCardTotalBeats,
  getCardWaitBeats,
  isAbilityAttackCard,
  isAbilityDefenseCard,
  isAbilitySpecialCard,
} from './shared/cardAnalytics.js';

const buildDistributionEntries = (values) => {
  const counts = new Map();
  values.forEach((value) => {
    const count = counts.get(value) ?? 0;
    counts.set(value, count + 1);
  });
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value - b.value);
};

const summarizeValues = (values) => {
  if (!values.length) {
    return {
      average: null,
      median: null,
      mode: [],
      distribution: [],
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const average = total / sorted.length;
  const middleIndex = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middleIndex - 1] + sorted[middleIndex]) / 2
      : sorted[middleIndex];
  const distribution = buildDistributionEntries(sorted);
  const maxCount = distribution.reduce((max, entry) => Math.max(max, entry.count), 0);
  const mode = distribution.filter((entry) => entry.count === maxCount).map((entry) => entry.value);
  return { average, median, mode, distribution };
};

const formatValue = (value) => {
  if (!Number.isFinite(value)) return 'N/A';
  if (Number.isInteger(value)) return `${value}`;
  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
};

const formatAverage = (value) => {
  if (!Number.isFinite(value)) return 'N/A';
  return value.toFixed(2);
};

const createKpi = (label, value) => {
  const kpi = document.createElement('div');
  kpi.className = 'stats-kpi';
  const labelEl = document.createElement('span');
  labelEl.className = 'stats-kpi-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'stats-kpi-value';
  valueEl.textContent = value;
  kpi.appendChild(labelEl);
  kpi.appendChild(valueEl);
  return kpi;
};

const withSymbolIcons = (text) =>
  `${text ?? ''}`
    .replace(/\{E\}/g, '<img class="stats-inline-icon" src="/public/images/E.png" alt="E symbol" />')
    .replace(/\{W\}/g, '<img class="stats-inline-icon" src="/public/images/W.png" alt="W symbol" />');

const createDistribution = (entries, labelFormatter = formatValue) => {
  const container = document.createElement('div');
  container.className = 'stats-distribution';
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'stats-empty';
    empty.textContent = 'No matching cards.';
    container.appendChild(empty);
    return container;
  }

  const maxCount = entries.reduce((max, entry) => Math.max(max, entry.count), 0);
  entries.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'stats-distribution-row';

    const label = document.createElement('span');
    label.className = 'stats-distribution-label';
    label.textContent = labelFormatter(entry.value);
    if (`${entry.value}`.trim().toUpperCase() === 'T') {
      label.classList.add('is-throw-label');
    }

    const track = document.createElement('div');
    track.className = 'stats-distribution-track';
    const fill = document.createElement('div');
    fill.className = 'stats-distribution-fill';
    fill.style.setProperty('--bar-fill', `${maxCount > 0 ? (entry.count / maxCount) * 100 : 0}%`);
    track.appendChild(fill);

    const count = document.createElement('span');
    count.className = 'stats-distribution-count';
    count.textContent = `${entry.count}`;

    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(count);
    container.appendChild(row);
  });
  return container;
};

const buildNumericStatsPanel = ({ title, subtitle, values, distributionEntries = null, distributionLabelFormatter = formatValue }) => {
  const panel = document.createElement('section');
  panel.className = 'panel stats-panel';
  const heading = document.createElement('h2');
  heading.textContent = title;
  const sub = document.createElement('p');
  sub.className = 'stats-panel-subtitle';
  sub.innerHTML = withSymbolIcons(subtitle);

  const summary = summarizeValues(values);
  const kpis = document.createElement('div');
  kpis.className = 'stats-kpis';
  const modeValue =
    summary.mode.length > 0 ? summary.mode.map((value) => formatValue(value)).join(', ') : 'N/A';
  kpis.appendChild(createKpi('Average', formatAverage(summary.average)));
  kpis.appendChild(createKpi('Mode', modeValue));
  kpis.appendChild(createKpi('Median', formatValue(summary.median)));

  panel.appendChild(heading);
  panel.appendChild(sub);
  panel.appendChild(kpis);
  panel.appendChild(createDistribution(distributionEntries ?? summary.distribution, distributionLabelFormatter));
  return panel;
};

const buildTypeDistributionPanel = (catalog) => {
  const panel = document.createElement('section');
  panel.className = 'panel stats-panel is-type';
  const heading = document.createElement('h2');
  heading.textContent = 'Type Distribution';
  const subtitle = document.createElement('p');
  subtitle.className = 'stats-panel-subtitle';
  subtitle.textContent = 'Movement plus ability categories used in deck-builder filters.';

  const abilityCards = Array.isArray(catalog?.ability) ? catalog.ability : [];
  const entries = [
    { value: 'Movement', count: Array.isArray(catalog?.movement) ? catalog.movement.length : 0 },
    { value: 'Attack', count: abilityCards.filter((card) => isAbilityAttackCard(card)).length },
    { value: 'Defense', count: abilityCards.filter((card) => isAbilityDefenseCard(card)).length },
    { value: 'Special', count: abilityCards.filter((card) => isAbilitySpecialCard(card)).length },
  ];

  panel.appendChild(heading);
  panel.appendChild(subtitle);
  panel.appendChild(createDistribution(entries, (value) => `${value}`));
  return panel;
};

const renderStats = async () => {
  const statsGrid = document.getElementById('statsGrid');
  const countPill = document.getElementById('statsCardCount');
  if (!statsGrid) return;
  try {
    const catalog = await loadCardCatalog();
    const movementCards = Array.isArray(catalog?.movement) ? catalog.movement : [];
    const abilityCards = Array.isArray(catalog?.ability) ? catalog.ability : [];
    const cards = [...movementCards, ...abilityCards];

    if (countPill) {
      countPill.textContent = `${cards.length} cards`;
    }

    const kbfValues = cards.map((card) => getCardKbfValue(card)).filter((value) => value > 0);
    const throwCount = cards.filter((card) => cardHasThrowText(card)).length;
    const kbfDistributionEntries = [];
    if (throwCount > 0) {
      kbfDistributionEntries.push({ value: 'T', count: throwCount });
    }
    kbfDistributionEntries.push(
      ...buildDistributionEntries(kbfValues).map((entry) => ({
        value: `${entry.value}`,
        count: entry.count,
      })),
    );

    const numericPanels = [
      {
        title: 'Total Beats',
        subtitle: 'Beats per card, excluding trailing {E}.',
        values: cards.map((card) => getCardTotalBeats(card)),
      },
      {
        title: 'KBF',
        subtitle: 'Cards with KBF greater than 0 plus T.',
        values: kbfValues,
        distributionEntries: kbfDistributionEntries,
        distributionLabelFormatter: (value) => `${value}`,
      },
      {
        title: 'Damage',
        subtitle: 'Cards with damage greater than 0.',
        values: cards.map((card) => getCardDamageValue(card)).filter((value) => value > 0),
      },
      {
        title: 'Wait Beats',
        subtitle: 'Number of {W} beats on each card.',
        values: cards.map((card) => getCardWaitBeats(card)),
      },
      {
        title: 'FTFA',
        subtitle: 'Frames to first action: leading {W} beats before first non-{W}.',
        values: cards.map((card) => getCardFramesToFirstAction(card)),
      },
    ];

    statsGrid.innerHTML = '';
    numericPanels.forEach((panelConfig) => {
      statsGrid.appendChild(buildNumericStatsPanel(panelConfig));
    });
    statsGrid.appendChild(buildTypeDistributionPanel(catalog));
  } catch (error) {
    console.error(error);
    if (countPill) {
      countPill.textContent = '0 cards';
    }
    statsGrid.innerHTML = '';
    const failure = document.createElement('section');
    failure.className = 'panel stats-panel';
    const heading = document.createElement('h2');
    heading.textContent = 'Failed to Load';
    const copy = document.createElement('p');
    copy.textContent = 'Unable to load card statistics right now.';
    failure.appendChild(heading);
    failure.appendChild(copy);
    statsGrid.appendChild(failure);
  }
};

void renderStats();
