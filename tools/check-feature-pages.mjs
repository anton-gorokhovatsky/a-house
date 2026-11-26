import assert from 'node:assert/strict';

async function openedPanel(page, control) {
  const id = await control.getAttribute('aria-controls');
  assert.ok(id, 'A disclosure must identify its panel');
  const panel = page.locator('[id=' + JSON.stringify(id) + ']');
  await panel.waitFor();
  assert.equal(await control.getAttribute('aria-expanded'), 'true');
  return panel;
}

async function verifyFocus(page, target) {
  await page.waitForFunction(element => {
    const {top, right, bottom, left} = element.getBoundingClientRect();
    return document.activeElement === element && top < innerHeight && bottom > 0 && left < innerWidth && right > 0;
  }, await target.elementHandle());
}

async function verifyModalFocus(page, dialog, nextTab) {
  await page.waitForFunction(element => element.contains(document.activeElement), await dialog.elementHandle());
  for (const key of [nextTab, nextTab, 'Shift+' + nextTab]) {
    await page.keyboard.press(key);
    assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)),
      'Keyboard focus must stay inside the open modal');
  }
}

async function verifyReadablePanel(panel) {
  const clipped = await panel.evaluate(element => {
    const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = text.nextNode(); node; node = text.nextNode()) {
      const parent = node.parentElement;
      const atom = parent.closest('[data-kind="text"] .feature-atom');
      if (!atom || !node.textContent.trim() || getComputedStyle(atom).visibility !== 'visible') continue;
      const scroller = atom.closest('.feature-scroller');
      const start = scroller ? scroller.getBoundingClientRect().left - scroller.scrollLeft : 0;
      const end = scroller ? start + scroller.scrollWidth : innerWidth;
      range.selectNodeContents(node);
      if ([...range.getClientRects()].some(rect => rect.width && (rect.left < start - 1 || rect.right > end + 1))) {
        return node.textContent.trim().slice(0, 80);
      }
    }
    return '';
  });
  assert.equal(clipped, '', 'The expanded section must keep its full text inside the viewport');
}

async function visitFeature(page, url, route) {
  const response = await page.goto(url + route);
  assert.ok(response?.ok(), route + ' must work as a direct entry');
  const main = page.getByRole('main');
  assert.equal(await main.getAttribute('id'), 'site-content');
  assert.equal(await main.getByRole('heading', {level: 1}).count(), 1);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    'The document should fit the viewport at ' + route);
  return main;
}

async function checkLongevity(page, url, activate, mobile, nextTab) {
  const main = await visitFeature(page, url, 'longevity/');
  const navigation = main.locator(mobile ? '#mobile-sections' : '#chapter-navigation');
  const recommendationLink = navigation.getByRole('link', {name: 'Рекомендации для девелопера'});
  const dialog = page.getByRole('dialog', {name: 'Рекомендации для девелопера'});
  if (mobile) {
    await activate(recommendationLink);
    await dialog.waitFor();
    await activate(dialog.getByRole('button', {name: /закрыть/i}));
    await dialog.waitFor({state: 'hidden'});
    await verifyFocus(page, recommendationLink);
  }
  for (const fragment of ['one', 'two', 'three']) {
    assert.ok(await main.locator('a[href="#' + fragment + '"]').count(), 'The research links to #' + fragment);
  }
  await activate(main.locator('a[href="#one"]:visible').first());
  await page.waitForURL(url + 'longevity/#one');
  await page.waitForFunction(() => Math.abs(document.getElementById('one').getBoundingClientRect().top) < 120);

  await activate(recommendationLink);
  const chapters = dialog.locator('.hacc__head');
  await chapters.first().waitFor();
  assert.equal(await chapters.count(), 5);
  await activate(chapters.nth(1));
  await openedPanel(page, chapters.nth(1));
  if (mobile) await activate(dialog.getByRole('button', {name: /закрыть/i}));
  else {
    await verifyModalFocus(page, dialog, nextTab);
    await page.keyboard.press('Escape');
  }
  await dialog.waitFor({state: 'hidden'});
  await verifyFocus(page, recommendationLink);

  await visitFeature(page, url, 'longevity/?check=bookmark#rules');
  await dialog.waitFor();
  await activate(dialog.getByRole('button', {name: /закрыть/i}));
  await dialog.waitFor({state: 'hidden'});
}

