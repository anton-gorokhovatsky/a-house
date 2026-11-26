import assert from 'node:assert/strict';

function luminance(color) {
  const values = color.match(/[\d.]+/g);
  assert.ok(values?.length >= 3, 'A rendered colour must have RGB channels: ' + color);
  const [r, g, b] = values.map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
}

const group = page => page.getByRole('group', { name: 'Тема сайта', exact: true });
const choice = (page, name) => group(page).getByRole('radio', { name, exact: true });
const canvas = page => page.locator('body').evaluate(body => getComputedStyle(body).backgroundColor);
const contacts = page => page.locator('.home-footer').evaluate(footer => getComputedStyle(footer).backgroundColor);

async function footerLayout(page) {
  return page.locator('#site-theme').evaluate(fieldset => {
    const positions = [...fieldset.querySelectorAll('label'), document.getElementById('footer-documents')].map(el => {
      const { left, top, height } = el.getBoundingClientRect();
      return [left, top + scrollY, height];
    });
    return { height: document.documentElement.scrollHeight, positions };
  });
}

async function tapVisible(page, locator) {
  const box = await locator.boundingBox();
  assert.ok(box);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

async function checkReadable(locator) {
  const pair = await locator.evaluate(element => {
    for (let parent = element; parent; parent = parent.parentElement) {
      const background = getComputedStyle(parent).backgroundColor;
      if (!background.startsWith('rgba(') && background !== 'transparent') {
        return [getComputedStyle(element).color, background];
      }
    }
    throw new Error('No reading surface for ' + element.className);
  });
  const [a, b] = pair.map(luminance).sort((x, y) => y - x);
  assert.ok((a + .05) / (b + .05) >= 4.5, 'Text contrast on ' + pair.join(' / '));
}

export async function checkTheme(browser, url) {
  const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, colorScheme: 'light' });
  context.setDefaultTimeout(30_000);
  try {
    const page = await context.newPage();
    await page.goto(url);
    assert.ok(await choice(page, 'Как в системе').isChecked());
    const systemChoice = group(page).locator('label:has(input[value="system"])');
    await systemChoice.getByText('В системе светлая', { exact: true }).waitFor();
    await group(page).scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    const initialLayout = await footerLayout(page);
    assert.ok(await group(page).evaluate(fieldset => {
      const legal = fieldset.closest('footer').querySelector('#footer-documents');
      return legal && fieldset.getBoundingClientRect().bottom <= legal.getBoundingClientRect().top;
    }), 'The theme belongs before the legal section');
    const light = await canvas(page);
    const lightContacts = await contacts(page);
    assert.ok(luminance(lightContacts) < .15, 'Contacts keep their dark background on a light page');
    const cover = page.locator('.home-friend-cover img');
    assert.equal(await cover.count(), 1, 'The subscription teaser shows an issue cover');
    await cover.scrollIntoViewIfNeeded();
    await cover.evaluate(img => img.decode());
    const image = () => cover.evaluate(img => [img.currentSrc, getComputedStyle(img).filter]);
    const original = await image();
    await page.emulateMedia({ colorScheme: 'dark' });
    await systemChoice.getByText('В системе тёмная', { exact: true }).waitFor();
    assert.deepEqual(await footerLayout(page), initialLayout, 'Changing the device theme keeps the footer in place');
    const dark = await canvas(page);
    assert.ok(luminance(light) > .75 && luminance(dark) < .15, 'A first visit follows the device');
    assert.equal(await contacts(page), dark, 'In system dark mode the page continues through contacts');
    assert.deepEqual(await image(), original, 'The printed issue keeps its artwork');
    await checkReadable(page.locator('.home-introduction p').first());
    await checkReadable(page.locator('.home-footer-contacts a').first());
    await checkReadable(group(page).locator('legend'));
    const targets = await group(page).locator('label').evaluateAll(labels => labels.map(label => label.getBoundingClientRect().height));
    assert.ok(targets.length === 3 && targets.every(height => height >= 44), 'All three choices have mobile hit areas');
    await group(page).getByText('Светлая', { exact: true }).tap();
    assert.ok(await choice(page, 'Светлая').evaluate(radio => radio.checked && getComputedStyle(radio).outlineStyle === 'none'),
      'A tap marks the chosen radio without adding a keyboard focus ring');
    await systemChoice.getByText('В системе тёмная', { exact: true }).waitFor();
    assert.deepEqual(await footerLayout(page), initialLayout, 'Choosing a manual theme keeps the page height and document links in place');
    assert.equal(await canvas(page), light);
    assert.equal(await contacts(page), lightContacts);
    await page.reload();
    assert.ok(await choice(page, 'Светлая').isChecked());
    assert.equal(await canvas(page), light);
    await group(page).getByText('Тёмная', { exact: true }).tap();
    await page.goto(url + 'a-friend/');
    await page.locator('#friend-name').fill('Анна');
    await page.evaluate(() => document.fonts.ready);
    const reading = () => page.locator('#friend-name').evaluate(field => ({
      url: location.href, entries: history.length, fieldTop: field.getBoundingClientRect().top, scroll: scrollY
    }));
    const beforeMenu = await reading();
    const toggle = page.locator('.site-menu-toggle');
    await tapVisible(page, toggle);
    const menu = group(page.locator('#site-navigation'));
    for (const [value, label] of [['system', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']]) {
      const radio = menu.getByRole('radio', { name: label, exact: true });
      await tapVisible(page, radio);
      assert.ok(await radio.isChecked());
      assert.equal(await radio.evaluate(node => getComputedStyle(node).outlineStyle), 'none');
      assert.equal(await page.locator('#site-theme :checked').inputValue(), value, 'The footer shares the menu preference');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert.deepEqual(await reading(), beforeMenu, 'Choosing a theme preserves the reading position, route and history');
    }
    await menu.getByRole('radio', { name: 'Тёмная' }).focus();
    await page.keyboard.press('ArrowLeft');
    assert.ok(await menu.getByRole('radio', { name: 'Светлая' }).isChecked());
    assert.ok(await menu.getByRole('radio', { name: 'Светлая' }).evaluate(node => node.matches(':focus-visible') && getComputedStyle(node).outlineStyle !== 'none'));
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.ok(await toggle.evaluate(button => document.activeElement === button));
    assert.deepEqual(await reading(), beforeMenu);
    assert.equal(await page.locator('body').getAttribute('data-page'), 'a-friend');
    assert.equal(await page.locator('#friend-name').inputValue(), 'Анна');
    for (const path of ['calendar/', 'calendar/light-of-time/', 'club/', 'member/', 'agreement/', 'archive/', '404.html']) {
      await page.goto(url + path);
      assert.ok(await choice(page, 'Тёмная').isChecked(), path + ' keeps the manual theme');
      assert.equal(await canvas(page), dark);
      if (await page.locator('.home-footer').count()) {
        assert.equal(await contacts(page), dark, path + ' uses one dark surface for content and contacts');
      }
    }
    await page.goto(url + 'archive/');
    await page.waitForURL(url + 'archive/');
    await page.locator('.archive-index .publication-list a').first().tap();
    await checkReadable(page.getByRole('main').getByRole('heading', {level: 1}));
    const other = await context.newPage();
    await other.goto(url + 'member/');
    await checkReadable(other.locator('#member-form input[name="name"]'));
    await page.bringToFront();
    await choice(page, 'Тёмная').focus();
    await page.keyboard.press('ArrowLeft');
    assert.ok(await choice(page, 'Светлая').isChecked(), 'Arrows select a theme within the radio group');
    assert.ok(await choice(page, 'Светлая').evaluate(radio => radio === document.activeElement && getComputedStyle(radio).outlineStyle !== 'none'));
    await other.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.keyboard.press('ArrowLeft');
    assert.ok(await choice(page, 'Как в системе').isChecked());
    await other.waitForFunction(() => !document.documentElement.hasAttribute('data-theme'));
    for (const [scheme, color] of [['dark', dark], ['light', light]]) {
      await page.emulateMedia({ colorScheme: scheme });
      assert.equal(await canvas(page), color);
    }
  } finally {
    await context.close();
  }

  const noScript = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' });
  noScript.setDefaultTimeout(30_000);
  try {
    const page = await noScript.newPage();
    await page.goto(url + 'calendar/');
    assert.ok(luminance(await canvas(page)) < .15, 'System dark mode also works without JavaScript');
    assert.equal(await contacts(page), await canvas(page));
    assert.equal(await page.locator('[data-site-theme]:visible').count(), 0);
    await page.emulateMedia({ colorScheme: 'light' });
    assert.ok(luminance(await canvas(page)) > .75);
  } finally {
    await noScript.close();
  }
}
