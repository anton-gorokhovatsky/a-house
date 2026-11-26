import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { signInContent } from '../views.mjs';
import { cabinetAssets, contestFontOrigin } from '../assets.mjs';

const { JURY_SUPABASE_URL, JURY_SUPABASE_PUBLISHABLE_KEY: publishableKey } = process.env;
const endpoint = new URL(JURY_SUPABASE_URL);
assert.match(endpoint.origin, /^https:\/\/[a-z0-9]{20}\.supabase\.co$/);
assert.equal(endpoint.href, endpoint.origin + '/');
assert.match(publishableKey, /^sb_publishable_[a-zA-Z0-9_-]+$/);

const output = process.argv[2];
assert.ok(output, 'Specify an empty output directory.');
const withJuryPath = process.argv[3] === '--jury-path';
const entryDirectory = withJuryPath ? path.join(output, 'jury') : output;
const assets = withJuryPath ? '../' : './';
await mkdir(output, { mode: 0o755 });
await mkdir(path.join(output, 'fonts'));
const hash = createHash('sha256');
for (const [filename, asset] of cabinetAssets) {
  const target = path.join(output, filename);
  await copyFile(asset.source, target);
  hash.update(await readFile(target));
}
const distribution = new URL('./node_modules/pdfjs-dist/', import.meta.url);
const pdfVersion = JSON.parse(await readFile(new URL('package.json', distribution), 'utf8')).version;
const pdfDirectory = 'pdfjs-' + pdfVersion;
await mkdir(path.join(output, pdfDirectory));
for (const filename of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  await copyFile(new URL('legacy/build/' + filename, distribution), path.join(output, pdfDirectory, filename));
}
for (const filename of ['cmaps', 'iccs', 'standard_fonts', 'wasm', 'LICENSE']) {
  await cp(new URL(filename, distribution), path.join(output, pdfDirectory, filename), { recursive: true });
}
const modules = {
  'typography.js': await readFile(new URL('../../../tools/typography.mjs', import.meta.url), 'utf8'),
  'criteria.js': await readFile(new URL('./criteria.mjs', import.meta.url), 'utf8'),
  'views.js': (await readFile(new URL('../views.mjs', import.meta.url), 'utf8')).replace('../../tools/typography.mjs', './typography.js'),
  'cabinet.js': await readFile(new URL('./cabinet.mjs', import.meta.url), 'utf8'),
  'sheets.js': (await readFile(new URL('./sheets.mjs', import.meta.url), 'utf8')).replace('./pdfjs-dist/', './' + pdfDirectory + '/'),
  'gallery.js': await readFile(new URL('./gallery.mjs', import.meta.url), 'utf8'),
  'ranking.js': await readFile(new URL('./ranking.mjs', import.meta.url), 'utf8'),
  'voting.js': await readFile(new URL('./voting.mjs', import.meta.url), 'utf8'),
  'config.js': 'export const backend = ' + JSON.stringify({ origin: endpoint.origin, publishableKey }) + ';\n'
};
for (const source of Object.values(modules)) hash.update(source);
const version = hash.digest('hex').slice(0, 12);
for (const [name, source] of Object.entries(modules)) {
  const versioned = source.replace(/(from '\.\/(?:config|views|voting|typography|criteria|gallery|ranking|sheets)\.js)'/g, "$1?v=" + version + "'");
  await writeFile(path.join(output, name), versioned);
}
if (withJuryPath) {
  await mkdir(entryDirectory);
  await copyFile(path.join(output, 'logo.svg'), path.join(entryDirectory, 'logo.svg'));
  await copyFile(new URL('./redirect.html', import.meta.url), path.join(output, 'index.html'));
  await copyFile(new URL('./redirect.js', import.meta.url), path.join(output, 'redirect.js'));
}
await writeFile(path.join(entryDirectory, 'index.html'), `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; font-src 'self' blob: ${contestFontOrigin}; img-src 'self' blob: data:; connect-src 'self' ${endpoint.origin}; form-action 'none'; base-uri 'none'">
<title>Вход для жюри · Меняя привычное</title>
<link rel="preconnect" href="${contestFontOrigin}" crossorigin>
<link rel="stylesheet" href="${assets}cabinet.css?v=${version}">
<link rel="modulepreload" href="${assets}views.js?v=${version}">
<link rel="modulepreload" href="${assets}config.js?v=${version}">
<link rel="modulepreload" href="${assets}typography.js?v=${version}">
<link rel="modulepreload" href="${assets}criteria.js?v=${version}">
<link rel="modulepreload" href="${assets}voting.js?v=${version}">
<script type="module" src="${assets}cabinet.js?v=${version}"></script>
</head>
<body>
<div id="cabinet">${signInContent({ logo: './logo.svg', method: 'dialog', action: '#', ready: false })}</div>
<noscript><p>Для входа включите JavaScript.</p></noscript>
</body>
</html>
`);
await writeFile(path.join(output, '.nojekyll'), '');
