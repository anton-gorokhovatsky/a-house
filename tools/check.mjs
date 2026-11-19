import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot, siteBase } from './build.mjs';

const dist = path.join(projectRoot, 'dist');
const base = siteBase(process.env.SITE_BASE);
const errors = [];
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
const htmlFiles = routes.map(({slug}) => slug==='home' ? 'index.html' : slug==='404' ? '404.html' : slug+'/index.html');
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
    if (element==='form' && (!/\smethod="dialog"/i.test(tag[0]) || /\saction=/i.test(tag[0]))) errors.push(file+' contains a live form');
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
