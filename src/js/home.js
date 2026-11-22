(() => {
  const overview = document.getElementById('overview');
  const sections = [...document.querySelectorAll('[data-home-section]')];
  const choices = [...overview.querySelectorAll('[data-home-view]')];
  const returnLink = document.querySelector('[data-home-return]');
  const links = [...document.querySelectorAll('a')];
  let restoreFrame = 0;

  function viewFor(target) {
    if (target?.id === 'services-checkout') return document.getElementById('club');
    return target?.closest('[data-home-section]') || null;
  }

  function displayView(target) {
    const selected = viewFor(target);
    for (const section of sections) section.hidden = !!selected && selected !== section;
    for (const choice of choices) {
      if (choice.hash === '#' + (selected?.id || 'overview')) choice.setAttribute('aria-current', 'true');
      else choice.removeAttribute('aria-current');
    }
    returnLink.hidden = !selected;
    const disclosure = target?.closest('details');
    if (disclosure) disclosure.open = true;
  }

  function hashTarget() {
    return document.getElementById(location.hash.slice(1));
  }

  function revealLocation() {
    const target = hashTarget();
    displayView(target);
    if (target && target.id !== 'services-checkout') {
      const place = sections.includes(target) ? overview : target;
      place.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }

  function restoreHistoryEntry() {
    displayView(hashTarget());
    cancelAnimationFrame(restoreFrame);
    const entry = history.state?.homeReturn;
    if (!entry) return;
    const destination = location.href;
    // Chrome can focus the URL fragment after popstate, displacing the link
    // used to leave a longer article. Restore its place after native traversal.
    restoreFrame = requestAnimationFrame(() => {
      if (destination !== location.href) return;
      let opener = links[entry.index];
      if (opener?.closest('.site-navigation[hidden]')) opener = document.querySelector('.site-menu-toggle');
      if (!opener?.getClientRects().length) return;
      const top = entry.top === null ? entry.scrollY : scrollY + opener.getBoundingClientRect().top - entry.top;
      window.scrollTo({ top, behavior: 'instant' });
      opener.focus({ preventScroll: true });
    });
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const target = document.getElementById(link.hash.slice(1));
    if (!target || target.id === 'services-checkout' || link.classList.contains('skip-content')) return;
    event.preventDefault();
    if (location.hash !== link.hash) {
      const top = link.closest('.site-header') ? null : link.getBoundingClientRect().top;
      const homeReturn = { index: links.indexOf(link), top, scrollY };
      history.replaceState({ ...history.state, homeReturn }, '');
      history.pushState(null, '', link.hash);
    }
    displayView(target);
    const place = sections.includes(target) ? overview : target;
    place.scrollIntoView({ block: 'start', behavior: 'instant' });
    if (link.hasAttribute('data-home-view')) link.focus({ preventScroll: true });
    else {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
  });

  // Keep dated entries and their sources together as they pass into the archive.
  const events = document.querySelector('[data-home-events]');
  const past = document.querySelector('[data-events-past]');
  const pastItems = past.querySelector('.home-events');
  const entries = [...events.querySelectorAll('[data-event-end]')];
  const spotlight = document.querySelector('[data-home-now]');
  const featured = entries.find(item => item.hasAttribute('data-home-spotlight'));
  if (featured) {
    spotlight.querySelector('span').textContent = featured.dataset.homeSpotlight + ' ' + featured.querySelector('.home-date').textContent.trim();
    const link = spotlight.querySelector('a');
    link.href = '#' + featured.id;
    link.textContent = featured.querySelector('h3').textContent;
  }
  const calendar = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  function refreshDates() {
    const today = calendar.format(new Date());
    spotlight.hidden = !featured || today < featured.dataset.eventStart || today > featured.dataset.eventEnd;
    for (const item of entries) {
      const expired = item.dataset.eventEnd < today;
      const destination = expired ? pastItems : events;
      if (item.parentElement !== destination) destination.append(item);
      const booking = item.querySelector('[data-event-booking]');
      if (booking) booking.hidden = expired;
    }
    past.hidden = !pastItems.childElementCount;
    document.querySelector('[data-events-empty]').hidden = !!events.childElementCount;
  }
  refreshDates();
  displayView(hashTarget());
  if (location.hash && performance.getEntriesByType('navigation')[0]?.type === 'navigate') {
    requestAnimationFrame(revealLocation);
  }
  window.addEventListener('popstate', restoreHistoryEntry);
  window.addEventListener('hashchange', restoreHistoryEntry);
  window.addEventListener('pageshow', refreshDates);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshDates();
  });
})();
