import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { projectRoot, siteBase } from './build.mjs';
import { previewServer } from './preview.mjs';

const base = siteBase(process.env.SITE_BASE);
const server = previewServer(path.resolve(process.argv[2] ?? path.join(projectRoot, 'dist')), base);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = 'http://127.0.0.1:' + server.address().port + base;

async function checkFirstHouseVisit(page, requested) {
  const house = page.locator('.home-intro + .t-rec .t396__artboard');
  const clippedURLs = await house.evaluate(board => {
    const frame = board.getBoundingClientRect();
    const style = getComputedStyle(board);
    const clips = value => value === 'hidden' || value === 'clip';
    const hidden = new Set([...board.querySelectorAll('[data-original]')].filter(el => {
      const r = el.getBoundingClientRect();
      return (clips(style.overflowY) && (r.top >= frame.bottom || r.bottom <= frame.top))
        || (clips(style.overflowX) && (r.left >= frame.right || r.right <= frame.left));
    }));
    function sources(el) {
      const css = getComputedStyle(el);
      const background = css.backgroundImage + ' ' + css.getPropertyValue('--scene-image');
      const urls = [...background.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(match => match[1]);
      return [el.dataset.original, el.currentSrc, ...urls].filter(Boolean).map(src => new URL(src, document.baseURI).href);
    }
    // A photograph reused elsewhere can legitimately be requested for that placement.
    const elsewhere = new Set([...document.querySelectorAll('img, [data-original]')].filter(el => !hidden.has(el)).flatMap(sources));
    return [...new Set([...hidden].flatMap(sources))].filter(src => !elsewhere.has(src));
  });

  const [scrolled] = await Promise.all([
    page.evaluate(() => new Promise(resolve => {
      const timeout = setTimeout(() => resolve(false), 10000);
      document.addEventListener('scrollend', () => { clearTimeout(timeout); resolve(true); }, { once: true });
    })),
    page.locator('.home-cover .t-cover__arrow').tap()
  ]);
  assert.ok(scrolled, 'Tapping the arrow must scroll to the House');
  const facade = house.locator('[data-elem-type="image"] img');
  await page.waitForFunction(img => img.complete && img.naturalWidth > 0, await facade.elementHandle(), { timeout: 10000 });
  const view = await facade.evaluate(async img => {
    await img.decode();
    return new Promise(resolve => {
      const observer = new IntersectionObserver(([entry]) => {
        observer.disconnect();
        resolve({
          visible: entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0
            && img.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
          received: performance.getEntriesByName(img.currentSrc).some(r => r.responseStatus === 200)
        });
      });
      observer.observe(img);
    });
  });
  assert.ok(view.received && view.visible, 'The first scroll must reveal the loaded illustration of the House');
  assert.deepEqual(clippedURLs.filter(src => requested.has(src)), [], 'Photos clipped by the mobile House scene were requested');
  console.log('First mobile scroll showed the facade without fetching the clipped photographs.');
}

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
  for (const width of [390, 1511]) {
    const mobile = width === 390;
    const page = await browser.newPage({
      viewport: { width, height: 844 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1
    });
    const requested = new Set();
    page.on('request', request => requested.add(request.url()));
    await page.goto(url);
    const menu = page.locator('.site-menu-toggle');
    if (await menu.isVisible()) await menu.click();
    const link = page.locator('.site-navigation').getByRole('link', { name: /^Дом A[–‑-]House$/i });
    const gap = await link.evaluate(async element => {
      await document.fonts.ready;
      // Measure the two letters themselves, including when markup splits the label.
      const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const letters = [];
      for (let node = text.nextNode(); node; node = text.nextNode()) {
        for (let i = 0; i < node.length; i++) {
          const range = new Range();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          letters.push(range.getBoundingClientRect());
        }
      }
      const a = element.textContent.indexOf('A');
      const m = element.textContent.indexOf('м');
      return letters[a].left - letters[m].right;
    });
    assert.ok(gap > 1, 'Missing visible space in «Дом A–House» at ' + width + ' px');
    if (mobile) {
      await menu.click();
      const photo = page.locator('main .t786__imgwrapper .js-product-img').last();
      const source = await photo.evaluate(el => getComputedStyle(el).getPropertyValue('--scene-image').match(/url\(["']?([^"')]+)/)[1]);
      const photoURL = new URL(source, url).href;
      assert.equal(requested.has(photoURL), false, 'A distant photo loaded before scrolling');
      await checkFirstHouseVisit(page, requested);
      await photo.scrollIntoViewIfNeeded();
      await page.waitForFunction(src => performance.getEntriesByName(src).some(r => r.responseEnd > 0), photoURL);
      requested.clear();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(url + 'press/');
      const cover = await page.locator('.reading-cover').evaluate(el => getComputedStyle(el).backgroundImage);
      assert.match(cover, /\/stills\//, 'Reduced motion must show a still on the press cover');
      assert.ok(![...requested].some(src => /\.gif(?:\?|$)/i.test(src)), 'An animated GIF loaded in reduced motion');
    }
    console.log('Visible word space at ' + width + ' px: ' + gap.toFixed(2) + ' px');
    await page.close();
  }
} finally {
  await browser?.close();
  server.close();
}
