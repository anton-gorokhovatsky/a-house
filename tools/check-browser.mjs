import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, devices, webkit } from 'playwright-core';
import { membershipSettings, projectRoot, readEventCatalog, siteBase } from './build.mjs';
import { eventDestination } from './calendar.mjs';
import { previewServer } from './preview.mjs';
import { checkMembershipTransport } from './check-membership.mjs';
import { checkTheme } from './check-theme.mjs';
import { checkFeaturePages } from './check-feature-pages.mjs';

const useWebKit = process.argv[2] === '--webkit';
const outputDirectory = process.argv[useWebKit ? 3 : 2];
const base = siteBase(process.env.SITE_BASE);
const server = previewServer(path.resolve(outputDirectory ?? path.join(projectRoot, 'dist')), base);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = 'http://127.0.0.1:' + server.address().port + base;
const jobCatalog = JSON.parse(await readFile(path.join(projectRoot, 'src/data/jobs.json'), 'utf8')).jobs;
const printCatalog = JSON.parse(await readFile(path.join(projectRoot, 'src/data/print-editions.json'), 'utf8'));
const bookCatalog = JSON.parse(await readFile(path.join(projectRoot, 'src/data/press-books.json'), 'utf8'));
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
  const events = await readEventCatalog();
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
    assert.ok(await title.evaluate(element =>
      parseFloat(getComputedStyle(element).fontSize) >
      parseFloat(getComputedStyle(document.querySelector('#home-program-heading')).fontSize)),
    'The overview label must stay subordinate to the featured exhibition title');
    const details = title.getByRole('link', { name: feature.title });
    assert.equal(await details.getAttribute('href'), eventDestination(feature, new URL('calendar/', url).pathname));
    assert.ok((await details.boundingBox()).height >= 44);
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
  await poster.getByRole('link', { name: feature.title }).tap();
  await page.waitForURL(url + 'calendar/' + feature.id + '/');
  const report = feature.links?.find(link => link.role === 'report');
  if (report) assert.equal(await page.getByRole('link', {name:report.label, exact:true}).getAttribute('href'), report.url);
  await page.goBack();
  await page.waitForURL(url);
  assert.ok(await poster.getByRole('link', { name: feature.title }).isVisible());
}

async function checkHomeNavigation(page) {
  await page.goto(url + '#projects');
  await page.evaluate(() => document.fonts.ready);
  const link = page.locator('.home-project-navigation a[href="#a-presence"]');
  const destination = page.locator('#a-presence');
  const arrived = () => {
    const header = document.getElementById('t-header').getBoundingClientRect();
    const top = document.getElementById('a-presence').getBoundingClientRect().top;
    return header.top === 0 && top >= header.bottom - 1 && top < header.bottom + 60;
  };
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
      assert.ok(await page.evaluate(arrived), 'Reduced motion must arrive immediately below the pinned menu');
    }
    await page.waitForFunction(arrived);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'a-presence');
    await page.goBack();
    await page.waitForFunction(() => document.activeElement?.matches('.home-project-navigation a[href="#a-presence"]'));
  }
  await page.goto(url);
  const scroll = await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 1500);
    return scrollY;
  });
  assert.ok(scroll > 0);
  const publication = page.locator('#site-navigation').getByRole('link', {name: 'Издательство', exact: true});
  const headerBox = await page.locator('#t-header').boundingBox();
  const box = await publication.boundingBox();
  assert.ok(headerBox.y === 0 && box.y >= 0 && box.y + box.height <= headerBox.height);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForURL(url + 'press/');
  await page.goBack();
  await page.waitForFunction(y => Math.abs(scrollY - y) <= 2 &&
    document.activeElement?.matches('#site-navigation a[href$="/press/"]'), scroll);
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
  const friendLabel = membershipSettings('friend') ? 'Оформить подписку A–Friend' : 'Условия подписки A–Friend';
  const form = page.locator('#friend-form');
  const origins = [
    ['', '.home-friend-promo'],
    ['press/#current-issues', '#current-issues'],
    ['press/#print-archive', '#print-archive']
  ];
  for (const [path, section] of origins) {
    const origin = url + path;
    await page.goto(origin);
    const subscription = page.locator(section + ' a[href$="#services-checkout"]');
    assert.equal((await subscription.innerText()).replace(/\s+/g, ' '), friendLabel);
    assert.equal(await subscription.evaluate(link => link.href), url + '#services-checkout');
    const activationMarker = 'Subscription link position ';
    await subscription.evaluate(async (link, marker) => {
      await document.fonts.ready;
      link.scrollIntoView({ block: 'center', behavior: 'instant' });
      link.addEventListener('click', () => console.debug(marker + link.getBoundingClientRect().top), { once: true });
    }, activationMarker);
    const [activation] = await Promise.all([
      page.waitForEvent('console', {predicate: message => message.text().startsWith(activationMarker)}),
      mobile ? subscription.tap() : subscription.press('Enter')
    ]);
    const top = Number(activation.text().slice(activationMarker.length));
    assert.ok(Number.isFinite(top));
    await page.waitForURL(url + '#services-checkout');
    await form.waitFor();
    assert.equal(await page.locator('dialog[open]').count(), 0);
    assert.equal(await form.locator('input[name="product"]').getAttribute('value'), 'A-Friend');
    assert.equal(await page.locator('#services-checkout').getByRole('link', { name: /app store|ahouseproject\.com|демоверси/i }).count(), 0);
    await page.goBack();
    await page.waitForURL(origin);
    await page.waitForFunction(({link, top}) => link === document.activeElement &&
      Math.abs(link.getBoundingClientRect().top - top) < 4, { link: await subscription.elementHandle(), top });
  }
  await page.goForward();
  await page.waitForURL(url + '#services-checkout');
  await form.waitFor();
  await page.goto(url + '#friend');
  assert.ok(await form.isVisible(), 'The former subscription bookmark reaches the same terms and order');
}

