import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesetText } from './typography.mjs';
import { formatDocumentTables } from './legal-documents.mjs';
import { markDeferredBackgrounds } from './deferred-backgrounds.mjs';
import { markExternalLinks } from './external-links.mjs';
import { loadImageDelivery } from './images.mjs';
import { eventDestination, renderCalendar, renderEventPage, routesWithEvents } from './calendar.mjs';
import { renderProgram, renderVenueProgram } from './program.mjs';
import { renderHomeProjects, renderProjectDirectory, renderProjectNavigation, renderProjectWorks } from './home-projects.mjs';
import { renderJobs } from './jobs.mjs';
import { renderHomeBookmarks, pdfMetadata, printArchiveFileNames, renderCurrentPrintIssues, renderFriendCovers, renderPressBookmarks, renderPressNavigation, renderPressBooks, renderPrintArchive, renderPrintFileLink, renderPrintRelease, renderPublication, renderSubscriptionEntries, subscriptionIssues } from './archive.mjs';
import { isInstitutionPage, renderInstitutionPage } from './institution-pages.mjs';
import { venues } from '../src/data/institution-pages.mjs';
import { clubPrograms } from '../src/data/club-programs.mjs';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const file = (...parts) => path.join(projectRoot, ...parts);

export function siteBase(value = '/a-house/') {
  if (!/^\/(?:[a-zA-Z0-9._-]+\/)*$/.test(value) || value.split('/').includes('..')) {
    throw new Error('SITE_BASE must be a root-relative directory ending in /');
  }
  return value;
}

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const source = name => readFile(file('src', name), 'utf8');

