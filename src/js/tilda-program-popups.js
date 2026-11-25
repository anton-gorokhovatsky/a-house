(() => {
  const visible = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible';
  const availableOpener = element => {
    const rect = element.getBoundingClientRect();
    return rect.right > 0 && rect.left < document.documentElement.clientWidth && visible(element);
  };
  const dialogs = document.querySelectorAll('.t-popup[data-tooltip-hook][aria-label]');
  for (const dialog of dialogs) {
    const hook = dialog.dataset.tooltipHook;
    const openers = [...document.querySelectorAll('a[href]')].filter(link => link.getAttribute('href') === hook);
    if (!openers.length) continue;

    dialog.id = 'program-dialog-' + hook.slice(1);
    const record = dialog.closest('.t-rec');
    const oldBookmark = dialog.dataset.popupRecIds?.replace(/^rec/, '#meeting-');
    let pendingOpener = null;
    let lastOpener = null;
    let ready = false;
    let open = false;
    const lockBackground = hook === '#rules';
    let inactiveBackground = [];

    for (const opener of openers) {
      opener.setAttribute('aria-haspopup', 'dialog');
      opener.setAttribute('aria-controls', dialog.id);
      opener.addEventListener('click', event => {
        event.preventDefault();
        lastOpener = opener;
        if (!ready) pendingOpener = opener;
      }, {capture: true});
    }

    record.addEventListener('landing-popup-ready', () => {
      ready = true;
      dialog.dataset.popupReady = 'true';
      if (pendingOpener) {
        pendingOpener.click();
        return;
      }
      if (location.hash !== hook && location.hash !== oldBookmark) return;
      const opener = openers.find(availableOpener);
      if (opener) {
        opener.scrollIntoView({block: 'center'});
        opener.click();
      }
    }, {once: true});

    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('a[href], button, [tabindex]')].filter(element =>
        element.tabIndex >= 0 && !element.matches(':disabled') && visible(element) && getComputedStyle(element).pointerEvents !== 'none');
      const index = controls.indexOf(document.activeElement) + (event.shiftKey ? -1 : 1);
      const fallback = event.shiftKey ? controls.at(-1) : controls[0];
      event.preventDefault();
      event.stopPropagation();
      (controls[index] ?? fallback)?.focus();
    });

    new MutationObserver(() => {
      // Tilda's display changes before its opening class is applied.
      const shown = visible(dialog);
      if (open === shown) return;
      open = shown;
      if (open) {
        if (lockBackground) {
          inactiveBackground = [...record.parentElement.children].filter(section => section !== record && !section.inert);
          for (const section of inactiveBackground) section.inert = true;
        }
        if (!dialog.contains(document.activeElement)) {
          dialog.querySelector('.t-popup__close-wrapper').focus({preventScroll: true});
        }
      } else {
        for (const section of inactiveBackground) section.inert = false;
        inactiveBackground = [];
        const origin = lastOpener;
        lastOpener = null;
        requestAnimationFrame(() => {
          if (open || lastOpener || !origin) return;
          const opener = availableOpener(origin) ? origin : openers.find(availableOpener);
          opener?.focus({preventScroll: true});
        });
      }
    }).observe(dialog, {attributes: true, attributeFilter: ['class', 'style']});
  }
})();