async function checkCalendar(page, mobile) {
  const activate = locator => mobile ? locator.tap() : locator.press('Enter');
  const all = page.locator('[data-calendar-audience=""]');
  const kids = page.locator('[data-calendar-audience="kids"]');
  const months = page.getByRole('navigation', { name: 'Месяц события' });
  const rows = page.locator('[data-calendar-event]:visible');
  const controlsAndResults = () => page.locator('.calendar-opening h1, [data-calendar-audience], #calendar-filters .calendar-months, .calendar-stream').evaluateAll(elements =>
    elements.map(element => {
      const { left, top } = element.getBoundingClientRect();
      return [left, top];
    })
  );
  await page.goto(url + '#program');
  await page.waitForURL(url + 'calendar/');
  assert.ok(await page.locator('#upcoming').isVisible() && await page.locator('#past').isVisible());
  await kids.waitFor();
  assert.equal(await months.evaluate(el => el.parentElement.id), mobile ? 'past' : 'calendar-filters');
  if (mobile) {
    const firstEvent = await rows.first().boundingBox();
    assert.ok(firstEvent.y < (await months.boundingBox()).y, 'Upcoming events precede the archive controls on a phone');
  }
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
  assert.ok(await months.isVisible(), 'A visitor can choose another month after an empty result');
  await activate(page.locator('[data-jump-past]'));
  await page.waitForURL(url + 'calendar/#past');
  assert.ok(await page.locator('#past [data-calendar-event]:visible').count() > 0);
  if (!mobile) {
    const header = await page.locator('#t-header').boundingBox();
    const filterBox = await page.locator('#calendar-filters').boundingBox();
    assert.ok(filterBox.y >= header.y + header.height, 'Calendar filters stay below the pinned menu');
  }
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

async function checkArchiveMonths(page) {
  const december = page.locator('#past [data-calendar-month="2026-12"]');
  const upcoming = page.locator('#upcoming [data-calendar-event]:visible');
  const archived = page.locator('#past [data-calendar-event]:visible');
  await page.clock.setFixedTime(new Date('2026-11-26T12:00:00+03:00'));
  await page.goto(url + 'calendar/#past');
  assert.equal(await december.isVisible(), false, 'An upcoming-only month is absent from the mobile archive');
  assert.ok(await page.locator('#upcoming [data-start^="2026-12"]:visible').count() > 0,
    'Upcoming December events remain in the program');
  await page.locator('#past [data-calendar-month="2026-11"]').tap();
  await page.waitForURL(url + 'calendar/?month=2026-11#past');
  assert.ok(await archived.count() > 0);
  assert.ok(await archived.evaluateAll(rows => rows.every(row =>
    row.dataset.end >= '2026-11-01' && row.dataset.end < '2026-11-26'
  )));
  await page.goBack();
  await page.waitForURL(url + 'calendar/#past');
  assert.equal(await page.locator('#past [data-calendar-month=""]').getAttribute('aria-current'), 'true');

  await page.goto(url + 'calendar/?month=2026-12');
  await page.waitForURL(url + 'calendar/?month=2026-12');
  assert.ok(await upcoming.count() > 0, 'Existing upcoming month links still open the program');
  assert.equal(await archived.count(), 0);

  await page.clock.setFixedTime(new Date('2026-12-02T00:00:00+03:00'));
  await page.goto(url + 'calendar/#past');
  await december.tap();
  await page.waitForURL(url + 'calendar/?month=2026-12#past');
  assert.ok(await page.locator('#past [data-start="2026-12-01"]:visible').count() > 0);
  assert.ok(await upcoming.count() > 0);
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
  await page.waitForFunction(() => document.activeElement?.pathname?.endsWith('/about/'));
  assert.equal(await page.locator('#publication-archive').isVisible(), false);
  assert.equal(await page.locator('#projects').isVisible(), false, 'The catalogue opens from navigation as its own view');
  const projects = projectGroups.flatMap(group => group.projects);
  const selected = ['news','directory'].map(key => projects.find(project => project.overview === key));
  const features = page.locator('.home-project-feature:visible');
  assert.deepEqual(await page.locator('#overview > [data-home-section]:visible').evaluateAll(items => items.map(item => item.id)),
    ['program', 'visit', 'gatherings']);
  assert.ok(await page.locator('#collection-community a[href$="/club/"]').isVisible());
  assert.equal(await page.locator('main a[href*="/member/"]').count(), 0, 'The homepage introduces the club before asking for an application');
  assert.deepEqual(await features.locator('.editorial-pair-title').allInnerTexts(), selected.map(project => project.name));
  assert.equal(await page.locator('#media h3.editorial-pair-title a, .home-community-project h3 a, .home-places h3 a').count(), 0,
    'An open project or venue has a plain heading and a separate link to its own page');
  for (const project of selected) {
    const action = features.getByRole('link', { name: project.overviewLinkLabel, exact: true });
    assert.equal(await action.getAttribute('href'), project.href);
  }
  for (const project of selected) assert.equal(await features.locator('a[href="' + project.href + '"]').count(), 1);
  const portfolios = selected.find(project => project.feature.portfolios).feature.portfolios;
  assert.deepEqual(await features.locator('.home-project-portfolios h4 a').evaluateAll(links => links.map(link => link.href)), portfolios.map(item => item.href));
  const editions = page.locator('section[aria-labelledby="collection-editions"]');
  const pressFeature = editions.getByRole('article', {name: 'A–Build о новом Доме A–House'});
  const cover = pressFeature.locator('.press-featured-cover');
  await cover.scrollIntoViewIfNeeded();
  await cover.evaluate(image => image.decode());
  const photo = await cover.getAttribute('src');
  const issueLink = pressFeature.getByRole('link', {name: 'О выпуске A–Build', exact: true});
  assert.equal(await issueLink.locator('.external-link-mark').count(), 0);
  await activate(issueLink);
  await page.waitForURL(url + 'press/#a-build');
  const issue = page.getByRole('article', {name: 'A–Build о новом Доме A–House'});
  await issue.getByRole('heading', {level: 2}).waitFor();
  assert.equal(await issue.locator('.press-featured-cover').getAttribute('src'), photo);
  assert.ok(await issue.evaluate(element => Boolean(
    element.compareDocumentPosition(document.getElementById('current-issues')) & Node.DOCUMENT_POSITION_FOLLOWING
  )));
  const announcement = issue.getByRole('link', {name: 'О выпуске в Telegram', exact: true});
  assert.equal(await announcement.getAttribute('href'), 'https://t.me/ahouseproject/10610');
  assert.equal(await announcement.locator('.external-link-mark').getAttribute('aria-hidden'), 'true');
  await page.goBack();
  await page.waitForURL(url);
  await issueLink.waitFor({state:'visible'});
  const archiveLink = editions.getByRole('link', {name:'Архив печатных номеров', exact:true});
  assert.equal(await archiveLink.evaluate(link => link.href), url + 'press/#print-archive');
  const editorialTitles = await page.locator('#media h3.editorial-pair-title:visible').allInnerTexts();
  assert.deepEqual(editorialTitles.map(title => title.replaceAll('\u00ad', '').replace(/\s+/g, ' ')), ['Издательство A–Press', 'A–News'],
    'The home reading highlights introduce the publisher and online journal');
  assert.equal(await page.locator('main .home-editions, main .print-issue, main .press-book').count(), 0);
  const chooseBooks = editions.getByRole('link', {name:'Книги A–Press'});
  await activate(chooseBooks);
  await page.waitForURL(url + 'press/books/');
  await page.getByRole('heading', {name:'Книги A–Press', level:1}).waitFor();
  assert.deepEqual(await page.locator('.press-book-title').allInnerTexts(), bookCatalog.map(book => book.title));
  assert.deepEqual(await page.locator('.press-book .book-preview a').evaluateAll(links => links.map(link => link.href)), bookCatalog.map(book => book.href));
  await page.goBack();
  await page.waitForURL(url);
  await chooseBooks.waitFor({state:'visible'});
  await page.waitForFunction(link => document.activeElement === link, await chooseBooks.elementHandle());
  const periodicalProjects = projects.filter(project => project.overview === 'editions');
  for (const work of projects.filter(project => project.overview !== 'editions')
    .flatMap(project => (project.works || []).map(work => ({...work, href: work.href || project.href})))) {
    const example = page.locator('.project-examples a').filter({hasText: work.title});
    assert.equal(await example.getAttribute('href'), work.href.replace('@@ROOT@@', new URL(url).pathname));
  }
  const gatherings = page.locator('#gatherings');
  const forum = gatherings.locator('article').filter({has: page.getByRole('heading', {name:'A–Forum', exact:true})});
  const festival = gatherings.locator('article').filter({has: page.getByRole('heading', {name:'A–Fest', exact:true})});
  assert.equal(await gatherings.locator('a[href$="/calendar/#past"]').count(), 0);
  assert.equal(await gatherings.locator('h3 a').count(), 0, 'The project names introduce their articles');
  const forum2026 = forum.getByRole('listitem').filter({has: page.locator('time[datetime="2026-11-12"]')});
  const festival2026 = festival.getByRole('listitem').filter({has: page.locator('time[datetime="2026-05-21"]')});
  assert.equal(await forum2026.getByRole('link', {name:'Программа A–Forum 2026'}).getAttribute('href'), 'https://news.ahouseproject.com/forum/');
  assert.equal(await forum2026.getByRole('link', {name:/Итоги первого форума/}).getAttribute('href'), 'https://t.me/ahouseproject/10590');
  assert.equal(await festival2026.getByRole('link', {name:'Выставка «Архитектура 2.0»'}).getAttribute('href'), 'https://aindexproject.com/fest/');
  assert.equal(await festival2026.getByRole('link', {name:/Фоторепортаж со второго фестиваля/}).getAttribute('href'), 'https://t.me/ahouseproject/7777');
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
  for (const id of ['a-forum','a-fest']) {
    const project = page.locator('#projects .home-project-row[href="#' + id + '"]');
    await activate(project);
    await page.waitForURL(url + '#' + id);
    assert.equal(await page.evaluate(() => document.activeElement.id), id);
    assert.ok(await gatherings.isVisible());
    await page.goBack();
    await page.waitForFunction(id => document.activeElement.getAttribute('href') === '#' + id, id);
  }
  assert.equal(await page.locator('#projects a[href$="special_projects/"]').count(), 0);
  const press = page.locator('#a-media .home-project-row[href$="/press/"]');
  await activate(press);
  await page.waitForURL(url + 'press/');
  assert.match(await page.getByRole('heading', {level: 1}).innerText(), /A–Press/);
  assert.equal(await page.locator('main .press-book').count(), 0);
  const current = page.locator('#current-issues');
  assert.ok(await current.locator('.home-action').evaluate(action => Boolean(
    action.previousElementSibling?.matches('.press-friend-issues')
  )));
  const latestIssues = printCatalog.filter(series => series.latest)
    .sort((a, b) => b.latest.published.localeCompare(a.latest.published));
  const featured = latestIssues.find(series => series.latest.cover);
  const issueOrder = featured ? [featured, ...latestIssues.filter(series => series !== featured)] : latestIssues;
  const issueTitles = await current.locator('.press-featured-issue h3, .press-friend-issues li p:first-child').allTextContents();
  const plainText = text => text.replaceAll('\u00ad', '').replace(/\s+/g, ' ').trim();
  assert.deepEqual(issueTitles.map(plainText), issueOrder.map(({edition, latest}) => plainText(edition + ' № ' + latest.number + ' ' + latest.topic)));
  assert.deepEqual(await current.locator('.press-friend-issues time').evaluateAll(dates => dates.map(date => date.dateTime)),
    issueOrder.map(({latest}) => latest.published));
  if (featured) assert.equal(await current.locator('.press-featured-cover').evaluate(image => image.src), new URL(featured.latest.cover.src, url).href);
  const periodicals = page.locator('#periodicals');
  assert.deepEqual((await periodicals.locator('.home-edition-brief h3').allTextContents()).map(plainText),
    periodicalProjects.map(project => project.name));
  for (const series of printCatalog) {
    const destination = new URL('press/#' + (series.archiveAnchor || series.seriesId), url);
    assert.ok(await periodicals.locator('a[href="' + destination.pathname + destination.hash + '"]').first().isVisible());
  }
  for (const project of periodicalProjects) {
    for (const work of project.works) {
      const example = periodicals.locator('.project-examples a').filter({hasText: work.title});
      assert.equal(await example.getAttribute('href'), (work.href || project.href).replace('@@ROOT@@', new URL(url).pathname));
    }
  }
  assert.equal(await periodicals.locator('a[href="#distribution"]').count(), 0);
  assert.equal(await periodicals.getByRole('link', {name:/Медиакит A–Press\s+PDF\s+·\s+10\s+МБ/}).getAttribute('href'),
    new URL('media/press/a-press-media-kit.pdf', url).pathname);
  const publisherContents = page.getByRole('navigation', {name:'Разделы издательства'});
  const booksTab = publisherContents.getByRole('link', {name:'Книги A–Press', exact:true});
  const archiveTab = publisherContents.getByRole('link', {name:'Архив печатных номеров', exact:true});
  await booksTab.scrollIntoViewIfNeeded();
  const booksTop = (await booksTab.boundingBox()).y;
  await activate(booksTab);
  await page.waitForURL(url + 'press/books/');
  await page.getByRole('heading', {name:'Книги A–Press', level:1}).waitFor();
  assert.equal(await publisherContents.locator('[aria-current="page"]').innerText(), 'Книги A–Press');
  assert.equal(await archiveTab.evaluate(link => link.href), url + 'press/#print-archive');
  assert.equal(await page.locator('main .print-issue, main #a-focus').count(), 0);
  await page.goBack();
  await page.waitForURL(url + 'press/');
  await page.waitForFunction(({link, top}) => document.activeElement === link &&
    Math.abs(link.getBoundingClientRect().top - top) < 4, {link: await booksTab.elementHandle(), top: booksTop});
  await activate(archiveTab);
  await page.waitForURL(url + 'press/#print-archive');
  const printArchive = page.locator('#print-archive');
  await printArchive.getByRole('heading', {name:'Архив печатных номеров', level:2}).waitFor();
  assert.equal(await booksTab.evaluate(link => link.href), url + 'press/books/');
  assert.equal(await printArchive.locator('.press-book').count(), 0);
  assert.ok(await printArchive.getByRole('heading',{name:'Газета A–News', exact:true}).isVisible());
  assert.ok(await printArchive.locator('#a-focus-archive').isVisible());
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
  await page.waitForURL(url + 'press/#print-archive');
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
  for (const [bookmark, destination, content] of [
    ['press/archive/', 'press/#print-archive', '#print-archive h2'],
    ['press/archive/#a-sport-01', 'press/#a-sport-01', '#a-sport-01 .press-file'],
    ['press/#a-kids', 'press/#a-kids', '#a-kids-heading'],
    ['press/#books', 'press/books/', 'main h1'],
    ['#home-books', 'press/books/', 'main h1'],
    ['#issue-a-sport', 'press/#a-sport-02', '#a-sport-02 .press-file']
  ]) {
    await page.goto(url + bookmark);
    await page.waitForURL(url + destination);
    await page.locator(content).first().waitFor();
    if (destination.includes('#')) {
      await page.waitForFunction(() => {
        const target = document.getElementById(location.hash.slice(1));
        return target && Math.abs(target.getBoundingClientRect().top) < innerHeight / 3;
      });
    }
  }
  await page.goto(url + '#publications');
  await page.waitForURL(url + 'archive/');
  const archive = page.getByRole('main');
  assert.ok(await archive.getByRole('heading', {name: 'Архив материалов A–House', level: 1}).isVisible());
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
      // Baseline-aligned text can have different box tops when glyph metrics differ.
      const marker = document.createElement('span');
      marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      return items.map(row => {
        const label = row.querySelector('dt');
        const value = row.querySelector('dd');
        const labelMarker = label.insertBefore(marker.cloneNode(), label.firstChild);
        const valueMarker = value.insertBefore(marker.cloneNode(), value.firstChild);
        const measurement = {
          labelBaseline: labelMarker.getBoundingClientRect().bottom,
          valueBaseline: valueMarker.getBoundingClientRect().bottom,
          valueLeft: value.getBoundingClientRect().left
        };
        labelMarker.remove();
        valueMarker.remove();
        const range = document.createRange();
        range.selectNodeContents(value);
        measurement.valueLines = range.getClientRects().length;
        return measurement;
      });
    });
    assert.ok(rows.every(row => Math.abs(row.labelBaseline - row.valueBaseline) < 1),
      'Registration labels and values must share a line at ' + page.viewportSize().width + ' px on ' + origin + ': ' + JSON.stringify(rows));
    assert.ok(Math.abs(rows[0].valueLeft - rows[1].valueLeft) < 1);
    assert.ok(rows.every(row => row.valueLines === 1), 'Registration numbers must stay whole on ' + origin);
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
  const numbersFit = await page.locator('.footer-registration dd').evaluateAll(async values => {
    await document.fonts.ready;
    return values.every(value => {
      const range = document.createRange();
      range.selectNodeContents(value);
      const lines = range.getClientRects();
      return lines.length === 1 && lines[0].right <= value.closest('dl').getBoundingClientRect().right + 1;
    });
  });
  assert.ok(numbersFit, 'Both registration numbers must fit at 320px and 200% text');

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
  for (const [path, title] of [
    ['press/', /A–Press/],
    ['press/#print-archive', /A–Press/],
    ['press/books/', 'Книги A–Press']
  ]) {
    await page.goto(url + path);
    await page.getByRole('heading', {level:1, name:title}).waitFor();
    assert.ok(await page.getByRole('navigation', {name:'Разделы издательства'}).isVisible());
    assert.ok(await page.evaluate(async () => {
      await document.fonts.ready;
      return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
    }), path + ' must fit at 320px and 200% text');
  }
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
  await page.goto(url + 'special_projects/#rec2308379591');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const contact = document.querySelector('main a:target');
    if (!contact || contact.getAttribute('href') !== 'mailto:partners@ahouseproject.com') return false;
    const link = contact.getBoundingClientRect();
    const header = document.querySelector('#t-header').getBoundingClientRect();
    return link.top >= header.bottom - 1 && link.bottom <= innerHeight;
  });
}

