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
const printCatalog = JSON.parse(await readFile(path.join(projectRoot, 'src/data/print-editions.json'), 'utf8'));
const projectGroups = JSON.parse(await readFile(path.join(projectRoot, 'src/data/projects.json'), 'utf8'));

async function renderedWordGaps(locator) {
  return locator.evaluate(async element => {
    await document.fonts.ready;
    const nodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const gaps = [];
    let previous;
    let space = false;
    for (let node = nodes.nextNode(); node; node = nodes.nextNode()) {
      for (let index = 0; index < node.length; index++) {
        if (/\s/.test(node.data[index])) {
          space = true;
          continue;
        }
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getBoundingClientRect();
        if (space && previous) gaps.push(rect.top >= previous.bottom ? null : rect.left - previous.right);
        previous = rect;
        space = false;
      }
    }
    return gaps;
  });
}

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

async function checkAboutFilm(page) {
  const film = page.locator('#film');
  const host = film.locator('.institution-video');
  const external = film.getByRole('link', { name: 'Смотреть фильм на YouTube' });
  const videoId = await host.getAttribute('data-content-video-url-youtube');
  assert.equal(new URL(await external.getAttribute('href')).searchParams.get('v'), videoId);
  const originalMotion = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await host.scrollIntoViewIfNeeded();
  assert.equal(await host.locator('iframe').count(), 0, 'Reduced motion waits for an explicit play request');
  const provider = 'https://www.youtube-nocookie.com/embed/';
  const pattern = provider + '**';
  // Exercise the site's response to an unavailable film independently of YouTube's network.
  await page.route(pattern, route => route.fulfill({ contentType: 'text/html', body:
    '<script>addEventListener("message", () => parent.postMessage(JSON.stringify({event:"onError",info:153}), "*"))</script>' }));
  try {
    const request = page.waitForRequest(req => req.url().startsWith(provider + videoId));
    await host.getByRole('button', {name: 'Смотреть фильм об A–House'}).press('Enter');
    const src = new URL((await request).url());
    assert.equal(src.searchParams.get('mute'), '1');
    assert.equal(src.searchParams.get('controls'), '1');
    await film.getByRole('status').filter({hasText: 'Не удалось загрузить фильм'}).waitFor();
    assert.equal(await host.locator('iframe').count(), 0);
    assert.ok(await host.getByRole('button', {name: 'Попробовать ещё раз'}).isVisible());
    assert.ok(await external.isVisible());
  } finally {
    await page.unroute(pattern);
    await page.emulateMedia({ reducedMotion: originalMotion ? 'reduce' : 'no-preference' });
  }
}

async function checkMobileExhibition(page) {
  const events = JSON.parse(await readFile(path.join(projectRoot, 'src/data/events.json'), 'utf8'));
  const feature = events.find(event => event.home === 'feature');
  if (!feature?.photos?.length || !feature.booking) return;
  const cover = feature.photos.find(photo => photo.mobileLead) || feature.photos[0];
  await page.clock.setFixedTime(new Date(feature.start + 'T12:00:00+03:00'));
  await page.goto(url);
  const poster = page.locator('[data-home-now]');
  if (feature.venueId) {
    const map = await poster.locator('.home-venue-link').getAttribute('href');
    assert.ok(map.startsWith('https://') && await page.locator('#visit .home-map-link').evaluateAll(
      (links, destination) => links.some(link => link.href === destination), map),
      'The exhibition address and the corresponding house must open the same map');
  }
  for (const [width, height] of [[320, 480], [320, 568], [375, 560], [390, 664], [390, 740], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => scrollTo({top:0, behavior:'instant'}));
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
    const title = poster.getByRole('heading', { name: feature.title });
    const heading = await title.boundingBox();
    const linkBox = await title.getByRole('link').boundingBox();
    const captionBox = await poster.locator('.home-feature-heading .home-meta').boundingBox();
    const clearance = Math.max(linkBox.y - (captionBox.y + captionBox.height),
      captionBox.y - (linkBox.y + linkBox.height));
    assert.ok(clearance >= 4, 'Keyboard focus around the exhibition title must leave the date unobstructed');
    const place = await poster.locator('.home-venue-link').boundingBox();
    const button = await action.boundingBox();
    const intro = await page.locator('.home-introduction').boundingBox();
    const events = page.locator('.home-program-head');
    assert.ok(intro.y + intro.height <= (await events.boundingBox()).y && frame.bottom <= heading.y &&
      heading.y + heading.height <= height && heading.y + heading.height <= place.y &&
      place.y + place.height <= button.y && button.height >= 44,
      'A first visit introduces A–House, then shows the exhibition photograph and its complete title');
    if (height >= 740) assert.ok(button.y + button.height <= height, 'Booking is visible on a regular phone');
    await events.evaluate(el => el.scrollIntoView({block:'start', behavior:'instant'}));
    const atProgram = await action.boundingBox();
    assert.ok(atProgram.y >= 0 && atProgram.y + atProgram.height <= height, 'Even on a short phone the opening programme fits with its booking action');
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
  await page.goto(url);
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
  const subscription = page.locator('#media a[href="#services-checkout"]');
  const friendLabel = membershipSettings('friend') ? 'Оформить подписку A–Friend' : 'Условия подписки A–Friend';
  assert.equal((await subscription.innerText()).replace(/\s+/g, ' '), friendLabel);
  const originalTop = await subscription.evaluate(async link => {
    await document.fonts.ready;
    link.scrollIntoView({ block: 'center', behavior: 'instant' });
    link.focus({ preventScroll: true });
    return link.getBoundingClientRect().top;
  });
  await page.keyboard.press('Enter');
  assert.equal(new URL(page.url()).hash, '#services-checkout');
  const form = page.locator('#friend-form');
  await form.waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await form.locator('input[name="product"]').getAttribute('value'), 'A-Friend');
  assert.equal(await page.locator('#services-checkout').getByRole('link', { name: /app store|ahouseproject\.com|демоверси/i }).count(), 0);
  await page.goBack();
  await page.waitForFunction(({link,top}) => link === document.activeElement &&
    Math.abs(link.getBoundingClientRect().top - top) < 4, { link: await subscription.elementHandle(), top: originalTop });
  assert.equal(new URL(page.url()).hash, '#media');
  await page.goForward();
  await form.waitFor();
  assert.equal(new URL(page.url()).hash, '#services-checkout');
  await page.goto(url + '#friend');
  assert.ok(await form.isVisible(), 'The former subscription bookmark reaches the same terms and order');
}

