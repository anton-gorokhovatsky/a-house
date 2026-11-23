import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { membershipSettings, projectRoot, siteBase } from './build.mjs';
import { previewServer } from './preview.mjs';
import { checkMembershipTransport } from './check-membership.mjs';
import { checkTheme } from './check-theme.mjs';

const base = siteBase(process.env.SITE_BASE);
const server = previewServer(path.resolve(process.argv[2] ?? path.join(projectRoot, 'dist')), base);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = 'http://127.0.0.1:' + server.address().port + base;
const jobCatalog = JSON.parse(await readFile(path.join(projectRoot, 'src/data/jobs.json'), 'utf8')).jobs;

async function checkHouseVisit(page) {
  const pageBody = page.getByRole('main');
  const photo = pageBody.locator('.institution-opening img');
  await photo.scrollIntoViewIfNeeded();
  await photo.evaluate(image => image.decode());
  assert.ok(await photo.isVisible());
  assert.match(await pageBody.innerText(), /Большой\s+Афанасьевский/);
  await pageBody.getByRole('link', {name: 'Резиденты Дома', exact: true}).click();
  const residents = pageBody.locator('#residents');
  await residents.getByRole('heading').waitFor();
  assert.ok(await residents.getByRole('link').count() >= 5, 'The House names its residents and links to them');
}

async function checkMobileExhibition(page) {
  const events = JSON.parse(await readFile(path.join(projectRoot, 'src/data/events.json'), 'utf8'));
  const feature = events.find(event => event.home === 'feature');
  if (!feature?.photos?.length || !feature.booking) return;
  const cover = feature.photos.find(photo => photo.mobileLead) || feature.photos[0];
  await page.clock.setFixedTime(new Date(feature.start + 'T12:00:00+03:00'));
  await page.goto(url);
  const poster = page.locator('[data-home-now]');
  for (const [width, height] of [[320, 480], [320, 568], [375, 560], [390, 664]]) {
    await page.setViewportSize({ width, height });
    const picture = poster.locator('img:visible');
    const frame = await picture.evaluate(async element => {
      await document.fonts.ready;
      await element.decode();
      return element.getBoundingClientRect().toJSON();
    });
    assert.ok((await picture.getAttribute('src')).endsWith(cover.file));
    assert.ok(frame.top >= 0 && frame.height >= height / 4 && frame.bottom < height,
      'A visitor should immediately see a substantial exhibition photograph');
    const action = poster.getByRole('link', { name: feature.booking.label });
    assert.equal(await action.getAttribute('href'), feature.booking.url);
    const heading = await poster.getByRole('heading', { name: feature.title }).boundingBox();
    const place = await poster.locator('.home-venue-link').boundingBox();
    const button = await action.boundingBox();
    assert.ok(frame.bottom <= heading.y && heading.y + heading.height <= place.y
      && place.y + place.height <= button.y && button.height >= 44 && button.y + button.height <= height,
      'The exhibition title, venue and booking action must follow the picture and fit on a short phone');
  }
}

async function checkProjectMotion(page) {
  await page.goto(url + '#projects');
  await page.evaluate(() => document.fonts.ready);
  const link = page.locator('.home-project-navigation a[href="#a-presence"]');
  const destination = page.locator('#a-presence');
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion });
    const start = await destination.evaluate(el => el.getBoundingClientRect().top);
    await link.click();
    if (reducedMotion === 'no-preference') {
      await page.waitForFunction(y => {
        const top = document.getElementById('a-presence').getBoundingClientRect().top;
        return top < y - 5 && top > innerHeight;
      }, start);
    } else {
      assert.ok((await destination.boundingBox()).y < 60, 'Reduced motion must arrive immediately');
    }
    await page.waitForFunction(() => document.activeElement?.id === 'a-presence' &&
      document.getElementById('a-presence').getBoundingClientRect().top < 60);
    await page.goBack();
    await page.waitForFunction(() => document.activeElement?.matches('.home-project-navigation a[href="#a-presence"]'));
  }
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
  const ids = await page.locator('#program [data-event-end]').evaluateAll(items => items.map(item => item.id));
  await page.locator('[data-past-calendar]').click();
  await page.waitForURL(url + 'calendar/#past');
  const past = page.locator('#past');
  for (const id of ids) assert.ok(await past.locator('[id="' + id + '"]').isVisible());
  assert.equal(await past.locator('[data-calendar-booking]:visible').count(), 0, 'Expired entries must withdraw booking links');
  await page.goto(url + '#light-of-time');
  await page.waitForURL(url + 'calendar/#light-of-time');
  assert.ok(await past.locator('#light-of-time').isVisible(), 'Earlier home links must reach the archived event');
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
  const offer = page.locator('#friend a[href="#services-checkout"]');
  await offer.press('Enter');
  const form = page.locator('#friend-form');
  await form.waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await form.locator('input[name="product"]').getAttribute('value'), 'A-Friend');
  assert.equal(await page.locator('#friend, #services-checkout').getByRole('link', { name: /app store|ahouseproject\.com|демоверси/i }).count(), 0);
  await page.goBack();
  await page.waitForFunction(link => document.activeElement === link, await offer.elementHandle());
  assert.equal(new URL(page.url()).hash, '#friend');
  await page.goBack();
  await page.waitForFunction(({link,top}) => link === document.activeElement &&
    Math.abs(link.getBoundingClientRect().top - top) < 4, { link: await subscription.elementHandle(), top: originalTop });
  assert.equal(new URL(page.url()).hash, '#media');
  await page.goForward();
  await offer.waitFor();
  await page.goForward();
  await form.waitFor();
  assert.equal(new URL(page.url()).hash, '#services-checkout');
}

