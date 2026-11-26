(() => {
  const panels = new Map();
  const dialogs = new Map();
  const fragments = new Map();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const documentRoot = document.documentElement;
  let activeDialog;
  let returnFocus;
  let closingThroughHistory = false;

  function addFragments(element) {
    for (const alias of (element.dataset.fragments ?? '').split(/\s+/).filter(Boolean)) {
      fragments.set(alias, element.id);
    }
  }

  function fragment(hash = location.hash) {
    const value = hash.slice(1);
    try {
      const decoded = decodeURIComponent(value);
      return fragments.get(decoded) ?? decoded;
    } catch {
      return value;
    }
  }

  const isAvailable = element => element && element !== document.body && element.getClientRects().length
    && !element.closest('[hidden], [inert]') && getComputedStyle(element).visibility === 'visible';

  function keepDialogFocus(event) {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')]
      .filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && isAvailable(control));
    const first = controls[0];
    const last = controls.at(-1);
    const active = document.activeElement;
    const backwards = event.shiftKey;
    if (active === (backwards ? first : last) || !controls.includes(active)) {
      event.preventDefault();
      (backwards ? last : first)?.focus();
    }
  }

  function setExpanded(button, panel, expanded) {
    button.setAttribute('aria-expanded', String(expanded));
    button.closest('[data-disclosure-heading]')?.classList.toggle('feature-expanded', expanded);
    panel.hidden = !expanded;
  }

  function expand(button, panel, expanded) {
    const group = button.dataset.featureToggle;
    if (expanded && group) {
      for (const {control, section} of panels.values()) {
        if (control !== button && control.dataset.featureToggle === group) {
          setExpanded(control, section, false);
        }
      }
    }
    setExpanded(button, panel, expanded);
  }

  for (const control of document.querySelectorAll('[data-feature-toggle][aria-controls]')) {
    const section = document.getElementById(control.getAttribute('aria-controls'));
    if (!section) continue;
    const heading = control.closest('[data-disclosure-heading]');
    panels.set(section.id, { control, section, heading });
    addFragments(section);
    control.addEventListener('click', () => expand(control, section, section.hidden));
    heading?.addEventListener('click', event => {
      if (!event.target.closest('a, button') && !getSelection()?.toString()) control.click();
    });
  }

  function closeDialog() {
    if (!activeDialog) return;
    const dialog = activeDialog;
    if (history.state?.featureDialog === dialog.id) {
      if (!closingThroughHistory) {
        closingThroughHistory = true;
        history.back();
      }
      return;
    }
    const url = new URL(location.href);
    if (fragment(url.hash) === dialog.id) {
      url.hash = '';
      history.replaceState(history.state, '', url);
    }
    hideDialog();
  }

  function hideDialog() {
    if (!activeDialog) return;
    activeDialog.close();
    activeDialog = undefined;
    documentRoot.classList.remove('feature-modal-open');
    const fallback = document.querySelector('.mts-feature h1') ?? document.getElementById('site-content');
    const destination = isAvailable(returnFocus) ? returnFocus : fallback;
    returnFocus = undefined;
    requestAnimationFrame(() => {
      if (activeDialog || !destination) return;
      const rect = destination.getBoundingClientRect();
      destination.focus({preventScroll: rect.bottom > 0 && rect.top < innerHeight});
    });
  }

  function showDialog(dialog, opener) {
    if (activeDialog === dialog) return;
    hideDialog();
    activeDialog = dialog;
    returnFocus = opener;
    dialog.showModal();
    dialog.scrollTop = 0;
    documentRoot.classList.add('feature-modal-open');
  }

  for (const dialog of document.querySelectorAll('dialog[data-feature-dialog]')) {
    dialogs.set(dialog.id, dialog);
    addFragments(dialog);
    dialog.querySelector('[data-feature-close]').addEventListener('click', closeDialog);
    dialog.addEventListener('keydown', keepDialogFocus);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const {left, right, top, bottom} = dialog.getBoundingClientRect();
      if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) closeDialog();
    });
    if (dialog.dataset.openAfter) {
      setTimeout(() => {
        if (!location.hash && !activeDialog && scrollY < 60) showDialog(dialog, document.activeElement);
      }, Number(dialog.dataset.openAfter));
    }
  }

  const openers = new Map();
  for (const opener of document.querySelectorAll('a[href^="#"]')) {
    const key = fragment(opener.hash);
    if (!dialogs.has(key)) continue;
    opener.setAttribute('aria-haspopup', 'dialog');
    opener.setAttribute('aria-controls', key);
    if (!openers.has(key)) openers.set(key, []);
    openers.get(key).push(opener);
    opener.addEventListener('click', event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.defaultPrevented) return;
      event.preventDefault();
      history.pushState({...history.state, featureDialog: key}, '', opener.hash);
      showDialog(dialogs.get(key), opener);
    });
  }

  function followFragment() {
    closingThroughHistory = false;
    const key = fragment();
    const dialog = dialogs.get(key);
    if (dialog) {
      const target = openers.get(key)?.find(isAvailable);
      if (target && !activeDialog) target.scrollIntoView({block: 'center'});
      showDialog(dialog, target);
      return;
    }
    hideDialog();
    const panel = panels.get(key);
    if (panel) {
      expand(panel.control, panel.section, true);
      panel.heading?.scrollIntoView({block: 'start'});
    }
  }
  window.addEventListener('hashchange', followFragment);
  window.addEventListener('popstate', followFragment);
  window.addEventListener('load', followFragment, {once: true});

  for (const region of document.querySelectorAll('.feature-scroller')) {
    region.addEventListener('keydown', event => {
      if (event.target !== region || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const behavior = reducedMotion.matches ? 'instant' : 'smooth';
      if (event.key === 'Home' || event.key === 'End') {
        region.scrollTo({left: event.key === 'Home' ? 0 : region.scrollWidth, behavior});
      } else {
        region.scrollBy({left: region.clientWidth * (event.key === 'ArrowRight' ? .85 : -.85), behavior});
      }
    });
    let drag;
    region.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'mouse' || event.button !== 0 || event.target.closest('a, button')) return;
      drag = {id: event.pointerId, x: event.clientX, left: region.scrollLeft};
      region.setPointerCapture(event.pointerId);
      region.dataset.dragging = '';
    });
    region.addEventListener('pointermove', event => {
      if (drag?.id === event.pointerId) region.scrollLeft = drag.left + drag.x - event.clientX;
    });
    region.addEventListener('lostpointercapture', () => {
      drag = undefined;
      delete region.dataset.dragging;
    });
    region.addEventListener('dragstart', event => event.preventDefault());
  }

  const breakpoints = [1200, 960, 640, 480, 320];
  function resizeCanvases() {
    const width = documentRoot.clientWidth;
    const base = breakpoints.find(size => size <= width) ?? breakpoints.at(-1);
    documentRoot.style.setProperty('--feature-scale', String(width / base));
    documentRoot.style.setProperty('--feature-grid-scale', String(Math.min(width / 390, 1)));
  }
  resizeCanvases();
  window.addEventListener('resize', resizeCanvases, {passive: true});
  const typeSize = document.createElement('span');
  typeSize.className = 'feature-type-size';
  typeSize.setAttribute('aria-hidden', 'true');
  document.body.append(typeSize);
  new ResizeObserver(([{contentRect}]) => {
    documentRoot.classList.toggle('feature-reflow', contentRect.width > 20);
  }).observe(typeSize);
  followFragment();
})();
