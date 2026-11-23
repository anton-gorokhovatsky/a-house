const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' });
const moscowDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
});

function escape(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function eventDate({ start, end = start }) {
  const full = day => dateFormat.format(new Date(day + 'T12:00:00Z'));
  const year = day => day.slice(0, 4);
  const time = (date, label) => '<time datetime="' + escape(date) + '">' + escape(label) + '</time>';
  if (start === end) return time(start, full(start) + ' ' + year(start));
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const first = sameMonth ? String(Number(start.slice(-2))) : full(start) + (year(start) === year(end) ? '' : ' ' + year(start));
  return time(start, first) + (sameMonth ? '–' : ' — ') + time(end, full(end) + ' ' + year(end));
}

function monthsInProgram(events) {
  const months = new Set();
  for (const event of events) {
    const cursor = new Date(event.start.slice(0, 7) + '-01T12:00:00Z');
    const last = (event.end || event.start).slice(0, 7);
    for (let key = cursor.toISOString().slice(0, 7); key <= last; key = cursor.toISOString().slice(0, 7)) {
      months.add(key);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  return [...months].sort().reverse();
}

function renderFilters(events, calendar) {
  const years = new Map();
  for (const key of monthsInProgram(events)) {
    const year = key.slice(0, 4);
    if (!years.has(year)) years.set(year, []);
    const name = monthFormat.format(new Date(key + '-01T12:00:00Z'));
    const month = name[0].toLocaleUpperCase('ru') + name.slice(1);
    years.get(year).push('<li><a data-calendar-month="' + key + '" href="' + calendar + '?month=' + key + '" aria-label="' + month + ' ' + year + '">' + month + '</a></li>');
  }
  const choices = [...years].map(([year, items]) =>
    '<div class="calendar-filter-year"><p>' + year + '</p><ul>' + items.join('') + '</ul></div>'
  ).join('');

  return `<aside id="calendar-filters" aria-label="Фильтры календаря" tabindex="-1" hidden>
    <nav class="calendar-audience" aria-label="Для кого">
      <a href="${calendar}" data-calendar-audience="" aria-current="true">Все события</a>
      <a href="${calendar}?audience=kids" data-calendar-audience="kids" class="calendar-kids">Для детей</a>
    </nav>
    <details class="calendar-months">
      <summary><span class="when-closed" data-month-label>Все месяцы</span><span class="when-open">Закрыть список месяцев</span></summary>
      <nav aria-label="Месяц события">
        <a href="${calendar}" data-calendar-month="" aria-current="true">Все месяцы</a>${choices}
      </nav>
    </details>
    <span data-calendar-count class="calendar-sr" role="status"></span>
  </aside>`;
}

function renderEvent(event, calendar) {
  const end = event.end || event.start;
  const name = escape(event.title);
  const time = event.time ? '<time class="calendar-time" datetime="' + escape(event.start + 'T' + event.time + '+03:00') + '">' + escape(event.time) + '</time>' : '';
  const children = event.audience === 'kids'
    ? '<span class="calendar-kids">Для детей' + (event.age ? ' · ' + escape(event.age) : '') + '</span>' : '';
  const venue = [event.venue, event.address].filter(Boolean).map(escape).join(', ');
  const links = (event.links || []).map(link =>
    '<a href="' + escape(link.url) + '"' + (link.url === event.booking?.url ? ' data-booking-source' : '') + '>' + escape(link.label) + '</a>'
  );
  if (event.booking) links.unshift('<a data-calendar-booking href="' + escape(event.booking.url) + '" hidden>' + escape(event.booking.label) + '</a>');
  const price = event.price ? '<p data-calendar-price hidden>' + escape(event.price) + '</p>' : '';
  return `<article class="calendar-event" id="${escape(event.id)}" data-calendar-event data-start="${escape(event.start)}" data-end="${escape(end)}" data-time="${escape(event.time || '')}" data-audience="${escape(event.audience || '')}" tabindex="-1" aria-labelledby="${escape(event.id)}-title">
    <div class="calendar-date">${eventDate(event)}${time}</div>
    <div class="calendar-event-copy">
      <div class="calendar-event-meta">${event.kind ? '<span>' + escape(event.kind) + '</span>' : ''}${children}</div>
      <h3 id="${escape(event.id)}-title"><a href="${calendar}#${escape(event.id)}">${name}</a></h3>
      ${venue ? '<p class="calendar-venue">' + venue + '</p>' : ''}
      ${event.summary ? '<p class="calendar-description">' + escape(event.summary) + '</p>' : ''}
      ${price}<div class="calendar-event-links">${links.join('')}</div>
    </div>
  </article>`;
}

export function renderCalendar(events, base, now = new Date()) {
  const calendar = escape(base) + 'calendar/';
  const today = moscowDate.format(now);
  const byDate = (a, b) => a.start.localeCompare(b.start) || (a.time || '').localeCompare(b.time || '');
  const current = events.filter(event => (event.end || event.start) >= today).sort(byDate);
  const past = events.filter(event => (event.end || event.start) < today).sort((a, b) =>
    (b.end || b.start).localeCompare(a.end || a.start) || byDate(b, a)
  );
  const entries = list => list.map(event => renderEvent(event, calendar)).join('\n');
  return `<header class="calendar-opening">
    <h1>Календарь событий</h1>
    <a href="#past" data-jump-past${current.length && past.length ? '' : ' hidden'}>К прошедшим событиям</a>
  </header>
  <div class="calendar-layout" data-calendar>
    ${renderFilters(events, calendar)}
    <div class="calendar-stream">
      <div data-calendar-empty hidden><p data-empty-message></p><a href="${calendar}" data-calendar-reset>Сбросить фильтры</a></div>
      <section id="upcoming" aria-labelledby="calendar-upcoming-heading">
        <h2 id="calendar-upcoming-heading">Сейчас и скоро</h2>
        <p data-no-upcoming${current.length ? ' hidden' : ''}>Новые даты пока не объявлены.</p>
        <div class="calendar-list" data-upcoming-list>${entries(current)}</div>
      </section>
      <section id="past" aria-labelledby="calendar-past-heading" tabindex="-1"${past.length ? '' : ' hidden'}>
        <div class="calendar-past-heading">
          <h2 id="calendar-past-heading">Прошедшие события</h2>
          <div class="calendar-archive-tools" data-archive-tools hidden>
            <a href="#calendar-filters" data-jump-filters>Выбрать месяц</a>
            <a href="${calendar}?audience=kids" class="calendar-kids" data-family-shortcut>Для детей</a>
          </div>
        </div>
        <div class="calendar-list" data-past-list>${entries(past)}</div>
      </section>
      <a class="calendar-family-source" data-family-source href="https://t.me/ahousekids" hidden>Канал A–Kids в Telegram</a>
    </div>
  </div>`;
}
