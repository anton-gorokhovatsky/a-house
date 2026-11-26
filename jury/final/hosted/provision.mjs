import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const [setupDirectory, materialsDirectory] = process.argv.slice(2);
assert.ok(setupDirectory && materialsDirectory, 'Pass the private setup and materials directories.');
const readJson = async filename => JSON.parse(await readFile(filename, 'utf8'));
const target = await readJson(path.join(setupDirectory, 'project.json'));
const project = target.data ?? target;
const ref = project.ref ?? project.id;
assert.equal(project.name, 'a-house-mts-jury', 'Use the dedicated final-round project.');
assert.match(ref, /^[a-z0-9]{20}$/);
const origin = 'https://' + ref + '.supabase.co';
const keyFile = await readJson(path.join(setupDirectory, 'api-keys.json'));
const keys = Array.isArray(keyFile) ? keyFile : keyFile.keys ?? keyFile.data;
const keyValues = keys.map(key => key.api_key ?? key.key);
const publishableKey = keyValues.find(key => key?.startsWith('sb_publishable_'));
const adminKey = keyValues.find(key => key?.startsWith('sb_secret_')) ??
  (keys.find(key => key.name === 'service_role')?.api_key);
assert.ok(publishableKey && adminKey, 'The publishable and administrative keys are required.');

const catalogue = await readJson(path.join(materialsDirectory, 'catalogue.json'));
assert.equal(catalogue.stage, 3);
assert.equal(catalogue.works.length, 15);
const works = catalogue.works.map(work => {
  assert.match(work.id, /^[a-f0-9]{24}$/);
  assert.equal(work.file, work.id + '.pdf');
  return { id: work.id, position: work.number, title: work.title, bytes: work.bytes };
});
assert.equal(new Set(works.map(work => work.id)).size, works.length);

function request(route, { useAdmin = false, token, method = 'GET', body, headers = {} } = {}) {
  const secret = useAdmin ? adminKey : publishableKey;
  const bearer = token ?? (useAdmin && adminKey.startsWith('ey') ? adminKey : undefined);
  const json = body && !Buffer.isBuffer(body);
  return fetch(origin + route, {
    redirect: 'error', cache: 'no-store', method, signal: AbortSignal.timeout(90000),
    headers: {
      apikey: secret,
      ...(bearer && { authorization: 'Bearer ' + bearer }),
      ...(json && { 'content-type': 'application/json' }),
      ...headers
    },
    body: json ? JSON.stringify(body) : body
  });
}

async function requireOk(response, step) {
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    const code = String(problem.code ?? problem.error_code ?? problem.error ?? '');
    throw new Error(step + ' failed (HTTP ' + response.status + ')' +
      (/^[a-zA-Z0-9_ -]{1,64}$/.test(code) ? ' ' + code : ''));
  }
  return response;
}

async function admin(route, options, step) {
  return requireOk(await request(route, { ...options, useAdmin: true }), step);
}

async function writePrivate(filename, text) {
  const fullPath = path.join(setupDirectory, filename);
  await writeFile(fullPath + '.pending', text, { mode: 0o600 });
  await rename(fullPath + '.pending', fullPath);
}

const accessFile = path.join(setupDirectory, 'jurors.json');
let jurors;
try {
  jurors = await readJson(accessFile);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  jurors = Array.from({ length: 15 }, (_, index) => ({
    login: 'jury-' + String(index + 1).padStart(2, '0'),
    password: randomBytes(20).toString('base64url') + 'Aa1!'
  }));
  await writePrivate('jurors.json', JSON.stringify(jurors, null, 2) + '\n');
}
assert.equal(jurors.length, 15);
const email = juror => juror.login + '@jury.example.com';
const membersResponse = await admin('/auth/v1/admin/users?per_page=100', {}, 'List jury accounts');
const { users } = await membersResponse.json();
assert.ok(users.every(user => jurors.some(juror => email(juror) === user.email)),
  'The dedicated project contains unrelated accounts.');
for (const juror of jurors) {
  let user = users.find(user => user.email === email(juror));
  if (!user) {
    user = await (await admin('/auth/v1/admin/users', {
      method: 'POST', body: { email: email(juror), password: juror.password, email_confirm: true }
    }, 'Create jury account')).json();
  }
  assert.match(user.id, /^[a-f0-9-]{36}$/);
  juror.userId = user.id;
}
await writePrivate('jurors.json', JSON.stringify(jurors, null, 2) + '\n');
console.log('Accounts prepared:', jurors.length);

const bucketRoute = '/storage/v1/bucket/jury-final';
const bucket = await request(bucketRoute, { useAdmin: true });
if ([400, 404].includes(bucket.status)) {
  await (await admin('/storage/v1/bucket', {
    method: 'POST', body: {
      id: 'jury-final', name: 'jury-final', public: false,
      allowed_mime_types: ['application/pdf'], file_size_limit: 50000000
    }
  }, 'Create private PDF storage')).body?.cancel();
} else {
  await requireOk(bucket, 'Check PDF storage');
  await bucket.body?.cancel();
}
const verifiedBucket = await admin(bucketRoute, {}, 'Verify PDF storage privacy');
assert.equal((await verifiedBucket.json()).public, false, 'Expected a private bucket before uploading originals.');

