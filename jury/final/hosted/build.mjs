import assert from 'node:assert/strict';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
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
await copyFile(new URL('../views.mjs', import.meta.url), path.join(output, 'views.js'));
await copyFile(new URL('./cabinet.mjs', import.meta.url), path.join(output, 'cabinet.js'));
await writeFile(path.join(output, 'config.js'),
  'export const backend = ' + JSON.stringify({ origin: endpoint.origin, publishableKey }) + ';\n');
await writeFile(path.join(output, 'index.html'), `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src ${endpoint.origin}; form-action 'none'; base-uri 'none'">
<title>Кабинет жюри · Меняя привычное</title>
<link rel="stylesheet" href="./cabinet.css">
<script type="module" src="./cabinet.js"></script>
</head>
<body>
<div id="cabinet"><main class="scene"><div class="wrap content"><p role="status">Загрузка кабинета…</p><noscript>Для входа включите JavaScript.</noscript></div></main></div>
</body>
</html>
`);
await writeFile(path.join(output, '.nojekyll'), '');
