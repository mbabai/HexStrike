const TOAST_ID = 'hexstrikeToast';
const DEFAULT_DURATION_MS = 2000;
const FADE_OUT_MS = 220;

let hideTimer = null;
let fadeTimer = null;
let toastToken = 0;

const ensureToast = () => {
  let toast = document.getElementById(TOAST_ID);
  if (toast) return toast;
  toast = document.createElement('div');
  toast.id = TOAST_ID;
  toast.className = 'app-toast';
  toast.hidden = true;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.setAttribute('aria-atomic', 'true');
  document.body.appendChild(toast);
  return toast;
};

const clearTimers = () => {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (fadeTimer) {
    clearTimeout(fadeTimer);
    fadeTimer = null;
  }
};

export const showToast = (message, options = {}) => {
  const text = `${message ?? ''}`.trim();
  if (!text) return;
  const toast = ensureToast();
  const durationMs = Number.isFinite(options.durationMs)
    ? Math.max(250, Math.floor(options.durationMs))
    : DEFAULT_DURATION_MS;
  const variant = options.variant === 'success' ? 'success' : 'info';
  toastToken += 1;
  const currentToken = toastToken;

  clearTimers();
  toast.hidden = false;
  toast.textContent = text;
  toast.classList.remove('is-visible', 'is-fading', 'is-info', 'is-success');
  toast.classList.add(variant === 'success' ? 'is-success' : 'is-info');
  // Force transition restart when replacing an active toast.
  void toast.offsetWidth;
  toast.classList.add('is-visible');

  hideTimer = setTimeout(() => {
    if (currentToken !== toastToken) return;
    toast.classList.add('is-fading');
    fadeTimer = setTimeout(() => {
      if (currentToken !== toastToken) return;
      toast.classList.remove('is-visible', 'is-fading', 'is-info', 'is-success');
      toast.hidden = true;
      toast.textContent = '';
    }, FADE_OUT_MS);
  }, durationMs);
};
