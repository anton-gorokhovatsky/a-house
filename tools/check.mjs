import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { membershipSettings, projectRoot, siteBase } from './build.mjs';
import { keepProjectNames, typesetHomeText } from './typography.mjs';

const dist = path.resolve(process.argv[2] ?? path.join(projectRoot, 'dist'));
const base = siteBase(process.env.SITE_BASE);
const errors = [];

// Keep a real inline boundary and a form in the sample: plain-text checks miss
// misplaced characters on either side of an anchor and changes to form values.
const linkTag = '<a title="Вход в Дом" href="/visit/">';
const form = '<dialog><form><label>Вход в Дом <input value="№ 2"></label></form></dialog>';
const sample = '<p>В ' + linkTag + 'Доме</a> до <time>29</time> ноября 2026, 19:30. Билет — 4 000 ₽. Выпуск № 2.</p>' + form;
const typesetSample = '<p>В\u00a0' + linkTag + 'Доме</a> до\u00a0<time>29</time>\u00a0ноября\u00a02026, 19:30. Билет\u00a0— 4\u202f000\u00a0₽. Выпуск №\u202f2.</p>' + form;
if (typesetHomeText(sample) !== typesetSample || keepProjectNames(sample) !== sample) {
  errors.push('Homepage typography must preserve inline markup, imported pages and form values');
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
const routes = JSON.parse(await readFile(path.join(projectRoot,'src/routes.json'),'utf8'));
const membershipPages = new Map([
  ['index.html', { kind: 'friend', settings: membershipSettings('friend') }],
  ['member/index.html', { kind: 'member', settings: membershipSettings('member') }]
]);
const htmlFiles = routes.map(({slug}) => slug==='home' ? 'index.html' : slug==='404' ? '404.html' : slug+'/index.html');
const routeTitles = new Map(routes.map(({slug, title}) => [base + slug + '/', title]));
function validateURL(source, value, asset) {
  value=value.trim().replaceAll('&amp;','&');
  if (!value || value[0]==='#' || value.startsWith('data:')) return;
  let url;
  try { url = new URL(value,'https://preview.invalid'+base+source); }
  catch { errors.push(source+' contains invalid URL '+value);return; }
  if (url.origin!=='https://preview.invalid') {
    if (asset) errors.push(source+' loads an external asset '+value);
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
  if (!/<meta\b[^>]*\bname="robots"[^>]*\bcontent="[^"]*\bnoindex\b/i.test(source)) errors.push(file+' lacks noindex');
  if (!/<h1\b|role="heading" aria-level="1"/i.test(source)) errors.push(file+' lacks its page heading');
  if (source.includes('@@ROOT@@') || source.includes('{{BODY}}')) errors.push(file+' has an unresolved template');
  const head = source.slice(0, source.indexOf('</head>'));
  const styles = [...head.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)];
  const themeLoader = [...head.matchAll(/<script src="[^"]*\/js\/theme\.js(?:\?[^"]*)?"><\/script>/g)];
  if (themeLoader.length !== 1 || !styles.length || themeLoader[0].index > styles[0].index ||
      !styles.at(-1)[1].startsWith(base + 'styles/theme.css?')) {
    errors.push(file + ' must restore the saved theme before styles and apply the shared palette last');
  }
  if ((source.match(/<fieldset\b[^>]*\bdata-site-theme(?=[\s>])/g) || []).length !== 1) {
    errors.push(file + ' must have one appearance control');
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
    if (value!==undefined) validateURL(file,value,element!=='a');
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
  for (const ref of source.matchAll(/url\(\s*['"]?([^)'"]+)/g)) validateURL(file,ref[1],true);
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
console.log('Verified '+htmlFiles.length+' noindex documents and their assets in '+files.size+' files for '+base);
