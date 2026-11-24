import { eventDate } from './calendar.mjs';

const sections = [
  ['primary', ''],
  ['gatherings', 'Фестиваль и форум'],
  ['houses', 'Дома, школа и клуб'],
  ['editions', 'Издания A–Press']
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

function photoFigure(photo, portfolio) {
  const caption = photo.href ? link(photo.href, photo.caption) : escape(photo.caption || '');
  const credit = portfolio ? '<strong>' + link(portfolio.href, portfolio.studio) + '</strong>' : '';
  const published = photo.published ? `<time datetime="${escape(photo.published)}">${eventDate({start: photo.published})}</time>` : '';
  const sources = photo.large ? `srcset="@@ROOT@@${escape(photo.src)} ${photo.width}w, @@ROOT@@${escape(photo.large)} ${photo.largeWidth}w"` : '';
  const sizes = portfolio ? '(min-width: 52rem) min(22vw, 18rem), 44vw' : '(min-width: 52rem) min(44vw, 37rem), 90vw';
  return `<figure style="--photo-ratio: ${photo.width} / ${photo.height}">
    <img src="@@ROOT@@${escape(photo.src)}" ${sources ? sources + ' sizes="' + sizes + '"' : ''}
      width="${photo.width}" height="${photo.height}" alt="${escape(photo.alt)}" loading="lazy" decoding="async">
    ${caption ? '<figcaption>' + credit + caption + published + '</figcaption>' : ''}
  </figure>`;
}

function projectEntry(project, events, heading) {
  const name = escape(project.name);
  if (!project.feature) {
    const distinctDestination = project.works.some(work => work.href && work.href !== project.href);
    return `<article class="home-project-brief"><${heading}>${distinctDestination ? link(project.href, project.name) : name}</${heading}>
      ${workList(project)}</article>`;
  }
  if (project.feature.portfolios) {
    return `<article class="home-project-feature home-portfolio-feature editorial-pair">
      <header class="portfolio-intro"><${heading} class="editorial-pair-title">${link(project.href, project.name)}</${heading}>
        <p>${escape(project.description)}</p></header>
      <div class="home-project-portfolios">${project.feature.portfolios.map(item => photoFigure(item.photo, item)).join('')}</div>
      <div class="home-project-feature-copy">${workList(project)}</div>
    </article>`;
  }
  const event = project.event && events.find(item => item.id === project.event);
  const report = event && event.links.find(item => item.role === 'recap');
  return `<article class="home-project-feature editorial-pair">
    <${heading} class="editorial-pair-title">${name}</${heading}>
    ${photoFigure(project.feature.photo)}
    <div class="home-project-feature-copy">
      ${event ? '<p class="home-meta">' + eventDate(event) + '</p>' : ''}
      <p>${escape(event ? event.summary : project.description)}</p>
      ${event ? `<div class="project-event-report"><p>${escape(event.detail)}</p>${link(report.url, report.label)} <span class="home-meta">Telegram</span></div>` : workList(project)}
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
    const editions = key === 'editions';
    const access = editions ? `<div class="editions-access"><a href="@@ROOT@@press/#distribution">Где найти печатный номер</a>
      <p>Полные выпуски {{digitalEditions}} можно <a href="#services-checkout">читать по подписке A–Friend</a>.</p></div>` : '';
    return title ? `<section class="project-collection" aria-labelledby="collection-${key}">
      <h3 id="collection-${key}">${editions ? link('@@ROOT@@press/', title) : title}</h3>${content}${access}</section>` : content;
  }).join('\n');
}
