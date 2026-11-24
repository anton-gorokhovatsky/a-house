import { institutionPages } from '../src/data/institution-pages.mjs';

const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const link = ({ label, href }) => `<a href="${escape(href)}">${escape(label)}</a>`;

function links(items) {
  return items?.length ? '<ul class="institution-links" role="list">' +
    items.map(item => '<li>' + link(item) + '</li>').join('') + '</ul>' : '';
}

function image(photo, first = false) {
  return `<img src="@@ROOT@@media/${escape(photo.file)}" width="${photo.width}" height="${photo.height}" alt="${escape(photo.alt || '')}" ${first ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

function figure(photo, first = false) {
  return `<figure>${image(photo, first)}${photo.caption ? '<figcaption>' + escape(photo.caption) + '</figcaption>' : ''}</figure>`;
}

function sectionContent(section) {
  const paragraphs = (section.paragraphs || []).map(text => '<p>' + escape(text) + '</p>').join('\n');
  const items = section.entries ? '<dl class="institution-entries">' + section.entries.map(entry =>
    '<div><dt>' + (entry.href ? link({ href: entry.href, label: entry.title }) : escape(entry.title)) + '</dt><dd>' + escape(entry.text) + '</dd></div>'
  ).join('\n') + '</dl>' : '';
  const people = section.people ? '<ul class="institution-people" role="list">' + section.people.map(person =>
    `<li class="editorial-pair">${image(person)}<div><h3 class="editorial-pair-title">${escape(person.name)}</h3>${person.role ? '<p>' + escape(person.role) + '</p>' : ''}</div></li>`
  ).join('\n') + '</ul>' : '';
  const photos = section.photos ? '<div class="institution-photos">' + section.photos.map(photo => figure(photo)).join('') + '</div>' : '';
  const video = section.video ? `<div class="t-video-carier institution-video" data-content-video-url-youtube="${escape(section.video)}"></div><noscript><a href="https://www.youtube.com/watch?v=${escape(section.video)}">Открыть видео на YouTube</a></noscript>` : '';
  return paragraphs + items + people + photos + video + links(section.links);
}

export function isInstitutionPage(slug) {
  return Object.hasOwn(institutionPages, slug);
}

export function renderInstitutionPage(slug) {
  const page = institutionPages[slug];
  const sections = page.sections.map(section => `
    <section class="institution-section${section.people ? ' institution-section-people' : ''}" id="${escape(section.id)}" aria-labelledby="${escape(section.id)}-title">
      <h2 id="${escape(section.id)}-title">${escape(section.title)}</h2>
      <div class="institution-copy">${sectionContent(section)}</div>
    </section>`).join('\n');
  return `<div id="allrecords" class="t-records home-page">
    <!-- EDITORIAL HEADER -->
    <main id="site-content" tabindex="-1" class="home-editorial institution-page">
      <header class="institution-opening${page.photo ? ' institution-opening-photo editorial-pair' : ''}">
        <div class="institution-intro">
          <h1 class="editorial-pair-title">${escape(page.title).replace('предпринимателя', '<span class="institution-long-word">пред&shy;при&shy;ни&shy;ма&shy;те&shy;ля</span>')}</h1>
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
