import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const sourceRepo = 'anton-gorokhovatsky/a-house';
const sourceBranch = 'codex/jury-final';
const pagesRepo = 'anton-gorokhovatsky/a-house-mts-jury';
const pagesBranch = 'main';
const domain = 'mts.ahouseproject.com';
const root = fileURLToPath(new URL('../../../', import.meta.url));

const [configFile, siteDirectory, flag, ...extra] = process.argv.slice(2);
assert.ok(configFile && siteDirectory && (!flag || flag === '--publish') && !extra.length,
  'Usage: node jury/final/hosted/release.mjs PUBLIC_CONFIG NEW_SITE_DIRECTORY [--publish]');
const config = JSON.parse(await readFile(configFile, 'utf8'));
const output = path.resolve(siteDirectory);

function read(program, args, cwd = root) {
  return execFileSync(program, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

function run(program, args, cwd, env = process.env) {
  execFileSync(program, args, { cwd, env, stdio: 'inherit' });
}

const source = read('git', ['rev-parse', 'HEAD']);
assert.match(source, /^[a-f0-9]{40}$/);
console.log('Source commit: ' + source);

async function verifyPages(commit) {
  const assets = ['source-commit.txt', 'jury/index.html', 'cabinet.css', 'cabinet.js', 'voting.js'];
  const expected = await Promise.all(assets.map(file => readFile(path.join(output, file))));
  for (let attempt = 0; attempt < 36; attempt++) {
    if (attempt) await delay(8000);
    const builds = JSON.parse(read('gh', ['api', 'repos/' + pagesRepo + '/pages/builds?per_page=10']));
    const build = builds.find(item => item.commit === commit);
    assert.notEqual(build?.status, 'errored', 'GitHub Pages reported a build failure for ' + commit);
    if (build?.status !== 'built') continue;
    const matches = await Promise.all(assets.map(async (file, index) => {
      const response = await fetch('https://' + domain + '/' + file + '?verify=' + commit + '-' + attempt, {
        cache: 'no-store', signal: AbortSignal.timeout(10000)
      }).catch(() => null);
      return response?.ok && expected[index].equals(Buffer.from(await response.arrayBuffer()));
    }));
    if (matches.every(Boolean)) {
      console.log('GitHub Pages serves the verified build at https://' + domain + '/jury/');
      return;
    }
  }
  throw new Error('GitHub Pages has yet to serve the verified build from ' + commit);
}

async function publish(work) {
  const pages = path.join(work, 'pages');
  const credentials = ['-c', 'credential.https://github.com.helper=',
    '-c', 'credential.https://github.com.helper=!gh auth git-credential'];
  run('git', [...credentials, 'clone', '--depth', '1', '--single-branch', '--branch', pagesBranch,
    'https://github.com/' + pagesRepo + '.git', pages], work);
  assert.equal((await readFile(path.join(pages, 'CNAME'), 'utf8')).trim(), domain);
  const managed = new Set(await readdir(output));
  for (const name of await readdir(pages)) {
    if (managed.has(name) || /^pdfjs-[\d.]+$/.test(name)) {
      await rm(path.join(pages, name), { recursive: true });
    }
  }
  await cp(output, pages, { recursive: true });
  run('git', ['add', '--all'], pages);
  const branchHead = read('gh', ['api', 'repos/' + sourceRepo + '/git/ref/heads/' + sourceBranch, '--jq', '.object.sha']);
  assert.equal(source, branchHead, 'Publish from the current source branch commit.');
  const changed = read('git', ['diff', '--cached', '--name-only'], pages);
  if (changed) {
    run('git', ['commit', '-m', 'Publish jury cabinet', '-m', 'Source-Commit: ' + source], pages);
    run('git', [...credentials, 'push', 'origin', 'HEAD:refs/heads/' + pagesBranch], pages);
  }
  const commit = read('git', ['rev-parse', 'HEAD'], pages);
  console.log('Pages commit: ' + commit);
  await verifyPages(commit);
}

const work = await mkdtemp(path.join(tmpdir(), 'a-house-jury-release-'));
try {
  const archived = path.join(work, 'source');
  await mkdir(archived);
  // A separate index copies the committed cabinet without reading unrelated blobs in a partial clone.
  run('git', ['-c', 'core.sparseCheckout=false', '-c', 'core.hooksPath=/dev/null',
    '--work-tree=' + archived, 'checkout', source, '--', 'jury/final', 'tools/typography.mjs', 'media/fonts'],
  root, { ...process.env, GIT_INDEX_FILE: path.join(work, 'source.index') });
  const hosted = path.join(archived, 'jury/final/hosted');
  run('npm', ['ci', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund'], hosted);
  run(process.execPath, ['node_modules/playwright-core/cli.js', 'install', 'chromium', 'webkit'], hosted);

  const fixture = path.join(work, 'fixture');
  run(process.execPath, ['build.mjs', fixture], hosted, {
    ...process.env,
    JURY_SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',
    JURY_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture'
  });
  const testEnv = {
    ...process.env, JURY_CHROMIUM_CHANNEL: process.env.JURY_CHROMIUM_CHANNEL || 'chromium', JURY_QA_DB_ONLY: ''
  };
  run(process.execPath, ['check.mjs', fixture], hosted, testEnv);
  run(process.execPath, ['check-voting.mjs', fixture], hosted, testEnv);
  run(process.execPath, ['build.mjs', output, '--jury-path'], hosted, {
    ...process.env, JURY_SUPABASE_URL: config.origin, JURY_SUPABASE_PUBLISHABLE_KEY: config.publishableKey
  });
  await writeFile(path.join(output, 'source-commit.txt'), source + '\n');
  console.log('Verified build: ' + output);
  if (flag === '--publish') await publish(work);
} finally {
  await rm(work, { recursive: true, force: true });
}
