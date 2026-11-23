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
const dateFormat = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const issueLinks = new Map([
  ['tpost/f0997i9441-anews-2', ['a-news', 'Газета A–News в каталоге A–Press']],
  ['tpost/svnul2ze71-pervii-vipusk-detskogo-zhurnala-akids-so', ['a-kids', 'Журнал A–Kids в каталоге A–Press']]
]);
const imageDescriptions = new Map([
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

// The saved feed has one editorial section per post. Keep its source links,
// captions, quotations, inline illustrations and consent-to-play video players.
function publicationBody(original, slug) {
  const section = original.match(/itemprop="articleBody"[^>]*>\s*<section>([\s\S]*?)<\/section>/);
  if (!section) throw new Error('Missing original article body in ' + slug);
  let body = section[1].trim()
    .replace(/\s(?:style|contenteditable|data-src)="[^"]*"/g, '')
    .replace(/<\/?span>/g, '');
  if (!body.startsWith('<')) return '<p>' + body + '</p>';
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
  return sizeImages(body);
}

function publicationCover(original) {
  const wrapper = original.match(/<div id="feed-cover"[^>]*>\s*([\s\S]*?)\s*<\/div>\s*<div class="t-feed__post-popup__date-parts-wrapper/);
  if (!wrapper) return ''; // Two source posts have an empty video cover.
  let content = wrapper[1].replace(/ class="js-feed-post-image[^"]*"/g, '');
  if (content.startsWith('<img')) content = content.replace('loading="lazy"', 'loading="eager"');
  return '<div class="publication-cover">' + sizeImages(content) + '</div>';
}

function renderPublication(page, original, topics) {
  const issue = issueLinks.get(page.slug);
  const topicLinks = topics.map(({slug, title}) => '<a href="@@ROOT@@' + escape(slug) + '/">' + escape(title) + '</a>');
  const timestamps = [...original.matchAll(/<meta itemprop="date(?:Published|Modified)" content="[^"]+">/g)].map(([tag]) => tag).join('');
  return `<div class="home-page" id="allrecords">
    <!-- EDITORIAL HEADER -->
    <main id="site-content" class="home-editorial publication-reader" tabindex="-1">
      <article itemscope itemtype="https://schema.org/BlogPosting">
        ${timestamps}
        <a class="publication-back" href="@@ROOT@@archive/">К архиву публикаций</a>
        <header class="publication-heading">
          <div class="publication-meta">${[dateMarkup(page.published), ...topicLinks].filter(Boolean).join(' ')}</div>
          <h1 itemprop="headline">${escape(page.title)}</h1>
        </header>
        ${publicationCover(original)}
        <div class="publication-body" itemprop="articleBody">${publicationBody(original, page.slug)}</div>
        ${issue ? '<p class="publication-issue"><a href="@@ROOT@@press/#' + issue[0] + '">' + escape(issue[1]) + '</a></p>' : ''}
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
    articles.set(page.slug, {page, html, tags:[...tags]});
  }
  const main = routes.find(page => page.slug === 'archive');
  const topicRoutes = [...topics.values()].map(topic => ({
    ...main, slug:topic.slug, archiveTopic:topic, title:topic.title + ' — Архив публикаций A–House'
  }));
  return {articles, topicRoutes};
}

export function renderArchiveEntries(archive, topic, base) {
  const slugs = topic ? topic.articles : [...archive.articles.keys()];
  return slugs.map(slug => {
    const {page,tags} = archive.articles.get(slug);
    const date = dateMarkup(page.published);
    return '<li>' + date + '<div><a href="' + escape(base + slug + '/') + '">' + escape(page.title) +
      '</a>' + (tags.length ? '<small>' + escape(tags.join(', ')) + '</small>' : '') + '</div></li>';
  }).join('\n');
}

export function renderArchiveTopics(archive, base, current) {
  const options = [{slug:'archive', title:'Все публикации'}, ...archive.topicRoutes.map(page => page.archiveTopic)
    .sort((a,b) => a.title.localeCompare(b.title,'ru'))];
  return '<nav class="archive-topics" aria-label="Рубрики архива">' + options.map(({slug,title}) =>
    '<a href="' + escape(base + slug + '/') + '"' + (slug === (current?.slug || 'archive') ? ' aria-current="page"' : '') + '>' + escape(title) + '</a>'
  ).join('') + '</nav>';
}
