(() => {
  function alertComingSoon(event) {
    event.preventDefault();
    window.alert('Coming soon');
  }

  function initMenu() {
    const menuShell = document.getElementById('menuShell');
    const menuToggle = document.getElementById('menuToggle');
    const menuSidebar = document.getElementById('menuSidebar');

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

    document.querySelectorAll('.menu-link, #findGame').forEach((button) => {
      button.addEventListener('click', alertComingSoon);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMenu);
  } else {
    initMenu();
  }
})();