async function checkBank(page, url, activate, mobile, nextTab) {
  await visitFeature(page, url, 't_bank/');
  const program = page.locator('#program');
  assert.equal(await program.locator('a[href^="#"]').count(), 9);
  const event = program.getByRole('link').and(program.locator('a[href="#four"]'));
  await activate(event);
  const dialog = page.getByRole('dialog', {name: /Изобретая коллекцию:\s*графика/});
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /Изобретая\s+коллекцию:\s+графика/i);
  await verifyModalFocus(page, dialog, nextTab);
  await page.goBack();
  await dialog.waitFor({state: 'hidden'});
  await verifyFocus(page, event);

  await visitFeature(page, url, 't_bank/?check=bookmark#meeting-2437515011');
  await dialog.waitFor();
  await activate(dialog.getByRole('button', {name: /закрыть/i}));
  await dialog.waitFor({state: 'hidden'});
}

async function checkContest(page, url, activate, mobile, nextTab) {
  await page.goto(url + '#projects');
  await activate(page.locator('.home-project-navigation a[href="#a-industry"]'));
  const contest = page.locator('#a-industry').getByRole('link', {name: /Конкурс МТС «Меняя привычное»/});
  await activate(contest);
  await page.waitForURL(url + 'mts/');
  const heading = page.getByRole('heading', {level: 1, name: /Меняя привычное/i});
  await heading.waitFor();
  assert.equal(await page.locator('.site-header, .home-footer, form').count(), 0);
  const notice = page.getByRole('dialog', {name: /портфолио.*окончен/i});
  await notice.waitFor();
  assert.match(await notice.innerText(), /aindex@ahouseproject\.com/);
  await activate(notice.getByRole('button', {name: /закрыть/i}));
  await notice.waitFor({state: 'hidden'});
  await verifyFocus(page, heading);

  const gallery = page.getByRole('region', {name: 'Фотографии базовых станций связи'});
  assert.equal(await gallery.getAttribute('tabindex'), '0');
  assert.ok(await gallery.evaluate(element => element.scrollWidth > element.clientWidth));
  if (!mobile) {
    for (let step = 0; step < 24 && !await gallery.evaluate(element => element === document.activeElement); step++) {
      await page.keyboard.press(nextTab);
    }
    await verifyFocus(page, gallery);
    assert.ok(await gallery.evaluate(element => element.matches(':focus-visible')));
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(element => element.scrollLeft > 0, await gallery.elementHandle());
    await page.keyboard.press(nextTab);
    assert.ok(await gallery.evaluate(element => !element.contains(document.activeElement)));
  }

  const more = page.getByRole('button', {name: 'Подробнее о конкурсе'});
  await activate(more);
  assert.match(await (await openedPanel(page, more)).innerText(), /российские\s+и\s+зарубежные\s+бюро/i);
  const secondStage = page.getByRole('button', {name: 'Этап 2. Эскизное задание'});
  await activate(secondStage);
  const secondPanel = await openedPanel(page, secondStage);
  assert.match(await secondPanel.innerText(), /подписание\s+NDA/i);
  if (mobile) await verifyReadablePanel(secondPanel);
  assert.equal(await more.getAttribute('aria-expanded'), 'false');
  const rules = page.getByRole('link', {name: /правила\s+конкурса\s+на\s+Яндекс\s+Диске/i});
  assert.equal(await rules.getAttribute('href'), 'https://disk.360.yandex.ru/d/kAckYUQ5My6vfg');

  await visitFeature(page, url, 'mts/?check=bookmark#rec2291517501');
  await openedPanel(page, secondStage);
  await visitFeature(page, url, 'mts/?check=notice#popup:infoblock');
  await notice.waitFor();
  await activate(notice.getByRole('button', {name: /закрыть/i}));
  await notice.waitFor({state: 'hidden'});
}