async function checkEditorialGrouping(page) {
  await page.goto(url);
  const mobile = page.viewportSize().width < 600;
  if (mobile) {
    const viewport = page.viewportSize();
    const menu = page.locator('.site-menu-toggle');
    const largerText = await page.addStyleTag({content: 'html { font-size: 200% !important; }'});
    try {
      await page.setViewportSize({width: 320, height: viewport.height});
      await menu.tap();
      const publisher = page.locator('#site-navigation').getByRole('link', {name:'Издательство', exact:true});
      assert.equal(await publisher.evaluate(link => link.href), url + 'press/');
      assert.ok(await publisher.evaluate(async item => {
        await document.fonts.ready;
        const range = document.createRange();
        range.selectNodeContents(item);
        const lines = [...range.getClientRects()].filter(rect => rect.width > 0);
        return lines.length > 0 && lines.every(rect => rect.left >= 0 && rect.right <= document.documentElement.clientWidth);
      }), 'The publisher link remains readable at 320px and 200% text');
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
      const entry = { top: card.getBoundingClientRect().top, paid: Boolean(card.querySelector('.home-event-amount')) };
      const action = card.querySelector('.home-event-admission');
      const address = card.querySelector('.home-detail');
      const description = address?.getClientRects().length ? address : card.querySelector('.home-event-info > p:last-child');
      if (action && description) {
        entry.endOfCopy = description.getBoundingClientRect().bottom;
        entry.actionGap = action.getBoundingClientRect().top - entry.endOfCopy;
        entry.lineHeight = parseFloat(getComputedStyle(action).lineHeight);
      }
      if (!entry.paid) return entry;
      const price = card.querySelector('.home-event-amount');
      if (!price || !description) return entry;
      const text = document.createRange();
      const walker = document.createTreeWalker(price, NodeFilter.SHOW_TEXT);
      const lines = [];
      for (let word = walker.nextNode(); word; word = walker.nextNode()) {
        text.selectNodeContents(word);
        lines.push(...[...text.getClientRects()].filter(rect => rect.width > 0));
      }
      if (!lines.length) return entry;
      return { ...entry, regular: getComputedStyle(price).fontWeight === getComputedStyle(price.parentElement).fontWeight,
        endOfCopy: description.getBoundingClientRect().bottom,
        priceTop: lines[0].top, priceBottom: lines.at(-1).bottom, sameLine: lines.every(rect => Math.abs(rect.top - lines[0].top) < 1) };
    }));
    for (const [index, entry] of entries.entries()) {
      if (entry.actionGap !== undefined) {
        assert.ok(entry.actionGap >= 0 && entry.actionGap <= entry.lineHeight,
          'Booking must sit directly below its own description even when the adjacent card is taller');
      }
      if (!entry.paid) continue;
      assert.ok(entry.regular, 'An amount must share the weight of its booking label');
      assert.ok(entry.sameLine && entry.priceTop > entry.endOfCopy, 'Each price belongs on a separate, unbroken line under its description');
      const next = entries[index + 1];
      if (!next) continue;
      if (Math.abs(entry.top - next.top) >= 1) {
        assert.ok(next.top - entry.priceBottom > entry.priceTop - entry.endOfCopy, 'A price must be closer to its own event than the next one');
      }
    }
  }

  await page.goto(url + 'press/#current-issues');
  const issue = page.locator('#current-issues .press-featured-issue');
  const group = await issue.evaluate(async el => {
    await document.fonts.ready;
    const cover = el.querySelector('.press-featured-cover').getBoundingClientRect();
    const label = el.querySelector('.home-kicker');
    const date = label.getBoundingClientRect();
    const title = el.querySelector('h3').getBoundingClientRect();
    return { width: cover.width, height: cover.height, coverBottom: cover.bottom, dateTop: date.top,
      offset: date.top - cover.top, gap: date.left - cover.right, titleTop: title.top, dateBottom: date.bottom,
      em: parseFloat(getComputedStyle(label).fontSize) };
  });
  assert.ok(group.width > 0 && group.height > 0 && group.titleTop >= group.dateBottom - 1);
  const besideCover = Math.abs(group.offset) < group.em && group.gap >= 0 && group.gap <= 2.5 * group.em;
  assert.ok(besideCover || group.coverBottom <= group.dateTop,
    'The issue date and title must sit beside the cover or directly below it');
}

