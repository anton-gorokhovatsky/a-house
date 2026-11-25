import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { clubPrograms } from '../src/data/club-programs.mjs';

const contactMethods = { Email: 'По почте', Telegram: 'В Telegram' };
const requiredFields = { offer: 20, name: 200, company: 200, phone: 48, email: 254, connect: 20, consent: 1 };
const optionalFields = { sphere: 200, profession: 200, recommendations: 420, comment: 2000 };
const limits = { ...requiredFields, ...optionalFields };
const addressPattern = /^[a-z0-9.!#$%&'*+/=?^_\x60{}|~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const acceptedTitle = 'Заявка отправлена';
const acceptedMessage = 'Команда клуба свяжется с вами выбранным способом.';
const failureTitle = 'Не удалось подтвердить отправку';
const submittedAt = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const escapeHTML = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function readApplication(body) {
  const fields = {};
  const received = new URLSearchParams(body);
  for (const [key, maxLength] of Object.entries(limits)) {
    const values = received.getAll(key);
    const value = (values[0] ?? '').replace(/\r\n?/g, '\n').trim();
    if (values.length > 1 || value.length > maxLength || (Object.hasOwn(requiredFields, key) && !value)) return null;
    if (/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value) || (key !== 'comment' && /[\t\n]/u.test(value))) return null;
    fields[key] = value;
  }
  const digits = fields.phone.replace(/\D/g, '');
  if (!Object.hasOwn(clubPrograms, fields.offer) || !Object.hasOwn(contactMethods, fields.connect) ||
      fields.consent !== '1' || !addressPattern.test(fields.email) ||
      digits.length < 7 || digits.length > 15 || /[^\d\s+().-]/.test(fields.phone)) return null;
  return fields;
}

export function renderApplicationEmail(fields, { date = new Date(), consentURL }) {
  const program = clubPrograms[fields.offer];
  const subject = 'Заявка в клуб A–House · ' + program;
  const time = submittedAt.format(date) + ' мск';
  const rows = [
    ['Компания', fields.company],
    ['Способ связи', contactMethods[fields.connect]],
    ['Электронная почта', fields.email, 'mailto:' + encodeURIComponent(fields.email).replace('%40', '@')],
    ['Телефон', fields.phone, 'tel:' + fields.phone.replace(/[^\d+]/g, '')],
    ['Сфера деятельности', fields.sphere],
    ['Должность', fields.profession],
    ['Рекомендация', fields.recommendations],
    ['Ожидания от клуба', fields.comment]
  ].filter(([, value]) => value);
  const details = rows.map(([label, value, href]) => {
    const display = escapeHTML(value).replaceAll('\n', '<br>');
    return '<tr><td style="padding:12px 0;border-bottom:1px solid #d9d6d1">' +
      '<p style="margin:0 0 4px;color:#57534e;font-size:13px">' + label + '</p>' +
      '<p style="margin:0;overflow-wrap:anywhere">' +
      (href ? '<a style="color:#171717" href="' + escapeHTML(href) + '">' + display + '</a>' : display) + '</p></td></tr>';
  }).join('\n');
  const text = [subject, fields.name, ...rows.map(([label, value]) => label + ' — ' + value),
    '', 'Получено ' + time, 'Согласие на обработку данных — ' + consentURL].join('\n');
  const html = '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + subject + '</title></head>' +
    '<body style="margin:0;background:#eeece7;color:#171717;font:16px/1.5 Arial,sans-serif">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:20px 12px">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fbfaf7">' +
    '<tr><td style="padding:24px;background:#171717;color:#fbfaf7">' +
    '<p style="margin:0 0 12px;font:18px Georgia,serif">A–HOUSE</p>' +
    '<h1 style="margin:0;font:normal 35px/1.13 Georgia,serif">Заявка в клуб</h1>' +
    '<p style="margin:8px 0 0;font-size:16px">' + program + '</p></td></tr>' +
    '<tr><td style="padding:24px;overflow-wrap:anywhere">' +
    '<h2 style="margin:0 0 8px;font:normal 26px/1.2 Georgia,serif">' + escapeHTML(fields.name) + '</h2>' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed">' + details + '</table>' +
    '<p style="margin:18px 0 4px;color:#57534e;font-size:13px">Получено ' + time + '</p>' +
    '<p style="margin:0;color:#57534e;font-size:13px"><a style="color:inherit" href="' + escapeHTML(consentURL) +
    '">Согласие на обработку данных</a> получено.</p>' +
    '</td></tr></table></td></tr></table></body></html>';
  return { subject, text, html, replyTo: { address: fields.email, name: '' } };
}

