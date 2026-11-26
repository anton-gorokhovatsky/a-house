import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { JURY_SUPABASE_URL, JURY_SUPABASE_PUBLISHABLE_KEY: publishableKey } = process.env;
const endpoint = new URL(JURY_SUPABASE_URL);
assert.match(endpoint.origin, /^https:\/\/[a-z0-9]{20}\.supabase\.co$/);
assert.equal(endpoint.href, endpoint.origin + '/');
assert.match(publishableKey, /^sb_publishable_[a-zA-Z0-9_-]+$/);

const output = process.argv[2];
assert.ok(output, 'Specify an empty output directory.');
await mkdir(output, { mode: 0o755 });
for (const filename of ['cabinet.css', 'logo.svg']) {
  await copyFile(new URL('../' + filename, import.meta.url), path.join(output, filename));
}
const modules = {
  'views.js': await readFile(new URL('../views.mjs', import.meta.url), 'utf8'),
  'cabinet.js': await readFile(new URL('./cabinet.mjs', import.meta.url), 'utf8'),
  'voting.js': await readFile(new URL('./voting.mjs', import.meta.url), 'utf8'),
  'config.js': 'export const backend = ' + JSON.stringify({ origin: endpoint.origin, publishableKey }) + ';\n'
};
const hash = createHash('sha256').update(await readFile(path.join(output, 'cabinet.css')));
for (const source of Object.values(modules)) hash.update(source);
const version = hash.digest('hex').slice(0, 12);
for (const [name, source] of Object.entries(modules)) {
  const versioned = source.replace(/(from '\.\/(?:config|views|voting)\.js)'/g, "$1?v=" + version + "'");
  await writeFile(path.join(output, name), versioned);
}
await writeFile(path.join(output, 'index.html'), `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src ${endpoint.origin}; form-action 'none'; base-uri 'none'">
<title>Кабинет жюри · Меняя привычное</title>
<link rel="stylesheet" href="./cabinet.css?v=${version}">
<script type="module" src="./cabinet.js?v=${version}"></script>
</head>
<body>
<div id="cabinet"><main class="scene"><div class="wrap content"><p role="status">Загрузка кабинета…</p><noscript>Для входа включите JavaScript.</noscript></div></main></div>
</body>
</html>
`);
await writeFile(path.join(output, '.nojekyll'), '');