async function checkArchiveReading(page) {
  const missing = await page.goto(url + 'missing-publication-for-browser-check/');
  assert.equal(missing.status(), 404);
  await page.getByRole('main').getByRole('link', { name: /в архив материалов/i }).click();
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
  await main.getByRole('link', { name: /в архив материалов/i }).click();
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
  const stories = page.locator('#partner-stories');
  assert.ok(await stories.getByRole('heading', {name:'Совместные проекты', level:2}).isVisible());
  const cases = stories.locator('.partner-case');
  assert.equal(await cases.count(), 6);
  assert.ok(await cases.evaluateAll(items => items.every(item => item.querySelectorAll('a[href]').length === 1)));
  const projects = cases.getByRole('link');
  assert.equal(await projects.nth(0).evaluate(link => link.href), url + 'mts/');
  assert.equal(await projects.nth(1).evaluate(link => link.href), url + 'longevity/');
  assert.equal(await projects.nth(5).evaluate(link => link.href), url + 'tpost/s1n334xh71-sin-nyan-hao-ili-schastlivogo-novogo-god/');
  assert.equal(await stories.locator('.partner-other-case a').evaluate(link => link.href), url + 'tpost/r8me79ap71-kvartirnik-pioneer-v-ahouse/');
  await projects.nth(3).focus();
  await page.keyboard.press('Tab');
  const chosen = projects.nth(4);
  const position = await chosen.evaluate(link => ({ address: link.href, top: link.getBoundingClientRect().top }));
  assert.equal(position.address, url + 'tpost/xenjkodze1-ahouse-cosmoscow/');
  assert.ok(await chosen.evaluate(link => document.activeElement === link));
  await page.keyboard.press('Enter');
  await page.waitForURL(position.address);
  await page.goBack();
  await page.waitForFunction(({ address, top }) => document.activeElement?.href === address &&
    Math.abs(document.activeElement.getBoundingClientRect().top - top) <= 2, position);
}

