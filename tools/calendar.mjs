import { compareEventStarts, compareUpcomingEvents, moscowDay } from '../src/js/schedule-dates.js';

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' });

function escape(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function eventAddress(event, addressHtml) {
  if (!event.venueMap || !addressHtml) return addressHtml;
  return '<a class="home-venue-link" href="' + escape(event.venueMap) + '">' + addressHtml +
    '<span class="screen-reader-only"> на Яндекс Картах</span></a>';
}

function venueLine(event) {
  return [escape(event.venue || ''), eventAddress(event, escape(event.address || ''))].filter(Boolean).join(', ');
}

export function bookingLabel(event) {
  const price = event.price ? ' — <span class="home-event-amount">' + escape(event.price) + '</span>' : '';
  return escape(event.booking.label) + price;
}

export function eventDate({ start, end = start }) {
  const full = day => dateFormat.format(new Date(day + 'T12:00:00Z'));
  const year = day => day.slice(0, 4);
  const time = (date, label, withYear = false) => '<time datetime="' + escape(date) + '">' + escape(label) +
    (withYear ? ' <wbr>' + escape(year(date)) : '') + '</time>';
  if (start === end) return time(start, full(start), true);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const first = sameMonth ? String(Number(start.slice(-2))) : full(start);
  return time(start, first, year(start) !== year(end)) + (sameMonth ? '–' : ' — ') + time(end, full(end), true);
}

export function scheduleAttributes({ start, end = start, time = '', kind = '' }) {
  return `data-start="${escape(start)}" data-end="${escape(end)}" data-time="${escape(time)}" data-kind="${escape(kind)}"`;
}

export function scheduleDate(event, absolute) {
  return `<span data-absolute-date>${absolute}</span><time data-relative-date datetime="${escape(event.end || event.start)}" hidden></time>`;
}

function eventPageLink(event) {
  return event.links?.find(link => link.role === 'event-page');
}

export function eventDestination(event, calendar) {
  return eventPageLink(event)?.url || calendar + event.id + '/';
}

export function routesWithEvents(routes, events) {
  const calendar = routes.find(page => page.slug === 'calendar');
  const pages = [];
  const ids = new Set();
  for (const event of events) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.id) || ids.has(event.id)) {
      throw new Error('Invalid or repeated event ID: ' + event.id);
    }
    ids.add(event.id);
    if (!eventPageLink(event)) {
      pages.push({ ...calendar, slug: calendar.slug + '/' + event.id, event,
        title: event.title + ' — A–House', description: event.summary });
    }
  }
  return [...routes, ...pages];
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
    <nav class="calendar-months" aria-label="Месяц события">
      <a href="${calendar}" data-calendar-month="" aria-current="true">Все месяцы</a>${choices}
    </nav>
    <span data-calendar-count class="calendar-sr" role="status"></span>
  </aside>`;
}

function renderEvent(event, calendar) {
  const name = escape(event.title);
  const time = event.time ? '<time class="calendar-time" datetime="' + escape(event.start + 'T' + event.time + '+03:00') + '">' + escape(event.time) + '</time>' : '';
  const children = event.audience === 'kids'
    ? '<span class="calendar-kids">Для детей' + (event.age ? ' · ' + escape(event.age) : '') + '</span>' : '';
  const venue = venueLine(event);
  const destination = eventDestination(event, calendar);
  const links = (event.links || []).filter(link => link.url !== destination).map(link =>
    '<a href="' + escape(link.url) + '"' + (link.url === event.booking?.url ? ' data-booking-source' : '') + '>' + escape(link.label) + '</a>'
  );
  if (event.booking) links.unshift('<a data-calendar-booking href="' + escape(event.booking.url) + '" hidden>' + bookingLabel(event) + '</a>');
  const price = event.price && !event.booking ? '<p data-calendar-price hidden>' + escape(event.price) + '</p>' : '';
  return `<article class="calendar-event" id="${escape(event.id)}" data-calendar-event ${scheduleAttributes(event)} data-audience="${escape(event.audience || '')}" tabindex="-1" aria-labelledby="${escape(event.id)}-title">
    <div class="calendar-date">${scheduleDate(event, eventDate(event) + time)}</div>
    <div class="calendar-event-copy">
      <div class="calendar-event-meta">${event.kind ? '<span>' + escape(event.kind) + '</span>' : ''}${children}</div>
      <h3 id="${escape(event.id)}-title"><a href="${escape(destination)}"${eventPageLink(event) ? '' : ' referrerpolicy="same-origin"'}>${name}</a></h3>
      ${venue ? '<p class="calendar-venue">' + venue + '</p>' : ''}
      ${event.summary ? '<p class="calendar-description">' + escape(event.summary) + '</p>' : ''}
      ${price}<div class="calendar-event-links">${links.join('')}</div>
    </div>
  </article>`;
}

export function renderEventPage(event, base, now = new Date()) {
  const end = event.end || event.start;
  const past = end < moscowDay(now);
  const calendar = base + 'calendar/';
  const venue = venueLine(event);
  const clock = event.time ? ' <time datetime="' + escape(event.start + 'T' + event.time + ':00+03:00') + '">' +
    escape(event.time) + (event.endTime ? '–' + escape(event.endTime) : '') + '</time>' : '';
  const audience = event.audience === 'kids' ? '<span class="calendar-kids">Для детей' +
    (event.age ? ' · ' + escape(event.age) : '') + '</span>' : '';
  const photos = event.photos?.map(photo => '<img src="' + escape(base + photo.file) + '" alt="' + escape(photo.alt) +
    '" width="' + escape(photo.width) + '" height="' + escape(photo.height) + '" loading="lazy">').join('');
  const report = photos && event.links?.find(link => link.role === 'report');
  const paragraphs = event.paragraphs?.length ? event.paragraphs : [event.summary, event.detail].filter(Boolean);
  const reference = link => '<a href="' + escape(link.url) + '">' + escape(link.label) + '</a>';
  const links = (event.links || []).filter(link => link !== report && link.url !== event.booking?.url).map(reference);
  const access = [];
  if (event.price && !event.booking) access.push('<p class="event-price">' + escape(event.price) + '</p>');
  if (event.access) access.push('<p>' + escape(event.access) + '</p>');
  if (event.booking) access.push('<a class="home-action" href="' + escape(event.booking.url) + '">' + bookingLabel(event) + '</a>');
  const fallback = !past && access.length
    ? '<noscript>' + access.join('') + '</noscript>' : '';
  return `<article class="event-article" data-event-detail data-end="${escape(end)}">
    <a class="event-calendar-link" data-event-calendar href="${escape(calendar + '#' + event.id)}">Календарь событий</a>
    <header class="event-opening">
      <p class="event-kind"><span>${escape(event.kind || '')}</span>${audience}</p>
      <h1>${escape(event.title)}</h1>
    </header>
    <div class="event-body">
      <div class="event-when">
        <p class="event-date">${eventDate(event)}${clock}</p>
        <p class="event-venue">${venue}</p>
        <p class="event-ended" data-event-ended${past ? '' : ' hidden'}>Событие завершилось</p>
        ${access.length ? '<div class="event-admission" data-event-admission hidden>' + access.join('') + '</div>' : ''}
        ${fallback}
      </div>
      <div class="event-story">
        ${paragraphs.map((paragraph, index) => '<p' + (index ? '' : ' class="event-summary"') + '>' + escape(paragraph) + '</p>').join('\n        ')}
        ${links.length ? '<div class="event-reading">' + links.join('') + '</div>' : ''}
      </div>
    </div>
    ${photos ? '<figure class="event-photos"><div>' + photos + '</div>' + (report ? '<figcaption>' + reference(report) + '</figcaption>' : '') + '</figure>' : ''}
  </article>`;
}

export function renderCalendar(events, base, now = new Date()) {
  const calendar = escape(base) + 'calendar/';
  const today = moscowDay(now);
  const current = events.filter(event => (event.end || event.start) >= today)
    .sort((a, b) => compareUpcomingEvents(a, b, today));
  const past = events.filter(event => (event.end || event.start) < today).sort((a, b) =>
    (b.end || b.start).localeCompare(a.end || a.start) || compareEventStarts(b, a)
  );
  const entries = list => list.map(event => renderEvent(event, calendar)).join('\n');
  return `<header class="calendar-opening">
    <h1 class="section-title">Календарь событий</h1>
    <nav class="calendar-entry-links" aria-label="Разделы календаря">
      <a class="calendar-results-shortcut" href="#calendar-results">К списку событий</a>
      <a href="${calendar}#past" data-jump-past${past.length ? '' : ' hidden'}>Весь архив событий</a>
    </nav>
  </header>
  <div class="calendar-layout" data-calendar>
    ${renderFilters(events, calendar)}
    <div class="calendar-stream" id="calendar-results" tabindex="-1">
      <div data-calendar-empty hidden><p data-empty-message></p><a href="${calendar}" data-calendar-reset>Сбросить фильтры</a></div>
      <section id="upcoming" aria-labelledby="calendar-upcoming-heading" tabindex="-1">
        <h2 id="calendar-upcoming-heading">Сейчас и скоро</h2>
        <div class="calendar-selection" data-month-selection hidden>
          <span data-selected-month></span>
          <a href="${calendar}" data-calendar-clear-month>Сбросить фильтр месяца</a>
        </div>
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
        <p class="calendar-archive-empty" data-archive-empty hidden>По выбранным фильтрам в архиве нет событий.</p>
        <div class="calendar-list" data-past-list>${entries(past)}</div>
      </section>
      <a class="calendar-family-source" data-family-source href="https://t.me/ahousekids" hidden>Канал A–Kids в Telegram</a>
    </div>
  </div>`;
}
