const tagLinks = /<a\b(?=[^>]*\bclass=["'][^"']*\bt-feed__post-popup__tag\b[^"']*["'])[^>]*>([\s\S]*?)<\/a>/gi;
const paths = new Map([
  ['Архитектура', 'architecture'], ['Выставки', 'exhibitions'], ['Дизайн', 'design'],
  ['События', 'events'], ['Трансляции', 'broadcasts']
]);
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

export async function collectArchive(routes, readArticle) {
  const articles = new Map();
  const topics = new Map();
  const source = routes.filter(page => page.slug.startsWith('tpost/'))
    .sort((a,b) => (b.published || '').localeCompare(a.published || '') || a.title.localeCompare(b.title,'ru'));
  const originals = await Promise.all(source.map(page => readArticle(page.slug)));
  for (const [index, page] of source.entries()) {
    const tags = new Set();
    const html = originals[index].replace(tagLinks, (link, contents) => {
      const title = contents.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ').replaceAll('&amp;', '&').trim();
      if (!title) return '';
      const directory = paths.get(title) || title.toLocaleLowerCase('ru').normalize('NFC')
        .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
      if (!directory) return contents;
      const slug = 'archive/' + directory;
      const topic = topics.get(slug) || {title, slug, articles:[]};
      if (topic.title !== title) throw new Error('Two archive topics share ' + slug);
      if (!tags.has(title)) {
        topic.articles.push(page.slug);
        tags.add(title);
      }
      topics.set(slug, topic);
      return link.replace(/\bhref=(["'])[^"']*\1/i, 'href="@@ROOT@@' + slug + '/"');
    });
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
    const date = page.published
      ? '<time datetime="' + escape(page.published) + '">' + escape(page.published.split('-').reverse().join('.')) + '</time>' : '';
    return '<li>' + date + '<div><a href="' + escape(base + slug + '/') + '">' + escape(page.title) +
      '</a>' + (tags.length ? '<small>' + escape(tags.join(', ')) + '</small>' : '') + '</div></li>';
  }).join('\n');
}

export function renderArchiveTopics(archive, base) {
  const links = [...archive.topicRoutes].sort((a,b) => a.archiveTopic.title.localeCompare(b.archiveTopic.title,'ru'))
    .map(page => '<a href="' + escape(base + page.slug + '/') + '">' + escape(page.archiveTopic.title) + '</a>');
  return links.length ? '<nav class="archive-topics" aria-label="Рубрики">' + links.join('') + '</nav>' : '';
}