async function checkClubApplication(page) {
  for (const bookmark of ['#club', '#rec2309637911']) {
    await page.goto(url + bookmark);
    await page.waitForURL(url + 'club/');
  }
  await page.goto(url);
  await page.locator('#collection-community').getByRole('link', {name:'Программы клуба'}).click();
  await page.waitForURL(url + 'club/');
  await page.getByRole('link', {name:'Программы участия'}).press('Enter');
  await page.waitForURL(url + 'club/#programs');
  const programs = page.locator('#programs [data-catalog-card]');
  assert.equal(await programs.count(), 3);
  const card = programs.nth(1);
  const programName = await card.getByRole('heading').innerText();
  assert.equal(await card.locator('.club-application-status').count(), 0);
  const application = card.getByRole('link', { name: 'Заполнить анкету по программе ' + programName });
  await application.evaluate(async link => {
    await document.fonts.ready;
    link.scrollIntoView({ block: 'center', behavior: 'instant' });
    // The browser can still scroll the link while preparing a pointer click.
    link.addEventListener('click', () => {
      sessionStorage.setItem('test-club-link-position', JSON.stringify({ href: link.href, top: link.getBoundingClientRect().top }));
    }, { once: true });
  });
  await application.click();
  await page.waitForURL(url + 'member/?offer=patron');
  const position = await page.evaluate(() => {
    const position = sessionStorage.getItem('test-club-link-position');
    sessionStorage.removeItem('test-club-link-position');
    return JSON.parse(position);
  });
  assert.ok(position, 'Measure the position at the actual click on the application link');
  assert.equal(await page.locator('.home-masthead').count(), 1);
  const form = page.locator('#member-form');
  const selected = form.getByRole('radio', { name: programName, exact: true });
  assert.ok(await selected.isChecked(), 'The selected club program must follow the visitor into the form');
  const intro = await page.locator('#member-intro').innerText();
  assert.match(intro.replace(/\s+/g, ' '), /укажите, как с вами связаться/);
  assert.equal(await form.locator('.membership-optional-group [name]:visible').count(), 4);
  await checkMembershipForm(page, 'member');
  await page.goBack();
  await card.waitFor();
  assert.equal(new URL(page.url()).hash, '#programs');
  await page.waitForFunction(({ href, top }) => document.activeElement?.href === href &&
    Math.abs(document.activeElement.getBoundingClientRect().top - top) <= 2 && history.scrollRestoration === 'auto', position);
  await page.goto(url + '#services-checkout');
  assert.equal(await page.locator('#friend-availability').count(), 0);
  assert.equal(await page.locator('#friend-form-heading').innerText(), 'Оформление подписки');
  await checkMembershipForm(page, 'friend');
}