async function checkCalendar(page, mobile) {
  const activate = locator => mobile ? locator.tap() : locator.press('Enter');
  const all = page.locator('[data-calendar-audience=""]');
  const kids = page.locator('[data-calendar-audience="kids"]');
  const months = page.getByRole('navigation', { name: 'Месяц события' });
  const rows = page.locator('[data-calendar-event]:visible');
  const controlsAndResults = () => page.locator('.calendar-opening h1, [data-calendar-audience], .calendar-months, .calendar-stream').evaluateAll(elements =>
    elements.map(element => {
      const { left, top } = element.getBoundingClientRect();
      return [left, top];
    })
  );
  await page.goto(url + '#program');
  await page.waitForURL(url + 'calendar/');
  assert.ok(await page.locator('#upcoming').isVisible() && await page.locator('#past').isVisible());
  await kids.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const shortcut = page.locator('.calendar-results-shortcut');
  await shortcut.focus();
  const shortcutBox = await shortcut.boundingBox();
  assert.ok(shortcutBox.height >= 44 && shortcutBox.y < (await months.boundingBox()).y,
    'Keyboard and touch visitors must be able to skip the expanded months');
  await shortcut.press('Enter');
  await page.waitForFunction(() => document.activeElement.id === 'calendar-results');
  await page.goBack();
  assert.equal(await rows.first().getByRole('heading').getByRole('link').evaluate(link =>
    getComputedStyle(link).textDecorationLine), 'underline', 'Event titles must be recognisable as links without hovering');
  const positions = await controlsAndResults();
  for (const choice of [kids, all, kids]) {
    await activate(choice);
    assert.deepEqual(await controlsAndResults(), positions, 'Changing the audience must keep the filters and results in place');
  }
  assert.equal(new URL(page.url()).searchParams.get('audience'), 'kids');
  assert.ok(await rows.count() >= 2);
  assert.deepEqual(await rows.evaluateAll(items => [...new Set(items.map(item => item.dataset.audience))]), ['kids']);
  assert.ok(await months.locator('[data-calendar-month="2024-11"]').isVisible());
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
  const about = page.getByRole('main').getByRole('link', {name: 'Об A–House', exact: true});
  await about.scrollIntoViewIfNeeded();
  await activate(about);
  await page.waitForURL(url + 'about/');
  const destination = page.getByRole('main');
  assert.ok(await page.locator('.home-masthead').isVisible());
  assert.match(await destination.getByRole('heading', {level: 1}).innerText(), /A–House/);
  assert.match(await destination.innerText(), /Architectural Association/);
  assert.ok(await destination.locator('#principles a[href*="hf4zfkc051-otkritie-ahouse"]').isVisible());
  assert.equal(await destination.locator('#patrons img').count(), 22);
  if (mobile) await checkAboutFilm(page);
  await page.goBack();
  await page.waitForFunction(() => document.activeElement?.pathname.endsWith('/about/'));
  assert.equal(await page.locator('#publication-archive').isVisible(), false);
  assert.equal(await page.locator('#projects').isVisible(), false, 'The catalogue opens from navigation as its own view');
  const projects = projectGroups.flatMap(group => group.projects);
  const selected = ['directory','news'].map(key => projects.find(project => project.overview === key));
  const features = page.locator('.home-project-feature:visible');
  assert.deepEqual(await page.locator('#overview > [data-home-section]:visible').evaluateAll(items => items.map(item => item.id)),
    ['program', 'visit', 'media', 'gatherings']);
  assert.ok(await page.locator('#collection-community a[href$="/club/"]').isVisible());
  assert.equal(await page.locator('main a[href*="/member/"]').count(), 0, 'The homepage introduces the club before asking for an application');
  assert.deepEqual(await features.locator('.editorial-pair-title').allInnerTexts(), selected.map(project => project.name));
  assert.deepEqual(await features.locator('.editorial-pair-title a').evaluateAll(links => links.map(link => link.href)), selected.map(project => project.href));
  for (const project of selected) assert.equal(await features.locator('a[href="' + project.href + '"]').count(), 1);
  const portfolios = selected.find(project => project.feature.portfolios).feature.portfolios;
  assert.deepEqual(await features.locator('.home-project-portfolios strong a').evaluateAll(links => links.map(link => link.href)), portfolios.map(item => item.href));
  const editions = page.locator('section[aria-labelledby="collection-editions"]');
  assert.deepEqual(await page.locator('#media h2:visible').allInnerTexts(), ['A–Press', 'A–Index', 'A–News'],
    'Each project has one heading and follows the intended order');
  assert.deepEqual(await editions.locator('.home-editions article h3').allTextContents(), projects.filter(project => project.overview === 'editions').map(project => project.name));
  assert.deepEqual(await editions.locator('.home-editions h3 a').evaluateAll(links => links.map(link => link.hash)),
    printCatalog.map(series => '#' + (series.archiveAnchor || series.seriesId)), 'Every print series opens its own archive');
  assert.equal(await editions.locator(':scope > .editions-access a[href="#services-checkout"]').count(), 1, 'Subscription terms belong to the publisher, outside individual issues');
  assert.equal(await editions.locator(':scope > .editions-access a[href$="press/#distribution"]').count(), 1);
  for (const work of projects.flatMap(project => (project.works || []).map(work => ({...work, href: work.href || project.href})))) {
    const example = page.locator('.project-examples a').filter({hasText: work.title});
    assert.equal(await example.getAttribute('href'), work.href.replace('@@ROOT@@', new URL(url).pathname));
  }
  const forum = page.locator('.home-gathering').filter({has: page.getByRole('heading', {name:'A–Forum', exact:true})});
  assert.equal(await forum.getByRole('link', {name:/Итоги форума/}).getAttribute('href'), 'https://t.me/ahouseproject/10590');
  assert.deepEqual(await page.locator('.home-gathering h3 a').evaluateAll(links => links.map(link => link.href)),
    ['https://news.ahouseproject.com/forum/', 'https://aindexproject.com/fest/']);
  for (const feature of await features.all()) {
    const image = await feature.locator('img').first().boundingBox();
    const title = await feature.locator('.editorial-pair-title').boundingBox();
    const description = await feature.locator('.project-intro').boundingBox();
    assert.ok(image.width > 0 && image.height > 0, 'Reserve the space for each photograph before scrolling to it');
    assert.ok(Math.abs(title.x - image.x) < 2 && title.y + title.height <= image.y + 1);
    assert.ok(mobile ? description.y + description.height <= image.y + 1 : Math.abs(description.y - image.y) < 2);
  }
  await page.goto(url + '#project-stories');
  await page.getByRole('heading', { name: 'A–Index', exact: true }).waitFor();
  assert.equal(await page.locator('#overview').getAttribute('data-view'), 'overview');
  await page.goto(url + '#collection-gatherings');
  assert.ok(await forum.isVisible());
  assert.equal(await page.locator('#overview').getAttribute('data-view'), 'overview');
  await page.goto(url + '#a-industry');
  await page.waitForFunction(() => {
    const { top } = document.getElementById('a-industry').getBoundingClientRect();
    return top >= 0 && top < innerHeight / 2;
  });
  await page.goto(url);
  if (mobile) await page.locator('.site-menu-toggle').tap();
  await activate(page.locator('#site-navigation a[href="#projects"]'));
  await page.waitForURL(url + '#projects');
  assert.equal(await page.locator('#projects .home-project-row:visible').count(), projects.length);
  assert.equal(await page.getByRole('link', { name: 'Спецпроекты и мероприятия' }).getAttribute('href'), new URL('special_projects/', url).pathname);
  const press = page.locator('#a-media .home-project-row[href$="/press/"]');
  await activate(press);
  await page.waitForURL(url + 'press/');
  assert.match(await page.getByRole('heading', {level: 1}).innerText(), /A–Press/);
  const printArchive = page.locator('#print-archive');
  const issueCards = printArchive.locator('.print-issue');
  assert.ok(await page.locator('main .press-file').evaluateAll(links => links.every(link => {
    const action = link.querySelector('.press-file-label');
    const format = link.querySelector('small');
    return action && format && action.textContent === action.textContent.trim() &&
      getComputedStyle(action).textDecorationLine.includes('underline') &&
      getComputedStyle(link).textDecorationLine === 'none' && getComputedStyle(format).textDecorationLine === 'none';
  })), 'PDF labels end at the final letter and the file metadata is outside the underline');
  assert.deepEqual(await issueCards.evaluateAll(items => items.map(item => [...item.querySelectorAll('a')].map(link => link.pathname.split('/').pop()))),
    printCatalog.flatMap(edition => edition.issues.map(issue => issue.files.map(file => file.name))),
    'Every archived issue offers the corresponding files in reading order');
  await activate(printArchive.getByRole('navigation', { name: 'Издания в архиве' }).getByRole('link', { name: 'A–Kids', exact: true }));
  await page.waitForURL(url + 'press/#a-kids');
  const newestKids = printCatalog.find(edition => edition.seriesId === 'a-kids').issues[0];
  assert.equal(await page.locator('#a-kids .print-issue').first().getAttribute('id'), newestKids.id);
  assert.equal(await page.locator('#' + newestKids.id + ' a[href$=".pdf"]').count(), 2, 'Children and adults can both read the newest open A–Kids');
  await page.goBack();
  await page.goto(url + 'press/#a-sport-01');
  await page.waitForFunction(() => Math.abs(document.getElementById('a-sport-01').getBoundingClientRect().top) < innerHeight / 3);
  await page.goBack();
  await page.waitForURL(url + 'press/');
  assert.equal(await page.locator('main a[href$="#services-checkout"]').count(), 1, 'Subscriptions belong to the archive as a whole');
  await activate(printArchive.locator('a[href$="#services-checkout"]'));
  await page.waitForURL(url + '#services-checkout');
  assert.ok(await page.locator('#friend-form').isVisible());
  await page.goBack();
  await page.waitForURL(url + 'press/');
  await page.goBack();
  await page.waitForFunction(() => document.activeElement?.matches('#a-media .home-project-row[href$="/press/"]'));
  await activate(page.locator('.home-project-navigation a[href="#a-media"]'));
  await page.waitForURL(url + '#a-media');
  const register = page.locator('#a-media .home-project-entries');
  assert.ok(await register.isVisible());
  await activate(register.getByRole('link', { name: /Газета\s+A–Sport/ }));
  await page.waitForURL(url + 'press/#a-sport');
  assert.ok(await page.locator('#a-sport-02').isVisible());
  await page.goto(url + '#issue-a-sport');
  await page.waitForURL(url + 'press/#a-sport-02');
  assert.ok(await page.locator('#a-sport-02 .press-file').isVisible());
  await page.goto(url + '#publications');
  await page.waitForURL(url + 'archive/');
  const archive = page.getByRole('main');
  assert.ok(await archive.getByRole('heading', {name: 'Архив сайта A–House', level: 1}).isVisible());
  const all = await archive.locator('.publication-list li').count();
  const design = archive.getByRole('link', {name: 'Дизайн', exact: true});
  await activate(design);
  await page.waitForURL(url + 'archive/design/');
  const rows = archive.locator('.publication-list li');
  assert.ok(await rows.count() > 0 && await rows.count() < all);
  assert.ok(await rows.evaluateAll(items => items.every(item => item.dataset.archiveTopics.split(' ').includes('design'))));
  await page.goBack();
  await page.waitForURL(url + 'archive/');
  assert.equal(await rows.count(), all);
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
    const registry = footer.locator('.footer-registration');
    assert.equal(await registry.getByRole('link').count(), 0);
    const rows = await registry.locator('div').evaluateAll(async items => {
      items[0].getBoundingClientRect();
      await document.fonts.ready;
      return items.map(row => {
        const label = row.querySelector('dt').getBoundingClientRect();
        const value = row.querySelector('dd').getBoundingClientRect();
        return { labelTop: label.top, valueTop: value.top, valueLeft: value.left, rowWidth: row.clientWidth };
      });
    });
    assert.ok(rows.every(row => Math.abs(row.labelTop - row.valueTop) < 1),
      'Registration labels and values must share a line at ' + page.viewportSize().width + ' px on ' + origin + ': ' + JSON.stringify(rows));
    assert.ok(Math.abs(rows[0].valueLeft - rows[1].valueLeft) < 1);
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
  await page.goto(url + 'longevity/');
  const researchTitleFits = await page.locator('.research-opening h1').evaluate(async heading => {
    await document.fonts.ready;
    const column = heading.parentElement.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(heading);
    return [...range.getClientRects()].every(line => line.right <= column.right + 1);
  });
  assert.ok(researchTitleFits, 'The research title must fit its own column beside the illustration');

  await page.goto(url + 't_private/');
  if (mobile) {
    assert.equal(await page.getByRole('dialog').count(), 0,
      'A mobile visitor must reach the program before choosing an event');
  }

  await page.goto(url + 't_bank/');
  const gift = page.locator('a[href="#second"]').filter({ hasText: /Искусство дарить/i }).first();
  await activate(gift);
  const panel = page.getByRole('dialog', {name: /Искусство дарить/});
  await panel.waitFor();
  assert.match(await panel.innerText(), /Искусство дарить/i);
  assert.ok(await panel.evaluate(dialog => dialog.matches(':modal')), 'The event occupies the native modal layer');
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
    await page.addStyleTag({content:'html { font-size: 200%; }'});
    assert.ok(await contacts.evaluate(dialog => {
      const card = dialog.getBoundingClientRect();
      const title = new Range();
      title.selectNodeContents(dialog.querySelector('h2'));
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

  await page.goto(url);
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await page.evaluate(() => document.fonts.ready);
  const vacancies = page.locator('.home-ways a[href="#industry"]');
  await vacancies.evaluate(el => el.scrollIntoView({block: 'center'}));
  const lastWord = await vacancies.evaluate(el => {
    const text = el.firstChild;
    const word = 'вакансию';
    const start = text.textContent.indexOf(word);
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + word.length);
    const rect = range.getBoundingClientRect();
    return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
  });
  await page.mouse.click(lastWord.x, lastWord.y);
  await page.waitForURL(url + '#industry');

  await page.goto(url + 'press/#a-sport');
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await page.locator('#a-sport').evaluate(el => el.scrollIntoView({block: 'start'}));
  await page.waitForFunction(() => {
    const header = document.querySelector('#t-header').getBoundingClientRect();
    return scrollY > innerHeight && Math.abs(header.top) < 1 &&
      document.querySelector('#a-sport').getBoundingClientRect().top >= header.bottom - 1;
  });
  const readingPosition = await page.evaluate(() => scrollY);
  await toggle.evaluate(el => el.focus({preventScroll:true}));
  await page.keyboard.press('Enter');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.ok(await toggle.evaluate(el => el === document.activeElement));
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - readingPosition) < 2,
    'Opening the mobile menu and closing it must preserve the position in the issue archive');

  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.style.fontSize = '200%';
  }, { once: true }));
  for (const bookmark of ['about/#principles', 'calendar/#past']) {
    await page.goto(url + bookmark);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => {
      const title = document.querySelector('main :target h2');
      if (!title) return false;
      const top = title.getBoundingClientRect().top;
      const header = document.querySelector('#t-header').getBoundingClientRect();
      return top >= header.bottom - 1 && top < innerHeight - 24;
    });
  }
}