async function checkCalendar(page, mobile) {
  const activate = locator => mobile ? locator.tap() : locator.press('Enter');
  const all = page.locator('[data-calendar-audience=""]');
  const kids = page.locator('[data-calendar-audience="kids"]');
  const months = page.locator('details.calendar-months');
  const rows = page.locator('[data-calendar-event]:visible');
  const controlsAndResults = () => page.locator('.calendar-opening h1, [data-calendar-audience], .calendar-months summary, .calendar-stream').evaluateAll(elements =>
    elements.map(element => {
      const { left, top } = element.getBoundingClientRect();
      return [left, top];
    })
  );
  await page.goto(url + '#program');
  await activate(page.locator('.home-calendar-link'));
  await page.waitForURL(url + 'calendar/');
  await kids.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const positions = await controlsAndResults();
  for (const choice of [kids, all, kids]) {
    await activate(choice);
    assert.deepEqual(await controlsAndResults(), positions, 'Changing the audience must keep the filters and results in place');
  }
  assert.equal(new URL(page.url()).searchParams.get('audience'), 'kids');
  assert.ok(await rows.count() >= 2);
  assert.deepEqual(await rows.evaluateAll(items => [...new Set(items.map(item => item.dataset.audience))]), ['kids']);
  await activate(months.locator('summary'));
  await activate(months.locator('[data-calendar-month="2024-11"]'));
  const launch = page.locator('#a-kids-first-issue');
  assert.ok(await launch.isVisible());
  assert.equal(await launch.locator('a[href="https://t.me/ahousekids/143"]').count(), 1);
  assert.match(await launch.innerText(), /2024/);
  await page.reload();
  assert.ok(await launch.isVisible());
  const filtered = page.url();
  await activate(launch.getByRole('heading').getByRole('link'));
  await page.waitForURL(url + 'calendar/a-kids-first-issue/');
  assert.ok(await page.locator('h1').isVisible());
  assert.ok(await page.getByRole('main').locator('a[href="https://t.me/ahousekids/143"]').isVisible());
  assert.equal(await page.locator('.event-admission:visible').count(), 0);
  await page.goBack();
  await page.waitForURL(filtered);
  assert.equal(await rows.count(), 1);
  assert.ok(await launch.isVisible());
  await page.goto(url + 'calendar/?month=2000-01&audience=kids');
  assert.equal(await rows.count(), 0);
  assert.ok(await page.locator('[data-calendar-empty]').isVisible());
  await activate(page.locator('[data-jump-past]'));
  await page.waitForURL(url + 'calendar/#past');
  assert.ok(await page.locator('#past [data-calendar-event]:visible').count() > 0);
  await page.goBack();
  await page.locator('[data-calendar-empty]').waitFor();
  await activate(page.locator('[data-calendar-reset]'));
  assert.ok(await rows.count() > 2);
  await page.goBack();
  await page.locator('[data-calendar-empty]').waitFor();
  for (const month of ['2026-05', '2026-06']) {
    await page.goto(url + 'calendar/?month=' + month);
    const festival = page.locator('#a-fest-2026');
    assert.ok(await festival.isVisible());
    assert.equal(await festival.locator('h3 a').getAttribute('href'), base + 'calendar/a-fest-2026/');
  }
  await page.goto(url + 'calendar/');
  assert.equal(await page.locator('h3 a[href="https://dompred.ru/events/marketing-mastermind"]').count(), 1);
}

