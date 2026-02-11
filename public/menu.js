export function initMenu() {
  const menuShell = document.getElementById('menuShell');
  const menuToggle = document.getElementById('menuToggle');
  const menuSidebar = document.getElementById('menuSidebar');
  const MENU_ENABLED = false;

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
    return;
  }

  if (menuShell && menuToggle) {
    menuToggle.addEventListener('click', () => {
      const isCollapsed = menuShell.classList.toggle('menu-collapsed');
      if (menuSidebar) {
        menuSidebar.classList.toggle('is-collapsed', isCollapsed);
        menuSidebar.hidden = isCollapsed;
        menuSidebar.setAttribute('aria-hidden', isCollapsed.toString());
      }
      menuToggle.setAttribute('aria-expanded', (!isCollapsed).toString());
    });
  }

  document.querySelectorAll('.menu-link').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      window.alert('Coming soon');
    });
  });
}
