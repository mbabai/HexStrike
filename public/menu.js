import { getTooltipModeEnabled, setTooltipModeEnabled } from './storage.js';

export function initMenu() {
  const menuShell = document.getElementById('menuShell');
  const menuToggle = document.getElementById('menuToggle');
  const menuSidebar = document.getElementById('menuSidebar');
  const tooltipModeToggle = document.getElementById('tooltipModeToggle');
  const menuBackdrop = document.createElement('button');
  const MENU_ENABLED = true;

  menuBackdrop.type = 'button';
  menuBackdrop.className = 'menu-backdrop';
  menuBackdrop.hidden = true;
  menuBackdrop.setAttribute('aria-hidden', 'true');
  menuBackdrop.setAttribute('aria-label', 'Close side menu');
  document.body.appendChild(menuBackdrop);

  const isMobileLayout = () => document.documentElement.classList.contains('is-mobile');

  const applyBackdropState = (collapsed) => {
    const showBackdrop = !collapsed && isMobileLayout();
    menuBackdrop.hidden = !showBackdrop;
    menuBackdrop.setAttribute('aria-hidden', (!showBackdrop).toString());
    menuBackdrop.classList.toggle('is-visible', showBackdrop);
  };

  const applyToggleState = (collapsed) => {
    if (!menuToggle) return;
    const expanded = !collapsed;
    menuToggle.setAttribute('aria-expanded', expanded.toString());
    menuToggle.setAttribute('aria-label', expanded ? 'Close side menu' : 'Open side menu');
    menuToggle.classList.toggle('is-open', expanded);
  };

  const applyMenuState = (collapsed) => {
    if (!menuShell || !menuToggle) return;
    menuShell.classList.toggle('menu-collapsed', collapsed);
    if (menuSidebar) {
      menuSidebar.classList.toggle('is-collapsed', collapsed);
      menuSidebar.hidden = collapsed;
      menuSidebar.setAttribute('aria-hidden', collapsed.toString());
    }
    applyToggleState(collapsed);
    applyBackdropState(collapsed);
  };

  if (!MENU_ENABLED) {
    if (menuShell) {
      menuShell.classList.add('menu-collapsed');
    }
    if (menuToggle) {
      menuToggle.hidden = true;
      menuToggle.style.display = 'none';
      menuToggle.setAttribute('aria-hidden', 'true');
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.setAttribute('tabindex', '-1');
    }
    if (menuSidebar) {
      menuSidebar.hidden = true;
      menuSidebar.style.display = 'none';
      menuSidebar.classList.add('is-collapsed');
      menuSidebar.setAttribute('aria-hidden', 'true');
    }
    menuBackdrop.remove();
    return;
  }

  if (menuShell && menuToggle) {
    menuToggle.hidden = false;
    menuToggle.style.display = '';
    menuToggle.removeAttribute('aria-hidden');
    menuToggle.removeAttribute('tabindex');
    applyMenuState(true);
    menuToggle.addEventListener('click', () => {
      const isCollapsed = !menuShell.classList.contains('menu-collapsed');
      applyMenuState(isCollapsed);
    });
  }

  menuBackdrop.addEventListener('click', () => {
    if (!menuShell) return;
    if (menuShell.classList.contains('menu-collapsed')) return;
    applyMenuState(true);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!menuShell || menuShell.classList.contains('menu-collapsed')) return;
    applyMenuState(true);
  });

  window.addEventListener('hexstrike:device-profile', () => {
    if (!menuShell) return;
    const isCollapsed = menuShell.classList.contains('menu-collapsed');
    applyBackdropState(isCollapsed);
  });

  document.querySelectorAll('button.menu-link').forEach((button) => {
    if (button === tooltipModeToggle) return;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      window.alert('Coming soon');
    });
  });

  if (tooltipModeToggle instanceof HTMLButtonElement) {
    const applyTooltipModeState = (enabled) => {
      tooltipModeToggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
      tooltipModeToggle.classList.toggle('is-enabled', enabled);
    };
    applyTooltipModeState(Boolean(getTooltipModeEnabled()));
    tooltipModeToggle.addEventListener('click', () => {
      const enabled = setTooltipModeEnabled(!getTooltipModeEnabled());
      applyTooltipModeState(enabled);
      window.dispatchEvent(new CustomEvent('hexstrike:tooltip-mode-changed', { detail: { enabled } }));
    });
  }
}
