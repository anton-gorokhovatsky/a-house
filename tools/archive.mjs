import { readFile } from 'node:fs/promises';

const imageInfo = JSON.parse(await readFile(new URL('./image-manifest.json', import.meta.url), 'utf8')).images;
// These two original JPEGs are served directly, outside the delivery manifest.
const originalDimensions = {
  'media/2023-10-17_200210-d98d7fee9957.jpg': {width: 1024, height: 1208},
  'media/2024-03-07_144932-6a3405f16f43.jpg': {width: 750, height: 453}
};
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

export function renderPrintFileLink(href, label, metadata, context = '') {
  const issue = context ? `<span class="screen-reader-only"> · ${escape(context)}</span>` : '';
  return `<a class="press-file" href="${escape(href)}"><span class="press-file-label">${escape(label)}</span>${issue} <small>${escape(metadata)}</small></a>`;
}

export function printArchiveFileNames(editions) {
  const names = new Set();
  for (const edition of editions) {
    for (const issue of edition.issues) {
      if (edition.latest && (issue.number >= edition.latest.number || issue.published >= edition.latest.published)) {
        throw new Error('The open archive includes a current or future issue: ' + issue.id);
      }
      names.add(issue.id + '.jpg');
      for (const file of issue.files) names.add(file.name);
    }
  }
  return names;
}

const archiveMonth = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const fileSizeFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export function pdfMetadata(bytes) {
  return 'PDF · ' + fileSizeFormat.format(bytes / 1e6) + ' МБ';
}

export async function renderPrintArchive(editions, getFileSize) {
  const navigation = editions.map(edition =>
    `<a href="#${escape(edition.archiveAnchor || edition.seriesId)}">${escape(edition.archiveLabel || edition.edition)}</a>`
  ).join('');
  const groups = await Promise.all(editions.map(async edition => {
    const anchor = escape(edition.archiveAnchor || edition.seriesId);
    const cards = await Promise.all(edition.issues.map(async issue => {
      const id = escape(issue.id);
      const name = edition.edition + ' № ' + issue.number;
      const month = archiveMonth.format(new Date(issue.published.slice(0, 7) + '-01T12:00:00Z')).replace(/\s*г\.$/, '');
      const files = await Promise.all(issue.files.map(async file => {
        const metadata = pdfMetadata(await getFileSize(file.name));
        return renderPrintFileLink('@@ROOT@@media/print/' + file.name, file.label, metadata, name);
      }));
      return `<article id="${id}" class="print-issue" tabindex="-1" aria-labelledby="${id}-title">
        <img src="@@ROOT@@media/print/${id}.jpg" alt="Обложка ${escape(name)}" width="${issue.coverWidth}" height="${issue.coverHeight || 780}" loading="lazy" decoding="async">
        <div><p class="home-kicker">№ ${issue.number} · <time datetime="${escape(issue.published)}">${escape(month)}</time></p>
        <h4 id="${id}-title">${escape(issue.title)}<span class="screen-reader-only"> · ${escape(name)}</span></h4>
        <p>${escape(issue.description)}</p><div class="press-page-links">${files.join('')}</div></div></article>`;
    }));
    return `<section id="${anchor}" class="print-series" tabindex="-1" aria-labelledby="${anchor}-heading">
      <h3 id="${anchor}-heading">${escape(edition.archiveLabel || edition.edition)}</h3>
      ${edition.archiveNote ? '<p>' + escape(edition.archiveNote) + '</p>' : ''}
      <div class="print-issues">${cards.join('\n')}</div>
    </section>`;
  }));
  return `<div class="print-archive-layout">
    <nav class="press-page-links print-series-nav" aria-label="Издания в архиве">${navigation}</nav>
    <div>${groups.join('\n')}</div>
  </div>`;
}

