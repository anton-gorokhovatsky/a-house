import { institutionPages } from '../src/data/institution-pages.mjs';

const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const link = ({ label, href }) => `<a href="${escape(href)}">${escape(label)}</a>`;

function links(items) {
  return items?.length ? '<ul class="institution-links" role="list">' +
    items.map(({ href, label }) => '<li><a class="word-underlined-link" href="' + escape(href) + '">' +
      escape(label) + '</a></li>').join('') + '</ul>' : '';
}

function image(photo, first = false) {
  return `<img src="@@ROOT@@media/${escape(photo.file)}" width="${photo.width}" height="${photo.height}" alt="${escape(photo.alt || '')}" ${first ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

function figure(photo, first = false) {
  return `<figure>${image(photo, first)}${photo.caption ? '<figcaption>' + escape(photo.caption) + '</figcaption>' : ''}</figure>`;
}

function partnershipFormat(format) {
  const headingTarget = format.id ? ` id="${escape(format.id)}" tabindex="-1"` : '';
  return `<article class="institution-format${format.photo ? ' institution-format-photo editorial-pair' : ''}">
    <div>
      <h3 class="editorial-pair-title"${headingTarget}>${escape(format.title)}</h3>
      <p>${escape(format.text)}</p>
      ${links(format.links)}
    </div>
    ${format.photo ? figure(format.photo) : ''}
  </article>`;
}

function sectionContent(section) {
  const paragraphs = (section.paragraphs || []).map(text => '<p>' + escape(text) + '</p>').join('\n');
  const items = section.entries ? '<dl class="institution-entries">' + section.entries.map(entry =>
    '<div><dt' + (entry.id ? ' id="' + escape(entry.id) + '"' : '') + '>' + (entry.href ? link({ href: entry.href, label: entry.title }) : escape(entry.title)) + '</dt><dd>' + escape(entry.text) + links(entry.links) + '</dd></div>'
  ).join('\n') + '</dl>' : '';
  const formats = section.formats ? '<div class="institution-formats">' + section.formats.map(partnershipFormat).join('\n') + '</div>' : '';
  const people = section.people ? '<ul class="institution-people" role="list">' + section.people.map(person =>
    `<li class="editorial-pair">${image(person)}<div><h3 class="editorial-pair-title">${escape(person.name)}</h3>${person.role ? '<p>' + escape(person.role).replace(/\(\d{4}–\d{4}\)/g, '<span class="person-years">$&</span>') + '</p>' : ''}</div></li>`
  ).join('\n') + '</ul>' : '';
  const photos = section.photos ? '<div class="institution-photos">' + section.photos.map(photo => figure(photo)).join('') + '</div>' : '';
  const video = section.video ? `<div class="t-video-carier institution-video" data-content-video-url-youtube="${escape(section.video)}" data-video-title="${escape(section.title)}" hidden>
    <img src="@@ROOT@@media/home/about-film.jpg" width="1280" height="720" alt="" loading="lazy"></div>
    <p class="institution-film-status" role="status"></p>
    <a class="institution-film-link" href="https://www.youtube.com/watch?v=${escape(section.video)}">Смотреть фильм на YouTube</a>` : '';
  const program = section.program ? '<!-- VENUE PROGRAM ' + section.program + ' -->' : '';
  return paragraphs + program + items + formats + people + links(section.links) + photos + video;
}

export function isInstitutionPage(slug) {
  return Object.hasOwn(institutionPages, slug);
}

export function renderInstitutionPage(slug) {
  const page = institutionPages[slug];
  const isMainSection = slug === 'partnership';
  const title = escape(page.title)
    .replace('предпринимателя', '<span class="wrap-group">пред&shy;при&shy;ни&shy;ма&shy;те&shy;ля</span>')
    .replace('Сотрудничество', 'Сотруд&shy;ничество');
  const sections = page.sections.map(section => `
    <section class="institution-section${section.people ? ' institution-section-people' : ''}${section.formats ? ' institution-section-formats' : ''}" id="${escape(section.id)}" aria-labelledby="${escape(section.id)}-title">
      <h2 id="${escape(section.id)}-title">${escape(section.title)}</h2>
      <div class="institution-copy">${sectionContent(section)}</div>
    </section>`).join('\n');
  return `<div id="allrecords" class="t-records home-page">
    <!-- EDITORIAL HEADER -->
    <main id="site-content" tabindex="-1" class="home-editorial institution-page" data-restore-fragment>
      <header class="institution-opening${page.photo ? ' institution-opening-photo editorial-pair' : ''}">
        <div class="institution-intro">
          <h1 class="editorial-pair-title${isMainSection ? ' section-title' : ''}">${title}</h1>
          <p class="institution-lead">${escape(page.lead).replace('предпринимателей', 'пред&shy;при&shy;ни&shy;ма&shy;те&shy;лей')}</p>
          ${page.intro ? '<p>' + escape(page.intro) + '</p>' : ''}
          ${links(page.links)}
        </div>
        ${page.photo ? figure(page.photo, true) : ''}
      </header>
      ${sections}
    </main>
    <!-- FOOTER -->
  </div>`;
}
