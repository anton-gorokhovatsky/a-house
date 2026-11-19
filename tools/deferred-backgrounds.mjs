// Keep the image URL out of inline background-image declarations. A browser
// can otherwise request distant photos (and GIFs in reduced-motion mode)
// while it is still parsing the page, before the final styles take effect.
export function markDeferredBackgrounds(html) {
  return html.replace(/<div\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, tag => {
    const classes = tag.match(/\sclass="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    const defer = classes.includes('t-bgimg');
    if (!defer && !tag.includes(' data-motion-still')) return tag;

    const style = tag.match(/\sstyle="([^"]*)"/);
    if (!style) return tag;
    const properties = [];
    let image;
    for (const declaration of style[1].split(';')) {
      const value = declaration.trim();
      const match = value.match(/^background-image\s*:\s*(url\(\s*['"]?@@ROOT@@media\/[^)]+\))$/i);
      if (match) image = match[1];
      else if (value) properties.push(value);
    }
    if (!image) return tag;
    properties.push('--scene-image:' + image);
    const attributes = defer ? ' data-scene-image data-load-on-approach' : ' data-scene-image';
    return tag.replace(style[0], () => attributes + ' style="' + properties.join(';') + '"');
  });
}