export function subscriptionIssues(editions) {
  return editions.filter(edition => edition.latest)
    .map(({ edition, latest }) => ({ ...latest, edition, title: `${edition} № ${latest.number} ${latest.topic}` }))
    .sort((a, b) => b.published.localeCompare(a.published));
}

function printCover({ cover }, className) {
  return `<img class="${className}" src="@@ROOT@@${escape(cover.src)}" width="${cover.width}" height="${cover.height}" alt="${escape(cover.alt)}" loading="lazy" decoding="async">`;
}

export function renderFriendCover(issues) {
  const issue = issues.find(issue => issue.cover);
  return issue ? `<figure class="home-friend-cover">${printCover(issue, 'friend-cover-image')}<figcaption>${escape(issue.title)}</figcaption></figure>` : '';
}

function renderIssueLinks(issue, homeLink) {
  const links = [];
  if (homeLink) {
    links.push(`<a href="${escape(homeLink)}">О выпуске ${escape(issue.edition)}</a>`);
  } else if (issue.announcement) {
    const name = issue.number ? `${issue.edition} № ${issue.number}` : issue.edition || issue.title;
    links.push(`<a href="${escape(issue.announcement)}">О выпуске ${escape(name)} в Telegram</a>`);
  }
  if (issue.article) {
    links.push(`<a href="${escape(issue.article.href)}">${escape(issue.article.title)}</a>`);
  }
  return links.length ? `<div class="${homeLink ? 'home-links' : 'press-page-links'}">${links.join('')}</div>` : '';
}

function renderFeaturedIssue(issue, { id, heading = 'h3', excerpt, homeLink } = {}) {
  const title = escape(issue.title).replace(/\p{L}+(?:\u00ad\p{L}+)+»?/gu, '<span class="wrap-group">$&</span>');
  const headingId = id ? escape(id) + '-title' : '';
  const attributes = id ? ` id="${escape(id)}" tabindex="-1" aria-labelledby="${headingId}"` : '';
  return `<article class="press-featured-issue"${attributes}>
    ${issue.cover ? printCover(issue, 'press-featured-cover') : ''}
    <div class="press-featured-copy">
      ${issue.published ? '<p class="home-kicker">' + dateMarkup(issue.published) + '</p>' : ''}
      <${heading}${headingId ? ' id="' + headingId + '"' : ''}>${title}</${heading}>
      ${issue.description ? '<p>' + escape(issue.description) + '</p>' : ''}
      ${excerpt ? '<p>' + escape(excerpt) + '</p>' : ''}
      ${renderIssueLinks(issue, homeLink)}
    </div>
  </article>`;
}

export function renderPressFeature(issue, home) {
  return home
    ? renderFeaturedIssue(issue, { id: 'home-press-issue', heading: 'h4', homeLink: '@@ROOT@@press/#' + issue.anchor })
    : renderFeaturedIssue(issue, { id: issue.anchor, heading: 'h2', excerpt: issue.excerpt });
}