async function checkVisitorLinks(page, mobile) {
  const activate = link => mobile ? link.tap() : link.press('Enter');
  await page.goto(url + '#industry');
  const jobs = page.locator('#jobs');
  const openings = jobs.locator('.home-job');
  const openingLinks = openings.locator('.home-job-apply');
  const addresses = await openingLinks.evaluateAll(links => links.map(link => link.href));
  const expected = jobCatalog.filter(job => job.status === 'open').map(job => job.url);
  assert.deepEqual(addresses.sort(), expected.sort(), 'The site must list every confirmed opening');
  assert.equal(new Set(addresses).size, addresses.length, 'Each role must open its own application');
  if (expected.length) {
    const summary = openings.first().locator('summary');
    if (!mobile) {
      await page.mouse.move(0, 0);
      const rest = await summary.evaluate(el => getComputedStyle(el).backgroundColor);
      await summary.hover({ position: { x: 10, y: 10 } });
      assert.notEqual(await summary.evaluate(el => getComputedStyle(el).backgroundColor), rest);
    }
    await activate(summary);
    assert.ok(await openingLinks.first().isVisible());
    await activate(summary);
    assert.ok(!await openingLinks.first().isVisible());
    await page.goto(url + '#' + await openings.first().getAttribute('id'));
    await openingLinks.first().waitFor();
  }
  const firstEarlier = jobCatalog.find(job => job.status === 'published');
  if (firstEarlier) {
    assert.equal(await jobs.locator('#job-' + firstEarlier.id).count(), 0);
    await page.goto(url + '#job-' + firstEarlier.id);
    await page.waitForURL(url + '#jobs');
    assert.ok(await jobs.getByRole('heading', { name: 'Работа в A–House' }).isVisible());
  }
  await page.goto(url);
  const about = page.getByRole('main').getByRole('link', {name: 'Об институции', exact: true});
  await about.scrollIntoViewIfNeeded();
  await activate(about);
  await page.waitForURL(url + 'about/');
  const destination = page.getByRole('main');
  assert.ok(await page.locator('.home-masthead').isVisible());
  assert.match(await destination.getByRole('heading', {level: 1}).innerText(), /A–House/);
  assert.match(await destination.innerText(), /Architectural Association/);
  assert.ok(await destination.locator('#patrons img').count() > 15);
  await page.goBack();
  await page.waitForFunction(() => document.activeElement?.pathname.endsWith('/about/'));
  const directions = page.locator('#projects .home-direction');
  const floors = await directions.evaluateAll(elements => elements.map(element => {
    const {top, bottom} = element.getBoundingClientRect();
    return {top, bottom, entrances: element.querySelectorAll('.home-direction-links a').length};
  }));
  assert.equal(floors.length, 4);
  assert.ok(floors.every((floor, i) => floor.entrances >= 2 && (!i || floor.top >= floors[i - 1].bottom)));
  const press = page.locator('#a-media .home-direction-links a[href$="/press/"]');
  await activate(press);
  await page.waitForURL(url + 'press/');
  assert.match(await page.getByRole('heading', {level: 1}).innerText(), /A–Press/);
  await page.goBack();
  await page.waitForFunction(() => document.activeElement?.closest('#a-media .home-direction-links'));
  await activate(page.locator('#projects .home-section-head a[href="#projects"]'));
  await page.waitForURL(url + '#projects');
  assert.equal(await page.locator('#projects .home-project-row').count(), 19);
  await activate(page.locator('.home-project-navigation a[href="#a-media"]'));
  await page.waitForURL(url + '#a-media');
  const register = page.locator('#a-media .home-project-entries');
  assert.ok(await register.isVisible());
  await activate(register.getByRole('link', { name: /Газета\s+A–Sport/ }));
  assert.equal(new URL(page.url()).hash, '#issue-a-sport');
  const photo = page.locator('#issue-a-sport img');
  await photo.evaluate(image => image.decode());
  assert.deepEqual(await photo.evaluate(image => [image.naturalWidth, image.naturalHeight]), [645, 800]);
  await page.goto(url + '#publications');
  const archive = page.getByRole('region', {name: 'Архив публикаций'});
  assert.ok(await archive.getByRole('heading', {name: 'Архив публикаций'}).isVisible());
  const design = archive.getByRole('link', {name: 'Дизайн', exact: true});
  await activate(design);
  await page.waitForURL(url + '#publication-archive-design');
  const rows = archive.locator('.publication-list li:visible');
  assert.ok(await rows.count() > 0);
  assert.ok(await rows.evaluateAll(items => items.every(item => item.dataset.archiveTopics.split(' ').includes('design'))));
  await page.goBack();
  await page.waitForURL(url + '#publications');
  await page.waitForFunction(() => !document.querySelector('#publication-archive .publication-list [hidden]'));
}