async function checkMembershipForm(page, kind) {
  const form = page.locator('#' + kind + '-form');
  const email = form.locator('input[type="email"]');
  const name = form.locator('input[name="name"]');
  const submit = form.locator('button[type="submit"]');
  const settings = membershipSettings(kind);
  const policy = form.locator('.membership-policy a');
  assert.ok(await policy.isVisible());
  assert.equal(await policy.getAttribute('href'), base + 'politic_a-com/');
  assert.equal(await policy.getAttribute('href'),
    await page.locator('.footer-legal a[href$="/politic_a-com/"]').getAttribute('href'));
  assert.ok(await policy.evaluate(link =>
    link.compareDocumentPosition(link.closest('form').elements.namedItem('name')) & Node.DOCUMENT_POSITION_FOLLOWING));
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
    assert.ok(await form.locator('.membership-status').evaluate(notice =>
      notice.compareDocumentPosition(notice.closest('form').elements.namedItem('name')) & Node.DOCUMENT_POSITION_FOLLOWING));
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

async function checkSkipLink(page, anchor, nextTab = 'Tab') {
  await page.locator('.skip-content').press('Enter');
  assert.equal(page.url(), url + '#' + anchor, 'Skipping the header must preserve the selected view');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'site-content');
  await page.keyboard.press(nextTab);
  const section = page.locator('[data-home-section][id="' + anchor + '"]');
  assert.ok(await section.evaluate(el => el.contains(document.activeElement)),
    'Reading must continue inside the original section');
}

