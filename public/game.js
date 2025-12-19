const MIN_SCALE = 0.35;
const MAX_SCALE = 3;
const MOMENTUM_DECAY = 0.92;
const MIN_VELOCITY = 0.01;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function initGame() {
  const gameArea = document.getElementById('gameArea');
  const canvas = document.getElementById('gameCanvas');
  const menuMatch = document.querySelector('.menu-match');

  if (!gameArea || !canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const css = getComputedStyle(document.documentElement);
  const colors = {
    fill: css.getPropertyValue('--color-hex-fill').trim(),
    stroke: css.getPropertyValue('--color-hex-stroke').trim(),
    background: css.getPropertyValue('--color-game-surface').trim(),
  };

  const state = {
    scale: 1,
    offset: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    dragging: false,
  };

  const viewport = { width: 0, height: 0, dpr: window.devicePixelRatio || 1 };
  let lastTime = performance.now();
  let hasCentered = false;
  const pointer = { id: null, x: 0, y: 0, time: 0 };

  const resize = () => {
    viewport.width = canvas.clientWidth;
    viewport.height = canvas.clientHeight;
    viewport.dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(viewport.width * viewport.dpr));
    canvas.height = Math.max(1, Math.floor(viewport.height * viewport.dpr));
    if (!hasCentered && viewport.width && viewport.height) {
      state.offset.x = viewport.width / 2;
      state.offset.y = viewport.height / 2;
      hasCentered = true;
    }
  };

  const showGameArea = () => {
    if (!gameArea.hidden) return;
    gameArea.hidden = false;
    if (menuMatch) menuMatch.hidden = true;
    requestAnimationFrame(resize);
  };

  window.addEventListener('resize', resize);
  window.addEventListener('hexstrike:match', showGameArea);
  window.addEventListener('hexstrike:game', showGameArea);

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    state.dragging = true;
    state.velocity.x = 0;
    state.velocity.y = 0;
    pointer.id = event.pointerId;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.time = performance.now();
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-dragging');
  };

  const onPointerMove = (event) => {
    if (!state.dragging || pointer.id !== event.pointerId) return;
    const now = performance.now();
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    const dt = Math.max(1, now - pointer.time);
    state.offset.x += dx;
    state.offset.y += dy;
    state.velocity.x = dx / dt;
    state.velocity.y = dy / dt;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.time = now;
  };

  const endDrag = (event) => {
    if (!state.dragging || (event && pointer.id !== event.pointerId)) return;
    state.dragging = false;
    canvas.classList.remove('is-dragging');
    if (event && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    pointer.id = null;
  };

  const onWheel = (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const worldX = (mouseX - state.offset.x) / state.scale;
    const worldY = (mouseY - state.offset.y) / state.scale;
    const zoom = Math.exp(-event.deltaY * 0.0015);
    const nextScale = clamp(state.scale * zoom, MIN_SCALE, MAX_SCALE);
    state.scale = nextScale;
    state.offset.x = mouseX - worldX * state.scale;
    state.offset.y = mouseY - worldY * state.scale;
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const drawHex = (x, y, size) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI / 180) * (60 * i - 30);
      const px = x + size * Math.cos(angle);
      const py = y + size * Math.sin(angle);
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };

  const drawGrid = () => {
    if (!viewport.width || !viewport.height) return;
    const size = viewport.width / 10;
    const sqrt3 = Math.sqrt(3);
    const minX = (-state.offset.x) / state.scale;
    const maxX = (viewport.width - state.offset.x) / state.scale;
    const minY = (-state.offset.y) / state.scale;
    const maxY = (viewport.height - state.offset.y) / state.scale;
    const rMin = Math.floor((minY - size) / (1.5 * size)) - 2;
    const rMax = Math.ceil((maxY + size) / (1.5 * size)) + 2;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (colors.background) {
      ctx.fillStyle = colors.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.setTransform(
      viewport.dpr * state.scale,
      0,
      0,
      viewport.dpr * state.scale,
      state.offset.x * viewport.dpr,
      state.offset.y * viewport.dpr,
    );
    ctx.fillStyle = colors.fill;
    ctx.strokeStyle = colors.stroke;
    const strokeWidth = Math.max(0.6, size * 0.06);
    ctx.lineWidth = strokeWidth;

    for (let r = rMin; r <= rMax; r += 1) {
      const qMin = Math.floor(minX / (sqrt3 * size) - r / 2) - 2;
      const qMax = Math.ceil(maxX / (sqrt3 * size) - r / 2) + 2;
      for (let q = qMin; q <= qMax; q += 1) {
        const x = size * sqrt3 * (q + r / 2);
        const y = size * 1.5 * r;
        drawHex(x, y, size);
      }
    }
  };

  const tick = (now) => {
    const dt = Math.max(0, now - lastTime);
    lastTime = now;

    if (!state.dragging && (Math.abs(state.velocity.x) > MIN_VELOCITY || Math.abs(state.velocity.y) > MIN_VELOCITY)) {
      const decay = Math.pow(MOMENTUM_DECAY, dt / 16);
      state.offset.x += state.velocity.x * dt;
      state.offset.y += state.velocity.y * dt;
      state.velocity.x *= decay;
      state.velocity.y *= decay;
    } else if (!state.dragging) {
      state.velocity.x = 0;
      state.velocity.y = 0;
    }

    if (!gameArea.hidden) {
      drawGrid();
    }

    requestAnimationFrame(tick);
  };

  resize();
  requestAnimationFrame(tick);
}
