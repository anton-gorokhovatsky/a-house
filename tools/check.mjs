import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { formatSiteVersion, membershipSettings, projectRoot, readEventCatalog, siteBase } from './build.mjs';
import { eventDestination, routesWithEvents } from './calendar.mjs';
import { collectArchive, printArchiveFileNames } from './archive.mjs';
import { typesetText } from './typography.mjs';

const dist = path.resolve(process.argv[2] ?? path.join(projectRoot, 'dist'));
const base = siteBase(process.env.SITE_BASE);
const errors = [];

// Keep a real inline boundary and a form in the sample: plain-text checks miss
// misplaced characters on either side of an anchor and changes to form values.
const linkTag = '<a title="Вход в Дом" href="/visit/">';
const form = '<dialog><form><label>Вход в Дом <input value="№ 2"></label></form></dialog>';
const sample = '<p>В ' + linkTag + 'Доме</a> до <time>29</time> ноября 2026, 19:30. Билет — 4 000 ₽. Выпуск № 2.</p>' + form;
const typesetSample = '<p>В\u00a0' + linkTag + 'Доме</a> до\u00a0<time>29</time>\u00a0ноября\u00a02026, 19:30. Билет\u00a0— 4\u202f000\u00a0₽. Выпуск №\u202f2.</p>' + form;
if (typesetText(sample) !== typesetSample || typesetText('<p>(п. 2.4.1)</p>') !== '<p>(п.\u00a02.4.1)</p>') {
  errors.push('Typography must preserve inline markup, clause references and form values');
}
const countSample = '<p>19 <em>архитектурных</em> бюро и 10 экскурсий. 2 000 участников. № 7 о дизайне. См. п. 2 статьи 6.</p>';
const countExpected = '<p>19\u00a0<em>архитектурных</em> бюро и\u00a010\u00a0экскурсий. 2\u202f000\u00a0участников. №\u202f7 о\u00a0дизайне. См. п.\u00a02 статьи 6.</p>';
if (typesetText(countSample) !== countExpected) {
  errors.push('A count must stay with its noun or first adjective, including across markup');
}
const role = '<p>Сооснователь и генеральный директор 12 <em>STOREEZ</em>, но под другим названием.</p>';
const formattedRole = '<p>Сооснователь и\u00a0генеральный директор 12\u00a0<em>STOREEZ</em>, но\u00a0под\u00a0другим названием.</p>';
if (typesetText(role) !== formattedRole) {
  errors.push('Keep 12 STOREEZ and short connectives together across inline tags');
}
const company = '<p>Правила ООО «А-КОММЬЮНИКЕЙШНС». Следующий абзац.</p>';
const formattedCompany = '<p>Правила ООО <span class="legal-name"><span>«А-КОМ</span>&shy;МЬЮ&shy;НИ&shy;КЕЙШНС».</span> Следующий абзац.</p>';
if (typesetText(company) !== formattedCompany) {
  errors.push('Punctuation following the company name belongs to the same wrapping group');
}
if (typesetText('<p>на стройплощадки</p>') !== '<p>на\u00a0строй\u00adплощадки</p>') {
  errors.push('Narrow screens need a natural break inside стройплощадки');
}
const longHeading = '<h2>Издательство</h2><h2>Форматы партнёрства</h2><h1>Назад в метабудущее</h1><p>партнёрство</p>';
const headingBreaks = '<h2>Изда\u00adтель\u00adство</h2><h2>Форматы <span class="wrap-group">партнёр\u00adства</span></h2><h1>Назад в\u00a0мета\u00adбудущее</h1><p>партнёрство</p>';
if (typesetText(longHeading) !== headingBreaks) {
  errors.push('Long titles need discretionary hyphens; prose keeps its original words');
}

const reference = '<a href="/rules/">Правила</a>';
const annotated = '<u>примечание</u>';
const richTextLinks = '<p><u>' + reference + '</u>,' + linkTag + '<u> Дом</u></a>. ' + annotated + '</p>';
if (typesetText(richTextLinks) !== '<p>' + reference + ', ' + linkTag + 'Дом</a>. ' + annotated + '</p>') {
  errors.push('Each imported link must have one underline confined to its label, preserving separate annotations');
}

