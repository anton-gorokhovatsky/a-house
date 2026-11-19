# Raster delivery

`media/` keeps every original imported image and its existing address. The
optional preparation step writes only `media/delivery/` and the checked-in
`tools/image-manifest.json`. These derivatives are part of the source checkout;
ordinary local and GitHub Actions builds require Node.js only, with no image
encoder, network, package install, or external image service.

Regenerate after adding or replacing an original, using Python with Pillow and
WebP support already available in the development environment:

```sh
python3 tools/prepare-images.py --workers 4
npm run build
npm run check
```

The manifest records the encoder version, common settings, original SHA-256,
dimensions, bytes, ICC presence, and each derivative's SHA-256. The generator
reuses verified unchanged derivatives. New filenames contain the output hash,
so a changed encoding gets a new URL and cannot reuse stale cached bytes.
Normal builds verify hashes and fail clearly if a mapped original or derivative
has changed without regeneration. Unmapped new files retain their original URL.

Delivery copies preserve the full canvas and aspect ratio. Full-size WebP uses
quality 92 and is selected only when at least 15% smaller than the original.
Transparent pixels and ICC profiles are checked; alpha is preserved exactly in
the full-size copy. Smaller copies at 640, 960, and 1280 pixels wide are generated
for archive images without upscaling or cropping and used only when they save
at least 15%. The generator reads display references from HTML/CSS/gallery data;
download-only sources and unused widths do not produce delivery files.
This is perceptual compression, not pixel-identical RGB preservation. The
original remains available for zoom, download, or a future new derivative.

GIF, SVG, animated PNG/WebP, explicitly oriented sources, and the existing
`media/stills/` reduced-motion assets are not processed. Small sources under
64 KiB or 400 pixels wide keep their existing delivery.

`loadImageDelivery(root)` in `tools/images.mjs` returns:

- `rewriteHTML(html, { base, slug })`: updates display `img src`, inline CSS
  URLs (including `--scene-image`), and `li_img` gallery data. It preserves alt,
  link/download `href`, `data-original`, and `data-img-zoom-url`.
- `rewriteCSS(css, { base })`: updates local display URLs.
- `assetURL(url, base)`: resolves a single display URL.

Only archive images receive `srcset`: their shared feed container has measured
widths of `viewport - 40px` up to 680px, then 640px through 960px, 620px through
1200px, and 760px above that. Lazy images additionally use `sizes="auto, …"`
where the browser supports it. If that preserved grid changes, update and
remeasure this fallback in `tools/images.mjs`. Arbitrary artboards keep the
full-size delivery copy: `object-fit: cover` may need more horizontal pixels
than the visible box width, so guessing `100vw` would reduce image quality.
