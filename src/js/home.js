(() => {
  const overview = document.getElementById('overview');
  const issue = document.querySelector('.home-issue');
  const sections = [...document.querySelectorAll('[data-home-section]')];
  const choices = [...document.querySelectorAll('[data-home-view]')];
  const links = [...document.querySelectorAll('a')];
  let restoreFrame = 0;

  function viewFor(target) {
    return target?.closest('[data-home-section]') || null;
  }

  function displayView(target) {
    const context = target?.closest('.home-footer') ? document.getElementById(history.state?.homeContext || '') : target;
    const selected = viewFor(context);
    overview.dataset.view = selected?.id || 'overview';
    issue.hidden = context?.id === 'publications';
    for (const section of sections) {
      section.hidden = selected ? selected !== section : !section.hasAttribute('data-overview-section');
    }
    const currentSection = selected?.id === 'services-checkout' ? 'club' : selected?.id || 'overview';
    for (const choice of choices) {
      if (choice.hash === '#' + currentSection) choice.setAttribute('aria-current', 'true');
      else choice.removeAttribute('aria-current');
    }
    for (let disclosure = target?.closest('details'); disclosure; disclosure = disclosure.parentElement.closest('details')) {
      disclosure.open = true;
    }
  }

  function hashTarget() {
    return document.getElementById(location.hash.slice(1));
  }

  function scrollToTarget(target) {
    if (target.id === 'publications') {
      // Keep the section heading and masthead in view if the first headline fits.
      // The same margin also applies when the browser follows the initial fragment.
      const firstHeadline = target.querySelector('h3');
      const fits = firstHeadline && firstHeadline.getBoundingClientRect().bottom + scrollY <= innerHeight;
      target.style.scrollMarginBlockStart = fits ? target.getBoundingClientRect().top + scrollY + 'px' : '0px';
    }
    // Section entries start with the masthead. A deeper link goes straight to its content.
    if (target === overview || target.hasAttribute('data-home-section')) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    } else {
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
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
    if (openArchivedEvent(hashTarget())) return;
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
    if (!target || link.classList.contains('skip-content')) return;
    event.preventDefault();
    if (location.hash !== link.hash) {
      const top = link.closest('.site-header') ? null : link.getBoundingClientRect().top;
      const homeReturn = { index: links.indexOf(link), top, scrollY };
      history.replaceState({ ...history.state, homeReturn }, '');
      const state = target.closest('.home-footer') ? { homeContext: history.state?.homeContext || hashTarget()?.id || 'overview' } : null;
      history.pushState(state, '', link.hash);
    }
    displayView(target);
    scrollToTarget(target);
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });

  // The calendar keeps the same public event address before and after the last day.
  const events = document.querySelector('[data-home-events]');
  const emptyEvents = document.querySelector('[data-events-empty]');
  const archive = document.querySelector('[data-past-calendar]');
  const entries = [...document.querySelectorAll('#program [data-event-end]')];
  const spotlight = document.querySelector('[data-home-now]');
  const featured = spotlight.querySelector('[data-event-end]');
  const program = spotlight.parentElement;
  const introduction = program.querySelector('.home-introduction');
  const compact = matchMedia('(max-width: 48em)');
  // Keep the About link in visual reading order when the two opening sections swap places.
  function orderIntroduction() {
    const before = compact.matches ? spotlight.nextElementSibling : program.firstElementChild;
    if (before === introduction) return;
    const focused = introduction.contains(document.activeElement) ? document.activeElement : null;
    program.insertBefore(introduction, before);
    focused?.focus({preventScroll: true});
  }
  orderIntroduction();
  compact.addEventListener('change', orderIntroduction);
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
    document.querySelector('[data-home-intro]').hidden = !!featureIsCurrent;
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
