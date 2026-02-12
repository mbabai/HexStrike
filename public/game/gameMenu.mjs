const setVisibility = (element, visible) => {
  if (!element) return;
  const isVisible = Boolean(visible);
  element.hidden = !isVisible;
  element.setAttribute('aria-hidden', (!isVisible).toString());
};

export const createGameMenu = ({
  gameArea,
  menuRoot,
  toggleButton,
  panel,
  forfeitButton,
  offerDrawButton,
  modalOverlay,
  modalEyebrow,
  modalTitle,
  modalCopy,
  modalCancelButton,
  modalConfirmButton,
  onForfeit,
  onOfferDraw,
} = {}) => {
  let menuOpen = false;
  let onModalConfirm = null;
  let onModalCancel = null;

  const setMenuOpen = (open) => {
    menuOpen = Boolean(open);
    if (panel) {
      panel.hidden = !menuOpen;
      panel.setAttribute('aria-hidden', (!menuOpen).toString());
    }
    if (toggleButton) {
      toggleButton.setAttribute('aria-expanded', menuOpen.toString());
    }
  };

  const hideModal = () => {
    setVisibility(modalOverlay, false);
    onModalConfirm = null;
    onModalCancel = null;
    if (modalCancelButton) {
      modalCancelButton.hidden = false;
      modalCancelButton.disabled = false;
      modalCancelButton.textContent = 'No';
    }
    if (modalConfirmButton) {
      modalConfirmButton.disabled = false;
      modalConfirmButton.textContent = 'Yes';
    }
    if (modalEyebrow) modalEyebrow.textContent = '';
    if (modalTitle) modalTitle.textContent = 'Confirm';
    if (modalCopy) modalCopy.textContent = '';
  };

  const showModal = ({
    eyebrow = '',
    title = 'Confirm',
    copy = '',
    confirmText = 'Yes',
    cancelText = 'No',
    hideCancel = false,
    onConfirm = null,
    onCancel = null,
  } = {}) => {
    if (modalEyebrow) modalEyebrow.textContent = `${eyebrow ?? ''}`;
    if (modalTitle) modalTitle.textContent = `${title ?? ''}`;
    if (modalCopy) modalCopy.textContent = `${copy ?? ''}`;
    if (modalCancelButton) {
      modalCancelButton.hidden = Boolean(hideCancel);
      modalCancelButton.disabled = false;
      modalCancelButton.textContent = cancelText || 'No';
    }
    if (modalConfirmButton) {
      modalConfirmButton.disabled = false;
      modalConfirmButton.textContent = confirmText || 'Yes';
    }
    onModalConfirm = typeof onConfirm === 'function' ? onConfirm : null;
    onModalCancel = typeof onCancel === 'function' ? onCancel : null;
    setVisibility(modalOverlay, true);
  };

  const closeAll = () => {
    setMenuOpen(false);
    hideModal();
  };

  const setModalButtonsEnabled = (enabled) => {
    const isEnabled = Boolean(enabled);
    if (modalConfirmButton) modalConfirmButton.disabled = !isEnabled;
    if (modalCancelButton) modalCancelButton.disabled = !isEnabled;
  };

  if (toggleButton) {
    toggleButton.addEventListener('click', () => {
      if (gameArea?.hidden) return;
      setMenuOpen(!menuOpen);
    });
  }

  if (forfeitButton) {
    forfeitButton.addEventListener('click', () => {
      if (typeof onForfeit === 'function') onForfeit();
    });
  }

  if (offerDrawButton) {
    offerDrawButton.addEventListener('click', () => {
      if (typeof onOfferDraw === 'function') onOfferDraw();
    });
  }

  if (modalConfirmButton) {
    modalConfirmButton.addEventListener('click', () => {
      if (typeof onModalConfirm === 'function') {
        onModalConfirm();
        return;
      }
      hideModal();
    });
  }

  if (modalCancelButton) {
    modalCancelButton.addEventListener('click', () => {
      if (typeof onModalCancel === 'function') {
        onModalCancel();
        return;
      }
      hideModal();
    });
  }

  if (modalOverlay) {
    modalOverlay.addEventListener('pointerdown', (event) => {
      if (event.target !== modalOverlay) return;
      hideModal();
    });
  }

  if (gameArea) {
    gameArea.addEventListener('pointerdown', (event) => {
      if (!menuOpen) return;
      if (menuRoot && menuRoot.contains(event.target)) return;
      setMenuOpen(false);
    });
  }

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (gameArea?.hidden) return;
    if (modalOverlay && !modalOverlay.hidden) {
      hideModal();
      return;
    }
    if (menuOpen) {
      setMenuOpen(false);
    }
  });

  setMenuOpen(false);
  hideModal();

  return {
    setMenuOpen,
    hideModal,
    showModal,
    closeAll,
    setModalButtonsEnabled,
  };
};