async function checkEditorialGrouping(page) {
  await page.goto(url + '#media');
  const title = page.locator('#media-title');
  const mobile = page.viewportSize().width < 600;
  const [beforeConjunction, afterConjunction] = await renderedWordGaps(title);
  if (mobile) assert.ok(beforeConjunction === null || beforeConjunction < 0, 'The print section title breaks before «и издательство» on the phone');
  else assert.ok(beforeConjunction > 0, 'The print section title fits on one line on desktop');
  assert.ok(afterConjunction > 0, 'The conjunction must remain on the same line as the noun');

  const renderedLines = locator => locator.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element.firstChild);
    return new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top))).size;
  });
  const specialTitle = page.locator('.home-issue h3').filter({hasText: /A–Focus.*предприни/u});
  const markedWord = specialTitle.locator('.wrap-group');
  if (await specialTitle.count()) assert.equal(await renderedLines(markedWord), 1,
    'Keep the full word «предпринимателя» on a fresh line when it fits in the A–Focus title');

  if (mobile) {
    const viewport = page.viewportSize();
    const menu = page.locator('.site-menu-toggle');
    const largerText = await page.addStyleTag({content: 'html { font-size: 200% !important; }'});
    try {
      await page.setViewportSize({width: 320, height: viewport.height});
      await menu.tap();
      const item = page.locator('#site-navigation a[href$="#media"]');
      const [before, after] = await renderedWordGaps(item);
      assert.ok(before > 0 && (after === null || after < 0), 'In the enlarged menu «Журнал и» still has room on the first line');
      assert.equal(await renderedLines(item.getByText('издательство', {exact: true})), 1,
        'At 320px and 200% text the whole noun fits on a fresh menu line');
    } finally {
      if (await menu.getAttribute('aria-expanded') === 'true') await menu.tap();
      await largerText.evaluate(style => style.remove());
      await page.setViewportSize(viewport);
    }
  }
  await page.goto(url);
  const festival = page.locator('.home-gathering').filter({ hasText: 'A–Fest' });
  const countLines = await festival.locator('p').last().evaluate(async el => {
    await document.fonts.ready;
    const text = el.firstChild;
    const y = offset => {
      const range = document.createRange();
      range.setStart(text, offset);
      range.setEnd(text, offset + 1);
      return range.getBoundingClientRect().top;
    };
    return [...text.textContent.matchAll(/(\d+)\s+(архитектурных|экскурсий)/gu)].map(match =>
      Math.abs(y(match.index) - y(match.index + match[0].indexOf(match[2]))));
  });
  assert.equal(countLines.length, 2, 'Check both quantities in the A–Fest announcement');
  assert.ok(countLines.every(delta => delta < 1), 'A quantity must share a line with the start of what it counts');

  const issue = page.locator('.home-current-issue');
  const group = await issue.evaluate(async el => {
    await document.fonts.ready;
    const cover = el.querySelector('figure').getBoundingClientRect();
    const label = el.querySelector('.home-kicker');
    const number = label.getBoundingClientRect();
    const story = el.querySelector('.home-issue-story').getBoundingClientRect();
    return { gap: number.left - cover.right, offset: number.top - cover.top, storyOffset: story.top - cover.top,
      titleBottom: el.querySelector('.home-issue-title h3').getBoundingClientRect().bottom, coverTop: cover.top, small: matchMedia('(max-width: 48em)').matches, em: parseFloat(getComputedStyle(label).fontSize) };
  });
  if (group.small) assert.ok(group.titleBottom < group.coverTop && Math.abs(group.storyOffset) < group.em,
    'On the phone the full title introduces the cover and the adjacent story');
  else assert.ok(Math.abs(group.offset) < group.em && group.gap >= 0 && group.gap <= 2.5 * group.em,
    'The issue date must sit beside the upper edge of its cover');

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
      const entry = { top: card.getBoundingClientRect().top, paid: Boolean(card.querySelector('.home-event-amount')) };
      if (!entry.paid) return entry;
      const price = card.querySelector('.home-event-amount');
      const address = card.querySelector('.home-detail');
      const description = address?.getClientRects().length ? address : link.querySelector('.home-event-info > p:last-child');
      if (!price || !description) return entry;
      const text = document.createRange();
      text.selectNodeContents(price);
      const lines = [...text.getClientRects()].filter(rect => rect.width > 0);
      if (!lines.length) return entry;
      return { ...entry, regular: getComputedStyle(price).fontWeight === getComputedStyle(price.parentElement).fontWeight, endOfCopy: description.getBoundingClientRect().bottom,
        priceTop: lines[0].top, priceBottom: lines.at(-1).bottom, sameLine: lines.every(rect => Math.abs(rect.top - lines[0].top) < 1) };
    }));
    for (const [index, entry] of entries.entries()) {
      if (!entry.paid) continue;
      assert.ok(entry.regular, 'An amount must share the weight of its booking label');
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
  await page.getByRole('main').getByRole('link', { name: /в архив сайта/i }).click();
  await page.waitForURL(url + 'archive/');
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
  await main.getByRole('link', { name: /в архив сайта/i }).click();
  await page.waitForURL(url + 'archive/');
  assert.ok(await listing.getByRole('link', { name: title, exact: true }).isVisible(),
    'The archive must contain the same article on return');

  await page.goto(url + 'tpost/svnul2ze71-pervii-vipusk-detskogo-zhurnala-akids-so/');
  const covers = page.getByRole('group', { name: 'Выбрать изображение' }).getByRole('button');
  assert.equal(await covers.count(), 2);
  await covers.nth(1).click();
  await page.waitForFunction(() => {
    const track = document.querySelector('.archive-gallery-track');
    return Math.abs(track.scrollLeft - track.clientWidth) < 2 &&
      document.querySelector('.archive-gallery-controls [role="status"]').textContent === '2 из 2';
  });
  assert.equal(await covers.nth(1).getAttribute('aria-current'), 'true');
  await covers.nth(1).press('Home');
  assert.ok(await covers.first().evaluate(button => button.matches(':focus-visible') && button.getAttribute('aria-current') === 'true'));

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
  await page.waitForURL(url + 'club/');
  await page.goto(url);
  await page.locator('#collection-community').getByRole('link', {name:'Клуб A–House'}).click();
  await page.waitForURL(url + 'club/');
  await page.getByRole('link', {name:'Программы участия'}).press('Enter');
  await page.waitForURL(url + 'club/#programs');
  const programs = page.locator('#programs [data-catalog-card]');
  assert.equal(await programs.count(), 3);
  const card = programs.nth(1);
  const programName = await card.getByRole('heading').innerText();
  const memberOpen = Boolean(membershipSettings('member'));
  assert.equal(await card.locator('.club-application-status').count(), memberOpen ? 0 : 1);
  const action = memberOpen ? 'Подать заявку' : 'Посмотреть анкету';
  const application = card.getByRole('link', { name: action + ' по программе ' + programName });
  await application.evaluate(link => link.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const position = await application.evaluate(link => ({ href: link.href, top: link.getBoundingClientRect().top }));
  await application.click();
  await page.waitForURL(url + 'member/?offer=patron');
  assert.equal(await page.locator('.home-masthead').count(), 1);
  const form = page.locator('#member-form');
  const selected = form.getByRole('radio', { name: programName, exact: true });
  assert.ok(await selected.isChecked(), 'The selected club program must follow the visitor into the form');
  const intro = await page.locator('#member-intro').innerText();
  assert.match(intro.replace(/\s+/g, ' '), memberOpen ? /оставьте контакты/ : /^Приём заявок на сайте закрыт/);
  await checkMembershipForm(page, 'member');
  await page.goBack();
  await card.waitFor();
  assert.equal(new URL(page.url()).hash, '#programs');
  await page.waitForFunction(({ href, top }) => document.activeElement?.href === href &&
    Math.abs(document.activeElement.getBoundingClientRect().top - top) <= 2 && history.scrollRestoration === 'auto', position);
  await page.goto(url + '#services-checkout');
  const friendOpen = Boolean(membershipSettings('friend'));
  assert.equal(await page.locator('#friend-availability').count(), friendOpen ? 0 : 1);
  assert.equal(await page.locator('#friend-form-heading').innerText(), friendOpen ? 'Оформить подписку' : 'Форма заказа');
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
  const headingGap = name => section(name).locator('h2').first().evaluate(heading =>
    heading.getBoundingClientRect().top - document.getElementById('t-header').getBoundingClientRect().bottom);
  for (const [anchor, title] of [['visit', 'Дома и адреса'], ['media', 'Журнал и издательство'], ['services-checkout', 'A–Friend']]) {
    await page.goto(url + '#' + anchor);
    assert.equal(await page.title(), title + ' — A–House');
    await page.locator('.skip-content').press('Enter');
    assert.equal(page.url(), url + '#' + anchor, 'Skipping the header must preserve the selected view');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'site-content');
    await page.keyboard.press('Tab');
    const visibleSection = section(anchor);
    assert.ok(await visibleSection.evaluate(el => el.contains(document.activeElement)),
      'Reading must continue inside the original section');
  }
  await checkReadingReturn(page, mobile);
  await page.goto(url);
  await checkEditorialGrouping(page);
  const menu = page.locator('.site-menu-toggle');
  const calendarLink = page.locator('.site-navigation a[href$="/calendar/"]');
  assert.equal(await section('program').isVisible(), true);
  assert.equal(await section('media').isVisible(), true);
  assert.equal(await section('club').isVisible(), false, 'The overview must keep club details in their own view');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const printArchive = page.locator('.home-print').getByRole('link', {name: 'Архив печатных номеров', exact: true});
  await printArchive.press('Enter');
  await page.waitForURL(url + 'press/#print-archive');
  assert.ok(await page.locator('#print-archive .press-file').first().isVisible());
  await page.goBack();
  assert.equal(await page.locator('#t-header a[href$="/archive/"], #t-footer a[href$="/archive/"]').count(), 0);
  const pastEvents = page.locator('#gatherings a[href$="calendar/#past"]');
  await pastEvents.press('Enter');
  await page.waitForURL(url + 'calendar/#past');
  assert.ok(await page.getByRole('heading', {name:'Прошедшие события',exact:true}).isVisible());
  await page.goBack();
  await page.waitForFunction(() => document.activeElement?.matches('#gatherings a[href$="calendar/#past"]'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await menu.isVisible(), mobile, 'Only a compact header needs a menu toggle');
  assert.equal(await choice('media').isVisible(), !mobile, 'Desktop sections should be visible before interaction');
  if (!mobile) {
    const links = page.locator('#site-navigation a:visible');
    const rows = await links.evaluateAll(items => items.map(a => Math.round(a.getBoundingClientRect().top)));
    assert.ok(rows.length > 1 && Math.max(...rows) - Math.min(...rows) < 2, 'Desktop destinations must share one visible row');
  }
  if (mobile) {
    const houses = page.locator('.home-tools > a');
    await menu.focus();
    await menu.scrollIntoViewIfNeeded();
    const housesClosed = await houses.boundingBox();
    await page.keyboard.press('Enter');
    assert.equal(await menu.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await houses.boundingBox(), housesClosed, 'Opening the menu must keep the address shortcut in place');
    assert.ok(await page.locator('#site-content').evaluate(el => el.inert), 'The full-screen menu covers the page content');
    const maps = page.locator('.menu-visit a:visible');
    assert.equal(await maps.count(), 2);
    await page.keyboard.press('Escape');
    assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    assert.ok(await menu.evaluate(el => el === document.activeElement), 'Escape must return focus to the menu toggle');
    assert.equal(await page.locator('#site-content').evaluate(el => el.inert), false);
    await menu.press('Enter');
    await maps.last().focus();
    await page.keyboard.press('Tab');
    assert.ok(await page.locator('#site-content').evaluate(el => el.contains(document.activeElement)),
      'Tab past the last direction link must continue into the page');
    await menu.focus();
    await page.keyboard.press('Enter');
    await calendarLink.press('Enter');
    await page.waitForURL(url + 'calendar/');
    assert.equal(await menu.getAttribute('aria-expanded'), 'false', 'Choosing a section must close the mobile menu');
    await page.goBack();
  }
  if (mobile && await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
  await choice('media').click();
  await section('media').waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).hash, '#media');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'media-title');
  const readingGap = await headingGap('media');
  assert.equal(await choice('media').getAttribute('aria-current'), 'true');
  assert.equal(await section('program').isVisible(), false);
  assert.equal(await section('media').getByRole('heading', {name: 'A–Index', exact: true}).count(), 0);
  const jumpToNews = section('media').getByRole('link', {name: 'К онлайн-журналу A–News'});
  await (mobile ? jumpToNews.tap() : jumpToNews.press('Enter'));
  await page.waitForURL(url + '#a-news');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'a-news');
  const article = section('media').getByRole('article', {name: 'A–News'}).locator('.project-examples a').first();
  assert.ok(await article.isVisible(), 'The reading selection must open an individual editorial item');
  await page.goBack();
  await page.waitForURL(url + '#media');
  assert.equal(await section('media').locator('.publication-list, .home-archived-issue').count(), 0);
  await page.evaluate(() => { location.hash = 'publication-archive-design'; });
  await page.waitForURL(url + 'archive/design/');
  await page.goBack();
  await page.waitForURL(url + '#media');
  await page.waitForFunction(() => document.title === 'Журнал и издательство — A–House');
  if (mobile) await menu.click();
  await calendarLink.press('Enter');
  await page.waitForURL(url + 'calendar/');
  assert.ok(await page.locator('#upcoming').isVisible() && await page.locator('#past').isVisible());
  await page.goBack();
  await section('media').waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).hash, '#media', 'Back must restore the chosen reading view');
  await page.goto(url + '#services-checkout');
  await page.locator('#friend-form').waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await page.goto(url + '#visit');
  await section('visit').waitFor({ state: 'visible' });
  assert.ok(readingGap > 0 && Math.abs(await headingGap('visit') - readingGap) <= 1,
    'The house addresses and reading sections must start at the same distance below the masthead');
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
    const [gap] = await renderedWordGaps(link);
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
    await page.goto(url + 'calendar/a-forum-2026/');
    const report = page.getByRole('main').getByRole('link', {name: 'Репортаж A–House On Air'});
    const reportGaps = await renderedWordGaps(report);
    assert.equal(reportGaps.length, 3);
    assert.ok(reportGaps.every(gap => gap > 1), 'All three word spaces in the A–Forum report link must be visible');
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