export function renderPrintRelease({ edition, latest, printRelease }) {
  const { anchor, number, topic, description, highlights, availableFrom, outlets, source, video } = printRelease;
  const id = escape(anchor);
  const title = escape(`${edition} № ${number} ${topic}`);
  const href = `@@ROOT@@press/#${id}`;
  const poster = `@@ROOT@@${escape(video.poster)}`;
  const outletList = outlets.map(name => `<li>${escape(name)}</li>`).join('');
  return {
    press: `<section class="press-release print-release-layout" id="${id}" tabindex="-1" aria-labelledby="${id}-title">
      <div>
        <p class="home-kicker">Печатный выпуск</p>
        <h2 id="${id}-title">${title}</h2>
      </div>
      <figure class="press-release-media" data-press-release-player>
        <div class="press-release-player">
          <video id="${id}-video" src="@@ROOT@@${escape(video.src)}" poster="${poster}" width="${video.width}" height="${video.height}" controls muted playsinline preload="none" aria-label="Ролик о выпуске ${title}" aria-describedby="${id}-video-description"></video>
          <button class="press-release-play" type="button" hidden aria-controls="${id}-video" aria-label="Смотреть ролик о выпуске ${title}"><span aria-hidden="true"></span></button>
        </div>
        <p class="press-release-video-status" role="status"></p>
        <figcaption class="screen-reader-only" id="${id}-video-description">${escape(video.description)}</figcaption>
      </figure>
      <div class="press-release-copy">
        <p>${escape(description)}</p>
        <p>${escape(highlights)}</p>
        <details class="press-release-distribution">
          <summary><span aria-hidden="true"></span>Где найти печатный номер</summary>
          <p>С ${dateMarkup(availableFrom)} в партнёрских точках</p>
          <ul role="list">${outletList}</ul>
        </details>
        <div class="press-page-links">
          <a href="${escape(source)}">Анонс в Telegram</a>
          ${latest ? `<a href="@@ROOT@@a-friend/#${escape(latest.anchor)}">Другие выпуски ${escape(edition)} в A–Friend</a>` : ''}
        </div>
      </div>
    </section>`,
    homeLink: `<a class="home-introduction-issue" href="${href}">Вышел ${title}</a>`,
    homePreview: `<article class="home-press-release print-release-layout" aria-labelledby="home-print-release-title">
      <div>
        <p class="home-kicker">Печатный выпуск</p>
        <h4 id="home-print-release-title">${title}</h4>
        <p>${escape(highlights)}</p>
      </div>
      <a class="home-press-release-media" href="${href}" aria-labelledby="home-print-release-title home-print-release-action">
        <img src="${poster}" width="${video.width}" height="${video.height}" alt="" loading="lazy" decoding="async">
        <span id="home-print-release-action">Видео и точки распространения</span>
      </a>
    </article>`
  };
}

export function renderCurrentPrintIssues(issues) {
  const featured = issues.find(issue => issue.cover);
  const other = issues.filter(issue => issue !== featured).map(issue =>
    `<li><p>${escape(issue.title)}</p><p class="home-kicker">${dateMarkup(issue.published)}</p>
      ${issue.description ? '<p class="press-issue-summary">' + escape(issue.description) + '</p>' : ''}
      ${renderIssueLinks(issue)}</li>`
  ).join('');
  return `<div class="press-friend-issues">${featured ? renderFeaturedIssue(featured) : ''}${other ? '<ul>' + other + '</ul>' : ''}</div>`;
}

export function renderFeaturedPrintProject(projects) {
  const special = projects.flatMap(project => project.specialIssue ? [project.specialIssue] : [])
    .sort((a, b) => b.published.localeCompare(a.published))[0];
  return special ? renderFeaturedIssue(special) : '';
}

export function renderSubscriptionEntries(issues) {
  return issues.filter(issue => issue.latest).map(issue => `<div id="${escape(issue.latest.anchor)}" class="friend-edition" tabindex="-1">
    <a class="friend-archive-return" href="@@ROOT@@press/#${escape(issue.archiveAnchor || issue.seriesId)}">К архиву ${escape(issue.edition)}</a>
    <p class="home-kicker">В подписке — ${escape(issue.edition)} № ${escape(issue.latest.number)} ${escape(issue.latest.topic)}</p>
  </div>`).join('\n');
}

export function renderPressBooks(books) {
  return books.map(({title, subtitle, description, cover, href, linkLabel, metadata}) => `<article class="press-book">
    <img src="@@ROOT@@${escape(cover.src)}" width="${cover.width}" height="${cover.height}" alt="${escape(cover.alt)}" loading="lazy" decoding="async">
    <div><h2 class="press-book-title">${escape(title)}</h2>
      ${subtitle ? '<p class="book-subtitle">' + escape(subtitle) + '</p>' : ''}
      <p>${escape(description)}</p>
      <div class="book-preview">${metadata ? renderPrintFileLink(href, linkLabel, metadata, title)
        : '<a href="' + escape(href) + '">' + escape(linkLabel) + '<span class="screen-reader-only"> · ' + escape(title) + '</span></a>'}</div>
    </div>
  </article>`).join('\n');
}

