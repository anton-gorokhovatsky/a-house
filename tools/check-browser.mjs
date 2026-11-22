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

async function checkHouseVisit(page, requested) {
  // The House page retains the original multi-breakpoint composition. Six of
  // its desktop photos are outside the cropped mobile artboard.
  const house = page.locator('#rec4578583101 .t396__artboard');
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

  assert.ok(clippedURLs.length, 'Expected clipped desktop photographs in the mobile House artboard');
  const facade = page.locator('main img[src*="/ill-"]').first();
  await facade.scrollIntoViewIfNeeded();
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
  assert.ok(view.received && view.visible, 'Opening the House must reveal its loaded illustration');
  await house.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(clippedURLs.filter(src => requested.has(src)), [], 'Photos clipped by the mobile House scene were requested');
  console.log('The House page showed the facade without fetching its clipped photographs.');
}

async function checkExpiredProgram(page) {
  await page.goto(url + '#program');
  const endDates = await page.locator('#program [data-event-end]').evaluateAll(items => items.map(item => item.dataset.eventEnd));
  if (!endDates.length) return;
  const afterProgram = new Date(endDates.sort().at(-1) + 'T12:00:00+03:00');
  afterProgram.setUTCDate(afterProgram.getUTCDate() + 1);
  await page.clock.setFixedTime(afterProgram);
  await page.reload();
  assert.ok(await page.locator('[data-events-empty]').isVisible(), 'An ended program must point visitors to fresh announcements');
  assert.equal(await page.locator('[data-home-now]').isVisible(), false, 'An expired exhibition cannot be featured as current');
  const past = page.locator('[data-events-past]');
  await past.locator('summary').click();
  assert.equal(await past.locator('[data-event-end]:visible').count(), endDates.length);
  assert.equal(await past.locator('[data-event-booking]:visible').count(), 0, 'Expired entries must withdraw booking links');
}

async function checkReadingReturn(page, mobile) {
  await page.goto(mobile ? url : url + '#media');
  if (mobile) {
    await page.locator('.site-menu-toggle').click();
    await page.locator('[data-home-view][href="#media"]').click();
  }
  const subscription = page.locator('#media a[href="#friend"]');
  const originalTop = await subscription.evaluate(async link => {
    await document.fonts.ready;
    link.scrollIntoView({ block: 'center', behavior: 'instant' });
    link.focus({ preventScroll: true });
    return link.getBoundingClientRect().top;
  });
  await page.keyboard.press('Enter');
  assert.equal(new URL(page.url()).hash, '#friend');
  const order = page.locator('[data-service-order="A-Friend"]:visible').first();
  await order.press('Enter');
  const dialog = page.locator('#services-checkout');
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await dialog.locator('[data-service-order-title]').innerText(), 'A-Friend');
  // The browser can refocus the section after popstate. Check the final render.
  const restored = page.evaluate(() => new Promise(resolve => {
    window.addEventListener('hashchange', () => requestAnimationFrame(() => requestAnimationFrame(resolve)), { once: true });
  }));
  await page.goBack();
  await restored;
  assert.equal(await dialog.isVisible(), false, 'Back must close an open preview');
  assert.equal(new URL(page.url()).hash, '#media');
  assert.ok(await subscription.evaluate((link, top) => link === document.activeElement
    && Math.abs(link.getBoundingClientRect().top - top) < 4, originalTop), 'Back must return to the focused link at the same reading position');
  await page.goForward();
  await order.click();
  await dialog.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.ok(await order.evaluate(el => el === document.activeElement), 'Closing the preview should restore focus to A-Friend');
}

async function checkEnlargedMenu(page) {
  await page.goto(url);
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  const toggle = page.locator('.site-menu-toggle');
  const wordmark = page.locator('.home-wordmark img');
  const originalWidth = await wordmark.evaluate(el => el.getBoundingClientRect().width);
  assert.ok(originalWidth >= 90, 'Enlarging text must leave a legible wordmark');
  await toggle.press('Enter');
  const menu = page.locator('#site-navigation');
  assert.ok(await menu.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'All menu columns must fit on the enlarged narrow screen');
  assert.equal(await wordmark.evaluate(el => el.getBoundingClientRect().width), originalWidth);
  await menu.getByRole('link', { name: 'Контакты' }).press('Enter');
  await page.locator('.home-footer summary').press('Enter');
  assert.ok(await page.locator('.home-footer details[open] a').first().isVisible());
}

