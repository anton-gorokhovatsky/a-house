import { eventDate } from './calendar.mjs';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const link = (href, title) => `<a href="${escape(href)}">${escape(title)}</a>`;

export function renderProjectWorks(project) {
  return '<ul class="project-examples" role="list">' + project.works.map(work => {
    const meta = [work.date && eventDate({start: work.date}), work.source && escape(work.source)].filter(Boolean);
    return `<li>${meta.length ? '<p class="home-meta">' + meta.join(' · ') + '</p>' : ''}
      ${link(work.href || project.href, work.title)}
      ${work.text ? '<p>' + escape(work.text) + '</p>' : ''}</li>`;
  }).join('') + '</ul>';
}

function photoFigure(photo, portfolio) {
  const caption = photo.href ? `<a class="project-photo-link" href="${escape(photo.href)}">${escape(photo.caption)}</a>` : escape(photo.caption || '');
  const credit = portfolio ? `<strong><a${photo.href ? '' : ' class="project-photo-link"'} href="${escape(portfolio.href)}">${escape(portfolio.studio)}</a></strong>` : '';
  const published = photo.published ? eventDate({start: photo.published}) : '';
  const sources = photo.large ? `srcset="@@ROOT@@${escape(photo.src)} ${photo.width}w, @@ROOT@@${escape(photo.large)} ${photo.largeWidth}w"` : '';
  const sizes = portfolio ? '(min-width: 52rem) min(22vw, 18rem), 44vw' : '(min-width: 52rem) min(44vw, 37rem), 90vw';
  return `<figure style="--photo-ratio: ${photo.width} / ${photo.height}">
    <img src="@@ROOT@@${escape(photo.src)}" ${sources ? sources + ' sizes="' + sizes + '"' : ''}
      width="${photo.width}" height="${photo.height}" alt="${escape(photo.alt)}" loading="lazy" decoding="async">
    ${caption ? '<figcaption>' + credit + caption + published + '</figcaption>' : ''}
  </figure>`;
}

function projectFeature(project) {
  const title = `<h3 class="editorial-pair-title">${link(project.href, project.name)}</h3>`;
  const intro = `<header class="project-intro">${title}<p>${escape(project.description)}</p></header>`;
  if (project.feature.portfolios) {
    return `<article class="home-project-feature home-portfolio-feature editorial-pair">
      ${intro}
      <div class="home-project-portfolios">${project.feature.portfolios.map(item => photoFigure(item.photo, item)).join('')}</div>
      <div class="home-project-feature-copy">${renderProjectWorks(project)}</div>
    </article>`;
  }
  return `<article class="home-project-feature editorial-pair">
    ${intro}${photoFigure(project.feature.photo)}
    <div class="home-project-feature-copy">${renderProjectWorks(project)}</div>
  </article>`;
}

export function renderHomeProjects(projects, events, group) {
  const entries = projects.filter(project => project.overview === group);
  if (group === 'gatherings') {
    return entries.map(project => ({ project, event: events.find(event => event.id === project.event) }))
      .sort((a, b) => b.event.end.localeCompare(a.event.end))
      .map(({project, event}) => {
        const report = event.links.find(item => item.role === 'recap');
        return `<article class="home-gathering"><h3>${link(project.href, project.name)}</h3>
          <p class="home-meta">${escape(event.kind)} · ${eventDate(event)}</p><p>${escape(event.detail)}</p>
          ${link(report.url, report.label)}</article>`;
      }).join('\n');
  }
  return entries.map(project => {
    if (project.feature) return projectFeature(project);
    if (group === 'community') {
      return `<article class="home-community-project"><h3>${link(project.href, project.name)}</h3>
        <p>${escape(project.description)}</p>${project.application ? '<div class="home-links">' + link(project.application.href, project.application.label) + '</div>' : ''}
        ${renderProjectWorks(project)}</article>`;
    }
    const distinct = project.works.some(work => work.href && work.href !== project.href);
    return `<article class="home-edition-brief"><h4>${distinct ? link(project.href, project.name) : escape(project.name)}</h4>
      ${renderProjectWorks(project)}</article>`;
  }).join('\n');
}