async function checkReport(page, url, activate, route, bookmark, openYear, secondYear, mobile) {
  const main = await visitFeature(page, url, route + '/#' + bookmark);
  const first = main.getByRole('button', {name: new RegExp(openYear + '\\s*год')});
  const next = main.getByRole('button', {name: new RegExp(secondYear + '\\s*год')});
  const panel = await openedPanel(page, first);
  if (mobile) await verifyReadablePanel(panel);
  if (route === 'report__') {
    const timeline = panel.getByRole('region', {name: 'Хроника ' + openYear + ' года'});
    const hasMoreColumns = await timeline.evaluate(element => element.scrollWidth > element.clientWidth + 1);
    if (mobile) assert.ok(hasMoreColumns, 'The next columns of the report remain reachable on the phone');
    if (hasMoreColumns) {
      assert.match(await timeline.evaluate(element => getComputedStyle(element).overflowX), /^(auto|scroll)$/,
        'The report supports native horizontal scrolling');
      await timeline.press('ArrowRight');
      await page.waitForFunction(element => element.scrollLeft > 0, await timeline.elementHandle());
      await page.waitForFunction(element => element.matches(':focus-visible') &&
        getComputedStyle(element).outlineColor === 'rgb(255, 255, 255)', await timeline.elementHandle());
    }
  }
  await activate(next);
  await openedPanel(page, next);
  await panel.waitFor({state: 'hidden'});
  assert.equal(await first.getAttribute('aria-expanded'), 'false');
}

async function checkMoscow(page, url, activate, mobile) {
  const main = await visitFeature(page, url, 'moscow_business/#program');
  assert.equal(await main.getByRole('heading', {level: 2, name: 'Программа', exact: true}).count(), 1);
  assert.equal(await main.getByRole('heading', {level: 2, name: 'Архив', exact: true}).count(), 1);
  assert.equal(await main.locator('#program').getByRole('heading', {level: 3}).count(), 5);
  const captions = main.locator('#ah-grid .card :is(.meta,.more)');
  assert.equal(await captions.count(), 10);
  const ratios = await captions.evaluateAll(items => {
    const luminance = color => color.match(/\d+/g).slice(0, 3).map(Number).reduce((total, channel, index) => {
      const normalized = channel / 255;
      const linear = normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
      return total + linear * [.2126, .7152, .0722][index];
    }, 0);
    const background = luminance(getComputedStyle(document.getElementById('program')).backgroundColor);
    return items.map(item => {
      const foreground = luminance(getComputedStyle(item).color);
      return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
    });
  });
  assert.ok(ratios.every(ratio => ratio >= 4.5), 'Program captions and controls must reach 4.5:1');

  const details = main.getByRole('button', {name: /^Подробнее:/}).first();
  await activate(details);
  const dialog = page.getByRole('dialog', {name: /Инновации в строительстве/});
  await dialog.waitFor();
  if (mobile) await activate(dialog.getByRole('button', {name: /закрыть/i}));
  else await page.keyboard.press('Escape');
  await dialog.waitFor({state: 'hidden'});
  await verifyFocus(page, details);
  await visitFeature(page, url, 'moscow_business/?check=bookmark#ah-ab1');
  const archived = main.locator('button[aria-controls="ah-ab1"]');
  await openedPanel(page, archived);
}

export async function checkFeaturePages(page, url, {mobile, nextTab = 'Tab'}) {
  const activate = element => mobile ? element.tap() : element.press('Enter');
  const dependencyRequests = new Set();
  const track = request => {
    const name = new URL(request.url()).hostname;
    if (/(^|\.)tilda(?:cdn)?\./i.test(name) || /jquery(?:-\d+(?:\.\d+)*)?(?:\.min)?\.js(?:$|\?)/i.test(request.url())) {
      dependencyRequests.add(request.url());
    }
  };
  page.on('request', track);
  try {
    await checkLongevity(page, url, activate, mobile, nextTab);
    // The separate programme should still open before a visitor chooses a meeting.
    if (mobile) {
      await page.goto(url + 't_private/');
      assert.equal(await page.getByRole('dialog').count(), 0);
    }
    await checkBank(page, url, activate, mobile, nextTab);
    await checkContest(page, url, activate, mobile, nextTab);
    await checkReport(page, url, activate, 'report', 'rec3736550101', '2023', '2026', mobile);
    await checkReport(page, url, activate, 'report__', 'rec3674146901', '2026', '2023', mobile);
    await checkMoscow(page, url, activate, mobile);
    assert.deepEqual([...dependencyRequests], [], 'Project pages must run without Tilda or jQuery requests');
  } finally {
    page.off('request', track);
  }
}
