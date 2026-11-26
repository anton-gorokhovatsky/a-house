import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { createSupabaseAuth } from './supabase.mjs';
import { cabinetAssets } from './assets.mjs';
import { cataloguePage, signInPage, statusPage, workPage } from './views.mjs';

const workId = /^[a-f0-9]{24}$/;
const accountId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const sessionToken = /^[A-Za-z0-9_.-]{1,3500}$/;
const cacheHeaders = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' };
const htmlHeaders = {
  ...cacheHeaders,
  'content-type': 'text/html; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};

function destination(value) {
  return /^\/works(?:\/[a-f0-9]{24})?$/.test(value ?? '') ? value : '/works';
}

function html(response, status, body) {
  response.writeHead(status, htmlHeaders).end(body);
}

function redirect(response, location) {
  response.writeHead(303, { ...cacheHeaders, location }).end();
}

function requestCookie(request, name) {
  return (request.headers.cookie ?? '').split(';').map(part => part.trim())
    .find(part => part.startsWith(name + '='))?.slice(name.length + 1);
}

async function fields(request) {
  if (!request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) return null;
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16 * 1024) return null;
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

async function loadWorks(directory) {
  const catalogue = JSON.parse(await readFile(path.join(directory, 'catalogue.json'), 'utf8'));
  assert.ok(catalogue.stage === 3 && Array.isArray(catalogue.works) && catalogue.works.length === 15,
    'JURY_FINAL_DATA must contain the prepared stage-three catalogue.');
  const works = new Map();
  for (const work of catalogue.works) {
    assert.ok(workId.test(work.id) && !works.has(work.id) && work.file === work.id + '.pdf' &&
      typeof work.title === 'string' && work.title && typeof work.filename === 'string' &&
      Number.isSafeInteger(work.bytes) && work.bytes > 0 && /^[a-f0-9]{64}$/.test(work.sha256),
    'Invalid dossier metadata.');
    const filename = path.join(directory, 'pdfs', work.file);
    const info = await lstat(filename);
    assert.ok(info.isFile() && info.size === work.bytes, 'A dossier is absent or has changed.');
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(filename)) digest.update(chunk);
    assert.equal(digest.digest('hex'), work.sha256, 'A PDF differs from the prepared original.');
    works.set(work.id, { ...work, filenameOnDisk: filename });
  }
  return works;
}

function byteRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return false;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return false;
  return { start, end };
}

async function pdf(request, response, work) {
  const range = byteRange(request.headers.range, work.bytes);
  if (range === false) {
    response.writeHead(416, { ...cacheHeaders, 'content-range': 'bytes */' + work.bytes }).end();
    return;
  }
  const filename = encodeURIComponent(work.filename).replace(/[!'()*]/g,
    character => '%' + character.charCodeAt(0).toString(16));
  const headers = {
    ...cacheHeaders,
    'content-type': 'application/pdf',
    'x-content-type-options': 'nosniff',
    'content-disposition': "inline; filename=\"work.pdf\"; filename*=UTF-8''" + filename,
    'accept-ranges': 'bytes',
    'content-length': range ? range.end - range.start + 1 : work.bytes
  };
  if (range) headers['content-range'] = 'bytes ' + range.start + '-' + range.end + '/' + work.bytes;
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === 'HEAD') response.end();
  else await pipeline(createReadStream(work.filenameOnDisk, range ?? undefined), response);
}