const dateFormat = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const relatedReading = new Map([
  ['tpost/f0997i9441-anews-2', { href: '@@ROOT@@press/#a-news-02', title: 'Читать второй номер A–News' }],
  ['tpost/svnul2ze71-pervii-vipusk-detskogo-zhurnala-akids-so', { href: '@@ROOT@@press/#a-kids-01', title: 'Читать первый A–Kids — для взрослых и для детей' }],
  ['tpost/17xaum7r91-translyatsiya-paris-design-week', {
    href: 'https://t.me/ahouseproject/832', title: 'Итоги Парижской недели дизайна в Telegram', published: '2023-09-18'
  }],
  ['tpost/pz3nj2pcg1-3daysofdesign-2024-translyatsiya-iz-kope', {
    href: 'https://t.me/ahouseproject/1989', title: 'Первый день 3daysofdesign в Telegram', published: '2024-06-12'
  }]
]);
const imageDescriptions = new Map([
  ['media/ALecture_0607_23_cli-6f77cadab8e4.jpg', 'Экран в тёмном зале. На заставке написано «Кинопоказ и обсуждение „Молодость“».'],
  ['media/ALecture_0607_10-aed95ac412d5.jpg', 'За столом участница встречи жестикулирует во время разговора. На переднем плане видны слушатели.'],
  ['media/ALecture_0607_21_cli-509881034f51.jpg', 'Лектор у экрана. На слайде написано «Хороший архитектор проектирует не пространства, а сюжеты, которые будут в них происходить».'],
  ['media/ALecture_0607_9-5013cc391aae.jpg', 'Среди деревьев стоит тёмный павильон с узорчатым фасадом. Под карнизом светится ряд круглых окон.'],
  ['media/ALecture_0607_22-9c2fd70a7be6.jpg', 'Гости с бокалами стоят и сидят вокруг дивана. Один из гостей снимает встречу на телефон.'],
  ['media/ALecture_0607_19_cli-117be641a686.jpg', 'На белых подиумах выставлены цветные предметы дизайна. Справа стоит кресло с круглой красной спинкой.'],
  ['media/pinacoteca-di-brera-64bf6fa6564f.jpeg', 'Два яруса аркад окружают внутренний двор пинакотеки Брера. В центре двора на постаменте стоит статуя.'],
  ['media/1_1-28bcddfdcb71.webp', 'Обложка второго номера A–News. В старинном интерьере у стены сложены разноцветные ткани.'],
  ['media/AKIDS_Adult_Cover-a5188dc68d2d.jpg', 'Обложка A–Kids для родителей с рисунком разноцветного куба.'],
  ['media/AKIDS_Cover-2705e2de13ce.jpg', 'Детская сторона журнала A–Kids с нарисованной парой глаз.'],
  ['media/AH_Guide_Copenhagen-f4cddc4b7b4a.jpg', 'Гид A–House по Копенгагену и фестивалю 3daysofdesign 2023 года.'],
  ['media/AH_Guide_Paris-1-e0f475b0a25c.webp', 'Гид A–House по Парижской неделе дизайна 2023 года.'],
  ['media/AH_Guide_Venice_1_pa-b6d72a4666eb.jpg', 'Гид A–House по Венеции и биеннале 2023 года.']
]);

function dateMarkup(date) {
  if (!date) return '';
  return '<time datetime="' + escape(date) + '">' + escape(dateFormat.format(new Date(date + 'T12:00:00Z')).replace(/\s*г\.$/, '')) + '</time>';
}

