import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// These sizes follow the preserved feed/grid container, measured at its
// 680/960/1200px breakpoints. Lazy images use their actual size when supported.
const archiveSizes = '(max-width: 680px) calc(100vw - 40px), (max-width: 960px) 640px, (max-width: 1200px) 620px, 760px';
const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
const tags = /<!--[^]*?-->|<(?:[^"'<>]|"[^"]*"|'[^']*')+>/g;
const attributes = /\s+([^\s=/>]+)\s*=\s*(["'])([^]*?)\2/g;

export async function loadImageDelivery(root) {
  const manifest = JSON.parse(await readFile(path.join(root, 'tools/image-manifest.json'), 'utf8'));
  if (manifest.version !== 1) throw new Error('Unknown image delivery manifest version');
  const files = new Map();
  for (const [source, entry] of Object.entries(manifest.images)) {
    files.set(source, entry.sha256);
    for (const variant of [entry.full, ...entry.variants]) files.set(variant.path, variant.sha256);
  }
  const inventory = [...files];
  for (let start = 0; start < inventory.length; start += 24) {
    await Promise.all(inventory.slice(start, start + 24).map(async ([name, hash]) => {
      if (!/^media\/[a-zA-Z0-9_./-]+$/.test(name) || name.split('/').includes('..')) {
        throw new Error('Invalid image delivery path: ' + name);
      }
      if (checksum(await readFile(path.join(root, name))) !== hash) {
        throw new Error('Image delivery is stale: ' + name + '. Regenerate with tools/prepare-images.py.');
      }
    }));
  }

  function find(url, base) {
    const prefix = url.startsWith('@@ROOT@@') ? '@@ROOT@@' : base && url.startsWith(base) ? base : '';
    if (!prefix) return null;
    const source = url.slice(prefix.length);
    const entry = manifest.images[source];
    return entry ? { entry, prefix } : null;
  }

  function assetURL(url, base) {
    const found = find(url, base);
    return found ? found.prefix + found.entry.full.path : url;
  }

  function rewriteCSS(css, { base } = {}) {
    return css.replace(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/gi,
      (whole, quote, url) => {
        const delivered = assetURL(url, base);
        return delivered === url ? whole : 'url(' + quote + delivered + quote + ')';
      });
  }

  function rewriteHTML(html, { base, slug } = {}) {
    return html.replace(tags, tag => {
      if (tag.startsWith('<!--') || /^<\//.test(tag)) return tag;
      const element = tag.match(/^<([\w:-]+)/)?.[1]?.toLowerCase();
      const values = Object.fromEntries([...tag.matchAll(attributes)].map(match => [match[1].toLowerCase(), match[3]]));
      const found = element === 'img' && find(values.src || '', base);
      let result = tag.replace(attributes, (whole, name, quote, value) => {
        let delivered = value;
        if (name.toLowerCase() === 'style') delivered = rewriteCSS(value, { base });
        if (element === 'img' && name.toLowerCase() === 'src') delivered = assetURL(value, base);
        if (name.toLowerCase() === 'data-field-imgs-value') {
          // Change the displayed gallery image only, not any zoom/link fields.
          delivered = value.replace(/("li_img"\s*:\s*")([^"]+)(")/g,
            (_, before, url, after) => before + assetURL(url, base) + after);
        }
        return delivered === value ? whole : whole.replace(quote + value + quote, quote + delivered + quote);
      });
      // Source artboards can crop by height; a guessed 100vw would undersample
      // them. Keep their full-canvas copy, and use srcset in the known archive.
      if (found && slug?.startsWith('tpost/') && !values.srcset && found.entry.variants.length) {
        const sources = [...found.entry.variants, found.entry.full].sort((a, b) => a.width - b.width);
        const srcset = sources.map(item => found.prefix + item.path + ' ' + item.width + 'w').join(', ');
        const sizes = (values.loading === 'lazy' ? 'auto, ' : '') + archiveSizes;
        result = result.replace(/\s*\/?>$/, end => ' srcset="' + srcset + '" sizes="' + sizes + '"' + end);
      }
      return result;
    });
  }
  return { assetURL, rewriteCSS, rewriteHTML };
}
