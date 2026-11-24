import { appendFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { typesetText } from './typography.mjs';
import { formatDocumentTables } from './legal-documents.mjs';
import { markDeferredBackgrounds } from './deferred-backgrounds.mjs';
import { loadImageDelivery } from './images.mjs';
import { eventDestination, renderCalendar, renderEventPage, routesWithEvents } from './calendar.mjs';
import { renderProgram, renderVenueProgram } from './program.mjs';
import { renderHomeProjects, renderProjectWorks } from './home-projects.mjs';
import { renderJobs } from './jobs.mjs';
import { archiveFragment, archiveFragmentStyles, collectArchive, renderArchiveCatalog, renderSubscriptionEntries } from './archive.mjs';
import { isInstitutionPage, renderInstitutionPage } from './institution-pages.mjs';
import { venues } from '../src/data/institution-pages.mjs';

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

function renderReportYear(year, label, edition) {
  const [heading, body] = year.records[edition];
  const items = year.entries.map(entry => '<li>' + entry.map(item => {
    if (item.copy) return item.copy;
    if (item.figure) return '<p class="report-stat"><strong>' + item.figure + '</strong> ' + item.label + '</p>';
    return '<figure>' + year.images[edition][item.photo] + '</figure>';
  }).join('\n') + '</li>').join('\n');
  return `<details class="project-disclosure report-year" id="rec${heading}">
    <summary>${label}<span class="summary-note">${year.summary}</span></summary>
    <ol class="report-milestones" id="rec${body}">${items}</ol>
  </details>`;
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
  const status = friend ? 'Оплата пока недоступна.' : 'Приём заявок пока недоступен.';
  const legal = { ...settings, kind, termsLabel: friend ? 'Условия покупки' : 'Условия вступления' };
  const fields = {
    formAttributes: settings ? `method="post" action="${escape(settings.action)}"` : 'method="dialog"',
    availability: settings ? '' : `<p class="membership-status">${status}</p>`,
    agreements: settings ? agreementTemplate.replace(/\{\{(kind|terms|termsLabel|consent|consentText)\}\}/g, (_, key) => escape(legal[key])) : `<div class="membership-field">
      <p class="home-links"><a href="@@ROOT@@politic_a-com/" target="_blank" rel="noopener noreferrer" aria-describedby="${kind}-documents">Политика обработки персональных данных</a></p>
      <p id="${kind}-documents" class="membership-hint">Документ откроется в новой вкладке.</p>
    </div>`,
    submitState: settings ? '' : ' disabled'
  };
  return template.replace(/\{\{(formAttributes|availability|agreements|submitState)\}\}/g, (_, key) => fields[key]);
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

export async function build(base = siteBase(process.env.SITE_BASE), { outputDirectory, env = process.env } = {}) {
  const friend = membershipSettings('friend', env);
  const member = membershipSettings('member', env);
  const output = outputDirectory ?? file('dist');
  const delivery = await loadImageDelivery(projectRoot);
  const events = JSON.parse(await source('data/events.json'));
  const jobs = renderJobs(JSON.parse(await source('data/jobs.json')));
  const directions = JSON.parse(await source('data/projects.json'));
  const projectNavigation = directions.map(group =>
    `<a href="#${escape(group.id)}">${escape(group.name)}</a>`
  ).join('\n');
  const projects = directions.flatMap(group => group.projects);
  const houseProjects = projects.filter(project => project.venue);
  const leadStory = projects.find(project => project.overview === 'lead-edition').works[0];
  const printEditions = JSON.parse(await source('data/print-editions.json'));
  const printDirectory = file('media/print');
  const publicPrintFiles = new Set(printEditions.flatMap(issue => [issue.id + '.jpg', ...issue.files.map(item => item.name)]));
  const printIssues = await Promise.all(printEditions.map(async issue => {
    const files = await Promise.all(issue.files.map(async item => {
      const pdf = 'media/print/' + item.name;
      const bytes = (await stat(file(pdf))).size;
      const size = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(bytes / 1e6);
      return `<a href="@@ROOT@@${pdf}">${escape(item.label)}<span class="screen-reader-only"> · ${escape(issue.edition)} № 1</span> <small>PDF · ${size} МБ</small></a>`;
    }));
    return `<article id="${escape(issue.id)}" class="print-issue" aria-labelledby="${issue.seriesId}-heading">
      <img id="${issue.seriesId}" src="@@ROOT@@media/print/${issue.id}.jpg" alt="Обложка ${escape(issue.edition)} № 1" width="${issue.coverWidth}" height="780" loading="lazy">
      <div><p class="home-kicker">${escape(issue.edition)} № 1 · <time datetime="${issue.published}">${issue.published.slice(0, 4)}</time></p><h3 id="${issue.seriesId}-heading">${escape(issue.title)}<span class="screen-reader-only"> · ${escape(issue.edition)} № 1</span></h3><p>${escape(issue.description)}</p>
      <div class="press-page-links">${files.join('')}</div></div></article>`;
  }));
  const projectGroups = directions.map(group => {
    const {id, name, intro} = group;
    const rows = group.projects.map(project => `<li>
      <a class="home-project-row" href="${escape(project.href)}">
        <span class="home-project-name">${escape(project.name)}</span>
        <span class="home-project-description">${escape(project.description)}</span>
      </a>
    </li>`).join('\n');
    return `<section class="home-direction" id="${escape(id)}" tabindex="-1" aria-labelledby="title-${escape(id)}">
      <h3 id="title-${escape(id)}">${escape(name)}</h3>
      <div class="home-direction-copy">
        <p>${escape(intro)}</p>
      </div>
      <ul class="home-project-entries">${rows}</ul>
    </section>`;
  }).join('\n');
  const sportPhoto = (await source('partials/a-sport-print.html')).trim();
  const pages = JSON.parse(await source('routes.json'));
  const reportYears = JSON.parse(await source('data/report-years.json'));
  const archive = await collectArchive(pages, slug => source('pages/' + slug + '.html'));
  const routes = routesWithEvents([...pages, ...archive.topicRoutes], events);
  const program = renderProgram(events, await source('partials/program-feature.html'), base);
  const comfort = events.find(event => event.id === 'designing-comfort');
  const themeControl = await source('partials/theme-control.html');
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
  const digitalEditions = 'A–News, A–Kids, A–Sport и A–State';
  const friendEditions = `Полные выпуски ${digitalEditions} в PDF можно читать в приложении A–House.`;
  const friendExtras = 'В подписку также входят путеводители, подборки фильмов, ресторанов и спектаклей, дайджесты событий, трансляции с международных площадок и приглашения на выставки A–House.';
  const priceLabel = new Intl.NumberFormat('ru-RU').format(friendPrice) + ' ₽';
  const period = env.A_FRIEND_PERIOD?.trim();
  const orderForm = renderMembership('friend', friendTemplate, agreements, friend)
    .replace('{{friendUnitPrice}}', String(friendPrice)).replace('{{friendTotal}}', priceLabel);
  const applicationForm = renderMembership('member', memberTemplate, agreements, member)
    .replace('<!-- MEMBER PROGRAMS -->', () => memberPrograms);
  if (!outputDirectory) await rm(output, { recursive: true, force: true });
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
  await appendFile(path.join(output, 'styles/pages/archive-list.css'), '\n' + archiveFragmentStyles(archive) + '\n');
  const scripts = ['js/site.js', 'js/services.js', 'js/interactions.js'];
  function scriptsFor(page) {
    if (page.layout === 'project') return ['js/site.js', ...(page.slug === 'a_pass' ? ['js/services.js'] : ['js/project-stories.js'])];
    if (page.slug === 'home') return [...scripts, 'js/home.js', 'js/publication-archive.js', 'js/membership.js'];
    if (page.slug === 'member') return [...scripts, 'js/membership.js'];
    if (page.slug === 'calendar') return [...scripts, 'js/calendar.js'];
    if (page.event) return [...scripts, 'js/event.js'];
    return scripts;
  }
  const clubPages = new Set(['club', 'member']);
  const documents = new Set(['agreement', 'agreement2', 'rules', 'politic_a-com', 'mts_docs']);
  const features = new Set(['press', 'special_projects', '404']);
  const readerPage = page => page.slug === 'archive' || Boolean(page.archiveTopic) || archive.articles.has(page.slug);
  function pageStyles(page) {
    const {slug} = page;
    let style;
    if (isInstitutionPage(slug)) style = 'institution';
    else if (readerPage(page)) style = 'reader';
    else if (documents.has(slug) || features.has(slug)) style = 'publications';
    if (style) return ['styles/source/grid-3.0.css', 'styles/chrome.css', 'styles/pages/home.css', 'styles/pages/' + style + '.css'];
    return page.styles;
  }
  const cssFor = page => [...new Set([
    'media/fonts/ahouse-fonts.css',
    ...(page.slug==='moscow_business' ? ['media/fonts/ahouse-fonts-moscow.css'] : []),
    ...pageStyles(page), ...(clubPages.has(page.slug) ? ['styles/pages/home.css'] : []),
    ...(page.slug === 'home' || page.slug === 'archive' || page.archiveTopic ? ['styles/pages/archive-list.css'] : []),
    'styles/site.css', 'styles/interactions.css', 'styles/services.css', 'styles/typography.css', 'styles/theme.css'
  ])];
  const nearbyImages = 'js/nearby-images.js';
  const archiveEntry = 'js/archive-entry.js';
  const references = new Set([nearbyImages, archiveEntry, 'js/theme.js', ...routes.flatMap(scriptsFor), ...routes.flatMap(cssFor)]);
  const urls = new Map(await Promise.all([...references].map(async name => {
    const bytes = await readFile(path.join(output, name));
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0,12);
    return [name, base+name+'?v='+digest];
  })));
  for (const page of routes) {
    const location = page.slug === 'home' || page.slug === '404' ? output : path.join(output,page.slug);
    await mkdir(location,{ recursive:true });
    const home = page.slug === 'home';
    const programPage = page.slug === 'calendar' || Boolean(page.event);
    const template = page.event ? 'event' : page.archiveTopic ? 'archive' : page.slug;
    const pageContent = isInstitutionPage(page.slug) ? renderInstitutionPage(page.slug)
      : archive.articles.get(page.slug)?.html ?? await source('pages/' + template + '.html');
    const markup = pageContent.includes('<!-- EDITORIAL HEADER -->') ? pageContent :
      '<div id="allrecords" class="t-records home-page">\n<!-- EDITORIAL HEADER -->\n' + pageContent + '\n<!-- FOOTER -->\n</div>';
    const body = markup
      .replace('<!-- EDITORIAL HEADER -->', () => editorialHeader
        .replaceAll('{{wordmarkTag}}', home ? 'h1' : 'div')
        .replace('{{programCurrent}}', programPage ? ' aria-current="location"' : '')
        .replace('{{clubCurrent}}', clubPages.has(page.slug) ? ' aria-current="location"' : ''))
      .replace(/<!-- REPORT (\d{4}) -->/g, (_, year) => renderReportYear(reportYears[year], year, page.slug))
      .replaceAll('{{eventsLabel}}', 'События')
      .replaceAll('{{housesLabel}}', 'Дома и адреса')
      .replaceAll('{{projectsLabel}}', 'Все проекты')
      .replace(/\{\{venue\.(\w+)\.(\w+)\}\}/g, (_, name, field) => escape(venues[name][field]))
      .replace('<!-- FRIEND ORDER -->', () => orderForm)
      .replace('<!-- MEMBER FORM -->', () => applicationForm)
      .replace('<!-- PROGRAM FEATURE -->', () => program.feature)
      .replace('<!-- PROGRAM EVENTS -->', () => program.cards)
      .replace(/<!-- VENUE PROGRAM (\w+) -->/g, (_, key) => renderVenueProgram(events, venues[key].name, base))
      .replace(/<!-- HOUSE WORK (\w+) -->/g, (_, key) => renderProjectWorks(houseProjects.find(project => project.venue === key)))
      .replace('<!-- A-HOUSE JOBS -->', () => jobs)
      .replace('<!-- PROJECT NAVIGATION -->', () => projectNavigation)
      .replace(/<!-- PROJECTS (\w+) -->/g, (_, group) => renderHomeProjects(projects, events, group))
      .replace('{{leadStoryText}}', () => escape(leadStory.text))
      .replace('{{leadStoryHref}}', () => escape(leadStory.href))
      .replace('{{leadStoryTitle}}', () => escape(leadStory.title))
      .replace('<!-- PROJECT DIRECTIONS -->', () => projectGroups)
      .replace('<!-- A-SPORT PRINT -->', () => sportPhoto)
      .replace('<!-- PRINT ISSUES -->', () => printIssues.join('\n'))
      .replace('<!-- FRIEND EDITIONS -->', () => renderSubscriptionEntries(printEditions))
      .replace('{{featureHidden}}', program.featureIsCurrent ? '' : ' hidden')
      .replace('{{emptyHidden}}', program.hasEvents ? ' hidden' : '')
      .replace('<!-- EVENT CALENDAR -->', () => renderCalendar(events, base))
      .replace('<!-- EVENT PAGE -->', () => renderEventPage(page.event, base))
      .replaceAll('{{comfortURL}}', () => escape(eventDestination(comfort, base + 'calendar/')))
      .replace('{{comfortDate}}', () => escape(comfort.start.slice(5).split('-').reverse().join('.')))
      .replace('{{comfortTitle}}', () => escape(comfort.title))
      .replaceAll('{{friendEditions}}', friendEditions)
      .replaceAll('{{digitalEditions}}', digitalEditions)
      .replaceAll('{{friendExtras}}', friendExtras)
      .replace('{{friendPrice}}', () => period ? priceLabel + ' ' + escape(period) : priceLabel)
      .replace('<!-- FOOTER -->', () => homeFooterTemplate)
      .replace(/\{\{footer\.(\w+)\}\}/g, (_, name) => {
        if (!footerContent.has(name)) throw new Error('Missing shared footer content: ' + name);
        return footerContent.get(name);
      })
      .replaceAll('{{home}}', home ? '' : '@@ROOT@@')
      .replace('{{archiveHeading}}', () => page.archiveTopic ? escape(page.archiveTopic.title) : 'Архив публикаций')
      .replace('<!-- PUBLICATION CATALOG -->', () => renderArchiveCatalog(archive, base, page.archiveTopic, home));
    let themedBody;
    if (body.includes('<!-- THEME CONTROL -->')) themedBody = body.replace('<!-- THEME CONTROL -->', () => themeControl);
    else if (body.includes('</footer>')) themedBody = body.replace('</footer>', () => themeControl + '</footer>');
    else themedBody = body + '<footer class="theme-footer">' + themeControl + '</footer>';
    const pageBody = prepareConsentDocuments(themedBody.replaceAll('{{themeLabel}}', 'Тема сайта'));
    const typeset = typesetText(documents.has(page.slug) ? formatDocumentTables(pageBody) : pageBody);
    const contentBody = delivery.rewriteHTML(markDeferredBackgrounds(typeset), { base, slug: page.slug });
    const scriptTags = scriptsFor(page).map(name => '<script defer src="'+urls.get(name)+'"></script>').join('\n');
    const pageScripts = contentBody.includes(' data-load-on-approach')
      ? '<script src="' + urls.get(nearbyImages) + '"></script>\n' + scriptTags
      : scriptTags;
    const values = {
      TITLE:escape(page.title), DESCRIPTION:escape(page.description), SLUG:escape(page.slug), THEME_SCRIPT:urls.get('js/theme.js'),
      ARCHIVE_ENTRY:page.slug === 'archive' || page.archiveTopic
        ? '<script src="' + urls.get(archiveEntry) + '" data-destination="' + escape(base + '#' + archiveFragment(page.archiveTopic)) + '"></script>'
        : '',
      FORM_ACTION:escape((home ? friend : page.slug === 'member' ? member : null)?.action.origin ?? "'none'"),
      STYLE:cssFor(page).map(name=>'<link rel="stylesheet" href="'+urls.get(name)+'">').join('\n'), SCRIPTS:pageScripts,
      FAVICON:page.icon?'<link rel="icon" href="'+base+escape(page.icon)+'">':'', BODY:contentBody
    };
    const content = shell.replace(/\{\{(TITLE|DESCRIPTION|SLUG|STYLE|SCRIPTS|FAVICON|BODY|FORM_ACTION|THEME_SCRIPT|ARCHIVE_ENTRY)\}\}/g,(_,key)=>values[key]).replaceAll('@@ROOT@@',base);
    await writeFile(path.join(location,page.slug==='404'?'404.html':'index.html'),content);
  }
  await writeFile(path.join(output,'.nojekyll'),'');
  console.log('Built '+routes.length+' HTML documents for '+base);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await build();
