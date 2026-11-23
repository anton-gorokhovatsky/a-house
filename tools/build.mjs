import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keepProjectNames, typesetHomeText } from './typography.mjs';
import { markDeferredBackgrounds } from './deferred-backgrounds.mjs';
import { loadImageDelivery } from './images.mjs';
import { renderCalendar } from './calendar.mjs';
import { renderProgram } from './program.mjs';

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
    agreements: settings ? agreementTemplate.replace(/\{\{(kind|terms|termsLabel|consent|consentText)\}\}/g, (_, key) => escape(legal[key])) : '',
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
  const routes = JSON.parse(await source('routes.json'));
  const events = JSON.parse(await source('data/events.json'));
  const program = renderProgram(events, await source('partials/program-feature.html'), base);
  const themeControl = await source('partials/theme-control.html');
  const archive = routes.filter(page => page.slug.startsWith('tpost/'))
    .sort((a,b) => (b.published || '').localeCompare(a.published || '') || a.title.localeCompare(b.title,'ru'))
    .map(page => {
      const date=(page.published || '').split('-').reverse().join('.');
      return '<li><time datetime="'+escape(page.published || '')+'">'+date+'</time><div><a href="'+base+page.slug+'/">'+escape(page.title)+'</a><small>'+escape(page.section || '')+'</small></div></li>';
    }).join('\n');
  const [shell, header, editorialHeader, footerTemplate, homeFooterTemplate, memberPrograms, friendTemplate, memberTemplate, agreements] = await Promise.all([
    'layout.html', 'partials/header.html', 'partials/editorial-header.html', 'partials/footer.html',
    'partials/home-footer.html', 'partials/member-programs.html', 'partials/friend-order.html',
    'partials/member-application.html', 'partials/membership-agreements.html'
  ].map(source));
  const footerContent = new Map();
  const footer = footerTemplate.replace(/<!-- footer:(\w+) -->([\s\S]*?)<!-- \/footer -->/g, (_, name, content) => {
    footerContent.set(name, content);
    return content;
  });
  const homeFooter = homeFooterTemplate.replace(/\{\{footer\.(\w+)\}\}/g, (_, name) => {
    if (!footerContent.has(name)) throw new Error('Missing shared footer content: ' + name);
    return footerContent.get(name);
  });
  const friendPrice = 12000;
  const priceLabel = new Intl.NumberFormat('ru-RU').format(friendPrice) + ' ₽';
  const period = env.A_FRIEND_PERIOD?.trim();
  const orderForm = renderMembership('friend', friendTemplate, agreements, friend);
  const applicationForm = renderMembership('member', memberTemplate, agreements, member)
    .replace('<!-- MEMBER PROGRAMS -->', () => memberPrograms);
  if (!outputDirectory) await rm(output, { recursive: true, force: true });
  // A caller building an alternate variant must supply a new directory.
  await mkdir(output);
  await Promise.all([
    cp(file('media'), path.join(output, 'media'), {
      recursive: true,
      filter: source => !['README.md','provenance.json','.DS_Store'].includes(path.basename(source))
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
  function scriptsFor(page) {
    if (page.slug === 'home') return [...scripts, 'js/home.js', 'js/membership.js'];
    if (page.slug === 'member') return [...scripts, 'js/membership.js'];
    if (page.slug === 'calendar') return [...scripts, 'js/calendar.js'];
    return scripts;
  }
  const clubPages = new Set(['club', 'member']);
  const cssFor = page => [...new Set([
    'media/fonts/ahouse-fonts.css',
    ...(page.slug==='moscow_business' ? ['media/fonts/ahouse-fonts-moscow.css'] : []),
    ...page.styles, ...(clubPages.has(page.slug) ? ['styles/pages/home.css'] : []),
    'styles/site.css', 'styles/interactions.css', 'styles/services.css', 'styles/typography.css', 'styles/theme.css'
  ])];
  const nearbyImages = 'js/nearby-images.js';
  const references = new Set([nearbyImages, 'js/theme.js', ...routes.flatMap(scriptsFor), ...routes.flatMap(cssFor)]);
  const urls = new Map(await Promise.all([...references].map(async name => {
    const bytes = await readFile(path.join(output, name));
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0,12);
    return [name, base+name+'?v='+digest];
  })));
  for (const page of routes) {
    const location = page.slug === 'home' || page.slug === '404' ? output : path.join(output,page.slug);
    await mkdir(location,{ recursive:true });
    const home = page.slug === 'home';
    const editorial = home || clubPages.has(page.slug) || page.slug === 'calendar';
    const body = (await source('pages/' + page.slug + '.html'))
      .replace('<!-- EDITORIAL HEADER -->', () => editorialHeader
        .replaceAll('{{wordmarkTag}}', home ? 'h1' : 'div')
        .replace('{{programCurrent}}', page.slug === 'calendar' ? ' aria-current="location"' : '')
        .replace('{{clubCurrent}}', clubPages.has(page.slug) ? ' aria-current="location"' : ''))
      .replace('<!-- HEADER -->', () => header)
      .replace('<!-- FRIEND ORDER -->', () => orderForm)
      .replace('<!-- MEMBER FORM -->', () => applicationForm)
      .replace('<!-- PROGRAM FEATURE -->', () => program.feature)
      .replace('<!-- PROGRAM EVENTS -->', () => program.cards)
      .replace('{{introHidden}}', program.featureIsCurrent ? ' hidden' : '')
      .replace('{{featureHidden}}', program.featureIsCurrent ? '' : ' hidden')
      .replace('{{emptyHidden}}', program.hasEvents ? ' hidden' : '')
      .replace('<!-- EVENT CALENDAR -->', () => renderCalendar(events, base))
      .replace('{{friendPrice}}', () => period ? priceLabel + ' ' + escape(period) : priceLabel)
      .replace('<!-- FOOTER -->', () => editorial ? homeFooter : footer)
      .replaceAll('{{home}}', home ? '' : '@@ROOT@@')
      .replace('<!-- ARCHIVE ENTRIES -->', () => archive);
    let themedBody;
    if (body.includes('<!-- THEME CONTROL -->')) themedBody = body.replace('<!-- THEME CONTROL -->', () => themeControl);
    else if (body.includes('</footer>')) themedBody = body.replace('</footer>', () => themeControl + '</footer>');
    else themedBody = body + '<footer class="theme-footer">' + themeControl + '</footer>';
    const pageBody = prepareConsentDocuments(themedBody);
    const typeset = editorial ? typesetHomeText(pageBody) : keepProjectNames(pageBody);
    const contentBody = delivery.rewriteHTML(markDeferredBackgrounds(typeset), { base, slug: page.slug });
    const scriptTags = scriptsFor(page).map(name => '<script defer src="'+urls.get(name)+'"></script>').join('\n');
    const pageScripts = contentBody.includes(' data-load-on-approach')
      ? '<script src="' + urls.get(nearbyImages) + '"></script>\n' + scriptTags
      : scriptTags;
    const values = {
      TITLE:escape(page.title), DESCRIPTION:escape(page.description), SLUG:escape(page.slug), THEME_SCRIPT:urls.get('js/theme.js'),
      FORM_ACTION:escape((home ? friend : page.slug === 'member' ? member : null)?.action.origin ?? "'none'"),
      STYLE:cssFor(page).map(name=>'<link rel="stylesheet" href="'+urls.get(name)+'">').join('\n'), SCRIPTS:pageScripts,
      FAVICON:page.icon?'<link rel="icon" href="'+base+escape(page.icon)+'">':'', BODY:contentBody
    };
    const content = shell.replace(/\{\{(TITLE|DESCRIPTION|SLUG|STYLE|SCRIPTS|FAVICON|BODY|FORM_ACTION|THEME_SCRIPT)\}\}/g,(_,key)=>values[key]).replaceAll('@@ROOT@@',base);
    await writeFile(path.join(location,page.slug==='404'?'404.html':'index.html'),content);
  }
  await writeFile(path.join(output,'.nojekyll'),'');
  console.log('Built '+routes.length+' HTML documents for '+base);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await build();
