import { compareEventStarts, isEventToday, moscowDay } from '../src/js/schedule-dates.js';
import { bookingLabel, eventAddress, eventDestination, scheduleAttributes, scheduleDate } from './calendar.mjs';

const dates = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function dateLine(event, today) {
  const first = dates.format(new Date(event.start + 'T12:00:00Z'));
  const end = dates.format(new Date(event.end + 'T12:00:00Z'));
  const year = event.end.slice(0, 4);
  const yearText = '<span data-event-year>' + (year === today.slice(0, 4) ? '' : ' ' + year) + '</span>';
  if (event.start === event.end) {
    const time = event.time || '';
    const iso = event.start + (time ? 'T' + time + ':00+03:00' : '');
    return '<time datetime="' + iso + '">' + first + yearText + (time ? ', ' + time : '') + '</time>';
  }
  const sameMonth = event.start.slice(0, 7) === event.end.slice(0, 7);
  const start = sameMonth ? Number(event.start.slice(-2)) : first + (event.start.slice(0, 4) !== year ? ' ' + event.start.slice(0, 4) : '');
  return '<time datetime="' + event.start + '">' + start + '</time>' + (sameMonth ? '–' : ' — ') +
    '<time datetime="' + event.end + '">' + end + yearText + '</time>';
}

function attributes(event, today) {
  return 'id="' + esc(event.id) + '" ' + scheduleAttributes(event) + (event.end < today ? ' hidden' : '');
}

function eventCard(event, today, base) {
  const href = eventDestination(event, base + 'calendar/');
  const heading = event.legacyHeading || event.id + '-home-title';
  const admission = event.booking
    ? '<a class="home-event-admission" href="' + esc(event.booking.url) + '">' + bookingLabel(event) + '</a>'
    : event.price ? '<span class="home-event-amount">' + esc(event.price) + '</span>' : '';
  return `<article class="home-event" ${attributes(event, today)}>
    <div class="home-event-main">
      <p class="home-meta"><span>${scheduleDate(event, dateLine(event, today))}</span> <span class="home-event-venue">${esc(event.shortVenue || event.venue)}</span></p>
      <div class="home-event-info">
        <h3 id="${esc(heading)}"><a class="home-event-link" href="${esc(href)}">${esc(event.title)}</a></h3>
        <p>${esc(event.summary)}</p>
      </div>
    </div>
    ${event.address ? '<p class="home-detail">' + esc(event.address) + '.</p>' : ''}
    ${admission ? '<p class="home-event-price">' + admission + '</p>' : ''}
  </article>`;
}

function featurePhoto(event, base) {
  if (!event.photos?.length) return '';
  const mobileLead = event.photos.find(photo => photo.mobileLead) || event.photos[0];
  const images = event.photos.map((photo, index) => {
    const classes = [index ? 'home-photo-detail' : '', photo === mobileLead ? 'home-photo-lead' : ''].filter(Boolean);
    const priority = photo === mobileLead ? 'fetchpriority="high"' : 'loading="lazy"';
    return '<img class="' + classes.join(' ') + '" ' + priority + ' src="' + esc(base + photo.file) +
      '" width="' + esc(photo.width) + '" height="' + esc(photo.height) + '" alt="' + esc(photo.alt) + '">';
  }).join('');
  return '<figure class="home-feature-photo"><div class="home-photo-pair">' + images + '</div></figure>';
}

export function renderVenueProgram(events, venue, base, today = moscowDay()) {
  const scheduled = events.filter(event => event.venue === venue && event.end >= today)
    .sort(compareEventStarts);
  const items = scheduled.map(event =>
    `<li data-venue-end="${esc(event.end)}"><span class="home-meta">${dateLine(event, today)}</span>
      <a class="word-underlined-link" href="${esc(eventDestination(event, base + 'calendar/'))}">${esc(event.title)}</a></li>`
  ).join('');
  return `<div class="venue-program" data-venue-program><ul role="list">${items}</ul>
    <p data-venue-empty${items ? ' hidden' : ''}>Новые даты пока не объявлены.</p></div>`;
}

export function renderProgram(events, featureTemplate, base, today = moscowDay()) {
  const spotlight = events.find(event => event.home === 'feature');
  const cards = events.filter(event => event !== spotlight && (event.home === 'card' || event.end >= today))
    .sort(compareEventStarts);
  const todayCards = cards.filter(event => isEventToday(event, today));
  const laterCards = cards.filter(event => !isEventToday(event, today));
  const featureIsToday = spotlight && isEventToday(spotlight, today);
  const featureIsCurrent = Boolean(spotlight && !featureIsToday && spotlight.start <= today && today <= spotlight.end);
  const fields = spotlight && {
    attrs: attributes(spotlight, today), date: scheduleDate(spotlight, dateLine(spotlight, today)), kind: esc(spotlight.kind),
    title: esc(spotlight.title).replace(/^(.*?\. )(.+)$/, '$1<span>$2</span>'),
    url: esc(eventDestination(spotlight, base + 'calendar/')),
    summary: esc(spotlight.summary),
    detail: spotlight.detail ? '<span class="home-detail"> ' + esc(spotlight.detail) + '</span>' : '',
    access: spotlight.access ? '<p class="home-feature-access">' + esc(spotlight.access) + '</p>' : '',
    place: eventAddress(spotlight, (spotlight.city ? '<span class="home-feature-city">' + esc(spotlight.city) + ', </span>' : '') +
      esc(spotlight.address || spotlight.venue)),
    booking: spotlight.booking ? '<a class="home-action" data-event-booking href="' + esc(spotlight.booking.url) + '">' + bookingLabel(spotlight) + '</a>' : '',
    figure: featurePhoto(spotlight, base)
  };
  const feature = fields ? featureTemplate.replace(/\{\{(\w+)\}\}/g, (_, key) => fields[key]) : '';
  if (featureIsToday) todayCards.push(spotlight);
  const renderCard = event => event === spotlight ? feature : eventCard(event, today, base);
  return {
    feature: featureIsToday ? '' : feature,
    todayCards: todayCards.sort(compareEventStarts).map(renderCard).join('\n'),
    cards: laterCards.map(renderCard).join('\n'),
    featureIsCurrent, hasEvents: todayCards.length > 0 || laterCards.some(event => event.end >= today) || Boolean(spotlight && spotlight.start > today)
  };
}