export function createApplicationHandler({ siteURL, consentURL, deliver }) {
  const site = new URL(siteURL);
  const club = new URL('club/#programs', site);
  const recent = new Map();
  function send(request, response, status, title, message) {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin, Accept' };
    if (request.headers.origin === site.origin) headers['Access-Control-Allow-Origin'] = site.origin;
    if (request.headers.accept === 'application/json') {
      response.writeHead(status, { ...headers, 'Content-Type': 'application/json' })
        .end(JSON.stringify({ status: status === 200 ? 'accepted' : 'error' }));
      return;
    }
    response.writeHead(status, {
      ...headers, 'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"
    }).end('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + title + ' — A–House</title><body style="margin:3rem auto;padding:0 1rem;max-width:36rem;font:18px/1.5 system-ui">' +
      '<h1>' + title + '</h1><p>' + message + '</p>' +
      (status === 200 ? '<a href="' + escapeHTML(club.href) + '">К программам клуба</a>' : '') + '</body></html>');
  }

  return async function handleApplication(request, response) {
    if (request.url !== '/application' || request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.origin !== site.origin || request.headers['content-type']?.split(';', 1)[0] !== 'application/x-www-form-urlencoded') {
      send(request, response, 403, failureTitle, 'Вернитесь к анкете на сайте A–House.');
      return;
    }
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        length += chunk.length;
        if (length > 48 * 1024) {
          request.resume();
          send(request, response, 413, failureTitle, 'Вернитесь к анкете и сократите текст заявки.');
          return;
        }
        chunks.push(chunk);
      }
      const fields = readApplication(Buffer.concat(chunks).toString('utf8'));
      if (!fields) {
        send(request, response, 422, failureTitle, 'Вернитесь к анкете и проверьте заполненные поля.');
        return;
      }
      const key = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
      const now = Date.now();
      for (const [digest, entry] of recent) {
        if (entry.expires < now) recent.delete(digest);
      }
      let entry = recent.get(key);
      if (!entry) {
        if (recent.size >= 512) {
          send(request, response, 503, failureTitle, 'Вернитесь к анкете и попробуйте отправить её позже.');
          return;
        }
        entry = { expires: Infinity, delivery: Promise.resolve().then(() => deliver(renderApplicationEmail(fields, { consentURL }))) };
        recent.set(key, entry);
        entry.delivery.then(() => { entry.expires = Date.now() + 10 * 60 * 1000; }, () => { recent.delete(key); });
      }
      await entry.delivery;
      send(request, response, 200, acceptedTitle, acceptedMessage);
    } catch {
      if (!response.destroyed) send(request, response, 503, failureTitle, 'Вернитесь к анкете и попробуйте отправить её ещё раз.');
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { A_MEMBER_SITE_URL, A_MEMBER_CONSENT_URL, A_MEMBER_SMTP_URL, A_MEMBER_MAIL_FROM, A_MEMBER_MAIL_TO } = process.env;
  const siteURL = URL.canParse(A_MEMBER_SITE_URL) ? new URL(A_MEMBER_SITE_URL) : null;
  const consentURL = URL.canParse(A_MEMBER_CONSENT_URL) ? new URL(A_MEMBER_CONSENT_URL) : null;
  const smtp = URL.canParse(A_MEMBER_SMTP_URL) ? new URL(A_MEMBER_SMTP_URL) : null;
  if (siteURL?.protocol !== 'https:' || !siteURL.pathname.endsWith('/') || siteURL.username || siteURL.password ||
      consentURL?.protocol !== 'https:' || consentURL.username || consentURL.password ||
      !['smtp:', 'smtps:'].includes(smtp?.protocol) || !smtp.hostname ||
      !addressPattern.test(A_MEMBER_MAIL_FROM ?? '') || !addressPattern.test(A_MEMBER_MAIL_TO ?? '')) {
    throw new Error('Configure A_MEMBER_SITE_URL, A_MEMBER_CONSENT_URL, A_MEMBER_SMTP_URL, A_MEMBER_MAIL_FROM and A_MEMBER_MAIL_TO.');
  }
  const secure = smtp.protocol === 'smtps:';
  const transport = nodemailer.createTransport({
    host: smtp.hostname, port: Number(smtp.port || (secure ? 465 : 587)), secure, requireTLS: !secure,
    auth: smtp.username ? { user: decodeURIComponent(smtp.username), pass: decodeURIComponent(smtp.password) } : undefined,
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 22000,
    disableFileAccess: true, disableUrlAccess: true
  });
  const handler = createApplicationHandler({
    siteURL, consentURL,
    deliver: async message => {
      const result = await transport.sendMail({ ...message, from: { name: 'Клуб A–House', address: A_MEMBER_MAIL_FROM }, to: A_MEMBER_MAIL_TO });
      if (!result.accepted.length) throw new Error('SMTP did not accept the application');
    }
  });
  const port = Number(process.env.PORT ?? 8787);
  createServer({ requestTimeout: 20000 }, handler).listen(port, '127.0.0.1', () => {
    console.log('Club application handler available on loopback, port ' + port);
  });
}
