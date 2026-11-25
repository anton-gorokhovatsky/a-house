(() => {
  // The original accordion owns its visual state and single-open behavior.
  const years = [...document.querySelectorAll('.accord-icon[aria-controls]')].map(trigger => {
    const heading = trigger.closest('.t-rec');
    const panel = document.getElementById(trigger.getAttribute('aria-controls'));

    trigger.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (!event.repeat) trigger.click();
    });

    const syncState = () => {
      const expanded = heading.classList.contains('active-accord');
      trigger.setAttribute('aria-expanded', String(expanded));
      panel.inert = !expanded;
    };
    new MutationObserver(syncState).observe(heading, { attributes: true, attributeFilter: ['class'] });
    syncState();
    return { heading, panel, trigger };
  });

  function followPanelBookmark() {
    const year = years.find(({ panel }) => '#' + panel.id === location.hash);
    if (!year || !year.heading.classList.contains('title-accord')) return;
    if (!year.heading.classList.contains('active-accord')) year.trigger.click();
    year.heading.scrollIntoView();
  }

  window.addEventListener('load', followPanelBookmark, { once: true });
  window.addEventListener('hashchange', followPanelBookmark);
})();
