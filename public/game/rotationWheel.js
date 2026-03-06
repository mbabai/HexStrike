export const ROTATION_LABELS = ['0', 'R1', 'R2', '3', 'L2', 'L1'];
const ROTATION_LAYOUT = {
  0: { x: 105.0, y: 19.8, angle: 0 },
  R1: { x: 131.0, y: 34.8, angle: 60 },
  R2: { x: 131.0, y: 62.9, angle: 120 },
  3: { x: 105.0, y: 77.9, angle: 180 },
  L2: { x: 79.0, y: 62.9, angle: 240 },
  L1: { x: 79.0, y: 34.8, angle: 300 },
};
const ROTATION_CENTER = (() => {
  const points = Object.values(ROTATION_LAYOUT);
  if (!points.length) return { x: 105.0, y: 48.85 };
  const totals = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: totals.x / points.length, y: totals.y / points.length };
})();
const SVG_NS = 'http://www.w3.org/2000/svg';
const WEDGE_FRAME_POINTS = '0,0 100,0 64.5,100 35.5,100';
const MIN_ADRENALINE = 0;
const MAX_ADRENALINE = 10;

const normalizeAdrenalineValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return Math.max(MIN_ADRENALINE, Math.min(MAX_ADRENALINE, rounded));
};

const createWedgeFrame = () => {
  const frame = document.createElementNS(SVG_NS, 'svg');
  frame.classList.add('rotation-wedge-frame');
  frame.setAttribute('viewBox', '0 0 100 100');
  frame.setAttribute('preserveAspectRatio', 'none');
  frame.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(SVG_NS, 'polygon');
  shape.classList.add('rotation-wedge-frame-shape');
  shape.setAttribute('points', WEDGE_FRAME_POINTS);
  frame.appendChild(shape);
  return frame;
};

export const buildRotationWheel = (container, onSelect) => {
  if (!container) return { getValue: () => null };

  container.innerHTML = '';
  container.setAttribute('role', 'radiogroup');
  container.setAttribute('aria-label', 'Rotation selector');
  container.style.setProperty('--rotation-center-x', `${ROTATION_CENTER.x / 210}`);
  container.style.setProperty('--rotation-center-y', `${ROTATION_CENTER.y / 297}`);
  const wedges = [];

  const centerAdrenaline = document.createElement('div');
  centerAdrenaline.className = 'rotation-wheel-center-adrenaline';
  centerAdrenaline.setAttribute('aria-hidden', 'true');
  centerAdrenaline.hidden = true;
  const centerAdrenalineIcon = document.createElement('img');
  centerAdrenalineIcon.src = '/public/images/Adrenaline.png';
  centerAdrenalineIcon.alt = '';
  const centerAdrenalineValue = document.createElement('span');
  centerAdrenalineValue.className = 'rotation-wheel-center-adrenaline-value';
  centerAdrenalineValue.textContent = '0';
  centerAdrenaline.appendChild(centerAdrenalineIcon);
  centerAdrenaline.appendChild(centerAdrenalineValue);
  container.appendChild(centerAdrenaline);

  ROTATION_LABELS.forEach((label, index) => {
    const wedge = document.createElement('button');
    wedge.type = 'button';
    wedge.className = 'rotation-wedge';
    wedge.dataset.index = `${index}`;
    wedge.dataset.rotation = label;
    wedge.setAttribute('role', 'radio');
    wedge.setAttribute('aria-checked', 'false');
    wedge.setAttribute('aria-label', `Rotation ${label}`);
    const position = ROTATION_LAYOUT[label];
    if (position) {
      wedge.style.setProperty('--rotation-x', `${position.x / 210}`);
      wedge.style.setProperty('--rotation-y', `${position.y / 297}`);
      wedge.style.setProperty('--rotation-angle', `${position.angle}deg`);
    }
    wedge.appendChild(createWedgeFrame());
    wedges.push(wedge);
    container.appendChild(wedge);
  });

  let selectedIndex = null;
  let allowedRotations = null;

  const isAllowed = (label) => !allowedRotations || allowedRotations.has(label);

  const updateAvailability = () => {
    wedges.forEach((wedge) => {
      const label = wedge.dataset.rotation;
      const disabled = !label || !isAllowed(label);
      wedge.classList.toggle('is-disabled', disabled);
      wedge.disabled = disabled;
      wedge.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    });
  };

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

  const selectWedge = (wedge) => {
    if (!wedge || wedge.classList.contains('is-disabled')) return;
    const index = Number(wedge.dataset.index);
    if (Number.isNaN(index)) return;
    updateSelection(index);
  };

  wedges.forEach((wedge) => {
    wedge.addEventListener('click', () => {
      selectWedge(wedge);
    });
    wedge.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectWedge(wedge);
    });
  });

  const setAllowedRotations = (allowed) => {
    if (!allowed) {
      allowedRotations = null;
    } else if (allowed instanceof Set) {
      allowedRotations = allowed;
    } else if (Array.isArray(allowed) && allowed.length) {
      allowedRotations = new Set(allowed);
    } else {
      allowedRotations = null;
    }
    updateAvailability();
    if (selectedIndex !== null) {
      const label = ROTATION_LABELS[selectedIndex];
      if (!isAllowed(label)) {
        updateSelection(null);
      }
    }
  };

  const setValue = (value) => {
    if (value === null || value === undefined || value === '') {
      updateSelection(null);
      return;
    }
    const index = ROTATION_LABELS.indexOf(`${value}`);
    if (index < 0) {
      updateSelection(null);
      return;
    }
    if (!isAllowed(ROTATION_LABELS[index])) {
      updateSelection(null);
      return;
    }
    updateSelection(index);
  };

  updateAvailability();

  const setCenterAdrenaline = (value) => {
    const normalized = normalizeAdrenalineValue(value);
    if (normalized === null) {
      centerAdrenaline.hidden = true;
      centerAdrenaline.classList.remove('is-visible');
      return;
    }
    centerAdrenalineValue.textContent = `${normalized}`;
    centerAdrenaline.hidden = false;
    centerAdrenaline.classList.add('is-visible');
  };

  return {
    getValue: () => (selectedIndex === null ? null : ROTATION_LABELS[selectedIndex]),
    setValue,
    clear: () => updateSelection(null),
    setAllowedRotations,
    setCenterAdrenaline,
  };
};