async function checkHomeRoutes(page, mobile) {
  const section = name => page.locator('[data-home-section][id="' + name + '"]');
  const headingStyle = selector => page.locator(selector).evaluate(element => {
    const {fontFamily, fontSize, fontWeight, lineHeight} = getComputedStyle(element);
    return {fontFamily, fontSize, fontWeight, lineHeight};
  });
  let visitHeadingStyle;
  for (const [anchor, title] of [['visit', 'Дома и адреса'], ['services-checkout', 'A–Friend']]) {
    await page.goto(url + '#' + anchor);
    assert.equal(await page.title(), title + ' — A–House');
    if (anchor === 'visit') visitHeadingStyle = await headingStyle('#visit-heading');
    await checkSkipLink(page, anchor);
  }
  await checkReadingReturn(page, mobile);
  await checkEditorialGrouping(page);
  await page.goto(url);
  const chapterStyle = await headingStyle('#home-friend-title');
  const chapterTitles = page.locator('#overview > section > .home-section-head > h2:visible');
  for (const title of await chapterTitles.all()) {
    assert.deepEqual(await headingStyle('#' + await title.getAttribute('id')), chapterStyle,
      'All title-level sections in the overview must use the same h2 style');
  }
  if (!mobile) {
    assert.ok(parseFloat(visitHeadingStyle.fontSize) > parseFloat(chapterStyle.fontSize),
      'A standalone section title has a larger desktop scale than its overview heading');
  }
  const menu = page.locator('.site-menu-toggle');
  const calendarLink = page.locator('.site-navigation a[href$="/calendar/"]');
  const publisherPath = new URL('press/', url).pathname;
  const publisherLink = page.locator('#site-navigation a[href="' + publisherPath + '"]');
  const media = page.locator('#media');
  assert.equal(await section('program').isVisible(), true);
  assert.equal(await media.isVisible(), true);
  assert.equal(await section('club').isVisible(), false, 'The overview must keep club details in their own view');
  assert.equal(await publisherLink.count(), 1);
  assert.equal(await page.locator('#site-navigation a[href^="' + publisherPath + '"]').count(), 1);
  assert.equal((await publisherLink.textContent()).trim().replaceAll('\u00ad', ''), 'Издательство');
  assert.equal(await page.locator('#site-navigation a[href="#media"]').count(), 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const printArchive = media.getByRole('link', {name:'Архив печатных номеров', exact:true});
  if (mobile) await printArchive.tap();
  else await printArchive.press('Enter');
  await page.waitForURL(url + 'press/#print-archive');
  assert.ok(await page.locator('#print-archive .press-file').first().isVisible());
  await page.goBack();
  assert.equal(await page.locator('#t-header a[href="' + new URL('archive/', url).pathname +
    '"], #t-footer a[href="' + new URL('archive/', url).pathname + '"]').count(), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await menu.isVisible(), mobile, 'Only a compact header needs a menu toggle');
  assert.equal(await publisherLink.isVisible(), !mobile, 'Desktop sections should be visible before interaction');
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
  if (mobile && await menu.getAttribute('aria-expanded') !== 'true') await menu.tap();
  if (mobile) await publisherLink.tap();
  else await publisherLink.press('Enter');
  await page.waitForURL(url + 'press/');
  assert.equal(await publisherLink.getAttribute('aria-current'), 'page');
  await page.getByRole('heading', {level:1, name:/A–Press/}).waitFor();
  assert.deepEqual(await headingStyle('.press-inner h1'), visitHeadingStyle,
    'The publisher and home sections share the primary heading scale');
  await page.goto(url + '#media');
  await media.waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).hash, '#media');
  await page.waitForFunction(() => document.activeElement.id === 'media');
  assert.equal(await page.title(), 'A–House');
  assert.ok(await section('program').isVisible(), 'The old reading bookmark opens within the full homepage');
  assert.equal(await media.getByRole('heading', {name:'A–Index', exact:true}).count(), 0);
  const news = media.getByRole('article', {name:'A–News', exact:true});
  const newsLink = news.getByRole('link', {name:'Читать журнал A–News'});
  assert.equal(await newsLink.getAttribute('href'), 'https://news.ahouseproject.com/');
  await page.goto(url + '#a-news');
  const article = news.locator('.project-examples a').first();
  assert.ok(await article.isVisible(), 'The reading selection must open an individual editorial item');
  assert.equal(new URL(await article.evaluate(link => link.href)).origin, 'https://news.ahouseproject.com');
  await page.goBack();
  await page.waitForURL(url + '#media');
  assert.equal(await media.locator('.publication-list, .print-issue, .press-book').count(), 0);
  await page.evaluate(() => { location.hash = 'publication-archive-design'; });
  await page.waitForURL(url + 'archive/design/');
  await page.goBack();
  await page.waitForURL(url + '#media');
  await page.waitForFunction(() => document.title === 'A–House');
  if (mobile) await menu.tap();
  await calendarLink.press('Enter');
  await page.waitForURL(url + 'calendar/');
  assert.deepEqual(await headingStyle('.calendar-opening h1'), visitHeadingStyle,
    'The calendar and home sections share the primary heading scale');
  assert.ok(await page.locator('#upcoming').isVisible() && await page.locator('#past').isVisible());
  await page.goBack();
  await media.waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).hash, '#media', 'Back must restore the reading bookmark');
  if (mobile) await menu.tap();
  const friendLink = page.locator('#site-navigation').getByRole('link', {name: 'Подписка A–Friend', exact: true, includeHidden: true});
  assert.equal(await friendLink.evaluate(link => link.closest('li').previousElementSibling?.querySelector('a')?.href), url + 'club/');
  if (mobile) await friendLink.tap();
  else await friendLink.press('Enter');
  await page.waitForURL(url + '#services-checkout');
  await page.locator('#friend-form').waitFor();
  assert.equal(await friendLink.getAttribute('aria-current'), 'true');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await page.goto(url + '#visit');
  await section('visit').waitFor({ state: 'visible' });
  const entrepreneur = section('visit').locator('.home-places > article').last();
  for (const external of [entrepreneur.locator('.home-address a'), entrepreneur.getByRole('link', {name: 'Расписание встреч', exact: true})]) {
    assert.equal(await external.locator('.external-link-mark').count(), 1);
  }
  for (const label of ['О Доме предпринимателя', 'Амбассадоры Дома']) {
    assert.equal(await entrepreneur.getByRole('link', {name: label, exact: true}).locator('.external-link-mark').count(), 0);
  }
  const housesCurrent = page.locator('#site-navigation a[aria-current="location"][href$="#visit"]');
  await entrepreneur.getByRole('link', {name: 'О Доме предпринимателя', exact: true}).click();
  await page.waitForURL(url + 'dompredprinimatelya/');
  assert.equal(await housesCurrent.count(), 1);
  await page.goBack();
  await page.waitForURL(url + '#visit');
  await section('visit').locator('a[href$="/residents/"]').first().click();
  await page.waitForURL(url + 'residents/');
  assert.equal(await housesCurrent.count(), 1);
}