async function checkFooterDocuments(page, mobile) {
  const cases = [
    ['', 'agreement', /Пользовательское соглашение/],
    ['calendar/archaeology-of-the-future/', 'politic_a-com', /Политика в отношении обработки персональных данных/i],
    ['agreement/', 'rules', /Правила пользования клубным пространством/i],
    ['a_pass/', 'agreement2', /согласие пользователя на обработку персональных данных/i]
  ];
  for (const [from, slug, title] of cases) {
    const origin = url + from + '#footer-documents';
    await page.goto(origin);
    const footer = page.locator('#t-footer');
    const documents = footer.getByRole('navigation', { name: 'Документы' });
    const links = documents.getByRole('link');
    assert.equal(await links.count(), 4);
    for (const link of await links.all()) assert.ok(await link.isVisible());
    assert.ok(await footer.getByRole('heading', {name: 'Реквизиты'}).isVisible());
    assert.equal(await footer.locator('.footer-channels a').count(), 3);
    assert.ok(await footer.locator('.footer-wordmark img').isVisible());
    assert.ok(await footer.getByRole('radio', {name: 'Как в системе'}).isVisible());
    const opener = documents.locator('a[href$="/' + slug + '/"]');
    await opener.scrollIntoViewIfNeeded();
    const previousTop = (await opener.boundingBox()).y;
    if (mobile) await opener.tap();
    else await opener.press('Enter');
    await page.waitForURL(url + slug + '/');
    const main = page.getByRole('main');
    assert.match((await main.getByRole('heading', { level: 1 }).innerText()).replace(/\s+/g, ' '), title);
    if (slug === 'agreement') assert.ok((await main.innerText()).length > 20000);
    await page.goBack();
    await page.waitForURL(origin);
    const href = await opener.evaluate(link => link.href);
    await page.waitForFunction(href => document.activeElement?.href === href &&
      document.activeElement.closest('#footer-documents'), href);
    assert.ok(Math.abs((await opener.boundingBox()).y - previousTop) < 4, 'Back restores the originating document link');
  }
}

