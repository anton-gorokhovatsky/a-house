import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jurorNamesFromRoster, makeSheetUpdates, tabs } from './sheets-rows.mjs';

const source = dirname(fileURLToPath(import.meta.url));
const setup = resolve(source, '../../../.work/jury-final-hosted');
const privateDir = join(setup, 'google-sheets');
const target = JSON.parse(await readFile(join(privateDir, 'target.json'), 'utf8'));
assert.match(target.spreadsheet, /^[A-Za-z0-9_-]+$/);
const [command, ...args] = process.argv.slice(2);
const chunkSize = 3000;

if (command === 'target') {
  console.log(JSON.stringify({ spreadsheet: target.spreadsheet, titles: tabs.map(t => t.name) }));
} else if (command === 'prepare') {
  assert.equal(args.length, tabs.length * 2);
  assert.ok(args.every(n => /^\d+$/.test(n)), 'Invalid grid dimensions');
  const props = tabs.map((tab, i) => {
    const sheetId = Number(args[2 * i]);
    assert.equal(sheetId, target.ids[i]);
    return { title: tab.name, sheetId, rowCount: Number(args[2 * i + 1]) };
  });
  const project = JSON.parse(await readFile(join(setup, 'project.json'), 'utf8'));
  assert.equal(project.name, 'a-house-mts-jury');
  assert.match(project.ref, /^[a-z]{20}$/);
  const raw = execFileSync(join(privateDir, 'supabase'), ['db', 'query', `--remote=${project.ref}`, '--read-only',
    '--file', join(source, 'sheets-report.sql')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, timeout: 45000 });
  const db = JSON.parse(raw);
  assert.equal(db.rows?.length, 1, 'Incomplete Supabase report');
  const report = db.rows[0].report;
  const names = jurorNamesFromRoster(await readFile(join(setup, 'jury-final-access.tsv'), 'utf8'));
  const requests = makeSheetUpdates(report, props, names);
  const payload = JSON.stringify(requests);
  const run = randomUUID();
  const dir = join(privateDir, 'pending');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, run), payload, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ run, chunks: Math.ceil(payload.length / chunkSize), length: payload.length,
    works: report.works.length, ballots: report.ballots.length, asOf: report.as_of,
    stamp: requests.find(r => r.updateCells)?.updateCells.rows[0].values[0].userEnteredValue.stringValue }));
} else {
  const [run, index] = args;
  assert.match(run ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const file = join(privateDir, 'pending', run);
  if (command === 'chunk') {
    assert.match(index ?? '', /^\d+$/);
    const payload = await readFile(file, 'utf8');
    const start = Number(index) * chunkSize;
    assert.ok(start < payload.length);
    console.log(JSON.stringify(payload.slice(start, start + chunkSize)));
  } else if (command === 'finish') {
    await unlink(file);
    console.log('ok');
  } else throw new Error('Unknown report command');
}
