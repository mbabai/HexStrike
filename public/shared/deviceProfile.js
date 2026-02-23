const MOBILE_BREAKPOINT_PX = 900;
const PHONE_USER_AGENT_PATTERN =
  /Android.+Mobile|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;
const GLOBAL_KEY = '__hexstrikeDeviceProfile';

const DEFAULT_PROFILE = Object.freeze({
  isMobile: false,
  isTouch: false,
  isCoarsePointer: false,
  isNarrowViewport: false,
  isLandscape: false,
});

const profilesMatch = (a, b) =>
  Boolean(a) &&
  Boolean(b) &&
  a.isMobile === b.isMobile &&
  a.isTouch === b.isTouch &&
  a.isCoarsePointer === b.isCoarsePointer &&
  a.isNarrowViewport === b.isNarrowViewport &&
  a.isLandscape === b.isLandscape;

const matchesMedia = (query) =>
  typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false;

const buildDeviceProfile = () => {
  const isCoarsePointer = matchesMedia('(pointer: coarse)') || matchesMedia('(any-pointer: coarse)');
  const isNarrowViewport = matchesMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
  const maxTouchPoints = Number.isFinite(navigator.maxTouchPoints) ? navigator.maxTouchPoints : 0;
  const isTouch = maxTouchPoints > 0 || isCoarsePointer || 'ontouchstart' in window;
  const isPhoneUserAgent = PHONE_USER_AGENT_PATTERN.test(`${navigator.userAgent ?? ''}`);
  const isMobile = isPhoneUserAgent || (isCoarsePointer && isNarrowViewport);
  const isLandscape = matchesMedia('(orientation: landscape)');
  return {
    isMobile,
    isTouch,
    isCoarsePointer,
    isNarrowViewport,
    isLandscape,
  };
};

const applyDeviceClasses = (profile) => {
  const root = document.documentElement;
  root.classList.toggle('is-mobile', profile.isMobile);
  root.classList.toggle('is-touch', profile.isTouch);
  root.classList.toggle('is-coarse-pointer', profile.isCoarsePointer);
  root.dataset.deviceProfile = profile.isMobile ? 'mobile' : 'desktop';
  root.dataset.deviceOrientation = profile.isLandscape ? 'landscape' : 'portrait';

  const body = document.body;
  if (!body) return;
  body.classList.toggle('is-mobile', profile.isMobile);
  body.classList.toggle('is-touch', profile.isTouch);
};

const emitDeviceProfile = (profile) => {
  window.dispatchEvent(
    new CustomEvent('hexstrike:device-profile', {
      detail: { ...profile },
    }),
  );
};

export const initDeviceProfile = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return DEFAULT_PROFILE;
  }
  const existing = window[GLOBAL_KEY];
  if (existing?.initialized && typeof existing.getProfile === 'function') {
    return existing.getProfile();
  }

  let current = DEFAULT_PROFILE;
  const refresh = () => {
    const next = buildDeviceProfile();
    const changed = !profilesMatch(current, next);
    current = next;
    applyDeviceClasses(current);
    if (changed) {
      emitDeviceProfile(current);
    }
    return current;
  };

  const scheduleRefresh = (() => {
    let frame = null;
    return () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        refresh();
      });
    };
  })();

  window.addEventListener('resize', scheduleRefresh, { passive: true });
  window.addEventListener('orientationchange', scheduleRefresh, { passive: true });
  if (window.visualViewport?.addEventListener) {
    window.visualViewport.addEventListener('resize', scheduleRefresh, { passive: true });
  }

  if (!document.body) {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        refresh();
      },
      { once: true },
    );
  }

  refresh();
  window[GLOBAL_KEY] = {
    initialized: true,
    getProfile: () => current,
  };
  return current;
};

export const getDeviceProfile = () => {
  if (typeof window === 'undefined') return DEFAULT_PROFILE;
  const existing = window[GLOBAL_KEY];
  if (existing?.initialized && typeof existing.getProfile === 'function') {
    return existing.getProfile();
  }
  return initDeviceProfile();
};
