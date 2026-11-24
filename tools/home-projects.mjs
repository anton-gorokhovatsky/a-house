import { eventDate } from './calendar.mjs';

const sections = [
  ['primary', ''],
  ['gatherings', 'Фестиваль и форум'],
  ['houses', 'Дома, школа и клуб'],
  ['editions', 'Издательство и подписка'],
  ['channels', 'В Telegram']
];
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const link = (href, title) => `<a href="${escape(href)}">${escape(title)}</a>`;

function workList(project) {
  return '<ul class="project-examples" role="list">' + project.works.map(work => {
    const meta = [work.date && eventDate({start: work.date}), work.source && escape(work.source)].filter(Boolean);
    return `<li>${meta.length ? '<p class="home-meta">' + meta.join(' · ') + '</p>' : ''}
      ${link(work.href || project.href, work.title)}
      ${work.text ? '<p>' + escape(work.text) + '</p>' : ''}</li>`;
  }).join('') + '</ul>';
}

function photoFigure(photo) {
  const caption = photo.href ? link(photo.href, photo.caption) : escape(photo.caption || '');
  return `<figure style="--photo-ratio: ${photo.width} / ${photo.height}">
    <img src="@@ROOT@@${escape(photo.src)}"
      srcset="@@ROOT@@${escape(photo.src)} ${photo.width}w, @@ROOT@@${escape(photo.large)} ${photo.largeWidth}w"
      sizes="(min-width: 52rem) min(44vw, 37rem), 90vw"
      width="${photo.width}" height="${photo.height}" alt="${escape(photo.alt)}" loading="lazy" decoding="async">
    ${caption ? '<figcaption>' + caption + '</figcaption>' : ''}
  </figure>`;
}

function projectEntry(project, events, heading) {
  const name = escape(project.name);
  if (!project.feature) {
    const distinctDestination = project.works.some(work => work.href && work.href !== project.href);
    return `<article class="home-project-brief"><${heading}>${distinctDestination ? link(project.href, project.name) : name}</${heading}>
      ${workList(project)}</article>`;
  }
  const event = project.event && events.find(item => item.id === project.event);
  const report = event && event.links.find(item => item.role === 'recap');
  return `<article class="home-project-feature editorial-pair">
    <${heading} class="editorial-pair-title">${name}</${heading}>
    ${photoFigure(project.feature.photo)}
    <div class="home-project-feature-copy">
      ${event ? '<p class="home-meta">' + eventDate(event) + '</p>' : ''}
      <p>${escape(event ? event.summary : project.description)}</p>
      ${event ? `<div class="project-event-report"><p>${escape(event.detail)}</p>${link(report.url, report.label + ' в Telegram')}</div>` : workList(project)}
      <a class="home-project-action" href="${escape(project.href)}">${escape(project.feature.action)}</a>
    </div>
  </article>`;
}

export function renderHomeProjects(directions, events) {
  const projects = directions.flatMap(direction => direction.projects);
  return sections.map(([key, title]) => {
    const entries = projects.filter(project => project.overview === key)
      .sort((a, b) => (a.feature?.order ?? Infinity) - (b.feature?.order ?? Infinity));
    const content = entries.map(project => projectEntry(project, events, title ? 'h4' : 'h3')).join('\n');
    return title ? `<section class="project-collection" aria-labelledby="collection-${key}">
      <h3 id="collection-${key}">${title}</h3>${content}</section>` : content;
  }).join('\n');
}
