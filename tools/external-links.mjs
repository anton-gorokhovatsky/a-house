// The site templates already contain HTML. Keep the original bytes of every
// link attribute and place the marker only in the renderable text of its label.
const htmlTokens = /<!--[\s\S]*?-->|<(script|style|svg|textarea|select|template|ag-signature)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<(\/?)([a-z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</gi;
const attributeTokens = /([^\s/="'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>]+)))?/g;
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
// Keep the last glyph and the arrow on the same line while allowing long
// words to keep their existing break opportunities at increased text sizes.
const ending = /(?:&(?:#(?:x[\da-f]+|\d+)|[a-z][a-z\d]*);|[^\s\p{M}]\p{M}*)(?=\s*$)/iu;
const arrow = '<svg class="external-link-mark" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2.5 9.5 9.5 2.5m-5 0h5v5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function attributes(raw) {
  return new Map(Array.from(raw.matchAll(attributeTokens), ([, name, double, single, unquoted]) =>
    [name.toLowerCase(), double ?? single ?? unquoted ?? '']));
}

function classes(attrs) {
  return (attrs.get('class') ?? '').split(/\s+/);
}

function externalWebURL(href, site) {
  if (!/^(?:https?:)?\/\//i.test(href?.trim() ?? '')) return false;
  try {
    const url = new URL(href, site);
    return url.origin !== site.origin ||
      !(url.pathname.startsWith(site.pathname) || url.pathname === site.pathname.slice(0, -1));
  } catch {
    return false;
  }
}

function labelWithin(anchorClasses) {
  if (anchorClasses.includes('home-project-row')) return (_, names) => names.includes('home-project-name');
  if (anchorClasses.includes('press-file')) return (_, names) => names.includes('press-file-label');
  return null;
}

export function markExternalLinks(html, base) {
  const site = new URL(base, 'https://anton-gorokhovatsky.github.io');
  let anchor;
  let cursor = 0;
  let result = '';
  for (const match of html.matchAll(htmlTokens)) {
    const [token, , closing, tagName, rawAttrs] = match;
    const tag = tagName?.toLowerCase();
    if (tag === 'a') {
      if (!closing) {
        const attrs = attributes(rawAttrs);
        const href = attrs.get('href');
        anchor = externalWebURL(href, site) && attrs.get('aria-hidden') !== 'true'
          ? { href, labelStart: match.index + token.length, scope: labelWithin(classes(attrs)), stack: [], last: null }
          : null;
      } else {
        // A verbatim URL already names the external destination. Preserve
        // the exact link markup in the legal documents that cite it.
        if (anchor?.last && html.slice(anchor.labelStart, match.index).trim() !== anchor.href) {
          const wordEnd = ending.exec(anchor.last[0]);
          const offset = anchor.last.index + wordEnd.index;
          result += html.slice(cursor, offset) + '<span class="external-link-ending">' + wordEnd[0] + arrow + '</span>';
          cursor = offset + wordEnd[0].length;
        }
        anchor = null;
      }
      continue;
    }
    if (!anchor) continue;
    const parent = anchor.stack.at(-1);
    if (!tag) {
      if (!token.startsWith('<') && !parent?.hidden && (!anchor.scope || parent?.label) && ending.test(token)) {
        anchor.last = match;
      }
    } else if (closing) {
      const level = anchor.stack.findLastIndex(element => element.tag === tag);
      if (level !== -1) anchor.stack.length = level;
    } else if (!voidTags.has(tag)) {
      const attrs = attributes(rawAttrs);
      const names = classes(attrs);
      anchor.stack.push({
        tag,
        hidden: parent?.hidden || attrs.has('hidden') || attrs.get('aria-hidden') === 'true' || names.includes('screen-reader-only'),
        label: parent?.label || anchor.scope?.(tag, names)
      });
    }
  }
  return result + html.slice(cursor);
}
