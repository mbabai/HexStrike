const ROTATION_LABELS = ['0', 'R1', 'R2', '3', 'L2', 'L1'];
const SVG_NS = 'http://www.w3.org/2000/svg';

const polarToCartesian = (centerX, centerY, radius, angleDeg) => {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: centerX + radius * Math.cos(angleRad),
    y: centerY + radius * Math.sin(angleRad),
  };
};

const describeDonutSegment = (centerX, centerY, outerRadius, innerRadius, startAngle, endAngle) => {
  const startOuter = polarToCartesian(centerX, centerY, outerRadius, endAngle);
  const endOuter = polarToCartesian(centerX, centerY, outerRadius, startAngle);
  const startInner = polarToCartesian(centerX, centerY, innerRadius, startAngle);
  const endInner = polarToCartesian(centerX, centerY, innerRadius, endAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;

  return [
    'M', startOuter.x, startOuter.y,
    'A', outerRadius, outerRadius, 0, largeArc, 0, endOuter.x, endOuter.y,
    'L', startInner.x, startInner.y,
    'A', innerRadius, innerRadius, 0, largeArc, 1, endInner.x, endInner.y,
    'Z',
  ].join(' ');
};

export const buildRotationWheel = (container, onSelect) => {
  if (!container) return { getValue: () => null };

  container.innerHTML = '';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('role', 'radiogroup');
  svg.setAttribute('aria-label', 'Rotation selector');

  const center = { x: 60, y: 60 };
  const outerRadius = 54;
  const innerRadius = 28;
  const wedges = [];

  ROTATION_LABELS.forEach((label, index) => {
    const startAngle = index * 60 - 30;
    const endAngle = startAngle + 60;
    const midAngle = startAngle + 30;
    const labelPoint = polarToCartesian(center.x, center.y, (outerRadius + innerRadius) / 2, midAngle);

    const wedge = document.createElementNS(SVG_NS, 'g');
    wedge.setAttribute('class', 'rotation-wedge');
    wedge.setAttribute('data-index', `${index}`);
    wedge.setAttribute('data-rotation', label);
    wedge.setAttribute('role', 'radio');
    wedge.setAttribute('tabindex', '0');
    wedge.setAttribute('aria-checked', 'false');
    wedge.setAttribute('aria-label', `Rotation ${label}`);

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', describeDonutSegment(center.x, center.y, outerRadius, innerRadius, startAngle, endAngle));

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', labelPoint.x.toFixed(2));
    text.setAttribute('y', labelPoint.y.toFixed(2));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.textContent = label;

    wedge.appendChild(path);
    wedge.appendChild(text);
    svg.appendChild(wedge);
    wedges.push(wedge);
  });

  container.appendChild(svg);

  let selectedIndex = null;

  const updateSelection = (index) => {
    selectedIndex = typeof index === 'number' && index >= 0 && index < wedges.length ? index : null;
    wedges.forEach((wedge, wedgeIndex) => {
      const isSelected = wedgeIndex === selectedIndex;
      wedge.classList.toggle('is-selected', isSelected);
      wedge.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });
    const rotationValue = selectedIndex === null ? null : ROTATION_LABELS[selectedIndex];
    if (onSelect) onSelect(rotationValue);
  };

  const selectFromEvent = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const wedge = target ? target.closest('.rotation-wedge') : null;
    if (!wedge) return;
    const index = Number(wedge.dataset.index);
    if (Number.isNaN(index)) return;
    updateSelection(index);
  };

  svg.addEventListener('click', selectFromEvent);
  svg.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectFromEvent(event);
  });

  return {
    getValue: () => (selectedIndex === null ? null : ROTATION_LABELS[selectedIndex]),
  };
};
