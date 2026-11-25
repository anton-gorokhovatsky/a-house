import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import https from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { build } from './build.mjs';
import { previewServer } from './preview.mjs';
import { createApplicationHandler } from '../server/member-application.mjs';

async function listen(server, protocol) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return protocol + '://127.0.0.1:' + server.address().port;
}

const declinedEmail = 'retry@example.invalid';

function receiveOrder(received) {
  return async (request, response) => {
    const html = { 'Content-Type': 'text/html; charset=utf-8' };
    if (request.method === 'POST' && request.url === '/order') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const fields = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
      received.push({ path: request.url, fields, type: request.headers['content-type'] });
      if (fields.email === declinedEmail) {
        response.writeHead(422, html).end('<h1>Укажите другой адрес электронной почты</h1>');
      } else {
        response.writeHead(303, { Location: '/received' + request.url }).end();
      }
    } else if (request.method === 'GET' && request.url === '/received/order') {
      response.writeHead(200, html).end('<h1>Принято локальным обработчиком</h1>');
    } else if (request.method === 'GET' && ['/terms', '/consent'].includes(request.url)) {
      response.writeHead(200, html).end('<h1>Тестовый документ</h1>');
    } else {
      response.writeHead(404).end();
    }
  };
}

export async function checkMembershipTransport(browser, contextOptions = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'a-house-form-'));
  const servers = [];
  let context;
  let nativeContext;
  try {
    const cert = path.join(root, 'cert.pem');
    const key = path.join(root, 'key.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=127.0.0.1', '-keyout', key, '-out', cert], { stdio: 'ignore' });
    const received = [];
    const order = receiveOrder(received);
    let application;
    const receiver = https.createServer({ cert: await readFile(cert), key: await readFile(key) }, (request, response) => {
      return request.url === '/application' ? application(request, response) : order(request, response);
    });
    servers.push(receiver);
    const api = await listen(receiver, 'https');
    const consentText = 'Принимаю условия тестовой формы';
    const env = {
      A_FRIEND_ORDER_URL: api + '/order', A_FRIEND_PERIOD: 'за 3 месяца',
      A_FRIEND_TERMS_URL: api + '/terms', A_FRIEND_CONSENT_URL: api + '/consent', A_FRIEND_CONSENT_TEXT: consentText,
      A_MEMBER_APPLICATION_URL: api + '/application', A_MEMBER_TERMS_URL: api + '/terms',
      A_MEMBER_CONSENT_URL: api + '/consent', A_MEMBER_CONSENT_TEXT: consentText
    };
    const base = '/a-house/';
    const variant = await build(base, { outputDirectory: path.join(root, 'site'), env });
    const preview = previewServer(variant, base);
    servers.push(preview);
    const site = await listen(preview, 'http');
    const mailer = nodemailer.createTransport({ streamTransport: true, buffer: true });
    let attempts = 0;
    const delivered = [];
    application = createApplicationHandler({ siteURL: site + base, consentURL: api + '/consent', deliver: async message => {
      if (++attempts === 1) throw new Error('Simulated mail gateway failure');
      const packed = await mailer.sendMail({ ...message, from: 'club@example.invalid', to: 'team@example.invalid' });
      delivered.push({ message, packed });
    } });
    context = await browser.newContext({ ...contextOptions, ignoreHTTPSErrors: true });
    context.setDefaultTimeout(30_000);
    const allowed = new Set([site, api]);
    await context.route('**/*', route => allowed.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const page = await context.newPage();
    const name = 'Тест & проверка';
    const phone = '+7 (000) 000-00-00';

    for (const kind of ['friend', 'member']) {
      const friend = kind === 'friend';
      const endpoint = friend ? '/order' : '/application';
      const entry = site + base + (friend ? '#services-checkout' : 'member/?offer=patron');
      await page.goto(site + base + (friend ? 'press/#print-archive' : 'club/#programs'));
      const destination = friend
        ? page.locator('#print-archive').getByRole('link', { name: 'Оформить подписку A–Friend' })
        : page.getByRole('link', { name: 'Заполнить анкету по программе A–Patron' });
      await destination.click();
      await page.waitForURL(entry);
      const form = page.locator('#' + kind + '-form');
      const field = key => form.locator('input[name="' + key + '"]');
      const submit = form.locator('button[type="submit"]');
      const consent = field('consent');
      assert.equal(await form.getAttribute('method'), 'post');
      assert.equal(await form.getAttribute('action'), api + endpoint);
      assert.equal(await consent.isChecked(), false);
      if (friend) {
        const increment = form.getByRole('button', { name: 'Увеличить количество' });
        const decrement = form.getByRole('button', { name: 'Уменьшить количество' });
        assert.ok(await decrement.isDisabled());
        await increment.click();
        assert.match(await form.locator('[data-order-total]').innerText(), /24\s000/);
        await form.getByRole('button', { name: 'Удалить' }).click();
        assert.equal(await submit.isVisible(), false);
        assert.equal(await form.locator('[name="quantity"]').inputValue(), '0');
        await form.getByRole('button', { name: 'Вернуть в заказ' }).click();
        assert.equal(await form.locator('[name="quantity"]').inputValue(), '2');
        assert.ok(await decrement.isEnabled());
        const areas = form.getByLabel('Сфера деятельности', { exact: false });
        assert.equal(await areas.locator('option').count(), 9);
        assert.equal(await areas.inputValue(), '');
        await areas.selectOption({ label: 'Урбанистика' });
        await form.locator('textarea[name="comment"]').fill('Сертификат для получателя');
        const offer = await page.locator('#services-checkout').innerText();
        assert.match(offer, /12\s000\s₽/);
        assert.match(offer, /за\s+3\s+месяца/);
      } else {
        assert.match((await page.locator('#member-intro').innerText()).replace(/\s+/g, ' '), /укажите, как с вами связаться/);
        assert.equal(await form.locator('[name="offer"]:checked').inputValue(), 'patron');
        await field('company').fill('Тестовое бюро');
        await form.locator('[name="connect"][value="Email"]').check();
        await field('sphere').fill('Архитектура');
        await field('profession').fill('Архитектор');
        await field('recommendations').fill('Тестовый участник клуба');
        await form.locator('textarea[name="comment"]').fill('Тест <письма>\nВторая строка.');
      }
      const email = field('email');
      const goodEmail = friend ? 'friend+reader@example.invalid' : 'member`reader@example.invalid';
      await field('name').fill(name);
      await field('phone').fill(phone);
      await email.fill('reader');
      await submit.click();
      assert.equal(await email.getAttribute('aria-invalid'), 'true');
      assert.equal(await field('name').inputValue(), name);
      assert.equal(page.url(), entry);
      const count = received.length;
      await email.fill(friend ? declinedEmail : goodEmail);
      assert.equal(await email.getAttribute('aria-invalid'), null);
      const documentLink = form.locator('a[href="' + api + '/terms"]');
      const [doc] = await Promise.all([page.waitForEvent('popup'), documentLink.click()]);
      await doc.getByRole('heading', { name: 'Тестовый документ' }).waitFor();
      await doc.close();
      assert.equal(await consent.isChecked(), false);
      assert.equal(received.length, count);
      await consent.check();
      if (friend) {
        const [failure] = await Promise.all([page.waitForResponse(api + endpoint), submit.click()]);
        assert.equal(failure.status(), 422);
        await page.getByRole('heading', { name: 'Укажите другой адрес электронной почты' }).waitFor();
        await page.goBack();
        assert.equal(page.url(), entry);
        assert.equal(await field('name').inputValue(), name);
        assert.equal(await field('phone').inputValue(), phone);
        assert.equal(await email.inputValue(), declinedEmail);
        assert.equal(await form.locator('[name="workarea"]').inputValue(), 'Урбанистика');
        assert.equal(await form.locator('[name="comment"]').inputValue(), 'Сертификат для получателя');
        await email.fill(goodEmail);
        await consent.check();
      }
      if (!friend) {
        const status = form.getByRole('status');
        const [failure] = await Promise.all([page.waitForResponse(api + endpoint), submit.click()]);
        assert.equal(failure.status(), 503);
        await status.filter({ hasText: 'Не удалось подтвердить отправку.' }).waitFor();
        assert.equal(page.url(), entry);
        for (const [key, value] of Object.entries({ name, phone, email: goodEmail, company: 'Тестовое бюро',
          sphere: 'Архитектура', profession: 'Архитектор', recommendations: 'Тестовый участник клуба' })) {
          assert.equal(await field(key).inputValue(), value, 'Preserved club form ' + key);
        }
        assert.equal(await form.locator('[name="offer"]:checked').inputValue(), 'patron');
        assert.equal(await form.locator('[name="connect"]:checked').inputValue(), 'Email');
        assert.equal(await form.locator('[name="comment"]').inputValue(), 'Тест <письма>\nВторая строка.');
        assert.ok(await consent.isChecked());
        const [receipt] = await Promise.all([page.waitForResponse(api + endpoint), submit.click()]);
        assert.equal(receipt.status(), 200);
        await status.filter({ hasText: 'Заявка отправлена.' }).waitFor();
        assert.equal(page.url(), entry);
        assert.ok(await submit.isHidden());
        assert.equal(delivered.length, 1);
        const [{ message, packed }] = delivered;
        assert.equal(message.subject, 'Заявка в клуб A–House · A–Patron');
        assert.equal(message.replyTo.address, goodEmail);
        assert.deepEqual(packed.envelope.to, ['team@example.invalid']);
        assert.match(packed.message.toString(), /Content-Type: multipart\/alternative/i);
        for (const value of [name, phone, goodEmail, 'Тестовое бюро', 'По почте', 'Архитектура', 'Архитектор', 'Тестовый участник клуба', 'Тест <письма>\nВторая строка.']) {
          assert.ok(message.text.includes(value));
        }
        assert.ok(message.html.includes('Тест &lt;письма&gt;<br>Вторая строка.'));
        nativeContext = await browser.newContext({ ...contextOptions, ignoreHTTPSErrors: true, javaScriptEnabled: false });
        nativeContext.setDefaultTimeout(30_000);
        const nativePage = await nativeContext.newPage();
        await nativePage.goto(entry);
        const nativeForm = nativePage.locator('#member-form');
        const data = new URLSearchParams(receipt.request().postData());
        for (const [key, value] of data) {
          if (['offer', 'connect', 'consent'].includes(key)) {
            await nativeForm.locator('[name="' + key + '"][value="' + value + '"]').check();
          } else {
            await nativeForm.locator('[name="' + key + '"]').fill(value);
          }
        }
        const [replay] = await Promise.all([nativePage.waitForResponse(api + endpoint), nativeForm.locator('button[type="submit"]').click()]);
        assert.equal(replay.status(), 200);
        await nativePage.getByRole('heading', { name: 'Заявка отправлена' }).waitFor();
        assert.equal(delivered.length, 1, 'Repeating the same submission should not duplicate mail');
        continue;
      }
      await Promise.all([page.waitForURL(api + '/received' + endpoint), submit.click()]);
      await page.getByRole('heading', { name: 'Принято локальным обработчиком' }).waitFor();
      const expected = { name, phone, email: goodEmail, consent: '1' };
      Object.assign(expected, { product: 'A-Friend', quantity: '2', workarea: 'Урбанистика', comment: 'Сертификат для получателя' });
      const last = received.at(-1);
      assert.equal(received.length, count + 2);
      assert.equal(last.path, endpoint);
      assert.equal(last.type, 'application/x-www-form-urlencoded');
      for (const [key, value] of Object.entries(expected)) assert.equal(last.fields[key], value, kind + ' ' + key);
    }
    console.log('Membership transport verified: HTTPS orders, club email, rejection, retained data and retry.');
  } finally {
    await nativeContext?.close();
    await context?.close();
    for (const server of servers) server.close();
    await rm(root, { recursive: true, force: true });
  }
}
