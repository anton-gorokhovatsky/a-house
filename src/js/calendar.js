(() => {
  const calendar = document.querySelector('[data-calendar]');
  if (!calendar) return;
  const filters = document.getElementById('calendar-filters');
  const months = filters.querySelector('.calendar-months');
  const summary = months.querySelector('summary');
  const monthLinks = [...filters.querySelectorAll('[data-calendar-month]')];
  const audienceLinks = [...filters.querySelectorAll('[data-calendar-audience]')];
  const events = [...calendar.querySelectorAll('[data-calendar-event]')];
  const upcoming = calendar.querySelector('[data-upcoming-list]');
  const past = calendar.querySelector('[data-past-list]');
  const empty = calendar.querySelector('[data-calendar-empty]');
  const moscowDate = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const monthName = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' });
  const chronological = (a, b) => a.dataset.start.localeCompare(b.dataset.start)
    || a.dataset.time.localeCompare(b.dataset.time);
  let lastDate;

  function filterURL(month, kids) {
    const url = new URL(location.pathname, location.origin);
    if (month) url.searchParams.set('month', month);
    if (kids) url.searchParams.set('audience', 'kids');
    return url;
  }

  function inMonth(event, month) {
    return !month || (event.dataset.start.slice(0, 7) <= month && month <= event.dataset.end.slice(0, 7));
  }

  function syncLink(link, destination, selected) {
    link.href = destination.href;
    if (selected) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }

  function order(list, rows) {
    let next = list.firstElementChild;
    for (const row of rows) {
      if (row === next) next = next.nextElementSibling;
      else list.insertBefore(row, next);
    }
  }

  function showSelection() {
    const url = new URL(location.href);
    const requested = url.searchParams.get('month') || '';
    let month = /^\d{4}-(?:0[1-9]|1[0-2])$/.test(requested) ? requested : '';
    let kids = url.searchParams.get('audience') === 'kids';

    // A shared event remains reachable even with an older, conflicting set of filters.
    const target = events.find(event => '#' + event.id === url.hash);
    if (target && ((!inMonth(target, month)) || (kids && target.dataset.audience !== 'kids'))) {
      if (!inMonth(target, month)) month = '';
      if (target.dataset.audience !== 'kids') kids = false;
      const destination = filterURL(month, kids);
      destination.hash = target.id;
      history.replaceState(history.state, '', destination);
    }

    lastDate = moscowDate.format(new Date());
    const currentEvents = [];
    const pastEvents = [];
    let visibleCurrent = 0;
    let visiblePast = 0;
    for (const event of events) {
      const expired = event.dataset.end < lastDate;
      const matches = inMonth(event, month) && (!kids || event.dataset.audience === 'kids');
      event.hidden = !matches;
      for (const item of event.querySelectorAll('[data-calendar-booking], [data-calendar-price]')) item.hidden = expired;
      for (const item of event.querySelectorAll('[data-booking-source]')) item.hidden = !expired;
      if (expired) {
        pastEvents.push(event);
        if (matches) visiblePast++;
      } else {
        currentEvents.push(event);
        if (matches) visibleCurrent++;
      }
    }
    order(upcoming, currentEvents.sort(chronological));
    order(past, pastEvents.sort((a, b) => b.dataset.end.localeCompare(a.dataset.end) || chronological(b, a)));
    for (const link of monthLinks) syncLink(link, filterURL(link.dataset.calendarMonth, kids), month === link.dataset.calendarMonth);
    for (const link of audienceLinks) syncLink(link, filterURL(month, !!link.dataset.calendarAudience), kids === !!link.dataset.calendarAudience);
    let label = 'Все месяцы';
    if (month) {
      const selectedMonth = monthName.format(new Date(month + '-01T12:00:00Z'));
      label = selectedMonth[0].toLocaleUpperCase('ru') + selectedMonth.slice(1) + ' ' + month.slice(0, 4);
    }
    summary.querySelector('[data-month-label]').textContent = label;
    const total = visiblePast + visibleCurrent;
    const filtered = !!month || kids;
    calendar.querySelector('[data-no-upcoming]').hidden = visibleCurrent > 0;
    document.getElementById('upcoming').hidden = filtered && !visibleCurrent;
    document.getElementById('past').hidden = !visiblePast;
    document.querySelector('[data-jump-past]').hidden = !pastEvents.length;
    calendar.querySelector('[data-family-source]').hidden = !kids;
    const familyShortcut = calendar.querySelector('[data-family-shortcut]');
    familyShortcut.href = filterURL(month, true).href;
    familyShortcut.hidden = kids;
    filters.querySelector('[data-calendar-count]').textContent = 'Количество событий — ' + total + '.';
    empty.hidden = !filtered || total > 0;
    if (!empty.hidden) empty.querySelector('p').textContent = kids
      ? (month ? 'В выбранном месяце нет событий для детей.' : 'В календаре пока нет событий для детей.')
      : 'В выбранном месяце нет событий.';
  }

  calendar.addEventListener('click', event => {
    const link = event.target.closest('[data-calendar-month], [data-calendar-audience], [data-calendar-reset]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    if (link.href !== location.href) history.pushState(null, '', link.href);
    months.open = false;
    showSelection();
    if (link.hasAttribute('data-calendar-month')) summary.focus();
    if (link.hasAttribute('data-calendar-reset')) audienceLinks[0].focus();
  });
  months.addEventListener('keydown', event => {
    if (event.key === 'Escape' && months.open) {
      months.open = false;
      summary.focus();
    }
  });

  filters.hidden = false;
  calendar.querySelector('[data-archive-tools]').hidden = false;
  calendar.querySelector('[data-jump-filters]').addEventListener('click', event => {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    if (location.hash !== '#calendar-filters') history.pushState(null, '', '#calendar-filters');
    months.open = true;
    summary.focus({ preventScroll: true });
    filters.scrollIntoView({ block: 'start' });
  });
  showSelection();
  window.addEventListener('popstate', showSelection);
  window.addEventListener('hashchange', showSelection);
  window.addEventListener('pageshow', showSelection);
  function refreshDay() {
    if (!document.hidden && moscowDate.format(new Date()) !== lastDate) showSelection();
  }
  document.addEventListener('visibilitychange', refreshDay);
  window.setInterval(refreshDay, 60000);
})();