async function checkEditorialGrouping(page) {
  const issue = page.locator('.home-issue');
  const group = await issue.evaluate(async el => {
    await document.fonts.ready;
    const cover = el.querySelector('figure').getBoundingClientRect();
    const label = el.querySelector('.home-kicker');
    const number = label.getBoundingClientRect();
    return { gap: number.left - cover.right, offset: number.top - cover.top, em: parseFloat(getComputedStyle(label).fontSize) };
  });
  assert.ok(Math.abs(group.offset) < group.em && group.gap >= 0 && group.gap <= 2.5 * group.em,
    'The issue number must sit beside the upper edge of its cover on the phone and desktop overview');

  const archive = page.locator('[data-events-past]');
  if (await archive.isVisible()) await archive.locator('summary').click();
  const lists = page.locator('.home-events:visible');
  for (const list of await lists.all()) {
    const entries = await list.locator(':scope > article:visible').evaluateAll(cards => cards.map(card => {
      const link = card.querySelector('.home-event-link');
      const entry = { top: card.getBoundingClientRect().top, paid: Boolean(link?.innerText.includes('₽')) };
      if (!entry.paid) return entry;
      const price = link.querySelector('.home-event-price');
      const description = link.querySelector('.home-event-info > p:last-child');
      if (!price || !description) return entry;
      const text = document.createRange();
      text.selectNodeContents(price);
      const lines = [...text.getClientRects()].filter(rect => rect.width > 0);
      if (!lines.length) return entry;
      return { ...entry, endOfCopy: description.getBoundingClientRect().bottom,
        priceTop: lines[0].top, priceBottom: lines.at(-1).bottom, sameLine: lines.every(rect => Math.abs(rect.top - lines[0].top) < 1) };
    }));
    for (const [index, entry] of entries.entries()) {
      if (!entry.paid) continue;
      assert.ok(entry.sameLine && entry.priceTop > entry.endOfCopy, 'Each price belongs on a separate, unbroken line under its description');
      const next = entries[index + 1];
      if (!next) continue;
      if (Math.abs(entry.top - next.top) >= 1) {
        assert.ok(next.top - entry.priceBottom > entry.priceTop - entry.endOfCopy, 'A price must be closer to its own event than the next one');
      } else if (next.paid) {
        assert.ok(Math.abs(entry.priceTop - next.priceTop) < 1, 'Prices for side-by-side events must share a baseline');
      }
    }
  }
}

async function checkArchiveReading(page) {
  const missing = await page.goto(url + 'missing-publication-for-browser-check/');
  assert.equal(missing.status(), 404);
  await page.getByRole('main').getByRole('link', { name: /в архив публикаций/i }).click();
  await page.waitForURL(url + 'archive/');
  const listing = page.getByRole('main').getByRole('list');
  const articles = listing.getByRole('link');
  const index = Math.floor(await articles.count() / 2);
  const entry = articles.nth(index);
  const title = (await entry.textContent()).replace(/\s+/g, ' ').trim();
  const address = await entry.evaluate(link => link.href);
  assert.ok(title, 'The catalogue must name the article it links to');
  await entry.scrollIntoViewIfNeeded();
  await entry.focus();
  const scroll = await page.evaluate(() => scrollY);
  await entry.press('Enter');
  await page.waitForURL(address);
  const main = page.getByRole('main');
  const heading = main.getByRole('heading', { name: title, level: 1, exact: true });
  await heading.waitFor({ state: 'visible' });
  const body = main.locator('[itemprop="articleBody"]');
  await body.waitFor({ state: 'visible' });
  if (!(await body.innerText()).trim()) {
    const media = body.locator('img[src], video, [data-archive-video]').filter({ visible: true }).first();
    assert.ok(await media.isVisible(), 'The selected publication must have visible text or editorial media');
  }
  for (let visit = 0; visit < 2; visit++) {
    await page.goBack();
    await page.waitForFunction(({ address, scroll }) =>
      document.activeElement?.href === address && Math.abs(scrollY - scroll) <= 2, { address, scroll });
    await page.keyboard.press('Tab');
    assert.ok(await articles.nth(index + 1).evaluate(link => link === document.activeElement), 'Tab must continue to the next publication');
    await page.goForward();
  }
  await main.getByRole('link', { name: /к архиву публикаций/i }).click();
  await page.waitForURL(url + 'archive/');
  assert.ok(await listing.getByRole('link', { name: title, exact: true }).isVisible(),
    'The archive must contain the same article on return');

  await page.goto(url + 'special_projects/');
  const clients = page.locator('main .t594__container');
  assert.ok(await clients.locator('img').evaluateAll(images => images.length > 0 && images.every(image =>
    Number(image.getAttribute('width')) > 0 && Number(image.getAttribute('height')) > 0)),
    'Project logos must reserve their area before the lazy files arrive');
  const projects = clients.getByRole('link');
  await projects.first().focus();
  await page.keyboard.press('Tab');
  const chosen = projects.nth(1);
  const position = await chosen.evaluate(link => ({ address: link.href, top: link.getBoundingClientRect().top }));
  await page.keyboard.press('Enter');
  await page.waitForURL(position.address);
  await page.goBack();
  await page.waitForFunction(({ address, top }) => document.activeElement?.href === address &&
    Math.abs(document.activeElement.getBoundingClientRect().top - top) <= 2, position);
}