function sizeImages(html) {
  return html.replace(/<img\b[^>]*>/g, tag => {
    const source = tag.match(/\bsrc="@@ROOT@@([^"]+)"/)?.[1];
    const image = imageInfo[source] || originalDimensions[source];
    const description = imageDescriptions.get(source);
    let result = description ? tag.replace('alt=""', 'alt="' + escape(description) + '"') : tag;
    if (image && !/\bwidth=/.test(result)) result = result.replace(/>$/, ' width="' + image.width + '" height="' + image.height + '">');
    return result;
  });
}

// Tilda sometimes linked a piece of punctuation separately from the name beside it.
function rejoinPublicationLinks(paragraph) {
  const namedDestinations = new Set();
  for (const [, href, label] of paragraph.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (/[\p{L}\p{N}]/u.test(label.replace(/<[^>]*>/g, ''))) namedDestinations.add(href);
  }
  const text = paragraph.replace(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\p{P}]+)<\/a>/gu,
    (tag, href, punctuation) => namedDestinations.has(href) ? punctuation : tag);

  // Adjacent parts of one label may also have been split across identical links.
  let opening = '';
  return text.replace(/<a\b[^>]*>|<\/a>((?:\s|&nbsp;)*)(<a\b[^>]*>)/gi, (tag, space, nextOpening) => {
    if (!nextOpening) {
      opening = tag;
      return tag;
    }
    const sameLink = nextOpening === opening;
    opening = nextOpening;
    return sameLink ? space : tag;
  });
}

// The saved feed has one editorial section per post. Keep its source links,
// captions, quotations, inline illustrations and consent-to-play video players.
function publicationBody(original, slug) {
  const section = original.match(/itemprop="articleBody"[^>]*>\s*<section>([\s\S]*?)<\/section>/);
  if (!section) throw new Error('Missing original article body in ' + slug);
  let body = section[1].trim()
    .replace(/\s(?:style|contenteditable|data-src)="[^"]*"/g, '')
    .replace(/<\/?span>/g, '')
    // The source editor sometimes gave the space next to a linked word its own link.
    .replace(/(<a href="[^"]+"(?: (?:target|rel)="[^"]*")*>)((?:\s|&nbsp;)*)([\s\S]*?)((?:\s|&nbsp;)*)<\/a>/gi,
      (_, tag, before, content, after) => before + (content ? tag + content + '</a>' : '') + after);
  if (!body.startsWith('<')) return '<p>' + rejoinPublicationLinks(body) + '</p>';
  body = body.replace(/^<div class="t-redactor__tte-view">([\s\S]*)<\/div>$/, '$1')
    .replace(/<div class="t-redactor__text">([\s\S]*?)<\/div>/g, (_, block) =>
      block.split(/(?:\s*<br\s*\/?>){2,}/gi).map(part => part.trim().replace(/^(?:<br\s*\/?>\s*)+|(?:\s*<br\s*\/?>)+$/gi, ''))
        .filter(Boolean).map(part => '<p>' + part + '</p>').join('\n'))
    .replaceAll('class="t-redactor__preface"', 'class="publication-preface"')
    .replaceAll('class="t-redactor__quote"', '')
    .replaceAll('class="t-redactor__video-container"', 'class="publication-video"');
  // This interview identifies each portrait in the paragraph directly after it.
  if (slug === 'tpost/047y7z7h91-iz-moskvi-2024-v-moskvu-2030') {
    body = body.replace(/(<figure>\s*<img\b[^>]*>)\s*<\/figure>\s*<p>([^<]+<br>[^<]+)<\/p>/g,
      '$1<figcaption>$2</figcaption></figure>');
  }
  body = body.replace(/<figure>\s*(<img\b[^>]*\bsrc="(@@ROOT@@media\/AH_Guide_[^"]+)"[^>]*>)\s*<\/figure>/g,
    '<figure><a class="publication-guide" href="$2">$1<span>Открыть гид в полном размере</span></a></figure>');
  return sizeImages(body.replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, rejoinPublicationLinks));
}

