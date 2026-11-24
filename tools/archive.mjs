import { readFile } from 'node:fs/promises';

const imageInfo = JSON.parse(await readFile(new URL('./image-manifest.json', import.meta.url), 'utf8')).images;
// These two original JPEGs are served directly, outside the delivery manifest.
const originalDimensions = {
  'media/2023-10-17_200210-d98d7fee9957.jpg': {width: 1024, height: 1208},
  'media/2024-03-07_144932-6a3405f16f43.jpg': {width: 750, height: 453}
};
const tagLinks = /<a\b(?=[^>]*\bclass=["'][^"']*\bt-feed__post-popup__tag\b[^"']*["'])[^>]*>([\s\S]*?)<\/a>/gi;
const paths = new Map([
  ['Архитектура', 'architecture'], ['Выставки', 'exhibitions'], ['Дизайн', 'design'],
  ['События', 'events'], ['Трансляции', 'broadcasts']
]);
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

export async function renderPrintArchive(editions, getFileSize) {
  const navigation = editions.map(edition =>
    `<a href="#${escape(edition.archiveAnchor || edition.seriesId)}">${escape(edition.edition)}</a>`
  ).join('');
  const groups = await Promise.all(editions.map(async edition => {
    const anchor = escape(edition.archiveAnchor || edition.seriesId);
    const cards = await Promise.all(edition.issues.map(async issue => {
      const id = escape(issue.id);
      const name = edition.edition + ' № ' + issue.number;
      const month = archiveMonth.format(new Date(issue.published.slice(0, 7) + '-01T12:00:00Z')).replace(/\s*г\.$/, '');
      const files = await Promise.all(issue.files.map(async file => {
        const mb = fileSizeFormat.format(await getFileSize(file.name) / 1e6);
        return renderPrintFileLink('@@ROOT@@media/print/' + file.name, file.label, 'PDF · ' + mb + ' МБ', name);
      }));
      return `<article id="${id}" class="print-issue" aria-labelledby="${id}-title">
        <img src="@@ROOT@@media/print/${id}.jpg" alt="Обложка ${escape(name)}" width="${issue.coverWidth}" height="${issue.coverHeight || 780}" loading="lazy" decoding="async">
        <div><p class="home-kicker">№ ${issue.number} · <time datetime="${escape(issue.published)}">${escape(month)}</time></p>
        <h4 id="${id}-title">${escape(issue.title)}<span class="screen-reader-only"> · ${escape(name)}</span></h4>
        <p>${escape(issue.description)}</p><div class="press-page-links">${files.join('')}</div></div></article>`;
    }));
    return `<section id="${anchor}" class="print-series" aria-labelledby="${anchor}-heading">
      <h3 id="${anchor}-heading">${escape(edition.edition)}</h3>
      ${edition.archiveNote ? '<p>' + escape(edition.archiveNote) + '</p>' : ''}
      <div class="print-issues">${cards.join('\n')}</div>
    </section>`;
  }));
  return `<nav class="press-page-links print-series-nav" aria-label="Издания в архиве">${navigation}</nav>${groups.join('\n')}`;
}

export function renderCurrentPrintIssues(issues, projects) {
  const current = issues.filter(issue => issue.latest)
    .sort((a, b) => b.latest.published.localeCompare(a.latest.published))[0];
  const { edition, latest } = current;
  const regular = { ...latest, title: `${edition} № ${latest.number} ${latest.topic}` };
  const special = projects.filter(project => project.specialIssue).map(project => project.specialIssue)
    .sort((a, b) => b.published.localeCompare(a.published))[0];
  return [regular, special].filter(Boolean).sort((a, b) => b.published.localeCompare(a.published)).map((issue, index) => {
    const { cover } = issue;
    const title = escape(issue.title).replace(/\p{L}+(?:\u00ad\p{L}+)+»?/gu, '<span class="wrap-group">$&</span>');
    const subscriberIssue = issue === regular;
    const more = issue.announcement ? ` <a href="${escape(issue.announcement)}">О выпуске в Telegram</a>` : '';
    const articleLink = issue.article
      ? `<div class="home-links"><a href="${escape(issue.article.href)}">${escape(issue.article.title)}</a></div>`
      : '';
    return `<article class="home-issue ${index === 0 ? 'home-current-issue' : 'home-companion-issue'} editorial-pair">
      ${cover ? `<figure class="home-issue-cover"><img src="@@ROOT@@${escape(cover.src)}" width="${cover.width}" height="${cover.height}" alt="${escape(cover.alt)}" loading="lazy"></figure>` : ''}
      <div class="home-issue-copy">
        <div class="home-issue-title"><p class="home-kicker">${subscriberIssue ? 'Свежий номер' : 'Спецвыпуск'} · ${dateMarkup(issue.published)}</p><h5>${title}</h5></div>
        <div class="home-issue-story">${issue.description ? '<p>' + escape(issue.description) + more + '</p>' : ''}${articleLink}</div>
      </div>
    </article>`;
  }).join('\n');
}

export function renderSubscriptionEntries(issues) {
  return issues.filter(issue => issue.latest).map(issue => `<div id="${escape(issue.latest.anchor)}" class="friend-edition" tabindex="-1">
    <a class="friend-archive-return" href="@@ROOT@@press/#${escape(issue.seriesId)}">К архиву ${escape(issue.edition)}</a>
    <p class="home-kicker">В подписке — ${escape(issue.edition)} № ${escape(issue.latest.number)} ${escape(issue.latest.topic)}</p>
  </div>`).join('\n');
}

export function renderPressBooks(books, heading) {
  return books.map(({title, subtitle, description, cover, href, linkLabel, metadata}) => `<article class="press-book">
    <img src="@@ROOT@@${escape(cover.src)}" width="${cover.width}" height="${cover.height}" alt="${escape(cover.alt)}" loading="lazy" decoding="async">
    <div><${heading} class="press-book-title">${escape(title)}</${heading}>
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

function renderPublication(page, original, topics) {
  const related = relatedReading.get(page.slug);
  const relatedDate = related?.published ? '<span class="publication-meta">' + dateMarkup(related.published) + '</span>' : '';
  const topicLinks = topics.map(topic => '<a href="@@ROOT@@' + escape(topic.slug) + '/">' + escape(topic.title) + '</a>');
  const timestamps = [...original.matchAll(/<meta itemprop="date(?:Published|Modified)" content="[^"]+">/g)].map(([tag]) => tag).join('');
  return `<div class="home-page" id="allrecords">
    <!-- EDITORIAL HEADER -->
    <main id="site-content" class="home-editorial publication-reader" tabindex="-1">
      <article itemscope itemtype="https://schema.org/BlogPosting">
        ${timestamps}
        <a class="publication-back" href="@@ROOT@@archive/">В архив сайта A–House</a>
        <header class="publication-heading">
          <div class="publication-meta">${[dateMarkup(page.published), ...topicLinks].filter(Boolean).join(' ')}</div>
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

export async function collectArchive(routes, readArticle) {
  const articles = new Map();
  const topics = new Map();
  const source = routes.filter(page => page.slug.startsWith('tpost/'))
    .sort((a,b) => (b.published || '').localeCompare(a.published || '') || a.title.localeCompare(b.title,'ru'));
  const originals = await Promise.all(source.map(page => readArticle(page.slug)));
  for (const [index, page] of source.entries()) {
    const tags = new Set();
    const articleTopics = [];
    for (const [,contents] of originals[index].matchAll(tagLinks)) {
      const title = contents.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ').replaceAll('&amp;', '&').trim();
      if (!title || tags.has(title)) continue;
      const directory = paths.get(title) || title.toLocaleLowerCase('ru').normalize('NFC')
        .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
      if (!directory) continue;
      const slug = 'archive/' + directory;
      const topic = topics.get(slug) || {title, slug, articles:[]};
      if (topic.title !== title) throw new Error('Two archive topics share ' + slug);
      topic.articles.push(page.slug);
      tags.add(title);
      articleTopics.push(topic);
      topics.set(slug, topic);
    }
    const html = renderPublication(page, originals[index], articleTopics);
    articles.set(page.slug, {page, html, topics:articleTopics});
  }
  const main = routes.find(page => page.slug === 'archive');
  const topicRoutes = [...topics.values()].map(topic => ({
    ...main, slug:topic.slug, archiveTopic:topic, title:topic.title + ' — Архив сайта A–House'
  }));
  return {articles, topicRoutes};
}

function topicKey(topic) {
  return topic.slug.slice('archive/'.length);
}

export function renderMovedPublicationLinks(archive, base) {
  const bookmarks = [
    ['publications', 'archive/', 'Архив сайта A–House'],
    ['publication-archive', 'archive/', 'Архив сайта A–House'],
    ['archive-heading', 'archive/', 'Архив сайта A–House'],
    ['issue-a-sport', 'press/#a-sport-02', 'A–Sport № 2 «Движение»'],
    ...archive.topicRoutes.map(({archiveTopic: topic}) =>
      ['publication-archive-' + topicKey(topic), topic.slug + '/', topic.title])
  ];
  const links = bookmarks.map(([id, path, title]) =>
    `<a id="${escape(id)}" href="${escape(base + path)}">${escape(title)}</a>`);
  return '<div class="home-bookmarks">' + links.join('') + '</div>';
}

function renderArchiveEntries(archive, topic, base) {
  const slugs = topic ? topic.articles : [...archive.articles.keys()];
  return slugs.map(slug => {
    const {page,topics} = archive.articles.get(slug);
    const date = dateMarkup(page.published);
    const keys = topics.map(topicKey).join(' ');
    const labels = topics.map(item => item.title).join(', ');
    return '<li data-archive-topics="' + escape(keys) + '">' + date + '<div><a href="' + escape(base + slug + '/') + '">' +
      escape(page.title) + '</a>' + (labels ? '<small>' + escape(labels) + '</small>' : '') + '</div></li>';
  }).join('\n');
}

export function renderArchiveCatalog(archive, base, current) {
  const options = [null, ...archive.topicRoutes.map(page => page.archiveTopic).sort((a,b) => a.title.localeCompare(b.title,'ru'))];
  const links = options.map(topic => {
    const key = topic ? topicKey(topic) : '';
    const slug = topic?.slug || 'archive';
    const selected = topic?.slug === current?.slug ? ' aria-current="page"' : '';
    return '<a href="' + escape(base + slug + '/') + '" data-archive-topic="' + escape(key) + '"' + selected +
      '>' + escape(topic?.title || 'Все материалы') + '</a>';
  });
  return '<div class="publication-catalog"><nav class="archive-topics" aria-label="Рубрики архива">' + links.join('') + '</nav>' +
    '<ol class="publication-list" aria-label="Публикации">' + renderArchiveEntries(archive, current, base) + '</ol></div>';
}
