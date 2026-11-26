import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, devices, webkit } from 'playwright-core';
import { createFinalServer } from './server.mjs';
import { createSupabaseAuth } from './supabase.mjs';

const directory = process.argv[2];
assert.ok(directory, 'Pass the private import directory to check.mjs.');
const { works } = JSON.parse(await readFile(path.join(directory, 'catalogue.json'), 'utf8'));
const port = Number(process.env.JURY_VERIFY_PORT ?? '44831');
const origin = 'http://127.0.0.1:' + port;
const screenshots = process.env.JURY_QA_SCREENSHOTS;
if (screenshots) await mkdir(screenshots, { recursive: true });

const memberId = randomUUID();
const outsiderId = randomUUID();
const token = randomUUID();
const outsiderToken = randomUUID();
const testPassword = randomUUID();
const auth = createSupabaseAuth({
  apiUrl: 'https://jury-test.example.test',
  publishableKey: 'sb_publishable_fixture',
  loginDomain: 'example.test',
  async fetchRequest(url, request) {
    assert.equal(url.origin, 'https://jury-test.example.test');
    assert.equal(request.headers.apikey, 'sb_publishable_fixture');
    if (url.pathname === '/auth/v1/token') {
      assert.equal(request.method, 'POST');
      assert.equal(url.searchParams.get('grant_type'), 'password');
      const { email, password } = JSON.parse(request.body);
      if (password === testPassword && email === 'member@example.test') {
        return Response.json({ user: { id: memberId }, access_token: token, expires_in: 3600 });
      }
      if (password === testPassword && email === 'outsider@example.test') {
        return Response.json({ user: { id: outsiderId }, access_token: outsiderToken, expires_in: 3600 });
      }
      return new Response(null, { status: 400 });
    }
    assert.equal(url.pathname, '/auth/v1/user');
    assert.equal(request.method, 'GET');
    if (request.headers.authorization === 'Bearer ' + token) return Response.json({ id: memberId });
    if (request.headers.authorization === 'Bearer ' + outsiderToken) return Response.json({ id: outsiderId });
    return new Response(null, { status: 401 });
  }
});

const failures = [];
const server = await createFinalServer({ directory, origin, auth, members: [memberId], onError: name => failures.push(name) });

async function checkViewport(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'The current screen overflows the viewport.');
}

try {
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', resolve).once('error', reject));
  const sample = works.reduce((smallest, work) => work.bytes < smallest.bytes ? work : smallest);
  const workPath = '/works/' + sample.id;
  const pdfPath = '/pdf/' + sample.id;
  const rejected = await fetch(origin + pdfPath, { headers: { range: 'bytes=0-4' } });
  assert.equal(rejected.status, 401);
  assert.equal(await rejected.text(), '');

  const form = new URLSearchParams({ login: 'outsider', password: testPassword, next: '/works' });
  const unapproved = await fetch(origin + '/login', { method: 'POST', headers: { origin }, body: form });
  assert.equal(unapproved.status, 401);
  assert.equal(unapproved.headers.get('set-cookie'), null);
  const foreignOrigin = await fetch(origin + '/login', {
    method: 'POST', headers: { origin: 'https://another-site.example.test' }, body: form
  });
  assert.equal(foreignOrigin.status, 403);

  for (const profile of [
    { name: 'iPhone-13', isMobile: true, engine: webkit, context: devices['iPhone 13'], launch: {} },
    { name: 'Desktop-Chrome', isMobile: false, engine: chromium, context: { viewport: { width: 1440, height: 900 } },
      launch: { channel: 'chrome' } }
  ]) {
    const browser = await profile.engine.launch(profile.launch);
    try {
      const context = await browser.newContext(profile.context);
      const page = await context.newPage();
      const control = selector => {
        const locator = page.locator(selector);
        return profile.isMobile ? locator.tap() : locator.press('Enter');
      };

      await page.goto(origin + workPath);
      assert.equal(new URL(page.url()).pathname, '/login');
      assert.ok(!(await page.locator('body').innerText()).includes(sample.title),
        'A logged-out visitor can see a title.');
      await checkViewport(page);
      if (screenshots) await page.screenshot({ path: path.join(screenshots, profile.name + '-login.png'), fullPage: true });

      await page.getByLabel('Логин', { exact: true }).fill('member');
      await page.getByLabel('Пароль', { exact: true }).fill('incorrect');
      await control('button.primary');
      await page.getByRole('alert').waitFor();
      assert.equal(await page.getByLabel('Логин', { exact: true }).inputValue(), 'member');
      assert.equal(await page.getByLabel('Пароль', { exact: true }).getAttribute('aria-describedby'), 'login-error');
      await page.getByLabel('Пароль', { exact: true }).fill(testPassword);
      await control('button.primary');
      await page.waitForURL(origin + workPath);
      assert.ok((await page.locator('main h1').textContent()) === sample.title);
      await checkViewport(page);
      if (screenshots) await page.screenshot({ path: path.join(screenshots, profile.name + '-work.png'), fullPage: true });
      if (profile.isMobile) {
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '32px');
        await checkViewport(page);
        await page.evaluate(() => { document.documentElement.style.removeProperty('font-size'); });
      }

      const pdfLink = page.getByRole('link', { name: 'Открыть PDF' });
      assert.ok(await pdfLink.isVisible());
      assert.equal(await pdfLink.getAttribute('href'), pdfPath);
      const response = await context.request.get(origin + pdfPath, { headers: { range: 'bytes=0-4' } });
      assert.equal(response.status(), 206);
      assert.equal(response.headers()['content-type'], 'application/pdf');
      assert.equal(response.headers()['content-range'], 'bytes 0-4/' + sample.bytes);
      assert.equal(await response.text(), '%PDF-');
      assert.equal((await context.request.head(origin + pdfPath)).headers()['content-length'], String(sample.bytes));

      await control('.return');
      await page.waitForURL(origin + '/works#' + sample.id);
      assert.equal(await page.locator('.work-link').count(), 15);
      await checkViewport(page);
      if (screenshots) await page.screenshot({ path: path.join(screenshots, profile.name + '-catalogue.png'), fullPage: true });
      const lastWork = works.at(-1);
      const lastLink = 'a[href="/works/' + lastWork.id + '"]';
      await control(lastLink);
      await page.waitForURL(origin + '/works/' + lastWork.id);
      await control('.return');
      await page.waitForURL(origin + '/works#' + lastWork.id);
      await page.waitForFunction(selector => {
        const row = document.querySelector(selector).getBoundingClientRect();
        return row.top >= 0 && row.bottom <= innerHeight;
      }, lastLink);
      await control('form[action="/logout"] button');
      await page.waitForURL(origin + '/login');
      assert.equal((await context.request.get(origin + pdfPath)).status(), 401);
    } finally {
      await browser.close();
    }
    console.log(profile.name + ': login, 15 works, protected PDF, return and logout verified.');
  }
  assert.deepEqual(failures, []);
} finally {
  await new Promise(resolve => server.close(resolve));
}
