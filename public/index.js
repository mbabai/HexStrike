(() => {
  function alertComingSoon(event) {
    event.preventDefault();
    window.alert('Coming soon');
  }

  function initMenu() {
    document.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', alertComingSoon);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMenu);
  } else {
    initMenu();
  }
})();