let browser;
async function browserPage(options) {
  const page = await browser.newPage(options);
  page.setDefaultTimeout(30_000);
  return page;
}

async function checkWebKit() {
  // In macOS WebKit, Option-Tab includes links in the default tab order.
  const nextTab = process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
  const phone = await browserPage({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  await checkMobileExhibition(phone);
  await phone.goto(url + '#visit');
  await checkSkipLink(phone, 'visit', nextTab);
  await checkArchiveMonths(phone);
  await checkFeaturePages(phone, url, {mobile: true, nextTab});
  await phone.close();
  console.log('WebKit iPhone 13: exhibition, skip link, calendar and project pages.');

  const narrow = await browserPage({viewport: {width: 320, height: 844}});
  await checkEnlargedMenu(narrow);
  await narrow.close();

  const desktop = await browserPage({viewport: {width: 1511, height: 900}, reducedMotion: 'reduce'});
  await checkHomeNavigation(desktop);
  await checkFeaturePages(desktop, url, {mobile: false, nextTab});
  await desktop.close();
  console.log('WebKit desktop: enlarged menu, project pages, keyboard controls and dialog focus.');
}

async function checkChrome() {
  const narrowPage = await browserPage({ viewport: { width: 320, height: 844 } });
  await checkEnlargedMenu(narrowPage);
  await narrowPage.close();
  const phone = await browserPage({ viewport: { width: 375, height: 560 }, isMobile: true, hasTouch: true });
  await checkMobileExhibition(phone);
  await phone.close();
  const motionPage = await browserPage({viewport: {width: 1440, height: 900}});
  await checkHomeNavigation(motionPage);
  await motionPage.close();
  for (const width of [390, 1511]) {
    const mobile = width === 390;
    const pageOptions = {
      viewport: { width, height: 844 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1
    };
    const page = await browserPage(pageOptions);
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
      await cover.scrollIntoViewIfNeeded();
      await page.waitForFunction(image => image.complete && image.naturalWidth > 0, await cover.elementHandle());
      assert.match(await cover.evaluate(image => image.currentSrc), /\/stills\//, 'Reduced motion shows a still on the press cover');
      const photo = page.locator('#distribution img');
      const photoURL = await photo.evaluate(image => image.src);
      assert.equal(await photo.getAttribute('loading'), 'lazy', 'The distribution map should be eligible for lazy loading');
      await photo.scrollIntoViewIfNeeded();
      await page.waitForFunction(image => image.complete && image.naturalWidth > 0, await photo.elementHandle());
      assert.ok(requested.has(photoURL), 'The distribution map loads when the reader reaches it');
      assert.ok(![...requested].some(src => /\.gif(?:\?|$)/i.test(src)), 'An animated GIF loaded in reduced motion');
      const futurePage = await browserPage({ ...pageOptions, reducedMotion: 'reduce' });
      await checkExpiredProgram(futurePage);
      await checkArchiveMonths(futurePage);
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
    await checkFeaturePages(page, url, {mobile});
    await checkClubApplication(page);
    await checkConsentReturn(page);
    console.log('Archive reading, club application and visible word space verified at ' + width + ' px (' + gap.toFixed(2) + ' px).');
    await page.close();
  }
}

try {
  if (useWebKit) {
    browser = await webkit.launch();
    await checkWebKit();
  } else {
    const launchOptions = { channel: 'chrome' };
    browser = await chromium.launch(launchOptions);
    await checkChrome();
    await browser.close();
    // The image-heavy project pages and the local transport fixtures use separate browser processes.
    browser = await chromium.launch(launchOptions);
    await checkTheme(browser, url);
    await checkMembershipTransport(browser);
  }
} finally {
  await browser?.close();
  server.close();
}