async function checkSpecialProjectPrograms(page, mobile) {
  const activate = element => mobile ? element.tap() : element.press('Enter');
  await page.goto(url + 't_private/');
  if (mobile) {
    assert.equal(await page.locator('.ah-interaction-open:visible').count(), 0,
      'A mobile visitor must reach the program before choosing an event');
  }

  await page.goto(url + 't_bank/');
  const gift = page.locator('a[href="#second"]').filter({ hasText: /Искусство дарить/i }).first();
  await activate(gift);
  const panel = page.locator('[data-tooltip-hook="#second"]');
  await panel.waitFor();
  assert.match(await panel.innerText(), /Искусство дарить/i);
  // The painted backdrop can hide the whole card even when its text passes hit testing.
  assert.ok(await panel.evaluate(dialog => {
    const backdrop = dialog.nextElementSibling;
    if (!backdrop?.matches('.t-popup__bg-active') || !backdrop.getClientRects().length) return true;
    return Number(getComputedStyle(dialog).zIndex) > Number(getComputedStyle(backdrop).zIndex);
  }), 'An open program card must paint above its backdrop');
  await activate(panel.getByRole('button', { name: /закрыть/i }).first());
  await panel.waitFor({state: 'hidden'});

  await page.goto(url + 'mts/');
  await activate(page.getByRole('link', {name: 'Контакты организаторов', exact: true}));
  const email = page.getByRole('dialog').getByRole('link', {name: 'aindex@ahouseproject.com'});
  await email.waitFor();
  assert.ok(await email.evaluate(link => {
    const box = link.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= innerHeight;
  }), 'Opening organizer contacts must reveal the email on the first screen');
  if (mobile) {
    const originalViewport = page.viewportSize();
    await page.setViewportSize({width: 320, height: 568});
    const contacts = page.getByRole('dialog');
    await contacts.locator('img').evaluate(image => image.decode());
    await contacts.locator('.t390__wrapper *').evaluateAll(elements => {
      const sizes = elements.map(element => parseFloat(getComputedStyle(element).fontSize));
      elements.forEach((element, index) => element.style.fontSize = (sizes[index] * 2) + 'px');
    });
    assert.ok(await contacts.evaluate(dialog => {
      const card = dialog.querySelector('.t-popup__container').getBoundingClientRect();
      const title = new Range();
      title.selectNodeContents(dialog.querySelector('.t390__title p'));
      return [...title.getClientRects()].every(line =>
        line.left >= card.left && line.right <= card.right && line.top >= 0 && line.bottom <= innerHeight);
    }), 'Enlarged contact heading must stay legible inside the card after the photo loads');
    await page.setViewportSize(originalViewport);
  }
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
  const documents = page.getByRole('navigation', { name: 'Документы' });
  assert.equal(await documents.getByRole('link').count(), 4);
  assert.ok(await documents.getByRole('link').last().isVisible());
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

  const lists = page.locator('.home-season:visible .home-events');
  for (const list of await lists.all()) {
    const section = page.locator('#program');
    const title = await section.getByRole('heading', {name: 'События', level: 2}).boundingBox();
    const feature = section.locator('[data-home-now]');
    if (await feature.isVisible()) {
      const poster = await feature.boundingBox();
      assert.ok(title.y + title.height <= poster.y, 'The section title must introduce the featured event');
      const secondary = list.locator('article:visible').first();
      if (await secondary.count()) assert.ok(poster.y + poster.height <= (await secondary.boundingBox()).y,
        'The smaller events must follow the featured event');
    }
    const baselines = await list.evaluate(el => {
      if (!matchMedia('(min-width:48.001em)').matches) return [];
      const pair = [...el.children].filter(card => !card.hidden).slice(0, 2);
      if (!pair.length) return [];
      const metrics = document.createElement('canvas').getContext('2d');
      return pair.map(card => card.querySelector('h3')).map(heading => {
        const text = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT).nextNode();
        const firstLetter = document.createRange();
        firstLetter.setStart(text, 0);
        firstLetter.setEnd(text, 1);
        const style = getComputedStyle(heading);
        metrics.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
        return firstLetter.getBoundingClientRect().top + metrics.measureText(firstLetter.toString()).fontBoundingBoxAscent;
      });
    });
    assert.ok(baselines.every(y => Math.abs(y - baselines[0]) < 1),
      'The first lines of the two smaller event titles must share a text baseline');
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
  await page.waitForURL(url + '#publication-archive');
  const listing = page.getByRole('main').getByRole('list', {name: 'Публикации', exact:true});
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
  await page.waitForURL(url + '#publication-archive');
  assert.ok(await listing.getByRole('link', { name: title, exact: true }).isVisible(),
    'The archive must contain the same article on return');

  await page.goto(url + 'special_projects/');
  const clients = page.locator('main .partner-client-list');
  assert.ok(await clients.locator('img').evaluateAll(images => images.length > 0 && images.every(image =>
    Number(image.getAttribute('width')) > 0 && Number(image.getAttribute('height')) > 0)),
    'Project logos must reserve their area before the lazy files arrive');
  assert.equal(await clients.getByRole('link').count(), 0);
  assert.equal(await clients.getByRole('img', {name: /.+/}).count(), 12);
  const projects = page.getByRole('navigation', {name: 'Совместные проекты'}).getByRole('link');
  assert.equal(await projects.count(), 3);
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
  const comparison = page.getByRole('navigation', { name: 'Сравнение программ клуба' });
  const choices = comparison.getByRole('link');
  assert.equal(await choices.count(), 3);
  const chosen = choices.nth(1);
  await chosen.press('Enter');
  const programId = new URL(page.url()).hash.slice(1);
  const card = page.locator('main [data-catalog-card]').nth(1);
  assert.equal(await card.getAttribute('id'), programId);
  const programName = await card.getByRole('heading').innerText();
  await card.getByRole('link', { name: /подать заявку/i }).click();
  await page.waitForURL(url + 'member/?offer=patron');
  assert.equal(await page.locator('.home-masthead').count(), 1);
  const form = page.locator('#member-form');
  const selected = form.getByRole('radio', { name: programName, exact: true });
  assert.ok(await selected.isChecked(), 'The selected club program must follow the visitor into the form');
  await checkMembershipForm(page, 'member');
  await page.goBack();
  await chosen.waitFor();
  assert.equal(new URL(page.url()).hash, '#' + programId);
  await page.goto(url + '#services-checkout');
  await checkMembershipForm(page, 'friend');
}

