import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium, devices, webkit } from 'playwright-core';
import { cabinetAssets } from '../assets.mjs';

const [site, privateSetup, privateMaterials] = process.argv.slice(2);
assert.ok(site, 'Pass a built directory or a live URL.');
const live = Boolean(privateSetup);
const fixtureOrigin = 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co';
const files = new Map([
  ['index.html', 'text/html'], ...Array.from(cabinetAssets, ([name, asset]) => [name, asset.type]),
  ['views.js', 'text/javascript'], ['config.js', 'text/javascript'], ['cabinet.js', 'text/javascript'], ['voting.js', 'text/javascript']
]);
let server;
let url = site;
if (!/^https?:\/\//.test(site)) {
  server = http.createServer(async (request, response) => {
    const name = new URL(request.url, 'http://local').pathname.slice(1) || 'index.html';
    if (!files.has(name)) return response.writeHead(404).end();
    response.writeHead(200, { 'content-type': files.get(name) });
    response.end(await readFile(path.join(site, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = 'http://127.0.0.1:' + server.address().port + '/';
}

const readJson = async filename => JSON.parse(await readFile(filename, 'utf8'));
const juror = live ? (await readJson(path.join(privateSetup, 'jurors.json')))[0]
  : { login: 'jury-01', password: 'synthetic-review-Aa1!' };
const fixturePdf = Buffer.from('%PDF-1.4\n%%EOF\n');
const works = live ? (await readJson(path.join(privateMaterials, 'catalogue.json'))).works
  : Array.from({ length: 15 }, (_, index) => ({
    id: (index + 1).toString(16).padStart(24, '0'), title: 'Работа ' + (index + 1), bytes: fixturePdf.length
  }));
const smallest = works.reduce((a, b) => a.bytes < b.bytes ? a : b);
const largest = works.reduce((a, b) => a.bytes > b.bytes ? a : b);
const last = works.at(-1);

async function checkLoginTypography(page, alignLeft) {
  const title = await page.locator('.hero h1').evaluate(async heading => {
    await document.fonts.ready;
    const style = getComputedStyle(heading);
    const canvas = document.createElement('canvas').getContext('2d');
    canvas.font = style.fontSize + ' ' + style.fontFamily;
    const logoLeft = document.querySelector('.hero img').getBoundingClientRect().left;
    const words = Array.from(heading.childNodes).filter(node => node.nodeType === Node.TEXT_NODE);
    const formTitle = document.querySelector('.login-card h2').firstChild;
    return {
      fonts: [...document.fonts].filter(face => face.status === 'loaded').map(face => face.family.replace(/["']/g, '')).sort(),
      formWords: Array.from(formTitle.textContent.matchAll(/\S+/g), match => {
        const range = document.createRange();
        range.setStart(formTitle, match.index);
        range.setEnd(formTitle, match.index + match[0].length);
        return range.getClientRects().length;
      }),
      words: words.map(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = range.getClientRects();
        const bearing = canvas.measureText(node.textContent[0].toUpperCase()).actualBoundingBoxLeft;
        return { lines: rects.length, inkOffset: rects[0].left - bearing - logoLeft };
      })
    };
  });
  assert.deepEqual(title.fonts, ['Roboto Flex Compact', 'Roboto Flex Extended']);
  assert.deepEqual(title.words.map(word => word.lines), [1, 1], 'Each word of the contest title must fit on one line.');
  assert.ok(title.formWords.every(lines => lines === 1), 'The sign-in heading should wrap between words.');
  if (alignLeft) assert.ok(title.words.every(word => Math.abs(word.inkOffset) <= 2), 'Align both opening capitals with the logo.');
}

async function useFixture(context) {
  await context.route(fixtureOrigin + '/**', async route => {
    const request = route.request();
    const endpoint = new URL(request.url());
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'apikey, authorization, content-type'
    };
    const reply = options => route.fulfill({ ...options, headers: { ...cors, ...options.headers } });
    if (request.method() === 'OPTIONS') return reply({ status: 204 });
    if (endpoint.pathname === '/auth/v1/token') {
      const data = request.postDataJSON();
      const success = data.email === 'jury-01@jury.example.com' && data.password === juror.password;
      return success ? reply({ json: { access_token: 'fixture-token', refresh_token: 'fixture-refresh', expires_in: 3600,
        user: { id: '00000000-0000-4000-8000-000000000001' } } })
        : reply({ status: 400, json: {} });
    }
    if (request.headers().authorization !== 'Bearer fixture-token') return reply({ status: 403 });
    if (endpoint.pathname === '/rest/v1/jury_works') return reply({ json: works });
    if (endpoint.pathname.startsWith('/storage/v1/object/authenticated/')) {
      return reply({ contentType: 'application/pdf', body: fixturePdf });
    }
    if (endpoint.pathname === '/auth/v1/logout') return reply({ status: 204 });
    return reply({ status: 404 });
  });
}

try {
  for (const profile of [
    { name: 'iPhone 13 WebKit', engine: webkit, options: {}, screen: devices['iPhone 13'], touch: true, work: smallest },
    { name: 'Chrome', engine: chromium, options: { channel: 'chrome' },
      screen: { viewport: { width: 1440, height: 900 } }, touch: false, work: largest }
  ]) {
    const browser = await profile.engine.launch(profile.options);
    try {
      const context = await browser.newContext(profile.screen);
      if (!live) await useFixture(context);
      const page = await context.newPage();
      const activate = locator => profile.touch ? locator.tap() : locator.press('Enter');
      const heading = page.locator('main h1');
      const button = name => page.getByRole('button', { name, exact: true });
      const filling = async password => {
        await page.getByLabel('Логин', { exact: true }).fill(juror.login);
        await page.getByLabel('Пароль', { exact: true }).fill(password);
        await activate(button('Войти'));
      };
      await page.goto(url + '#work/' + profile.work.id);
      await button('Войти').waitFor();
      await checkLoginTypography(page, !profile.touch);
      if (profile.touch) {
        const original = page.viewportSize();
        await page.setViewportSize({ width: 320, height: 568 });
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '32px');
        await checkLoginTypography(page, false);
        await page.evaluate(() => { document.documentElement.style.removeProperty('font-size'); });
        await page.setViewportSize(original);
      }
      assert.equal(await page.locator('.work-link').count(), 0);
      if (process.env.JURY_QA_SCREENSHOTS && !live) {
        await page.screenshot({ path: path.join(process.env.JURY_QA_SCREENSHOTS, profile.name + '-login.png') });
      }
      await filling('incorrect');
      await page.getByRole('alert').waitFor();
      assert.equal(await page.getByLabel('Логин', { exact: true }).inputValue(), juror.login);
      assert.equal(await page.getByLabel('Пароль', { exact: true }).inputValue(), 'incorrect');
      await filling(juror.password);
      const open = button('Открыть PDF');
      await open.waitFor({ timeout: 20000 });
      assert.ok((await heading.textContent()) === profile.work.title);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.JURY_QA_SCREENSHOTS && !live) {
        await page.screenshot({ path: path.join(process.env.JURY_QA_SCREENSHOTS, profile.name + '-work.png') });
      }

      let opened;
      const opening = new Promise(resolve => { opened = resolve; });
      const watch = tab => {
        tab.on('download', () => opened('download'));
        tab.on('framenavigated', frame => {
          if (frame.url().startsWith('blob:')) opened('browser PDF viewer');
        });
      };
      watch(page);
      context.on('page', watch);
      const [pdf] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith('/' + profile.work.id + '.pdf'), { timeout: 30000 }),
        activate(open)
      ]);
      assert.equal(pdf.status(), 200);
      assert.equal(pdf.headers()['content-type'], 'application/pdf');
      await open.waitFor({ timeout: 90000 });
      const variant = await Promise.race([
        opening,
        page.locator('#pdf-link').waitFor({ timeout: 15000 }).then(() => 'browser link to PDF')
      ]);
      await activate(page.getByRole('link', { name: 'К списку работ' }));
      await page.locator('.work-link').first().waitFor();
      assert.equal(await page.locator('.work-link').count(), 15);
      await activate(page.locator('a[id="' + last.id + '"]'));
      await open.waitFor();
      await activate(page.getByRole('link', { name: 'К списку работ' }));
      await page.waitForFunction(id => document.activeElement.id === id, last.id);
      await activate(button('Выйти'));
      await button('Войти').waitFor();
      assert.equal(await page.locator('.work-link').count(), 0);
      console.log(profile.name + ': login, 15 works, ' + variant + ', return and logout.');
    } finally {
      await browser.close();
    }
  }
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
}
