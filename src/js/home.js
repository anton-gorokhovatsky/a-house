(() => {
  const homeTitle = document.title;
  const overview = document.getElementById('overview');
  const brand = document.querySelector('[data-home-brand]');
  const sections = [...document.querySelectorAll('[data-home-section]')];
  const choices = [...document.querySelectorAll('[data-home-view]')];
  const links = [...document.querySelectorAll('a')];
  let restoreFrame = 0;

  function followSectionBookmark() {
    const clubLink = '#club .home-links > a';
    const shortcuts = { '#program': '.home-calendar-link', '#club': clubLink, '#rec2309637911': clubLink };
    const fragment = location.hash;
    const friendIssue = fragment.startsWith('#friend-a-');
    const friendAnchor = friendIssue || fragment === '#form634408909' || fragment === '#order:A-Friend=12000';
    const friendEntry = friendAnchor || ['#a-friend', '#services-checkout', '#friend',
      '#rec634408909', '#rec3091941801', '#rec3796030101'].includes(fragment);
    const selector = friendEntry ? '#site-navigation a[href$="/a-friend/"]' : shortcuts[fragment];
    const link = selector && document.querySelector(selector);
    if (!link) return false;
    const destination = new URL(link.href);
    destination.search = location.search;
    if (friendAnchor) destination.hash = fragment;
    location.replace(destination.href);
    return true;
  }
  if (followSectionBookmark()) return;

  function viewFor(target) {
    if (target?.closest('.home-overview-only, #program')) return null;
    return target?.closest('[data-home-section]') || null;
  }

  function displayView(target) {
    const context = target?.closest('.home-footer') ? document.getElementById(history.state?.homeContext || '') : target;
    const selected = viewFor(context);
    if (selected) {
      brand.href = brand.dataset.homeBrand;
      brand.setAttribute('aria-label', 'A–House, на главную');
    } else {
      brand.removeAttribute('href');
      brand.removeAttribute('aria-label');
    }
    overview.dataset.view = selected?.id || 'overview';
    for (const section of sections) {
      section.hidden = selected ? selected !== section : !section.hasAttribute('data-overview-section');
    }
    const heading = selected && document.getElementById(selected.dataset.homeTitle || selected.getAttribute('aria-labelledby'));
    document.title = heading
      ? heading.textContent.replaceAll('\u00ad', '').replace(/\s+/g, ' ').trim() + ' — ' + homeTitle
      : homeTitle;
    const currentSection = selected?.id || 'overview';
    for (const choice of choices) {
      if (choice.hash === '#' + currentSection) choice.setAttribute('aria-current', 'true');
      else choice.removeAttribute('aria-current');
    }
    for (let disclosure = target?.closest('details'); disclosure; disclosure = disclosure.parentElement.closest('details')) {
      disclosure.open = true;
    }
  }

  function hashTarget() {
    const id = location.hash.slice(1);
    const target = document.getElementById(id);
    if (!target && id.startsWith('job-')) {
      history.replaceState(history.state, '', '#jobs');
      return document.getElementById('jobs');
    }
    return target;
  }

  function scrollToTarget(target, behavior = 'instant') {
    // Section entries start with the masthead. A deeper link goes straight to its content.
    if (target === overview || target.hasAttribute('data-home-section')) {
      window.scrollTo({ top: 0, behavior });
    } else {
      target.scrollIntoView({ block: 'start', behavior });
    }
  }

  function revealLocation() {
    const target = hashTarget();
    displayView(target);
    if (target) {
      scrollToTarget(target);
    }
  }

  function restoreHistoryEntry() {
    if (followSectionBookmark()) return;
    const target = hashTarget();
    if (openArchivedEvent(target)) return;
    const previousView = overview.dataset.view;
    const wasHidden = target && !target.getClientRects().length;
    displayView(target);
    cancelAnimationFrame(restoreFrame);
    const entry = history.state?.homeReturn;
    if (!entry) {
      // A pasted fragment can point into a view that was hidden during native scrolling.
      if (target && (wasHidden || previousView !== overview.dataset.view)) scrollToTarget(target);
      return;
    }
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
    if (!target) return;
    if (link.classList.contains('skip-content')) {
      // On the home page the fragment also selects what the main region contains.
      if (overview.dataset.view !== 'overview') {
        event.preventDefault();
        target.focus({ preventScroll: true });
        scrollToTarget(target);
      }
      return;
    }
    event.preventDefault();
    const previousView = overview.dataset.view;
    if (location.hash !== link.hash) {
      const top = link.closest('.site-header') ? null : link.getBoundingClientRect().top;
      const homeReturn = { index: links.indexOf(link), top, scrollY };
      history.replaceState({ ...history.state, homeReturn }, '');
      const state = target.closest('.home-footer') ? { homeContext: history.state?.homeContext || hashTarget()?.id || 'overview' } : null;
      history.pushState(state, '', link.hash);
    }
    displayView(target);
    scrollToTarget(target, previousView === overview.dataset.view ? 'auto' : 'instant');
    const focusTarget = document.getElementById(target.dataset.homeTitle) || target;
    if (!focusTarget.hasAttribute('tabindex')) focusTarget.setAttribute('tabindex', '-1');
    focusTarget.focus({ preventScroll: true });
  });

  // The calendar keeps the same public event address before and after the last day.
  const events = document.querySelector('[data-home-events]');
  const emptyEvents = document.querySelector('[data-events-empty]');
  const archive = document.querySelector('[data-past-calendar]');
  const entries = [...document.querySelectorAll('#program [data-event-end]')];
  const spotlight = document.querySelector('[data-home-now]');
  const featured = spotlight.querySelector('[data-event-end]');
  const calendar = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  let displayedDay;
  function openArchivedEvent(target) {
    const item = target?.closest('#program [data-event-end]');
    if (!item || item.dataset.eventEnd >= calendar.format(new Date())) return false;
    const url = new URL(archive.href);
    url.hash = item.id;
    location.replace(url.href);
    return true;
  }
  function refreshDates() {
    const today = calendar.format(new Date());
    if (today === displayedDay) return;
    displayedDay = today;
    const featureIsCurrent = featured && featured.dataset.eventStart <= today && today <= featured.dataset.eventEnd;
    spotlight.hidden = !featureIsCurrent;
    for (const item of entries) {
      const expired = item.dataset.eventEnd < today;
      item.hidden = expired;
      const destination = item === featured && featureIsCurrent ? spotlight : events;
      if (!expired && item.parentElement !== destination) {
        const next = [...destination.children].find(entry => entry.dataset.eventStart > item.dataset.eventStart);
        destination.insertBefore(item, next || null);
      }
      const booking = item.querySelector('[data-event-booking]');
      if (booking) booking.hidden = expired;
      const year = item.dataset.eventEnd.slice(0, 4);
      const yearLabel = item.querySelector('[data-event-year]');
      if (yearLabel) yearLabel.textContent = expired || year !== today.slice(0, 4) ? '\u00a0' + year : '';
    }
    emptyEvents.hidden = [...events.children].some(item => !item.hidden);
    openArchivedEvent(hashTarget());
  }
  refreshDates();
  displayView(hashTarget());
  if (location.hash && performance.getEntriesByType('navigation')[0]?.type === 'navigate') {
    const destination = location.href;
    // Native fragment scrolling and the final text metrics settle when the page opens.
    window.addEventListener('pageshow', () => requestAnimationFrame(() => {
      if (location.href === destination) revealLocation();
    }), { once: true });
  }
  window.addEventListener('popstate', restoreHistoryEntry);
  window.addEventListener('hashchange', restoreHistoryEntry);
  window.addEventListener('pageshow', refreshDates);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshDates();
  });
  window.setInterval(() => { if (!document.hidden) refreshDates(); }, 60000);
})();