export async function createFinalServer({ directory, origin, members, auth, onError = console.error }) {
  const publicUrl = new URL(origin);
  const secure = publicUrl.protocol === 'https:';
  assert.ok((secure || (publicUrl.protocol === 'http:' && ['127.0.0.1','localhost'].includes(publicUrl.hostname)))
    && publicUrl.href === publicUrl.origin + '/', 'JURY_ORIGIN must be an HTTPS origin or a local test address.');
  assert.ok(Array.isArray(members) && members.length &&
    members.every(id => typeof id === 'string' && accountId.test(id)),
  'members.json must contain the approved jury account identifiers.');
  const approved = new Set(members);
  assert.equal(approved.size, members.length, 'members.json contains duplicate accounts.');
  const works = await loadWorks(path.resolve(directory));
  const assets = new Map();
  for (const [name, { source, type }] of cabinetAssets) assets.set('/' + name, { type, body: await readFile(source) });
  const cookieName = secure ? '__Host-final-jury' : 'final-jury';

  function cookie(token, age) {
    return cookieName + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + age +
      (secure ? '; Secure' : '');
  }

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, publicUrl);
      const p = url.pathname;
      if (request.method === 'POST' && request.headers.origin !== publicUrl.origin) {
        response.writeHead(403, cacheHeaders).end();
        return;
      }

      if (request.method === 'GET' && p === '/login') {
        html(response, 200, signInPage({ next: destination(url.searchParams.get('next')) }));
        return;
      }

      if (request.method === 'POST' && p === '/login') {
        const body = await fields(request);
        const next = destination(body?.get('next'));
        const login = (body?.get('login') ?? '').trim();
        const password = body?.get('password') ?? '';
        const session = login && login.length <= 254 && password && password.length <= 1024
          ? await auth.signIn(login, password)
          : null;
        if (!session || !approved.has(session.userId) ||
            !sessionToken.test(session.token ?? '') ||
            !Number.isSafeInteger(session.seconds) || session.seconds <= 0) {
          html(response, 401, signInPage({ login, next, message: 'Проверьте логин и пароль для кабинета жюри.' }));
          return;
        }
        response.setHeader('set-cookie', cookie(session.token, session.seconds));
        redirect(response, next);
        return;
      }

      if (request.method === 'POST' && p === '/logout') {
        response.setHeader('set-cookie', cookie('', 0));
        redirect(response, '/login');
        return;
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { ...cacheHeaders, allow: 'GET, HEAD' }).end();
        return;
      }
      const asset = assets.get(p);
      if (asset) {
        response.writeHead(200, {
          ...cacheHeaders, 'x-content-type-options': 'nosniff',
          'content-type': asset.type
        }).end(request.method === 'HEAD' ? undefined : asset.body);
        return;
      }

      const match = /^\/(works|pdf)\/([a-f0-9]{24})$/.exec(p);
      if (p !== '/' && p !== '/works' && !match) {
        html(response, 404, statusPage('Страница не найдена', 'Вернитесь к списку работ.'));
        return;
      }

      const token = requestCookie(request, cookieName);
      const member = sessionToken.test(token ?? '') ? await auth.account(token) : null;
      if (!approved.has(member)) {
        if (match?.[1] === 'pdf') response.writeHead(401, cacheHeaders).end();
        else redirect(response, '/login?next=' + encodeURIComponent(destination(p)));
        return;
      }

      if (p === '/') redirect(response, '/works');
      else if (p === '/works') html(response, 200, cataloguePage([...works.values()]));
      else {
        const work = works.get(match[2]);
        if (!work) html(response, 404, statusPage('Работа не найдена', 'Вернитесь к списку работ.'));
        else if (match[1] === 'pdf') await pdf(request, response, work);
        else html(response, 200, workPage(work));
      }
    } catch (error) {
      if (error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
      onError(error.name);
      if (!response.headersSent) {
        html(response, 503, statusPage('Кабинет временно недоступен', 'Попробуйте войти ещё раз через несколько минут.'));
      } else response.destroy();
    }
  });
}

async function start() {
  const {
    JURY_FINAL_DATA: directory, JURY_ORIGIN: origin,
    JURY_SUPABASE_URL: apiUrl, JURY_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    JURY_LOGIN_DOMAIN: loginDomain, JURY_HOST: host = '127.0.0.1', JURY_PORT: port = '4183'
  } = process.env;
  assert.ok(directory && origin && apiUrl && publishableKey,
    'Set JURY_FINAL_DATA, JURY_ORIGIN, JURY_SUPABASE_URL and JURY_SUPABASE_PUBLISHABLE_KEY.');
  const members = JSON.parse(await readFile(path.join(directory, 'members.json'), 'utf8'));
  const auth = createSupabaseAuth({ apiUrl, publishableKey, loginDomain });
  const server = await createFinalServer({ directory, origin, members, auth });
  server.listen(Number(port), host, () => console.log('Final jury cabinet listening on port ' + port));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await start();
}