function standaloneDocument(html, base, assetURLs, externalLinksStyle) {
  const policy = [
    "default-src 'none'",
    "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:", "font-src 'self'", "media-src 'self'",
    "connect-src 'none'", "form-action 'none'", "base-uri 'none'",
  ].join('; ');
  const marked = markExternalLinks(html, base);
  const linkStyles = marked === html ? '' : '\n<link rel="stylesheet" href="' + assetURLs.get(externalLinksStyle) + '">';
  return marked.replace('<!-- STANDALONE POLICY -->', '<meta http-equiv="Content-Security-Policy" content="' + escape(policy) + '">' + linkStyles)
    .replace(/@@ROOT@@((?:js|styles|media\/fonts)\/[^"'\s?#]+)/g, (_, name) => assetURLs.get(name) ?? base + name)
    .replaceAll('@@ROOT@@', base);
}

export function formatSiteVersion(timestamp) {
  const instant = new Date(timestamp);
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(instant);
  const { day, month, year, hour, minute } = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `Версия от <time datetime="${instant.toISOString()}">${day} ${month} ${year}, ${hour}:${minute} мск</time>`;
}

function siteVersion() {
  const result = spawnSync('git', ['show', '-s', '--format=%cI', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' });
  if (result.status === 0) return formatSiteVersion(result.stdout.trim());
  if (process.env.GITHUB_ACTIONS === 'true') throw new Error('The published site needs the date of the Git revision.');
  return 'Локальная сборка';
}

export function membershipSettings(kind, env = process.env) {
  if (kind !== 'friend' && kind !== 'member') throw new Error('Unknown membership form: ' + kind);
  const prefix = kind === 'friend' ? 'A_FRIEND_' : 'A_MEMBER_';
  const actionKey = prefix + (kind === 'friend' ? 'ORDER_URL' : 'APPLICATION_URL');
  const keys = [actionKey, prefix + 'TERMS_URL', prefix + 'CONSENT_URL', prefix + 'CONSENT_TEXT'];
  if (kind === 'friend') keys.push('A_FRIEND_PERIOD');
  if (!keys.some(key => env[key]?.trim())) return null;
  const missing = keys.filter(key => !env[key]?.trim());
  if (missing.length) {
    console.warn('The ' + kind + ' form stays closed. Missing ' + missing.join(', '));
    return null;
  }

  function publicURL(key) {
    const url = URL.canParse(env[key]) ? new URL(env[key]) : null;
    if (!url || url.protocol !== 'https:' || url.username || url.password) {
      throw new Error(key + ' must be a public HTTPS URL without embedded credentials');
    }
    return url;
  }

  const action = publicURL(actionKey);
  if (action.hash) throw new Error(actionKey + ' must point to a POST handler without a fragment');
  return {
    action,
    terms: publicURL(prefix + 'TERMS_URL'),
    consent: publicURL(prefix + 'CONSENT_URL'),
    consentText: env[prefix + 'CONSENT_TEXT']
  };
}

function renderMembership(kind, template, agreementTemplate, settings) {
  const friend = kind === 'friend';
  const legal = { ...settings, kind, termsLabel: friend ? 'Условия покупки' : 'Условия вступления' };
  const agreements = settings ? agreementTemplate
    .replace(/\{\{(kind|terms|termsLabel|consent|consentText)\}\}/g, (_, key) => escape(legal[key])) : '';
  const policyNote = kind + '-policy-window';
  const fields = {
    formAttributes: settings ? `method="post" action="${escape(settings.action)}"` : 'method="dialog"',
    formNotice: settings ? '' : '<p class="membership-status">Приём заявок пока закрыт.</p>',
    formPolicy: friend && !settings ? '' : `<p class="membership-policy"><a href="@@ROOT@@politic_a-com/" target="_blank" rel="noopener noreferrer" aria-describedby="${policyNote}">Политика обработки персональных данных</a> <span id="${policyNote}">В&nbsp;новой вкладке</span></p>`,
    agreements,
    submitState: settings ? '' : ' disabled'
  };
  return template.replace(/\{\{(formAttributes|formNotice|formPolicy|agreements|submitState)\}\}/g, (_, key) => fields[key]);
}

function consentLink(link, hintId) {
  const tokens = { rel: [], 'aria-describedby': [] };
  const attributes = link.slice(0, -1).replace(/\s+(target|rel|aria-describedby)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (_, name, doubleQuoted, singleQuoted, unquoted) => {
      const list = tokens[name.toLowerCase()];
      if (list) {
        const value = doubleQuoted ?? singleQuoted ?? unquoted;
        list.push(...value.split(/\s+/).filter(Boolean));
      }
      return '';
    });
  tokens.rel.push('noopener', 'noreferrer');
  tokens['aria-describedby'].push(hintId);
  const metadata = Object.entries(tokens).map(([name, list]) => {
    const value = [...new Set(list)].join(' ').replaceAll('"', '&quot;');
    return ` ${name}="${value}"`;
  }).join('');
  return `${attributes} target="_blank"${metadata}>`;
}

function prepareConsentDocuments(html) {
  let formNumber = 0;
  return html.replace(/<form\b[^>]*\bdata-service-form\b[^>]*>[\s\S]*?<\/form>/gi, form => {
    const hintId = `service-documents-${++formNumber}`;
    let needsHint = true;
    return form.replace(/<label\b[^>]*\bt-checkbox__control\b[^>]*>[\s\S]*?<\/label>/gi, label => {
      if (!/<a\s[^>]*\bhref=/i.test(label)) return label;
      const hint = needsHint ? `<p class="services-hint" id="${hintId}">Документы открываются в новой вкладке.</p>` : '';
      needsHint = false;
      // The demo clears entered data on pagehide. Reading a consent document
      // must leave the original form open, including when JavaScript is off.
      return hint + label.replace(/<a\s[^>]*\bhref=[^>]*>/gi, link => consentLink(link, hintId));
    });
  });
}

export async function readEventCatalog() {
  const [entries, programme] = await Promise.all(['data/events.json', 'data/mmoma-2026.json'].map(async name =>
    JSON.parse(await source(name))));
  const museumEvents = programme.events.map(event => ({
    ...programme.defaults, ...event, end: event.start,
    links: [...(event.links || []), ...programme.defaults.links]
  }));
  return [...entries, ...museumEvents].map(event => {
    if (!event.venueId) return event;
    const venue = venues[event.venueId];
    if (!venue) throw new Error('Unknown venue ' + event.venueId + ' for event ' + event.id);
    return { ...event, venue: venue.name, venueMap: venue.map };
  });
}

export async function build(base = siteBase(process.env.SITE_BASE), { outputDirectory, env = process.env } = {}) {
  const versionLabel = siteVersion();
  const friend = membershipSettings('friend', env);
  const member = membershipSettings('member', env);
  const output = outputDirectory ?? file('dist');
  const delivery = await loadImageDelivery(projectRoot);
  const events = await readEventCatalog();
  const jobs = renderJobs(JSON.parse(await source('data/jobs.json')));
  const directions = JSON.parse(await source('data/projects.json'));
  const projectNavigation = renderProjectNavigation(directions);
  const projects = directions.flatMap(group => group.projects);
  const houseProjects = projects.filter(project => project.venue);
  const printEditions = JSON.parse(await source('data/print-editions.json'));
  const printReleases = printEditions.filter(series => series.printRelease)
    .sort((a, b) => b.printRelease.availableFrom.localeCompare(a.printRelease.availableFrom))
    .map(renderPrintRelease);
  const homePrintRelease = printReleases[0];
  const currentPrintIssues = subscriptionIssues(printEditions);
  const pressBooks = JSON.parse(await source('data/press-books.json'));
  const printDirectory = file('media/print');
  const publicPrintFiles = printArchiveFileNames(printEditions);
  const printArchive = await renderPrintArchive(printEditions, async name => (await stat(path.join(printDirectory, name))).size);
  const mediaKitPath = 'media/press/a-press-media-kit.pdf';
  const pressInterviewPath = 'media/press/a-news-01-daria-belyakova.pdf';
  const [mediaKit, pressInterview] = await Promise.all([mediaKitPath, pressInterviewPath].map(name => stat(file(name))));
  const projectGroups = renderProjectDirectory(directions);
  const pages = JSON.parse(await source('routes.json'));
  const routes = routesWithEvents(pages, events);
  const aBuild = pages.find(page => page.slug === 'press/a-build');
  const aBuildPeriodical = {
    name: 'Газета ' + aBuild.pressIssue.edition,
    href: '@@ROOT@@' + aBuild.slug + '/',
    overview: 'editions',
    works: [{ title: aBuild.pressIssue.catalogueTitle, text: aBuild.description }]
  };
  const periodicals = projects.flatMap(project => project.href === '@@ROOT@@press/#a-state'
    ? [project, aBuildPeriodical] : [project]);
  const homeEvents = events.filter(event => event.home !== false);
  const program = renderProgram(homeEvents, await source('partials/program-feature.html'), base);
  const comfort = events.find(event => event.id === 'designing-comfort');
  const themeControl = await source('partials/theme-control.html');
  const menuTheme = themeControl.replaceAll('{{themeId}}', 'menu-theme');
  const footerTheme = themeControl.replaceAll('{{themeId}}', 'site-theme');
  const [shell, editorialHeader, footerTemplate, homeFooterTemplate, memberPrograms, friendTemplate, memberTemplate, agreements] = await Promise.all([
    'layout.html', 'partials/editorial-header.html', 'partials/footer.html',
    'partials/home-footer.html', 'partials/member-programs.html', 'partials/friend-order.html',
    'partials/member-application.html', 'partials/membership-agreements.html'
  ].map(source));
  const footerContent = new Map();
  for (const [, name, content] of footerTemplate.matchAll(/<!-- footer:(\w+) -->([\s\S]*?)<!-- \/footer -->/g)) {
    footerContent.set(name, content);
  }
  const friendPrice = 12000;
  const digitalEditions = new Intl.ListFormat('ru').format(printEditions.filter(issue => issue.latest).map(issue => issue.edition));
  const friendEditions = `${digitalEditions} доступны в приложении A–House.`;
  const friendExtras = 'В подписку также входят путеводители, подборки фильмов, ресторанов и спектаклей, дайджесты событий, трансляции с международных площадок и приглашения на выставки A–House.';
  const friendAction = friend ? 'Оформить подписку A–Friend' : 'Условия подписки A–Friend';
  const priceLabel = new Intl.NumberFormat('ru-RU').format(friendPrice) + ' ₽';
  const period = env.A_FRIEND_PERIOD?.trim() || 'за год';
  const orderForm = renderMembership('friend', friendTemplate, agreements, friend)
    .replace('{{friendUnitPrice}}', String(friendPrice)).replace('{{friendTotal}}', priceLabel);
  const programOptions = Object.entries(clubPrograms).map(([id, name]) =>
    `<label><input type="radio" name="offer" value="${id}" required aria-describedby="member-offer-error"><span>${escape(name)}</span></label>`);
  const applicationForm = renderMembership('member', memberTemplate, agreements, member)
    .replace('<!-- MEMBER PROGRAMS -->', () => memberPrograms.replace('<!-- CLUB PROGRAM OPTIONS -->', programOptions.join('\n  ')));
  if (!outputDirectory) await rm(output, { recursive: true, force: true, maxRetries: 2 });
  // A caller building an alternate variant must supply a new directory.
  await mkdir(output);
  await Promise.all([
    cp(file('media'), path.join(output, 'media'), {
      recursive: true,
      filter: source => {
        if (source.startsWith(printDirectory + path.sep)) return publicPrintFiles.has(path.relative(printDirectory, source));
        return !['README.md','provenance.json','.DS_Store'].includes(path.basename(source));
      }
    }),
    cp(file('src/js'), path.join(output, 'js'), { recursive: true })
  ]);
  async function styles(folder) {
    await mkdir(path.join(output,folder), { recursive: true });
    for (const item of await readdir(file('src',folder), { withFileTypes: true })) {
      const name = path.join(folder,item.name);
      if (item.isDirectory()) await styles(name);
      else await writeFile(path.join(output,name), delivery.rewriteCSS(await source(name), { base }).replaceAll('@@ROOT@@',base));
    }
  }
  await styles('styles');
  const scripts = ['js/site.js', 'js/services.js', 'js/interactions.js'];
  const scheduleScripts = new Set(['js/home.js', 'js/calendar.js']);
  const scheduleImport = './schedule-dates.js';
  const scheduleBytes = await readFile(path.join(output, 'js', scheduleImport));
  const scheduleDigest = createHash('sha256').update(scheduleBytes).digest('hex').slice(0,12);
  await Promise.all([...scheduleScripts].map(async name => {
    const target = path.join(output, name);
    const script = await readFile(target, 'utf8');
    await writeFile(target, script.replace(scheduleImport, scheduleImport + '?v=' + scheduleDigest));
  }));
  function scriptsFor(page) {
    if (page.layout === 'project') return ['js/site.js', ...(page.slug === 'a_pass' ? ['js/services.js'] : ['js/project-stories.js'])];
    if (page.slug === 'home') return [...scripts, 'js/home.js', 'js/press.js'];
    if (page.slug === 'member' || page.slug === 'a-friend') return [...scripts, 'js/membership.js'];
    if (page.slug === 'press') return [...scripts, 'js/press.js'];
    if (page.slug === 'calendar') return [...scripts, 'js/calendar.js'];
    if (page.event) return [...scripts, 'js/event.js'];
    return scripts;
  }
  const clubPages = new Set(['club', 'member']);
  const housePages = new Set(['residents', 'dompredprinimatelya']);
  const documents = new Set(['agreement', 'agreement2', 'rules', 'politic_a-com', 'mts_docs']);
  const pressPages = new Set(['press', 'press/archive', 'press/books', ...pages.filter(page => page.pressIssue).map(page => page.slug)]);
  const features = new Set(['special_projects', '404']);
  const readerPage = page => page.pressIssue || page.slug.startsWith('tpost/');
  function pageStyles(page) {
    const {slug} = page;
    let style;
    if (isInstitutionPage(slug)) style = 'institution';
    else if (readerPage(page)) style = 'reader';
    else if (documents.has(slug) || pressPages.has(slug) || features.has(slug)) style = 'publications';
    if (style) return ['styles/source/grid-3.0.css', 'styles/chrome.css', 'styles/pages/home.css', 'styles/pages/' + style + '.css'];
    return page.styles;
  }
  const externalLinksStyle = 'styles/external-links.css';
  const cssFor = page => [...new Set([
    'media/fonts/ahouse-fonts.css',
    ...pageStyles(page), ...(clubPages.has(page.slug) ? ['styles/pages/home.css'] : []),
    'styles/site.css', 'styles/interactions.css', 'styles/services.css', 'styles/typography.css', externalLinksStyle, 'styles/theme.css'
  ])];
  const nearbyImages = 'js/nearby-images.js';
  const editorialRoutes = routes.filter(page => page.layout !== 'standalone');
  const standalonePages = new Map(await Promise.all(routes.filter(page => page.layout === 'standalone')
    .map(async ({slug}) => [slug, await source('pages/' + slug + '.html')])));
  const standaloneAssets = [...standalonePages.values()].flatMap(html =>
    [...html.matchAll(/(?:src|href)="@@ROOT@@((?:js|styles|media\/fonts)\/[^"?#]+)"/g)].map(match => match[1]));
  const references = new Set([nearbyImages, 'js/theme.js', externalLinksStyle,
    ...editorialRoutes.flatMap(scriptsFor), ...editorialRoutes.flatMap(cssFor), ...standaloneAssets]);
  const urls = new Map(await Promise.all([...references].map(async name => {
    const bytes = await readFile(path.join(output, name));
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0,12);
    return [name, base+name+'?v='+digest];
  })));
  for (const page of routes) {
    const location = page.slug === 'home' || page.slug === '404' ? output : path.join(output,page.slug);
    await mkdir(location,{ recursive:true });
    const home = page.slug === 'home';
    if (standalonePages.has(page.slug)) {
      await writeFile(path.join(location, 'index.html'), standaloneDocument(standalonePages.get(page.slug), base, urls, externalLinksStyle));
      continue;
    }
    const programPage = page.slug === 'calendar' || Boolean(page.event);
    const template = page.event ? 'event' : page.slug;
    let pageContent = page.pressIssue ? ''
      : (isInstitutionPage(page.slug) ? renderInstitutionPage(page.slug) : await source('pages/' + template + '.html'));
    if (readerPage(page)) pageContent = renderPublication(page, pageContent);
    const markup = pageContent.includes('<!-- EDITORIAL HEADER -->') ? pageContent :
      '<div id="allrecords" class="t-records home-page">\n<!-- EDITORIAL HEADER -->\n' + pageContent + '\n<!-- FOOTER -->\n</div>';
    const body = markup
      .replace('<!-- EDITORIAL HEADER -->', () => editorialHeader
        .replaceAll('{{wordmarkTag}}', home ? 'h1' : 'div')
        .replace('{{wordmarkDestination}}', home ? 'data-home-brand="@@ROOT@@"' : 'href="@@ROOT@@" aria-label="A–House, на главную"')
        .replace('{{programCurrent}}', programPage ? ' aria-current="location"' : '')
        .replace('{{housesCurrent}}', housePages.has(page.slug) ? ' aria-current="location"' : '')
        .replace('{{pressCurrent}}', pressPages.has(page.slug) ? ' aria-current="' + (page.slug === 'press' ? 'page' : 'location') + '"' : '')
        .replace('{{clubCurrent}}', clubPages.has(page.slug) ? ' aria-current="location"' : '')
        .replace('{{friendCurrent}}', page.slug === 'a-friend' ? ' aria-current="page"' : '')
        .replace('{{partnershipCurrent}}', page.slug === 'partnership' ? ' aria-current="page"'
          : page.slug === 'special_projects' ? ' aria-current="location"' : ''))
      .replace('<!-- MENU THEME CONTROL -->', () => menuTheme)
      .replaceAll('{{eventsLabel}}', 'События')
      .replaceAll('{{housesLabel}}', 'Дома и адреса')
      .replaceAll('{{projectsLabel}}', 'Все проекты')
      .replace(/\{\{venue\.(\w+)\.(\w+)\}\}/g, (_, name, field) => escape(venues[name][field]))
      .replace('<!-- FRIEND ORDER -->', () => orderForm)
      .replace('<!-- MEMBER FORM -->', () => applicationForm)
      .replace('<!-- TODAY EVENTS -->', () => program.todayCards)
      .replace('<!-- PROGRAM FEATURE -->', () => program.feature)
      .replace('<!-- PROGRAM EVENTS -->', () => program.cards)
      .replace(/<!-- VENUE PROGRAM (\w+) -->/g, (_, key) => renderVenueProgram(home ? homeEvents : events, venues[key].name, base))
      .replace(/<!-- HOUSE WORK (\w+) -->/g, (_, key) => renderProjectWorks(houseProjects.find(project => project.venue === key)))
      .replace('<!-- A-HOUSE JOBS -->', () => jobs)
      .replace('<!-- PROJECT NAVIGATION -->', () => projectNavigation)
      .replace(/<!-- PROJECTS (\w+) -->/g, (_, group) => renderHomeProjects(projects, events, group))
      .replace('<!-- PRESS PRINT RELEASE -->', () => printReleases.map(release => release.press).join('\n'))
      .replace('<!-- CURRENT PRINT ISSUES -->', () => renderCurrentPrintIssues(currentPrintIssues))
      .replace('<!-- PRESS PERIODICALS -->', () => renderHomeProjects(periodicals, events, 'editions'))
      .replace('<!-- HOME PRINT RELEASE -->', () => homePrintRelease?.homeLink ?? '')
      .replace('<!-- HOME PRESS PREVIEW -->', () => homePrintRelease?.homePreview ?? '')
      .replace('<!-- FRIEND FEATURED COVERS -->', () => renderFriendCovers(currentPrintIssues))
      .replace('<!-- PRESS CONTENTS -->', () => renderPressNavigation(page.slug))
      .replace('<!-- PRESS BOOKMARKS -->', () => renderPressBookmarks(projects.find(project => project.overview === 'news').href, aBuild))
      .replace('<!-- PUBLISHER BOOKS -->', () => renderPressBooks(pressBooks))
      .replaceAll('{{friendAction}}', friendAction)
      .replace('<!-- PRESS MEDIA KIT -->', () => renderPrintFileLink('@@ROOT@@' + mediaKitPath, 'Медиакит A–Press', pdfMetadata(mediaKit.size)))
      .replace('<!-- PRESS INTERVIEW PDF -->', () => renderPrintFileLink('@@ROOT@@' + pressInterviewPath, 'Читать интервью', pdfMetadata(pressInterview.size) + ' · с. 24–25'))
      .replace('<!-- PROJECT DIRECTIONS -->', () => projectGroups)
      .replace('<!-- PRINT ISSUES -->', () => printArchive)
      .replace('<!-- FRIEND EDITIONS -->', () => renderSubscriptionEntries(printEditions))
      .replace('{{todayHidden}}', program.todayCards ? '' : ' hidden')
      .replace('{{featureHidden}}', program.featureIsCurrent ? '' : ' hidden')
      .replace('{{emptyHidden}}', program.hasEvents ? ' hidden' : '')
      .replace('<!-- EVENT CALENDAR -->', () => renderCalendar(events, base))
      .replace('<!-- EVENT PAGE -->', () => renderEventPage(page.event, base))
      .replaceAll('{{comfortURL}}', () => escape(eventDestination(comfort, base + 'calendar/')))
      .replace('{{comfortDate}}', () => escape(comfort.start.slice(5).split('-').reverse().join('.')))
      .replace('{{comfortTitle}}', () => escape(comfort.title))
      .replaceAll('{{friendEditions}}', friendEditions)
      .replaceAll('{{friendExtras}}', friendExtras)
      .replace('{{friendPrice}}', () => priceLabel + ' ' + escape(period))
      .replace('<!-- FOOTER -->', () => homeFooterTemplate)
      .replace(/\{\{footer\.(\w+)\}\}/g, (_, name) => {
        if (!footerContent.has(name)) throw new Error('Missing shared footer content: ' + name);
        return footerContent.get(name);
      })
      .replace('{{siteVersion}}', versionLabel)
      .replaceAll('{{home}}', home ? '' : '@@ROOT@@')
      .replace('<!-- HOME BOOKMARKS -->', () => renderHomeBookmarks(base, aBuild));
    let themedBody;
    if (body.includes('<!-- THEME CONTROL -->')) themedBody = body.replace('<!-- THEME CONTROL -->', () => footerTheme);
    else if (body.includes('</footer>')) themedBody = body.replace('</footer>', () => footerTheme + '</footer>');
    else themedBody = body + '<footer class="theme-footer">' + footerTheme + '</footer>';
    const pageBody = prepareConsentDocuments(themedBody);
    const typeset = typesetText(documents.has(page.slug) ? formatDocumentTables(pageBody) : pageBody);
    const contentBody = delivery.rewriteHTML(markDeferredBackgrounds(typeset), { base, slug: page.slug });
    const scriptTags = scriptsFor(page).map(name => {
      const loading = scheduleScripts.has(name) ? 'type="module"' : 'defer';
      return '<script ' + loading + ' src="' + urls.get(name) + '"></script>';
    }).join('\n');
    const pageScripts = contentBody.includes(' data-load-on-approach')
      ? '<script src="' + urls.get(nearbyImages) + '"></script>\n' + scriptTags
      : scriptTags;
    let share = '';
    if (page.shareImage) {
      const publicBase = new URL(base, env.SITE_ORIGIN || 'https://anton-gorokhovatsky.github.io');
      const pageURL = new URL(page.slug + '/', publicBase).href;
      const metadata = { type: 'website', title: page.title, description: page.description, url: pageURL,
        image: new URL(page.shareImage, publicBase).href };
      share = '<link rel="canonical" href="' + escape(pageURL) + '">\n  ' +
        Object.entries(metadata).map(([key, value]) => '<meta property="og:' + key + '" content="' + escape(value) + '">').join('\n  ');
    }
    const values = {
      SHARE:share, TITLE:escape(page.title), DESCRIPTION:escape(page.description), SLUG:escape(page.slug), THEME_SCRIPT:urls.get('js/theme.js'),
      REFERRER_POLICY:page.slug === 'member' && member ? 'strict-origin' : 'no-referrer',
      CONNECT_SOURCE:escape((page.slug === 'member' ? member : null)?.action.origin ?? "'none'"),
      FORM_ACTION:escape((page.slug === 'a-friend' ? friend : page.slug === 'member' ? member : null)?.action.origin ?? "'none'"),
      STYLE:cssFor(page).map(name=>'<link rel="stylesheet" href="'+urls.get(name)+'">').join('\n'), SCRIPTS:pageScripts,
      FAVICON:page.icon?'<link rel="icon" href="'+base+escape(page.icon)+'">':'', BODY:contentBody
    };
    const content = markExternalLinks(
      shell.replace(/\{\{(TITLE|DESCRIPTION|SHARE|SLUG|STYLE|SCRIPTS|FAVICON|BODY|REFERRER_POLICY|CONNECT_SOURCE|FORM_ACTION|THEME_SCRIPT)\}\}/g,(_,key)=>values[key]).replaceAll('@@ROOT@@',base),
      base
    );
    await writeFile(path.join(location,page.slug==='404'?'404.html':'index.html'),content);
  }
  await writeFile(path.join(output,'.nojekyll'),'');
  console.log('Built '+routes.length+' HTML documents for '+base);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await build();