async function checkClubApplication(page) {
  await page.goto(url + '#club');
  await page.locator('#club').getByRole('link', { name: /сравнить программы клуба/i }).click();
  await page.waitForURL(url + 'club/');
  // Pick a non-default level and read the name and offer from its visible card.
  const card = page.locator('main [data-catalog-card]').nth(1);
  const cardText = (await card.innerText()).toLocaleLowerCase('ru');
  const apply = card.getByRole('link', { name: /оставить заявку/i });
  const application = new URL(await apply.evaluate(link => link.href));
  const offer = application.searchParams.get('offer');
  assert.ok(offer && application.origin === new URL(url).origin, 'Club membership must lead to a local demo for the selected level');
  await apply.click();
  await page.waitForURL(application.href);
  const form = page.locator('form[data-service-form="member"]');
  const level = form.getByLabel('Уровень участия');
  assert.equal(await level.inputValue(), offer);
  const levelName = (await level.locator('option:checked').innerText()).trim();
  assert.ok(levelName && cardText.includes(levelName.toLocaleLowerCase('ru')), 'The form must name the same level as the chosen card');

  const outside = target => target.origin !== application.origin;
  const external = [];
  await page.context().route(outside, route => {
    external.push(route.request().resourceType());
    return route.abort();
  });
  const name = form.locator('input[name="name"]');
  const email = form.locator('input[type="email"]');
  const visitor = 'Тестовый посетитель';
  const mailbox = 'reader@example.invalid';
  await name.fill(visitor);
  await email.fill(mailbox);
  const consent = form.getByRole('link', { name: /согласие на обработку персональных данных/i });
  const consentChoice = form.getByRole('checkbox', { name: /согласие на обработку персональных данных/i });
  const consentURL = await consent.evaluate(link => link.href);
  const [documentPage] = await Promise.all([page.waitForEvent('popup', { timeout: 6000 }), consent.click()]);
  await documentPage.waitForURL(consentURL);
  await documentPage.getByRole('heading', { level: 1, name: /согласие.+обработку персональных данных/i }).waitFor();
  await documentPage.close();
  assert.equal(page.url(), application.href);
  assert.equal(await name.inputValue(), visitor, 'Reading the consent must preserve the name already entered');
  assert.equal(await email.inputValue(), mailbox);
  assert.equal(await level.inputValue(), offer);
  assert.equal(await consentChoice.isChecked(), false, 'Reading the terms must not itself give consent');

  const companyGroup = form.locator('[data-field-name="company"]');
  const company = companyGroup.getByRole('textbox');
  await form.locator('input[type="tel"]').fill('+7 000 000-00-00');
  await form.getByRole('radio', { name: 'Email', exact: true }).press('Space');
  for (const agreement of await form.getByRole('checkbox').all()) await agreement.press('Space');
  const review = form.getByRole('button', { name: /проверить анкету/i });
  await review.click();
  assert.equal(await company.getAttribute('aria-invalid'), 'true');
  const hint = companyGroup.locator('[data-service-field-error]');
  assert.ok(await hint.isVisible() && (await hint.innerText()).trim(),
    'A missing company needs a visible correction near the field');
  assert.equal(await form.locator('[data-service-result]').isVisible(), false);
  await company.fill('Учебное бюро');
  assert.equal(await company.getAttribute('aria-invalid'), null);
  assert.equal(await hint.isVisible(), false, 'Correcting the company should clear its own hint');
  assert.equal(await name.inputValue(), visitor);
  assert.equal(await email.inputValue(), mailbox);
  assert.equal(await level.inputValue(), offer);
  await review.click();
  const result = form.locator('[data-service-result]');
  await result.getByRole('heading', { name: 'Анкета проверена' }).waitFor();
  assert.ok((await result.locator('[data-service-result-offer]').innerText()).includes(levelName));
  assert.deepEqual(external, [], 'Checking a demo application must not contact an external service');
  await page.context().unroute(outside);
}

