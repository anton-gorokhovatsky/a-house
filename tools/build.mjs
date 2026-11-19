import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keepProjectNames } from './typography.mjs';

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

export async function build(base = siteBase(process.env.SITE_BASE)) {
  const output = file('dist');
  const routes = JSON.parse(await source('routes.json'));
  const archive = routes.filter(page => page.slug.startsWith('tpost/'))
    .sort((a,b) => (b.published || '').localeCompare(a.published || '') || a.title.localeCompare(b.title,'ru'))
    .map(page => {
      const date=(page.published || '').split('-').reverse().join('.');
      return '<li><time datetime="'+escape(page.published || '')+'">'+date+'</time><div><a href="'+base+page.slug+'/">'+escape(page.title)+'</a><small>'+escape(page.section || '')+'</small></div></li>';
    }).join('\n');
  const [shell, header, footer] = await Promise.all(['layout.html', 'partials/header.html', 'partials/footer.html'].map(source));
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
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
      else await writeFile(path.join(output,name), (await source(name)).replaceAll('@@ROOT@@',base));
    }
  }
  await styles('styles');
  const scripts = ['js/site.js', 'js/services.js', 'js/interactions.js'];
  const cssFor = page => [...new Set([
    'media/fonts/ahouse-fonts.css',
    ...(page.slug==='moscow_business' ? ['media/fonts/ahouse-fonts-moscow.css'] : []),
    ...page.styles, 'styles/site.css', 'styles/interactions.css', 'styles/services.css', 'styles/typography.css'
  ])];
  const references = new Set([...scripts, ...routes.flatMap(cssFor)]);
  const urls = new Map(await Promise.all([...references].map(async name => {
    const bytes = await readFile(path.join(output, name));
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0,12);
    return [name, base+name+'?v='+digest];
  })));
  const scriptTags = scripts.map(name => '<script defer src="'+urls.get(name)+'"></script>').join('\n');
  for (const page of routes) {
    const location = page.slug === 'home' || page.slug === '404' ? output : path.join(output,page.slug);
    await mkdir(location,{ recursive:true });
    const body = (await source('pages/' + page.slug + '.html')).replace('<!-- HEADER -->',()=>header)
      .replace('<!-- FOOTER -->',()=>footer).replace('<!-- ARCHIVE ENTRIES -->',()=>archive);
    const values = {
      TITLE:escape(page.title), DESCRIPTION:escape(page.description), SLUG:escape(page.slug),
      STYLE:cssFor(page).map(name=>'<link rel="stylesheet" href="'+urls.get(name)+'">').join('\n'), SCRIPTS:scriptTags,
      FAVICON:page.icon?'<link rel="icon" href="'+base+escape(page.icon)+'">':'', BODY:keepProjectNames(body)
    };
    const content = shell.replace(/\{\{(TITLE|DESCRIPTION|SLUG|STYLE|SCRIPTS|FAVICON|BODY)\}\}/g,(_,key)=>values[key]).replaceAll('@@ROOT@@',base);
    await writeFile(path.join(location,page.slug==='404'?'404.html':'index.html'),content);
  }
  await writeFile(path.join(output,'.nojekyll'),'');
  console.log('Built '+routes.length+' HTML documents for '+base);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await build();
