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
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
  for (const width of [390, 1511]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
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
    if (width === 390) {
      await menu.click();
      const photo = page.locator('main .t786__imgwrapper .js-product-img').last();
      const source = await photo.evaluate(el => getComputedStyle(el).getPropertyValue('--scene-image').match(/url\(["']?([^"')]+)/)[1]);
      const photoURL = new URL(source, url).href;
      assert.equal(requested.has(photoURL), false, 'A distant photo loaded before scrolling');
      await photo.scrollIntoViewIfNeeded();
      await page.waitForFunction(src => performance.getEntriesByName(src).some(r => r.responseEnd > 0), photoURL);
      requested.clear();
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
