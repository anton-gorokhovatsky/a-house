(() => {
  const storageKey = 'a-house:theme';
  const root = document.documentElement;
  let preference = 'system';
  let control;

  function readPreference() {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved === 'dark' || saved === 'light' ? saved : 'system';
    } catch {
      return preference;
    }
  }

  function apply(value) {
    preference = value;
    if (value === 'system') root.removeAttribute('data-theme');
    else root.dataset.theme = value;
    if (control) control.querySelector('input[value="' + value + '"]').checked = true;
  }

  apply(readPreference());

  document.addEventListener('DOMContentLoaded', () => {
    control = document.querySelector('[data-site-theme]');
    if (!control) return;
    apply(preference);
    control.hidden = false;
    for (const entry of document.querySelectorAll('.theme-menu-link')) entry.hidden = false;
    control.addEventListener('focus', () => {
      requestAnimationFrame(() => {
        if (document.activeElement === control) control.querySelector(':checked').focus({ preventScroll: true });
      });
    });
    control.addEventListener('change', event => {
      const choice = event.target;
      if (!choice.matches('input[name="site-theme-choice"]:checked')) return;
      apply(choice.value);
      try {
        if (preference === 'system') localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, preference);
      } catch {
        // A browser can disallow storage while the current page remains usable.
      }
    });
  });

  window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) apply(readPreference());
  });
  window.addEventListener('pageshow', () => apply(readPreference()));
})();
