(() => {
  const overview = document.getElementById('overview');
  const sections = [...document.querySelectorAll('[data-home-section]')];
  const choices = [...document.querySelectorAll('[data-home-view]')];
  const links = [...document.querySelectorAll('a')];
  let restoreFrame = 0;

  function viewFor(target) {
    if (target?.id === 'services-checkout') return document.getElementById('club');
    return target?.closest('[data-home-section]') || null;
  }

  function displayView(target) {
    const selected = viewFor(target);
    overview.dataset.view = selected?.id || 'overview';
    for (const section of sections) {
      section.hidden = selected ? selected !== section : !section.hasAttribute('data-overview-section');
    }
    for (const choice of choices) {
      if (choice.hash === '#' + (selected?.id || 'overview')) choice.setAttribute('aria-current', 'true');
      else choice.removeAttribute('aria-current');
    }
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
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
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
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });

  // Keep dated entries and their sources together as they pass into the archive.
  const events = document.querySelector('[data-home-events]');
  const past = document.querySelector('[data-events-past]');
  const pastItems = past.querySelector('.home-events');
  const emptyEvents = document.querySelector('[data-events-empty]');
  const upcomingChannel = document.querySelector('[data-upcoming-channel]');
  const entries = [...document.querySelectorAll('#program [data-event-end]')];
  const spotlight = document.querySelector('[data-home-now]');
  const featured = spotlight.querySelector('[data-event-end]');
  const calendar = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  function refreshDates() {
    const today = calendar.format(new Date());
    const featureIsCurrent = featured && featured.dataset.eventStart <= today && today <= featured.dataset.eventEnd;
    spotlight.hidden = !featureIsCurrent;
    document.querySelector('[data-home-intro]').hidden = !!featureIsCurrent;
    for (const item of entries) {
      const expired = item.dataset.eventEnd < today;
      const destination = expired ? pastItems : item === featured && featureIsCurrent ? spotlight : events;
      if (item.parentElement !== destination) {
        const dateOf = entry => expired ? entry.dataset.eventEnd : entry.dataset.eventStart || entry.dataset.eventEnd;
        const next = [...destination.children].find(entry =>
          expired ? dateOf(entry) < dateOf(item) : dateOf(entry) > dateOf(item)
        );
        destination.insertBefore(item, next || null);
        if (expired && item.contains(hashTarget())) past.open = true;
      }
      const booking = item.querySelector('[data-event-booking]');
      if (booking) booking.hidden = expired;
      const year = item.dataset.eventEnd.slice(0, 4);
      const yearLabel = item.querySelector('[data-event-year]');
      if (yearLabel) yearLabel.textContent = expired || year !== today.slice(0, 4) ? '\u00a0' + year : '';
    }
    past.hidden = !pastItems.childElementCount;
    const hasUpcoming = events.childElementCount > 0;
    emptyEvents.hidden = hasUpcoming;
    upcomingChannel.hidden = !hasUpcoming;
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
