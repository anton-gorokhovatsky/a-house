const dates = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const moscow = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow'
});
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
  return 'id="' + esc(event.id) + '" data-event-start="' + esc(event.start) +
    '" data-event-end="' + esc(event.end) + '"' + (event.end < today ? ' hidden' : '');
}

function eventCard(event, today, base) {
  const href = event.booking?.url || event.links[0]?.url || base + 'calendar/#' + event.id;
  return `<article class="home-event" ${attributes(event, today)}>
    <a class="home-event-link" href="${esc(href)}">
      <div class="home-event-info">
        <p class="home-meta">${dateLine(event, today)} <span class="home-event-venue">${esc(event.shortVenue || event.venue)}</span></p>
        <h3${event.legacyHeading ? ' id="' + esc(event.legacyHeading) + '"' : ''}>${esc(event.title)}</h3>
        <p>${esc(event.summary)}</p>
      </div>
      ${event.price ? '<p class="home-event-price">' + esc(event.price) + '</p>' : ''}
    </a>
    ${event.address ? '<p class="home-detail">' + esc(event.address) + '.</p>' : ''}
  </article>`;
}

function featurePhoto(event, base) {
  if (!event.photos?.length) return '';
  const images = event.photos.map((photo, index) =>
    '<img ' + (index ? 'class="home-photo-detail" loading="lazy"' : 'fetchpriority="high"') +
    ' src="' + esc(base + photo.file) + '" width="' + esc(photo.width) + '" height="' + esc(photo.height) +
    '" alt="' + esc(photo.alt) + '">').join('');
  const report = event.links.find(link => link.role === 'report');
  const caption = report ? '<figcaption><a href="' + esc(report.url) + '">' + esc(report.label) + '</a></figcaption>' : '';
  return '<figure class="home-feature-photo"><div class="home-photo-pair">' + images + '</div>' + caption + '</figure>';
}

export function renderProgram(events, featureTemplate, base, today = moscow.format(new Date())) {
  const spotlight = events.find(event => event.home === 'feature');
  const cards = events.filter(event => event !== spotlight && (event.home === 'card' || event.end >= today));
  cards.sort((a, b) => a.start.localeCompare(b.start) || (a.time || '').localeCompare(b.time || ''));
  const featureIsCurrent = Boolean(spotlight && spotlight.start <= today && today <= spotlight.end);
  const fields = spotlight && {
    attrs: attributes(spotlight, today), date: dateLine(spotlight, today), kind: esc(spotlight.kind),
    title: esc(spotlight.title).replace(/^(.*?\. )(.+)$/, '$1<span>$2</span>'),
    summary: esc(spotlight.summary),
    detail: spotlight.detail ? '<span class="home-detail"> ' + esc(spotlight.detail) + '</span>' : '',
    access: spotlight.access ? '<p class="home-feature-access">' + esc(spotlight.access) + '</p>' : '',
    address: esc(spotlight.address || spotlight.venue),
    booking: spotlight.booking ? '<a class="home-action" data-event-booking href="' + esc(spotlight.booking.url) + '">' + esc(spotlight.booking.label) + '</a>' : '',
    figure: featurePhoto(spotlight, base)
  };
  const feature = fields ? featureTemplate.replace(/\{\{(\w+)\}\}/g, (_, key) => fields[key]) : '';
  return {
    feature, cards: cards.map(event => eventCard(event, today, base)).join('\n'),
    featureIsCurrent, hasEvents: cards.some(event => event.end >= today) || Boolean(spotlight && spotlight.start > today)
  };
}