async function checkHomeRoutes(page, mobile) {
  const choice = name => page.locator('[data-home-view][href="#' + name + '"]');
  const section = name => page.locator('[data-home-section][id="' + name + '"]');
  await checkReadingReturn(page, mobile);
  await page.goto(url);
  await checkEditorialGrouping(page);
  const menu = page.locator('.site-menu-toggle');
  assert.equal(await section('program').isVisible(), true);
  assert.equal(await section('media').isVisible(), true);
  assert.equal(await section('club').isVisible(), false, 'The overview must keep club details in their own view');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const more = page.locator('.home-section-tail a[href="#publications"]');
  await more.press('Enter');
  const publications = page.getByRole('region', { name: 'Другие публикации' });
  assert.equal(new URL(page.url()).hash, '#publications');
  assert.ok(await publications.locator('.home-kicker').first().evaluate(async el => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = el.getBoundingClientRect();
    return box.top >= document.querySelector('#t-header').getBoundingClientRect().bottom - 1 && box.top < innerHeight;
  }), 'Other publications must immediately reveal the first additional article');
  await page.goBack();
  await page.waitForFunction(link => document.activeElement === link, await more.elementHandle());
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await menu.isVisible(), mobile, 'Only a compact header needs a menu toggle');
  assert.equal(await choice('media').isVisible(), !mobile, 'Desktop sections should be visible before interaction');
  if (!mobile) {
    const links = page.locator('#site-navigation a:visible');
    const rows = await links.evaluateAll(items => items.map(a => Math.round(a.getBoundingClientRect().top)));
    assert.ok(rows.length > 1 && Math.max(...rows) - Math.min(...rows) < 2, 'Desktop destinations must share one visible row');
  }
  if (mobile) {
    await menu.focus();
    await page.keyboard.press('Enter');
    assert.equal(await menu.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    assert.ok(await menu.evaluate(el => el === document.activeElement), 'Escape must return focus to the menu toggle');
    await page.keyboard.press('Enter');
    const programLink = page.locator('.site-navigation a[href="#program"]');
    await programLink.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#program').contains(document.activeElement));
    assert.equal(await menu.getAttribute('aria-expanded'), 'false', 'Choosing a section must close the mobile menu');
  }
  if (mobile) await menu.click();
  await choice('media').click();
  await section('media').waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).hash, '#media');
  assert.equal(await choice('media').getAttribute('aria-current'), 'true');
  assert.equal(await section('program').isVisible(), false);
  const article = section('media').locator('a[href^="https://news.ahouseproject.com/"]:not([href="https://news.ahouseproject.com/"])').first();
  assert.ok(await article.isVisible(), 'The reading selection must open an individual editorial item');
  if (mobile) await menu.click();
  await choice('program').focus();
  await page.keyboard.press('Enter');
  await section('program').waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).hash, '#program');
  assert.ok(await section('program').locator('a[href^="https://"]:visible').first().isVisible(), 'The program must identify where an external event continues');
  await page.goBack();
  await section('media').waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).hash, '#media', 'Back must restore the chosen reading view');
  await page.goto(url + '#services-checkout');
  await page.locator('#services-checkout').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page.goto(url + '#visit');
  await section('visit').waitFor({ state: 'visible' });
  await section('visit').locator('a[href$="/residents/"]').first().click();
  await page.waitForURL(url + 'residents/');
}

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
  const narrowPage = await browser.newPage({ viewport: { width: 320, height: 844 } });
  await checkEnlargedMenu(narrowPage);
  await narrowPage.close();
  for (const width of [390, 1511]) {
    const mobile = width === 390;
    const pageOptions = {
      viewport: { width, height: 844 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1
    };
    const page = await browser.newPage(pageOptions);
    const requested = new Set();
    page.on('request', request => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) requested.clear();
      requested.add(request.url());
    });
    await checkHomeRoutes(page, mobile);
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
      await checkHouseVisit(page, requested);
      requested.clear();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(url + 'press/');
      const cover = await page.locator('.reading-cover').evaluate(el => getComputedStyle(el).backgroundImage);
      assert.match(cover, /\/stills\//, 'Reduced motion must show a still on the press cover');
      const photo = page.locator('main .t1241__cover[data-scene-image]').first();
      const source = await photo.evaluate(el => getComputedStyle(el).getPropertyValue('--scene-image').match(/url\(["']?([^"')]+)/)[1]);
      const photoURL = new URL(source, url).href;
      assert.equal(requested.has(photoURL), false, 'A distant photo loaded before scrolling');
      await photo.scrollIntoViewIfNeeded();
      await page.waitForFunction(src => performance.getEntriesByName(src).some(r => r.responseEnd > 0), photoURL);
      assert.ok(![...requested].some(src => /\.gif(?:\?|$)/i.test(src)), 'An animated GIF loaded in reduced motion');
      const futurePage = await browser.newPage({ ...pageOptions, reducedMotion: 'reduce' });
      await checkExpiredProgram(futurePage);
      await futurePage.close();
    }
    await checkArchiveReading(page);
    await checkClubApplication(page);
    console.log('Archive reading, club application and visible word space verified at ' + width + ' px (' + gap.toFixed(2) + ' px).');
    await page.close();
  }
} finally {
  await browser?.close();
  server.close();
}