async function checkMembershipForm(page, kind) {
  const form = page.locator('#' + kind + '-form');
  const email = form.locator('input[type="email"]');
  const name = form.locator('input[name="name"]');
  const submit = form.locator('button[type="submit"]');
  const settings = membershipSettings(kind);
  await name.fill('Тестовый читатель');
  await email.fill('reader');
  await email.press('Tab');
  assert.equal(await email.getAttribute('aria-invalid'), 'true');
  assert.ok(await form.locator('[data-field-error="email"]').isVisible());
  await email.fill('reader@example.invalid');
  assert.equal(await email.getAttribute('aria-invalid'), null);
  assert.equal(await name.inputValue(), 'Тестовый читатель');
  if (settings) {
    assert.equal(await form.getAttribute('method'), 'post');
    assert.equal(await form.getAttribute('action'), settings.action.href);
    const consent = form.locator('[name="consent"]');
    assert.equal(await consent.isChecked(), false);
    await submit.click();
    assert.equal(await consent.getAttribute('aria-invalid'), 'true');
  } else {
    assert.equal(await form.getAttribute('method'), 'dialog');
    assert.equal(await form.getAttribute('action'), null);
    assert.ok(await submit.isDisabled());
    const address = page.url();
    const posted = [];
    const watch = request => { if (request.method() === 'POST') posted.push(request.url()); };
    page.on('request', watch);
    await email.press('Enter');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    page.off('request', watch);
    assert.deepEqual(posted, [], 'An unconnected membership form must never send a visitor’s information');
    assert.equal(page.url(), address);
  }
}

async function checkConsentReturn(page) {
  await page.goto(url + 'a_pass/');
  const form = page.locator('form[data-service-form="a-pass"]');
  const name = form.locator('input[name="name"]');
  await name.fill('Тестовый посетитель');
  const documentLink = form.locator('a[href$="/agreement2/"]');
  const checkbox = documentLink.locator('xpath=ancestor::label').getByRole('checkbox');
  const [tab] = await Promise.all([page.waitForEvent('popup'), documentLink.click()]);
  await tab.getByRole('heading', {level: 1, name: /согласие/i}).waitFor();
  await tab.close();
  assert.equal(await name.inputValue(), 'Тестовый посетитель');
  assert.equal(await checkbox.isChecked(), false, 'Reading a document must not give consent');
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
  await page.locator('#friend-form').waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 0);
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
  const phone = await browser.newPage({ viewport: { width: 375, height: 560 }, isMobile: true, hasTouch: true });
  await checkMobileExhibition(phone);
  await phone.close();
  const motionPage = await browser.newPage({viewport: {width: 1440, height: 900}});
  await checkProjectMotion(motionPage);
  await motionPage.close();
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
    const link = page.getByRole('main').getByRole('heading', { name: /^Дом\s+A[–‑-]House$/i, level: 1 });
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
    await checkHouseVisit(page);
    if (mobile) {
      requested.clear();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(url + 'press/');
      const cover = page.locator('.press-opening-image img');
      await cover.evaluate(image => image.decode());
      assert.match(await cover.evaluate(image => image.currentSrc), /\/stills\//, 'Reduced motion shows a still on the press cover');
      const photo = page.locator('#distribution img');
      const photoURL = await photo.evaluate(image => image.src);
      assert.equal(requested.has(photoURL), false, 'A distant photo loaded before scrolling');
      await photo.scrollIntoViewIfNeeded();
      await photo.evaluate(image => image.decode());
      assert.ok(requested.has(photoURL), 'The distribution map loads when the reader reaches it');
      assert.ok(![...requested].some(src => /\.gif(?:\?|$)/i.test(src)), 'An animated GIF loaded in reduced motion');
      const futurePage = await browser.newPage({ ...pageOptions, reducedMotion: 'reduce' });
      await checkExpiredProgram(futurePage);
      await futurePage.close();
    }
    await checkArchiveReading(page);
    await checkCalendar(page, mobile);
    await checkVisitorLinks(page, mobile);
    await checkFooterDocuments(page, mobile);
    await checkSpecialProjectPrograms(page, mobile);
    await checkClubApplication(page);
    await checkConsentReturn(page);
    console.log('Archive reading, club application and visible word space verified at ' + width + ' px (' + gap.toFixed(2) + ' px).');
    await page.close();
  }
  await checkTheme(browser, url);
  await checkMembershipTransport(browser);
} finally {
  await browser?.close();
  server.close();
}
