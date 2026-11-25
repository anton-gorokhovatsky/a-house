import { eventDate, eventDestination } from './calendar.mjs';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const link = (href, title, className = '') => `<a${className ? ' class="' + className + '"' : ''} href="${escape(href)}">${escape(title)}</a>`;

export function renderProjectNavigation(directions) {
  return directions.map(({ id, name, indexLabel = name }) => link('#' + id, indexLabel)).join('\n');
}

export function renderProjectDirectory(directions) {
  return directions.map(({ id, name, indexLabel = name, projects }) => {
    const sectionId = escape(id);
    const rows = projects.map(project => `<li>
      <a class="home-project-row" href="${escape(project.href)}">
        <span class="home-project-name">${escape(project.name)}</span>
        <span class="home-project-description">${escape(project.indexDescription || project.description)}</span>
      </a>
    </li>`).join('\n');
    return `<section class="home-direction" id="${sectionId}" tabindex="-1" aria-labelledby="title-${sectionId}">
      <header class="home-direction-heading">
        <h3 id="title-${sectionId}">${escape(indexLabel)}</h3>
        <p class="home-direction-brand">${escape(name)}</p>
      </header>
      <ul class="home-project-entries" role="list">${rows}</ul>
    </section>`;
  }).join('\n');
}

export function renderProjectWorks(project, useHeadings = false) {
  return '<ul class="project-examples" role="list">' + project.works.map(work => {
    const meta = [work.date && eventDate({start: work.date}), work.source && escape(work.source)].filter(Boolean);
    const title = link(work.href || project.href, work.title);
    return `<li>${meta.length ? '<p class="home-meta">' + meta.join(' · ') + '</p>' : ''}
      ${useHeadings ? '<h4>' + title + '</h4>' : title}
      ${work.text ? '<p>' + escape(work.text) + '</p>' : ''}</li>`;
  }).join('') + '</ul>';
}

function photoFigure(photo, caption, sizes) {
  const sources = photo.large ? `srcset="@@ROOT@@${escape(photo.src)} ${photo.width}w, @@ROOT@@${escape(photo.large)} ${photo.largeWidth}w"` : '';
  return `<figure style="--photo-ratio: ${photo.width} / ${photo.height}">
    <img src="@@ROOT@@${escape(photo.src)}" ${sources ? sources + ' sizes="' + sizes + '"' : ''}
      width="${photo.width}" height="${photo.height}" alt="${escape(photo.alt)}" loading="lazy" decoding="async">
    <figcaption>${caption}</figcaption>
  </figure>`;
}

function portfolioFigure({studio, href, text, photo}) {
  const title = link(href, studio, photo.href ? '' : 'project-photo-link');
  const subject = photo.href ? link(photo.href, photo.caption, 'project-photo-link') : escape(photo.caption);
  const date = photo.published ? `<p class="home-meta">Telegram A–House · ${eventDate({start: photo.published})}</p>` : '';
  return photoFigure(photo, `<h4>${title}</h4><p class="project-photo-subject">${subject}</p>${date}<p class="project-figure-summary">${escape(text)}</p>`,
    '(min-width: 52rem) min(28vw, 25rem), (min-width: 36rem) 44vw, 90vw');
}

function newsFigure({photo, story}) {
  const title = link(story.href, story.title, 'project-photo-link');
  return photoFigure(photo, `<p class="home-meta">${escape(photo.caption)}</p><h4>${title}</h4><p class="project-figure-summary">${escape(story.text)}</p>`,
    '(min-width: 52rem) min(54vw, 47rem), 90vw');
}

function projectFeature(project) {
  const bookmark = escape(project.bookmark);
  const { portfolios, specialties } = project.feature;
  const images = portfolios
    ? `<div class="home-project-portfolios">${portfolios.map(portfolioFigure).join('')}</div>`
    : newsFigure(project.feature);
  const categories = specialties ? `<div class="project-specialties"><h4>Найти команду</h4><ul role="list">${specialties.map(item => '<li>' + link(item.href, item.title) + '</li>').join('')}</ul></div>` : '';
  return `<article class="home-project-feature editorial-pair project-${escape(project.overview)}" aria-labelledby="${bookmark}">
    <h3 id="${bookmark}" class="editorial-pair-title">${escape(project.name)}</h3>
    <div class="project-intro"><p>${escape(project.description)}</p>
      <div class="home-links">${link(project.href, project.overviewLinkLabel)}</div>
    </div>
    ${categories}
    ${images}
    <div class="home-project-feature-copy">${renderProjectWorks(project, project.overview === 'news')}</div>
  </article>`;
}

export function renderHomeProjects(projects, events, group) {
  const entries = projects.filter(project => project.overview === group);
  if (group === 'gatherings') {
    return entries.map(project => {
      const bookmark = project.id ? ` id="${escape(project.id)}" tabindex="-1"` : '';
      const editions = events.filter(event => event.projectId && event.projectId === project.id)
        .sort((a, b) => b.start.localeCompare(a.start));
      const items = editions.map(event => {
        const sources = (event.links || []).filter(item => item.role === 'edition-site' || item.role === 'recap');
        const actions = sources.length ? sources.map(item => link(item.url, item.label)).join('\n')
          : link(eventDestination(event, '@@ROOT@@calendar/'), event.title);
        const text = event.detail || event.summary;
        return `<li><p class="home-meta">${eventDate(event)}</p>
          ${text ? '<p>' + escape(text) + '</p>' : ''}<div class="home-links">${actions}</div></li>`;
      }).join('\n');
      return `<article class="home-gathering"><h3${bookmark}>${escape(project.name)}</h3>
        <p>${escape(project.description)}</p>${items ? '<ul role="list">' + items + '</ul>' : ''}</article>`;
    }).join('\n');
  }
  return entries.map(project => {
    if (project.feature) return projectFeature(project);
    if (group === 'community') {
      return `<article class="home-community-project"${project.bookmark ? ' id="' + escape(project.bookmark) + '"' : ''}><h3${project.legacyBookmark ? ' id="' + escape(project.legacyBookmark) + '"' : ''}>${escape(project.name)}</h3>
        <p>${escape(project.description)}</p>
        <div class="home-links">${link(project.href, project.overviewLinkLabel)}</div>
        ${renderProjectWorks(project)}</article>`;
    }
    const distinct = project.works.some(work => work.href && work.href !== project.href);
    return `<article class="home-edition-brief"><h3>${distinct ? link(project.href, project.name) : escape(project.name)}</h3>
      ${renderProjectWorks(project)}</article>`;
  }).join('\n');
}