function publicationCover(original) {
  const wrapper = original.match(/<div id="feed-cover"[^>]*>\s*([\s\S]*?)\s*<\/div>\s*<div class="t-feed__post-popup__date-parts-wrapper/);
  if (!wrapper) return ''; // Two source posts have an empty video cover.
  let content = wrapper[1].replace(/ class="js-feed-post-image[^"]*"/g, '');
  // Imported posts contain their old pager. The reader builds one picker from the actual images.
  content = content.replace(/<div class="archive-gallery-controls">[\s\S]*?<\/div>/g, '');
  if (content.startsWith('<img')) content = content.replace('loading="lazy"', 'loading="eager"');
  return '<div class="publication-cover">' + sizeImages(content) + '</div>';
}

export function renderPublication(page, original) {
  const related = relatedReading.get(page.slug);
  const relatedDate = related?.published ? '<span class="publication-meta">' + dateMarkup(related.published) + '</span>' : '';
  const section = page.section ? '<span>' + escape(page.section) + '</span>' : '';
  const timestamps = [...original.matchAll(/<meta itemprop="date(?:Published|Modified)" content="[^"]+">/g)].map(([tag]) => tag).join('');
  return `<div class="home-page" id="allrecords">
    <!-- EDITORIAL HEADER -->
    <main id="site-content" class="home-editorial publication-reader" tabindex="-1">
      <article itemscope itemtype="https://schema.org/BlogPosting">
        ${timestamps}
        <header class="publication-heading">
          <div class="publication-meta">${dateMarkup(page.published)}${section}</div>
          <h1 itemprop="headline">${escape(page.title)}</h1>
        </header>
        ${publicationCover(original)}
        <div class="publication-body" itemprop="articleBody">${publicationBody(original, page.slug)}</div>
        ${related ? '<p class="publication-issue">' + relatedDate + '<a href="' + escape(related.href) + '">' + escape(related.title) + '</a></p>' : ''}
      </article>
    </main>
    <!-- FOOTER -->
  </div>`;
}

const pressBooksTitle = 'Книги A–Press';

export function renderPressNavigation(slug) {
  const archive = (slug === 'press' ? '' : '@@ROOT@@press/') + '#print-archive';
  const books = slug === 'press/books'
    ? '<span aria-current="page">' + pressBooksTitle + '</span>'
    : '<a href="@@ROOT@@press/books/">' + pressBooksTitle + '</a>';
  return `<nav class="press-page-links press-contents" aria-label="Разделы издательства">
    <a href="${archive}">Архив печатных номеров</a>${books}
  </nav>`;
}

function renderSectionBookmarks(entries) {
  const links = entries.map(([id, href, title]) =>
    '<a data-section-bookmark id="' + escape(id) + '" href="' + escape(href) + '">' + escape(title) + '</a>');
  return '<div class="section-bookmarks">' + links.join('') + '</div>';
}

export function renderPressBookmarks(newsHref) {
  return renderSectionBookmarks([
    ['online', newsHref, 'Читать журнал A–News'],
    ...['books', 'books-heading', 'editions', 'press-editions-title', 'rec2308376921']
      .map(id => [id, '@@ROOT@@press/books/', pressBooksTitle])
  ]);
}

export function renderHomeBookmarks(base) {
  const bookmarks = [
    ['partnership', 'partnership/', 'Сотрудничество'],
    ['partnership-heading', 'partnership/', 'Сотрудничество'],
    ['rec2309705331', 'partnership/#rec2309705331', 'Книги и газеты'],
    ['rec2309704211', 'partnership/#rec2309704211', 'Городские пространства'],
    ['home-books', 'press/books/', 'Книги A–Press'],
    ['home-periodicals', 'press/#periodicals', 'Газеты и журналы'],
    ['issue-a-sport', 'press/#a-sport-02', 'A–Sport № 2 «Движение»']
  ];
  return renderSectionBookmarks(bookmarks.map(([id, path, title]) => [id, base + path, title]));
}