const pdfRoute = id => '/storage/v1/object/authenticated/jury-final/' + id + '.pdf';
async function upload(work, file) {
  const target = new URL('/storage/v1/object/jury-final/' + work.file, origin);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const status = await new Promise((resolve, reject) => {
      const headers = {
        apikey: adminKey,
        'content-type': 'application/pdf',
        'content-length': file.length,
        'cache-control': 'no-store',
        'x-upsert': 'true'
      };
      if (adminKey.startsWith('ey')) headers.authorization = 'Bearer ' + adminKey;
      const request = httpsRequest(target, {
        method: 'POST', headers, signal: AbortSignal.timeout(120000)
      }, response => {
        response.resume();
        response.once('end', () => resolve(response.statusCode));
        response.once('error', reject);
      });
      request.on('error', reject);
      request.end(file);
    }).catch(() => 0);
    if (status >= 200 && status < 300) return;
    if (attempt === 3 || (status >= 400 && status < 500 && status !== 429)) {
      throw new Error('Upload original PDF failed (HTTP ' + (status || 'connection error') + ').');
    }
    await pause(attempt * 1000);
  }
}

let numberReady = 0;
for (const work of catalogue.works) {
  const existing = await request(pdfRoute(work.id), {
    useAdmin: true, headers: { range: 'bytes=0-4' }
  });
  const existingBytes = existing.status === 206 ? Number(existing.headers.get('content-range')?.split('/').at(-1))
    : Number(existing.headers.get('content-length'));
  const complete = existing.ok && existing.headers.get('content-type') === 'application/pdf' && existingBytes === work.bytes;
  await existing.body?.cancel();
  if (!complete) {
    const file = await readFile(path.join(materialsDirectory, 'pdfs', work.file));
    assert.equal(file.length, work.bytes);
    assert.equal(createHash('sha256').update(file).digest('hex'), work.sha256);
    await upload(work, file);
  }
  numberReady++;
  if (numberReady % 3 === 0) console.log('Original PDFs ready:', numberReady);
}

await (await admin('/rest/v1/jury_works', {
  method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: works
}, 'Publish the private catalogue')).body?.cancel();

const listRoute = '/rest/v1/jury_works?select=id,bytes&order=position';
const first = works.reduce((a, b) => a.bytes < b.bytes ? a : b);
const anonymousList = await request(listRoute);
const anonymousPdf = await request(pdfRoute(first.id));
const publicPdf = await request('/storage/v1/object/public/jury-final/' + first.id + '.pdf');
assert.ok([401, 403].includes(anonymousList.status), 'Anonymous catalogue must be unavailable.');
assert.ok(!anonymousPdf.ok, 'Anonymous PDF must be unavailable.');
assert.ok(!publicPdf.ok, 'The public object route must be unavailable.');
await anonymousList.body?.cancel();
await anonymousPdf.body?.cancel();
await publicPdf.body?.cancel();

async function signIn(juror) {
  return (await requireOk(await request('/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email: email(juror), password: juror.password }
  }), 'Verify password sign-in')).json();
}

const approved = await (await admin('/rest/v1/jury_members?select=user_id', {}, 'Read current admission list')).json();
if (!approved.length) {
  const { access_token: token } = await signIn(jurors.at(-1));
  const denied = await request(listRoute, { token });
  assert.deepEqual(await (await requireOk(denied, 'Check unlisted account')).json(), []);
  const deniedPdf = await request(pdfRoute(first.id), { token, headers: { range: 'bytes=0-4' } });
  assert.ok(!deniedPdf.ok, 'An unlisted account must be denied the PDF.');
  await deniedPdf.body?.cancel();
}
assert.ok(approved.every(row => jurors.some(juror => juror.userId === row.user_id)));
await (await admin('/rest/v1/jury_members', {
  method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
  body: jurors.map(juror => ({ user_id: juror.userId }))
}, 'Enable jury admission')).body?.cancel();

const { access_token: token } = await signIn(jurors[0]);
const listed = await (await requireOk(await request(listRoute, { token }), 'Verify the complete catalogue')).json();
assert.deepEqual(listed.map(work => [work.id, work.bytes]), works.map(work => [work.id, work.bytes]));
for (const work of works) {
  const pdf = await requireOk(await request(pdfRoute(work.id), { token, headers: { range: 'bytes=0-4' } }),
    'Verify authenticated PDF access');
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  if (pdf.status === 206) {
    assert.equal(pdf.headers.get('content-range'), 'bytes 0-4/' + work.bytes);
    assert.equal(await pdf.text(), '%PDF-');
  } else {
    assert.equal(Number(pdf.headers.get('content-length')), work.bytes);
    await pdf.body?.cancel();
  }
}

await writePrivate('public-config.json', JSON.stringify({ origin, publishableKey }) + '\n');
await writePrivate('jury-access.tsv', 'Логин\tПароль\n' +
  jurors.map(juror => juror.login + '\t' + juror.password).join('\n') + '\n');
console.log('Verified: 15 sign-ins provisioned, 15 private PDFs, anonymous access denied.');