const files = new Set();
async function inventory(directory) {
  for (const file of await readdir(path.join(dist,directory),{withFileTypes:true})) {
    const name=path.posix.join(directory,file.name);
    if (file.isDirectory()) await inventory(name);
    else files.add(name);
  }
}
await inventory('');
const printEditions = JSON.parse(await readFile(path.join(projectRoot, 'src/data/print-editions.json'), 'utf8'));
const allowedPrint = printArchiveFileNames(printEditions);
for (const file of files) {
  if (file.startsWith('media/print/') && !allowedPrint.has(file.slice('media/print/'.length))) errors.push('Unlisted print archive file: ' + file);
}
const [pages, events] = await Promise.all([
  readFile(path.join(projectRoot, 'src/routes.json'), 'utf8').then(JSON.parse),
  readEventCatalog()
]);
const archive = await collectArchive(pages, slug => readFile(path.join(projectRoot, 'src/pages', slug + '.html'), 'utf8'));
const routes = routesWithEvents([...pages, ...archive.topicRoutes], events);
const membershipPages = new Map([
  ['index.html', { kind: 'friend', settings: membershipSettings('friend') }],
  ['member/index.html', { kind: 'member', settings: membershipSettings('member') }]
]);
const expectedFiles = routes.map(({slug}) => slug==='home' ? 'index.html' : slug==='404' ? '404.html' : slug+'/index.html');
const standaloneFiles = new Set(routes.filter(page => page.layout === 'standalone').map(page => page.slug + '/index.html'));
const htmlFiles = [...files].filter(file => file.endsWith('.html'));
for (const file of expectedFiles) if (!files.has(file)) errors.push('Missing page ' + file);
const documents = new Map();
const checkedStandaloneStyles = new Set();
const routeTitles = new Map(routes.map(({slug, title}) => [base + slug + '/', title]));
function validateURL(source, value, asset) {
  value=value.trim().replaceAll('&amp;','&');
  if (!value || value[0]==='#' || value.startsWith('data:')) return;
  let url;
  try { url = new URL(value,'https://preview.invalid'+base+source); }
  catch { errors.push(source+' contains invalid URL '+value);return; }
  if (url.origin!=='https://preview.invalid') {
    if (asset) {
      errors.push(source+' loads an external asset '+value);
    }
    if (url.protocol==='javascript:') errors.push(source+' contains a javascript: URL');
    return;
  }
  if (!url.pathname.startsWith(base)) { errors.push(source+' points outside the site prefix: '+value); return; }
  let target=decodeURIComponent(url.pathname).slice(base.length);
  if (!target || target.endsWith('/')) target+='index.html';
  if (!files.has(target)) errors.push(source+' points to missing '+target);
}
for (const file of htmlFiles) {
  if (!files.has(file)) { errors.push('Missing page '+file);continue; }
  const source=await readFile(path.join(dist,file),'utf8');
  documents.set(file, source);
  if (!source.includes('<meta name="format-detection" content="telephone=no">')) {
    errors.push(file+' must keep company identifiers as text in iOS Safari');
  }
  if (!/<meta\b[^>]*\bname="robots"[^>]*\bcontent="[^"]*\bnoindex\b/i.test(source)) errors.push(file+' lacks noindex');
  if (!/<h1\b|role="heading" aria-level="1"/i.test(source)) errors.push(file+' lacks its page heading');
  if (source.includes('@@ROOT@@') || /\{\{[\w.]+\}\}/.test(source)) errors.push(file+' has an unresolved template');
  if (source.includes('#nbsp;')) errors.push(file+' contains an unconverted Tilda space');
  if (file === 'calendar/index.html') {
    for (const event of events) {
      const destination = eventDestination(event, base + 'calendar/').replaceAll('&', '&amp;');
      if (!source.includes('id="' + event.id + '-title"><a href="' + destination + '"')) {
        errors.push('The calendar title for ' + event.id + ' must open its event');
      }
    }
  }
  const topic = archive.topicRoutes.find(page => page.slug + '/index.html' === file)?.archiveTopic;
  if (topic || file === 'archive/index.html') {
    const articles = [...source.matchAll(/<li data-archive-topics="[^"]*">\s*(?:<time\b[^>]*>[\s\S]*?<\/time>\s*)?<div><a href="([^"]+)"/g)].map(([, url]) => url);
    const expected = (topic ? topic.articles : [...archive.articles.keys()]).map(slug => base + slug + '/');
    if (JSON.stringify(articles) !== JSON.stringify(expected)) errors.push(file + ' has an incorrect selection of publications');
  }
  if (file === 'index.html' && (source.includes('class="publication-catalog"') || source.includes('home-archived-issue'))) {
    errors.push('The media overview must keep site articles and archived print issues in their own catalogues');
  }
  const head = source.slice(0, source.indexOf('</head>'));
  const standalone = standaloneFiles.has(file);
  if (standalone) {
    if (!head.includes('http-equiv="Content-Security-Policy"') || !head.includes("connect-src 'none'; form-action 'none'")) {
      errors.push(file + ' must keep the standalone page separate from live integrations');
    }
    if (!head.includes("script-src 'self'") || !head.includes("font-src 'self'") || /tildacdn\.|cdn\.jsdelivr\./i.test(head)) {
      errors.push(file + ' must load its own scripts, styles and fonts');
    }
  } else {
    const styles = [...head.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)];
    const themeLoader = [...head.matchAll(/<script src="[^"]*\/js\/theme\.js(?:\?[^"]*)?"><\/script>/g)];
    if (themeLoader.length !== 1 || !styles.length || themeLoader[0].index > styles[0].index ||
        !styles.at(-1)[1].startsWith(base + 'styles/theme.css?')) {
      errors.push(file + ' must restore the saved theme before styles and apply the shared palette last');
    }
    for (const [tag, id] of [['nav', 'menu-theme'], ['footer', 'site-theme']]) {
      const region = source.match(new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*?</' + tag + '>'))?.[0];
      if (!region?.includes('id="' + id + '" data-site-theme')) {
        errors.push(file + ' is missing its theme choices in the ' + tag);
      }
    }
  }
  // The House renovation announcement also returns HTTP 200. A consent link
  // labelled as a privacy policy must lead to the published policy itself.
  for (const [label] of source.matchAll(/<label\b[^>]*\bt-checkbox__control\b[^>]*>[\s\S]*?<\/label>/gi)) {
    for (const [, , href, contents] of label.matchAll(/<a\b[^>]*?\shref=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
      const title = routeTitles.get(href);
      if (title && /политик/iu.test(contents.replace(/<[^>]+>/g, '')) && !/политик/iu.test(title)) {
        errors.push(file + ' labels ' + href + ' as a privacy policy, but its page is «' + title + '»');
      }
    }
  }
  for (const tag of source.matchAll(/<(a|img|source|script|link|form|iframe|video|audio)\b[^>]*>/gi)) {
    const element=tag[1].toLowerCase();
    const attribute=element==='a' || element==='link' ? 'href' : 'src';
    const value=tag[0].match(new RegExp('\\s'+attribute+'\\s*=\\s*["\\x27]([^"\\x27]*)','i'))?.[1];
    const canonical = standalone && element === 'link' && /\brel="canonical"/.test(tag[0]);
    if (value!==undefined) validateURL(file,value,element!=='a' && !canonical);
    if (standalone && value?.startsWith(base) && element === 'link' && /\brel="stylesheet"/.test(tag[0])) {
      const stylesheet = value.slice(base.length).split('?')[0];
      if (files.has(stylesheet) && !checkedStandaloneStyles.has(stylesheet)) {
        checkedStandaloneStyles.add(stylesheet);
        const css = await readFile(path.join(dist, stylesheet), 'utf8');
        for (const ref of css.matchAll(/url\(\s*['"]?([^)'"]+)/g)) validateURL(stylesheet, ref[1], true);
      }
    }
    if (element==='a' && value===base+'404.html') errors.push(file+' links straight to the error page');
    if (element==='img' || element==='source') {
      const candidates=tag[0].match(/\bsrcset="([^"]+)"/i)?.[1];
      if (candidates) {
        for (const candidate of candidates.split(',')) validateURL(file,candidate.trim().split(/\s+/)[0],true);
      } else if (element==='source' && tag[0].includes('prefers-reduced-motion')) {
        errors.push(file+' is missing its reduced-motion picture');
      }
    }
    if (element==='script' && !value) errors.push(file+' contains an inline script');
    if (element === 'form') {
      const memberPage = membershipPages.get(file);
      const id = tag[0].match(/\sid="([^"]+)"/i)?.[1];
      const enabled = memberPage && id === memberPage.kind + '-form' && memberPage.settings;
      const method = tag[0].match(/\smethod="([^"]+)"/i)?.[1]?.toLowerCase();
      const action = tag[0].match(/\saction="([^"]*)"/i)?.[1]?.replaceAll('&amp;', '&');
      if (enabled ? method !== 'post' || action !== enabled.action.href : method !== 'dialog' || action !== undefined) {
        errors.push(file + ' has an unexpected form method or recipient');
      }
    }
  }
  if (/\son(?:click|submit|error|load|change)\s*=/i.test(source) || /data-tilda-formskey|formservices\[\]/i.test(source)) errors.push(file+' contains a live integration');
  const inlineStyleSource = source.replaceAll('&quot;', '"');
  for (const ref of inlineStyleSource.matchAll(/url\(\s*['"]?([^)'"]+)/g)) validateURL(file,ref[1],true);
}

// Bookmarks and partner programmes can open any HTML document directly.
const versionTag = [...documents.values()][0].match(/<p class="site-version">.*?<\/p>/)?.[0];
const timestamp = versionTag?.match(/<time datetime="([^"]+)">/)?.[1];
const localVersion = '<p class="site-version">Локальная сборка</p>';
if (timestamp && Number.isFinite(Date.parse(timestamp))) {
  const expected = typesetText('<p class="site-version">' + formatSiteVersion(timestamp) + '</p>');
  if (versionTag !== expected) errors.push('The visible site version must match its machine-readable date');
} else if (versionTag !== localVersion || process.env.GITHUB_ACTIONS === 'true') {
  errors.push('Missing dated site version');
}
if (!formatSiteVersion('2026-12-31T21:07:00Z').includes('1 января 2027, 00:07 мск')) {
  errors.push('Site versions must use the date and time in Moscow, including around midnight');
}
const documentsCitingOfficialSite = new Set(['politic_a-com/index.html', 'rules/index.html']);
const citedSite = 'https://ahouseproject.com/';
for (const [file, html] of documents) {
  if (standaloneFiles.has(file)) {
    if (!/<main\b[^>]*\bid="site-content"/i.test(html) ||
        !html.includes('class="feature-skip" href="#site-content"') ||
        /class="(?:site-header|home-footer)|data-record-type=|\bt396__artboard\b/i.test(html)) {
      errors.push(file + ' must render its own standalone content');
    }
    continue;
  }
  if (!html.includes(versionTag) || !html.includes('class="skip-content" href="#site-content"')) {
    errors.push(file + ' is missing the shared version or the skip link');
  }
  const main = html.match(/<main\b[^>]*\bid="site-content"[^>]*>[\s\S]*?<\/main>/i)?.[0];
  if (!main || !html.includes('class="site-header home-masthead"') || !html.includes('class="home-footer"') ||
      /\bclass="[^"]*\b(?:t-rec|t396__artboard)\b/.test(main)) {
    errors.push('Direct entry renders a legacy layout at ' + file);
  }
  const legalCopy = documentsCitingOfficialSite.has(file) && html.match(/<div\b[^>]*\bclass="document-copy"[^>]*>[\s\S]*?<\/article>/);
  for (const link of html.matchAll(/<a\b[^>]*?\shref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const [, href, label] = link;
    const address = new URL(href.replaceAll('&amp;', '&'), 'https://preview.invalid' + base + file);
    const inLegalCopy = legalCopy && link.index >= legalCopy.index && link.index < legalCopy.index + legalCopy[0].length;
    const exactCitation = inLegalCopy && label === citedSite && href === citedSite;
    if (inLegalCopy && (label.startsWith('https://ahouseproject.com') || label === '/') && !exactCitation) {
      errors.push(file + ' splits the cited site address or links it to a different URL');
    }
    if (/^(?:www\.)?ahouseproject\.com$/i.test(address.hostname) && !exactCitation) {
      errors.push(file + ' sends the visitor to the old A–House website: ' + address.href);
    }
    if (address.origin !== 'https://preview.invalid' || !address.pathname.startsWith(base)) continue;
    let target = decodeURIComponent(address.pathname.slice(base.length));
    if (!target || target.endsWith('/')) target += 'index.html';
    if (!documents.has(target)) continue;
    if (target !== file && address.hash) {
      const id = decodeURIComponent(address.hash.slice(1));
      if (!documents.get(target).includes('id="' + id + '"')) errors.push(file + ' links to missing #' + id + ' in ' + target);
    }
  }
}
for (const file of files) {
  if (!file.endsWith('.css')) continue;
  const css=await readFile(path.join(dist,file),'utf8');
  for (const ref of css.matchAll(/url\(\s*['"]?([^)'"]+)/g)) validateURL(file,ref[1],true);
}
const unprotected=[...files].filter(n=>n.endsWith('.html')&&!htmlFiles.includes(n));
if (unprotected.length) errors.push('Unexpected HTML: '+unprotected.join(', '));
if (errors.length) {
  const unique=[...new Set(errors)];
  console.error(unique.slice(0,35).join('\n'));
  throw new Error(unique.length+' site checks failed');
}
console.log('Verified '+htmlFiles.length+' direct editorial pages and their assets in '+files.size+' files for '+base);
