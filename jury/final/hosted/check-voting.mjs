import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium, devices, webkit } from 'playwright-core';
import { reportRows } from './sheets-rows.mjs';
import { criterionTitles } from './criteria.mjs';
import { cabinetAssets } from '../assets.mjs';

const [site, postgresModule = '@electric-sql/pglite'] = process.argv.slice(2);
const { PGlite } = await import(postgresModule);
const db = new PGlite();
const fixtures = new Map(Array.from({ length: 15 }, (_, i) => {
  const login = 'jury-' + String(i + 1).padStart(2, '0');
  return [login, '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0')];
}));
const pdf = await readFile(new URL('./test/sheets.pdf', import.meta.url));
const works = [...fixtures].map((_, i) => ({ id: (i + 1).toString(16).padStart(24, '0'), title: 'Работа ' + (i + 1), bytes: pdf.length }));
const technicalTest = 'jury-test-technical';
fixtures.set(technicalTest, '00000000-0000-4000-8000-000000000016');
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role supabase_read_only_user bypassrls;
  create schema auth; create schema storage; create table storage.objects(bucket_id text);
  create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
await db.exec(await readFile(new URL('schema.sql', import.meta.url), 'utf8'));
for (const [login, id] of fixtures) {
  await db.query('insert into auth.users (id, email) values ($1,$2)', [id, login + '@jury.example.com']);
  await db.query('insert into public.jury_members values ($1)', [id]);
}
for (const [i, work] of works.entries()) {
  await db.query('insert into public.jury_works values ($1,$2,$3,$4)', [work.id, i + 1, work.title, work.bytes]);
}
await db.exec(await readFile(new URL('voting.sql', import.meta.url), 'utf8'));
await db.query('insert into public.jury_final_voters (user_id, technical, is_test) values ($1,true,true)', [fixtures.get(technicalTest)]);
await db.exec("update public.jury_final_control set regulations_url='https://disk.360.yandex.ru/d/fixture'");

async function queryAs(login, sql, values = []) {
  return db.transaction(async tx => {
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [fixtures.get(login)]);
    return (await tx.query(sql, values)).rows;
  });
}
const legacySheet = async login => (await queryAs(login, 'select public.jury_final_sheet() as data'))[0].data;
const legacySave = async (login, work, answers, comment, revision) => (await queryAs(login,
  'select public.jury_save_final_ballot($1,$2,$3,$4) as data', [work, JSON.stringify(answers), comment, revision]))[0].data;
const oldAnswers = { brief:4, art:5, ergonomics:0, economics:3, landscape:null };
const probe = works[14].id;
await legacySave('jury-02', probe, oldAnswers, 'До обновления', 0);
await db.exec(await readFile(new URL('voting-50-50.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('organizer-comments.sql', import.meta.url), 'utf8'));
const currentRubric = 'final_50_50';
const sheet = async login => (await queryAs(login, 'select public.jury_final_rubric_sheet(null) as data'))[0].data;
const save = async (login, work, answers, comment, revision, rubric = currentRubric, nominations) => {
  const params = [rubric, work, JSON.stringify(answers), comment, revision];
  const nominationParameter = nominations === undefined ? '' : ',$6::text[]';
  if (nominations !== undefined) params.push(nominations);
  return (await queryAs(login, 'select public.jury_save_rubric_ballot($1,$2,$3,$4,$5' + nominationParameter + ') as data', params))[0].data;
};
const activate = rubric => db.query('update public.jury_final_control set active_rubric=$1 where singleton', [rubric]);
const stats = async () => (await db.query('select * from public.jury_final_work_summary where work_id=$1', [probe])).rows[0];
assert.equal((await sheet('jury-02')).rubric, 'original');
assert.deepEqual((await sheet('jury-02')).ballots[0].answers, oldAnswers);
await db.query('update public.jury_final_rubrics set criteria_url=$1 where id=$2', ['https://docs.google.com/document/d/fixture',currentRubric]);
await activate(currentRubric);
assert.equal((await legacySheet('jury-02')).accepting, false);
await assert.rejects(legacySave('jury-02', probe, oldAnswers, 'Вчерашняя вкладка', 1), { code:'PT403' });
assert.equal((await sheet('jury-02')).ballots.length,0);
assert.equal(Number((await stats()).ballot_count),0);
const regular = { concept:0 };
const tech = { technical_review:4 };
const raw = async login => (await db.query(
  'select answers, comment, revision, updated_at from public.jury_final_ballots where user_id=$1 and work_id=$2 and rubric=$3',
  [fixtures.get(login), probe, currentRubric])).rows[0];
const reportSql = await readFile(new URL('sheets-report.sql', import.meta.url), 'utf8');
const report = async () => (await db.query(reportSql)).rows[0].report;
await db.exec('grant usage on schema auth to supabase_read_only_user; grant select on all tables in schema public, auth to supabase_read_only_user');
const installRoleSplit = await readFile(new URL('voting-role-split.sql', import.meta.url), 'utf8');
const rollbackRoleSplit = await readFile(new URL('rollback-role-split.sql', import.meta.url), 'utf8');

for (const [login, concept] of [['jury-01',1],['jury-02',3],['jury-04',4],['jury-05',5]]) {
  await save(login, probe, { concept }, '', 0);
}
assert.equal((await stats()).working_score, null);
await save('jury-03', probe, { concept:2, technical_review:4 }, 'До разделения ролей', 0);
await save(technicalTest, probe, { concept:0, technical_review:5 }, 'Технический тест', 0);
assert.equal(Number((await stats()).working_score),3.5);
const archivedTechnical = await raw('jury-03');
const archivedTest = await raw(technicalTest);

await db.exec(installRoleSplit);
await db.exec(await readFile(new URL('voting-nominations.sql', import.meta.url), 'utf8'));
assert.equal((await sheet('jury-02')).accepting,true);
assert.equal((await sheet('jury-08')).role, 'observer');
assert.deepEqual((await sheet('jury-08')).criteria, []);
for (const login of ['jury-03', technicalTest]) {
  assert.equal((await sheet(login)).role, 'technical');
  assert.deepEqual((await sheet(login)).criteria.map(c => [c.key,c.weight]), [['technical_review',50]]);
}
assert.deepEqual((await sheet('jury-03')).ballots[0].answers, tech);
assert.deepEqual((await sheet(technicalTest)).ballots[0].answers, {technical_review:5});
assert.deepEqual((await sheet('jury-01')).criteria.map(c=>[c.key,c.weight]), [['concept',50]]);
await assert.rejects(save('jury-08', probe, regular, '', 0), { code: '42501' });
await assert.rejects(save('jury-02', probe, tech, '', 0), { code: '22023' });
await assert.rejects(save('jury-02', probe, { concept:6 }, '', 0), { code: '22023' });
await assert.rejects(save('jury-02', probe, { concept:null }, '', 0), { code: '22023' });
await assert.rejects(save('jury-03', probe, regular, '', 0), { code: '22023' });
await assert.rejects(save('jury-03', probe, { concept:2, technical_review:4 }, '', 1), { code: 'PT412' });
await assert.rejects(queryAs('jury-02', 'select * from public.jury_final_ballots'), { code: '42501' });
assert.deepEqual(await raw('jury-03'), archivedTechnical);
assert.deepEqual(await raw(technicalTest), archivedTest);
assert.equal(Number((await stats()).ballot_count),5);
assert.equal(Number((await stats()).technical_count),1);
assert.equal(Number((await stats()).working_score),3.625);
assert.equal((await stats()).meets_prize_feasibility_threshold,true);
const asService = await db.transaction(async tx => {
  await tx.exec('set local role service_role');
  return (await tx.query('select working_score from public.jury_final_work_summary where work_id=$1', [probe])).rows[0];
});
assert.equal(Number(asService.working_score), 3.625);
const exported = await report();
const readOnlyExport = await db.transaction(async tx => {
  await tx.exec('set local role supabase_read_only_user');
  return (await tx.query(reportSql)).rows[0].report;
});
assert.deepEqual(readOnlyExport.works, exported.works);
assert.deepEqual(readOnlyExport.ballots, exported.ballots);
const exportedWork = exported.works.find(w => w.work_id === probe);
assert.equal(exportedWork.mean_concept, 3.25);
assert.equal(exportedWork.mean_feasibility, 4);
assert.equal(exportedWork.working_score, 3.625);
for (const [login, score, isTest] of [['jury-03', 4, false], [technicalTest, 5, true]]) {
  const ballot = exported.ballots.find(b => b.login === login && b.work_id === probe);
  assert.equal(ballot.concept, null);
  assert.equal(ballot.technical_score, score);
  assert.equal(ballot.is_test, isTest);
}
assert.equal((await save('jury-03', probe, tech, 'До разделения ролей', 0)).revision, 1);
assert.deepEqual(await raw('jury-03'), archivedTechnical);
const edited = await save('jury-03', probe, {technical_review:3}, 'После разделения ролей', 1);
assert.deepEqual(edited.answers, {technical_review:3});
assert.equal(edited.revision, 2);
assert.deepEqual((await raw('jury-03')).answers, {concept:2, technical_review:3});
assert.equal(Number((await stats()).working_score),3.125);
assert.equal((await stats()).meets_prize_feasibility_threshold,false);
const freshTest = await save(technicalTest, works[12].id, {technical_review:0}, 'Новый технический тест', 0);
assert.deepEqual(freshTest.answers, {technical_review:0});

const beforeRoleRollback = await raw('jury-03');
await db.exec(rollbackRoleSplit);
assert.equal((await sheet('jury-03')).rubric, currentRubric);
assert.equal((await sheet('jury-03')).accepting,true);
assert.deepEqual((await sheet('jury-03')).criteria.map(c => c.key), ['concept','technical_review']);
assert.deepEqual((await sheet('jury-03')).ballots[0].answers, {concept:2, technical_review:3});
assert.deepEqual((await sheet(technicalTest)).ballots.find(b => b.work_id === works[12].id).answers, {technical_review:0});
assert.equal((await report()).ballots.find(b => b.login === 'jury-03' && b.work_id === probe).concept, 2);
assert.deepEqual(await raw('jury-03'), beforeRoleRollback);
await db.exec(installRoleSplit);
await db.exec(await readFile(new URL('voting-nominations.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('voting-nomination-limit.sql', import.meta.url), 'utf8'));
assert.deepEqual((await sheet('jury-03')).ballots[0].answers, {technical_review:3});
assert.deepEqual(await raw('jury-03'), beforeRoleRollback);
await db.exec(await readFile(new URL('rollback-50-50.sql', import.meta.url), 'utf8'));
assert.equal((await legacySheet('jury-02')).accepting,true);
assert.equal((await sheet('jury-02')).ballots[0].comment,'До обновления');
const comments = 'select * from jury_admin.comments';
const organizerRow = (await db.query(comments)).rows[0];
assert.equal(organizerRow['Работа'], works[14].title);
assert.equal(organizerRow['Логин жюри'], 'jury-02');
assert.equal(organizerRow['Комментарий'], 'До обновления');
assert.equal(organizerRow['Тестовая запись'], false);
assert.equal((await db.query("select has_schema_privilege('anon','jury_admin','usage') as granted")).rows[0].granted, false);
assert.equal((await db.query("select has_schema_privilege('authenticated','jury_admin','usage') as granted")).rows[0].granted, false);
assert.equal(Number((await stats()).ballot_count),1);
await assert.rejects(save('jury-01', probe, regular, 'Old cached form', 1), {code:'PT412'});
await activate(currentRubric);
assert.deepEqual((await sheet('jury-02')).ballots[0].answers,{concept:3});
assert.equal(Number((await stats()).ballot_count),5);
await db.exec('update public.jury_final_control set accepting=false');
await assert.rejects(save('jury-01', works[4].id, regular, '', 0), { code: 'PT403' });
await db.exec('update public.jury_final_control set accepting=true');

const recommendationWork = works[12].id;
const recommend = (login, keys, revision, comment = '') => save(login, recommendationWork, regular, comment, revision,
  currentRubric, keys);
assert.equal((await sheet('jury-07')).nomination_recommendations, true);
assert.equal((await sheet('jury-03')).nomination_recommendations, true);
assert.equal((await sheet(technicalTest)).nomination_recommendations, true);
assert.equal((await sheet('jury-08')).nomination_recommendations, false);
await assert.rejects(recommend('jury-08', ['context'], 0), { code:'42501' });
const officialBeforeRecommendations = (await report()).works;
for (const [login, work, score, revision] of [['jury-03', probe, 3, 2], [technicalTest, recommendationWork, 0, 1]]) {
  const previous = (await sheet(login)).ballots.find(b => b.work_id === work);
  const updated = await save(login, work, {technical_review:score}, previous.comment, revision,
    currentRubric, ['experiment','context']);
  assert.deepEqual(updated.answers, {technical_review:score});
  assert.equal(updated.revision, revision + 1);
  assert.deepEqual(updated.nomination_keys, ['context','experiment']);
  const reloaded = (await sheet(login)).ballots.find(b => b.work_id === work);
  assert.deepEqual(reloaded.nomination_keys, updated.nomination_keys);
  assert.equal(reloaded.comment, previous.comment);
  const exported = (await report()).ballots.find(b => b.login === login && b.work_id === work);
  assert.deepEqual(exported.nomination_keys, updated.nomination_keys);
  assert.equal(exported.technical_score, score);
  assert.equal(exported.concept, null);
  assert.equal(exported.is_test, login === technicalTest);
}
assert.deepEqual((await report()).works, officialBeforeRecommendations);
await assert.rejects(recommend('jury-07', ['not-a-nomination'], 0), { code:'22023' });
await assert.rejects(recommend('jury-07', ['context','context'], 0), { code:'22023' });
const firstRecommendation = await recommend('jury-07', ['experiment','context'], 0);
assert.equal(firstRecommendation.revision, 1);
assert.deepEqual(firstRecommendation.nomination_keys, ['context','experiment']);
assert.deepEqual(await recommend('jury-07', ['context','experiment'], 0), firstRecommendation);
const legacyEdit = await save('jury-07', recommendationWork, regular, 'Правка со старого клиента', 1);
assert.equal(legacyEdit.revision, 2);
const savedRecommendation = async () => (await sheet('jury-07')).ballots.find(b => b.work_id === recommendationWork);
assert.deepEqual((await savedRecommendation()).nomination_keys, ['context','experiment']);
await assert.rejects(recommend('jury-07', ['scale'], 1, 'Правка со старого клиента'), { code:'PT409' });
const nominationsOnly = await recommend('jury-07', ['statement'], 2, 'Правка со старого клиента');
assert.equal(nominationsOnly.revision, 3);
assert.deepEqual(nominationsOnly.nomination_keys, ['statement']);
const exportedRecommendations = reportRows(await report(), new Map([['jury-07','Тест экспорта']])).bodies[1];
assert.equal(exportedRecommendations.find(row => row[1] === 'Тест экспорта')[7], 'Лучшее архитектурное высказывание');
assert.equal((await recommend('jury-07', [], 3, 'Правка со старого клиента')).revision, 4);
assert.deepEqual((await savedRecommendation()).nomination_keys, []);
const contested = [works[10].id, works[11].id];
const compareChoices = result => result.status === 'fulfilled';
const simultaneous = await Promise.allSettled(contested.map(work =>
  save('jury-06', work, regular, 'Проверка общего ограничения', 0, currentRubric, ['context'])));
assert.equal(simultaneous.filter(compareChoices).length, 1);
assert.equal(simultaneous.find(result => !compareChoices(result)).reason.code, 'PT422');
const selectedWork = simultaneous.find(compareChoices).value;
const rejectedWork = contested.find(work => work !== selectedWork.work_id);
assert.equal((await sheet('jury-06')).ballots.some(ballot => ballot.work_id === rejectedWork), false);
assert.deepEqual((await save('jury-04', rejectedWork, regular, '', 0, currentRubric, ['context'])).nomination_keys, ['context']);
await save('jury-06', selectedWork.work_id, regular, '', selectedWork.revision, currentRubric, []);
assert.deepEqual((await save('jury-06', rejectedWork, regular, '', 0, currentRubric, ['context','experiment'])).nomination_keys,
  ['context','experiment']);
console.log('PGlite: one recommendation per juror and nomination, atomic rejection, transfer, roles and revision checks passed.');

console.log('PGlite: role-specific ballots, historical scores, retries, 50/50, export, test exclusions and both rollbacks passed.');
if (process.env.JURY_QA_DB_ONLY) {
  await db.close();
  process.exit(0);
}

const files = new Set(['index.html', ...cabinetAssets.keys(), 'config.js', 'cabinet.js', 'gallery.js', 'ranking.js', 'sheets.js', 'voting.js', 'views.js', 'criteria.js', 'typography.js']);
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  const zoom = /^text-(200|225|250)\.css$/.exec(name);
  if (zoom) {
    res.writeHead(200, { 'content-type':'text/css' });
    return res.end('html { font-size:' + zoom[1] + '% }');
  }
  if (!files.has(name) && !/^pdfjs-[0-9.]+\/(?:(?:cmaps|iccs|wasm|standard_fonts)\/)?[\w.-]+$/.test(name)) return res.writeHead(404).end();
  const type = cabinetAssets.get(name)?.type ?? (/\.m?js$/.test(name) ? 'text/javascript' : name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.html') ? 'text/html' : 'application/octet-stream');
  res.writeHead(200, { 'content-type': type });
  res.end(await readFile(path.join(site, name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/';

async function intercept(context, fault) {
  await context.route('https://aaaaaaaaaaaaaaaaaaaa.supabase.co/**', async route => {
    const req = route.request();
    const endpoint = new URL(req.url()).pathname;
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods':'GET, POST, OPTIONS',
      'access-control-allow-headers':'apikey, authorization, content-type' };
    const reply = (status, json) => route.fulfill({ status, headers: cors, ...(json === undefined ? {} : { json }) });
    if (req.method() === 'OPTIONS') return reply(204);
    const login = req.headers().authorization?.replace('Bearer ', '');
    const body = req.method() === 'POST' ? req.postDataJSON() : {};
    if (endpoint === '/auth/v1/token') {
      const name = body.email.split('@')[0];
      return fixtures.has(name) && body.password === 'test' ? reply(200, { access_token:name, refresh_token:'fixture', expires_in:3600,
        user:{ id:fixtures.get(name) } }) : reply(400, {});
    }
    if (!fixtures.has(login)) return reply(403);
    if (endpoint === '/auth/v1/logout') return reply(204);
    if (endpoint === '/rest/v1/jury_works') return reply(200, works);
    if (endpoint.endsWith('/jury_final_rubric_sheet')) return reply(200, await sheet(login));
    if (endpoint.endsWith('/jury_save_rubric_ballot')) {
      await fault.beforeSave?.();
      if (fault.saveUnavailable) { fault.saveUnavailable = false; return reply(503); }
      try {
        const record = await save(login, body.p_work_id, body.p_answers, body.p_comment, body.p_revision, body.p_rubric, body.p_nomination_keys);
        if (fault.lost) { fault.lost = false; return route.abort('failed'); }
        return reply(200, record);
      } catch (e) { return reply(e.code.startsWith('PT') ? Number(e.code.slice(2)) : 403, { message:e.message }); }
    }
    if (endpoint.startsWith('/storage/v1/object/authenticated/jury-final/regulations/')) {
      fault.regulationsRequests = (fault.regulationsRequests ?? 0) + 1;
      await fault.regulationsGate;
      if (fault.regulationsError) return reply(503);
    }
    if (req.headers().range && fault.sheetError) { fault.sheetError = false; return reply(503); }
    if (endpoint.startsWith('/storage/v1/object/authenticated/')) return route.fulfill({ status:200, headers:cors, contentType:'application/pdf', body:pdf });
    return reply(404);
  });
}

async function checkNominationRace(browser, options, act, mobile) {
  const context = await browser.newContext(options);
  const gate = Promise.withResolvers();
  let arrivals = 0;
  try {
    await intercept(context, { beforeSave() {
      if (++arrivals === 2) gate.resolve();
      return gate.promise;
    } });
    const login = mobile ? 'jury-05' : technicalTest;
    const criterion = mobile ? 'concept' : 'technical_review';
    const targets = [works[8].id, works[9].id];
    const pages = await Promise.all(targets.map(async id => {
      const page = await context.newPage();
      await page.goto(url + '#work/' + id);
      await page.getByLabel('Логин', { exact:true }).fill(login);
      await page.getByLabel('Пароль').fill('test');
      await act(page.getByRole('button', { name:'Войти', exact:true }));
      const score = page.locator('input[name="' + criterion + '"][value="2"]');
      const nomination = page.locator('input[name="nomination_keys"][value="scale"]');
      if (mobile) await score.locator('..').tap();
      else await score.press('Space');
      await page.locator('textarea').fill('Черновик из одной из вкладок');
      if (mobile) await nomination.locator('..').tap();
      else await nomination.press('Space');
      return page;
    }));
    const response = pages.map(page => page.waitForResponse(res => new URL(res.url()).pathname.endsWith('/jury_save_rubric_ballot')));
    await Promise.all(pages.map(page => act(page.locator('.save-ballot'))));
    const statuses = (await Promise.all(response)).map(res => res.status());
    assert.deepEqual([...statuses].sort(), [200,422]);
    const winner = pages[statuses.indexOf(200)];
    const loser = pages[statuses.indexOf(422)];
    await loser.getByText(/В\s+одной\s+из\s+выбранных\s+номинаций\s+уже\s+рекомендована/).waitFor();
    assert.equal(await loser.locator('textarea').inputValue(), 'Черновик из одной из вкладок');
    assert.ok(await loser.locator('input[name="nomination_keys"][value="scale"]').isChecked());
    await winner.getByText('Оценка сохранена.', { exact:true }).waitFor();
    const savedChoice = winner.locator('input[name="nomination_keys"][value="scale"]');
    if (mobile) await savedChoice.locator('..').tap();
    else await savedChoice.press('Space');
    await act(winner.locator('.save-ballot'));
    await winner.getByText('Оценка сохранена.', { exact:true }).waitFor();
    await loser.reload();
    await act(loser.locator('.save-ballot'));
    await loser.getByText('Оценка сохранена.', { exact:true }).waitFor();
    const assigned = (await sheet(login)).ballots.filter(ballot => ballot.nomination_keys.includes('scale'));
    assert.deepEqual(assigned.map(ballot => ballot.work_id), [targets[statuses.indexOf(422)]]);
  } finally {
    gate.resolve();
    await context.close();
  }
}

async function observeRegulationsPreview(page) {
  await page.evaluate(() => {
    window.open = () => ({
      document: { body: {} },
      closed: false,
      location: { replace(href) { document.body.dataset.regulationsPreview = href; } }
    });
  });
}

async function checkRoleLayout(browser, options, act, role) {
  const context = await browser.newContext(options);
  try {
    const fault = { regulationsError: true };
    await intercept(context, fault);
    const page = await context.newPage();
    await page.goto(url + '#work/' + works[0].id);
    await page.getByLabel('Логин', { exact:true }).fill(role.login);
    await page.getByLabel('Пароль').fill('test');
    await act(page.getByRole('button', { name:'Войти', exact:true }));
    await page.getByRole('heading', { name:'Оценка работы' }).waitFor();
    assert.deepEqual(await page.locator('.criterion-number').allTextContents(), ['01', '02']);
    assert.deepEqual(await page.locator('.criterion input[type=radio]').evaluateAll(fields => [...new Set(fields.map(field => field.name))]), [role.criterion]);
    assert.equal(await page.getByRole('group', { name:'Рекомендовать на номинацию', exact:true }).getByRole('checkbox').count(), 4);

    assert.equal(fault.regulationsRequests, undefined);
    const regulations = page.getByRole('link', { name:'Положение о работе жюри' });
    await observeRegulationsPreview(page);
    await act(regulations);
    await page.waitForFunction(() => document.body.dataset.regulationsPreview === 'https://disk.360.yandex.ru/d/fixture');
    assert.equal(fault.regulationsRequests, 1);

    for (const [width, zoom] of [[740, 225], [768, 250]]) {
      await page.setViewportSize({ width, height: 1000 });
      const style = await page.addStyleTag({ url:'/text-' + zoom + '.css' });
      const layout = await page.locator('.recommendation-step').evaluate(step => {
        const [number, title, choices] = [...step.children].map(child => child.getBoundingClientRect());
        const opticalInset = parseFloat(getComputedStyle(step.firstElementChild).insetInlineStart) || 0;
        return {
          widths: [number.width, title.width, choices.width],
          stacked: number.bottom <= title.top && title.bottom <= choices.top,
          aligned: Math.abs(number.left - opticalInset - title.left) < 1 && Math.abs(title.left - choices.left) < 1,
          fits: choices.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth + 1
        };
      });
      assert.ok(layout.widths.every(actual => actual > width / 2) && layout.stacked && layout.aligned && layout.fits,
        role.login + ' at ' + width + 'px / ' + zoom + '%: ' + JSON.stringify(layout));
      await style.evaluate(node => node.remove());
    }
  } finally { await context.close(); }
}

try {
  for (const [engine, login] of [[webkit, 'jury-01'], [chromium, 'jury-03']]) {
    const mobile = engine === webkit;
    const channel = process.env.JURY_CHROMIUM_CHANNEL || 'chrome';
    const browser = await engine.launch(mobile ? {} : { channel });
    try {
      const options = mobile ? devices['iPhone 13'] : { viewport:{ width:1440, height:900 } };
      const context = await browser.newContext(options);
      const fault = { lost:true, sheetError:true, saveUnavailable:true };
      await intercept(context, fault);
      let page = await context.newPage();
      const act = loc => mobile ? loc.tap() : loc.press('Enter');
      const signIn = async who => {
        await page.getByLabel('Логин', { exact:true }).fill(who);
        await page.getByLabel('Пароль').fill('test');
        await act(page.getByRole('button',{ name:'Войти', exact:true }));
      };
      const id = works[0].id;
      const criterionKey = mobile ? 'concept' : 'technical_review';
      const onlyCriterion = 'input[name=' + criterionKey + ']';
      const answers = mobile ? regular : tech;
      await page.goto(url + '#work/' + id);
      await signIn(login);
      await page.getByRole('heading', { name:'Оценка работы' }).waitFor();
      assert.equal(await page.getByText('Критерии оценки', { exact: true }).count(), 0);
      assert.equal(await page.locator('input[name=technical_review]').count(), mobile ? 0 : 6);
      assert.equal(await page.locator('input[name=concept]').count(), mobile ? 6 : 0);
      const criterion = page.locator('.criterion-final');
      const scale = criterion.getByRole('list', {
        name:mobile ? 'Шкала оценки концепции' : 'Шкала реализуемости', exact:true
      });
      assert.deepEqual(await scale.locator('.scale-number').allTextContents(), ['0','1','2','3','4','5']);
      assert.equal(await scale.locator('li:visible').count(), 6);
      assert.equal(await criterion.locator('.criterion-number').innerText(), '01');
      if (mobile) {
        const normalizeTitle = text => text.replace(/[\u00ad\u200b]/g, '').replace(/\s+/gu, ' ').trim();
        assert.equal(normalizeTitle(await criterion.locator('h3').textContent()), criterionTitles.concept);
        assert.ok(!normalizeTitle(await criterion.locator('.scale-body').textContent()).includes(criterionTitles.concept));
      }
      const weightNote = criterion.getByText(/^Вес критерия в\s+итоговой оценке\s+—\s+50\s+%\.$/u);
      assert.equal(await weightNote.count(), 1);
      assert.ok(await weightNote.isHidden());
      assert.equal(await criterion.locator('details[open]').count(), 0);
      const grid = await criterion.evaluate(el => {
        const score = el.querySelector('.score-choices').getBoundingClientRect();
        const number = el.querySelector('.criterion-number').getBoundingClientRect();
        const caption = el.querySelector('.score-scale').getBoundingClientRect();
        const circle = getComputedStyle(el.querySelector('.score-choice span')).borderRadius;
        return [score.left > number.left, caption.top > score.bottom, circle];
      });
      assert.deepEqual(grid, [true,true,'50%']);
      const formRhythm = await page.evaluate(() => {
        const element = selector => document.querySelector(selector);
        const rect = selector => element(selector).getBoundingClientRect();
        const style = selector => getComputedStyle(element(selector));
        const groupGap = Math.round(rect('.score-choices').top - rect('.criterion-final summary').bottom);
        const guideGap = Math.round(rect('.nomination-reference').top - rect('.nomination-choice:last-child').bottom);
        const checkGap = Math.round(rect('.save-ballot').top - rect('.nomination-reference').bottom);
        return {
          sizes: ['.score-scale', '.comment-label', '.ballot textarea',
            '.nomination-option', '.save-ballot', '.ballot-reference-toggle', '.ballot-references .ballot-rules']
            .map(sel => style(sel).fontSize),
          groupGap, guideGap, checkGap,
          afterSave: Math.round(rect('.ballot-references').top - rect('.save-ballot').bottom),
          upperDivider: style('.score-choices').borderBlockStartWidth,
          headingStyle: ['.criterion-main h3', '.recommendation-step h3'].map(sel => {
            const heading = style(sel);
            return [heading.fontSize, heading.lineHeight, heading.fontFamily];
          }),
          disclosureStyles: ['.criterion-final summary', '.ballot-reference-toggle'].map(sel => {
            const s = style(sel);
            const marker = getComputedStyle(element(sel),'::before');
            return [s.textDecorationLine, s.textUnderlineOffset, marker.display !== 'none' && marker.content !== 'none'];
          }),
          separate: element('#voting form').nextElementSibling === element('.ballot-references')
        };
      });
      assert.deepEqual(new Set(formRhythm.sizes), new Set([mobile ? '16px' : '24px']));
      assert.equal(formRhythm.groupGap, mobile ? 18 : 28);
      assert.equal(formRhythm.guideGap, formRhythm.groupGap);
      assert.equal(formRhythm.checkGap, formRhythm.groupGap);
      assert.equal(formRhythm.afterSave, mobile ? 28 : 56);
      assert.equal(formRhythm.upperDivider, '0px');
      assert.deepEqual(formRhythm.headingStyle[0], formRhythm.headingStyle[1]);
      assert.deepEqual(formRhythm.disclosureStyles[0], formRhythm.disclosureStyles[1]);
      assert.equal(formRhythm.separate, true);
      const recommendations = page.locator('input[name=nomination_keys]');
      assert.equal(await recommendations.count(), 4);
      assert.equal(await page.locator('#nomination-instruction').innerText().then(text => text.replace(/\s+/gu, ' ')),
        'Предпочтение в каждой номинации можно отдать только одному участнику.');
      if (!mobile) {
        assert.ok(await recommendations.nth(0).isDisabled());
        const assigned = page.locator('.nomination-choice').first().getByRole('link', { name:'Открыть рекомендованную работу' });
        assert.equal(await assigned.getAttribute('href'), '#work/' + probe);
      }
      assert.equal(await page.locator('.recommendation-step .criterion-number').textContent(), '02');
      assert.equal(await page.getByRole('group', {name:'Рекомендовать на номинацию',exact:true})
        .getByRole('checkbox').count(), 4);
      const fileAction = page.getByRole('button', { name:'Открыть PDF', exact:true });
      assert.match(await fileAction.getAttribute('aria-describedby'), /^work-pdf-size$/);
      assert.equal(await fileAction.locator('small').count(), 0);
      assert.match(await page.locator('#work-pdf-size').innerText(), /МБ$/);
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(mobile => {
        const size = sel => document.querySelector(sel).getBoundingClientRect();
        const button = size('#open-pdf');
        const label = size('#work-pdf-label');
        const fileSize = size('#work-pdf-size');
        const middle = rect => rect.left + rect.width / 2;
        return {
          sectionGap: size('.ballot h2').top - size('.work-return').bottom,
          aligned: Math.abs(middle(label) - middle(button)) < 1,
          sizeAtRight: fileSize.left > button.right &&
            (mobile ? Math.abs(fileSize.left - button.right - 10) < 1 :
              Math.abs(fileSize.left - size('.criterion-main').left) < 1) &&
            Math.abs(fileSize.bottom - button.bottom - fileSize.height * .1) < 1 &&
            parseFloat(getComputedStyle(document.querySelector('#work-pdf-size')).fontSize) >
              parseFloat(getComputedStyle(document.querySelector('#open-pdf')).fontSize),
          commentGap: Math.round(size('.comment-label').top - size('.score-scale').bottom),
          lowerDivider: getComputedStyle(document.querySelector('.criterion-final')).borderBlockEndWidth
        };
      }, mobile);
      assert.ok(layout.sectionGap >= 24 && layout.sectionGap <= 66);
      assert.ok(layout.aligned && layout.sizeAtRight);
      assert.equal(layout.lowerDivider, '0px');
      assert.equal(layout.commentGap, mobile ? 28 : 56);
      const strip = page.locator('.sheet-strip');
      const dialog = page.locator('dialog[open]');
      const second = strip.locator('[data-page="2"]');
      const loaded = number => page.waitForFunction(n => {
        const img = document.querySelector('dialog[open] img');
        return img?.naturalWidth && img.alt.endsWith(' ' + n) && !document.querySelector('dialog .sheet-status').textContent;
      }, number);
      await act(page.getByRole('button', { name: 'Повторить загрузку листа' }));
      await strip.locator('[data-page="1"] img[src]').waitFor();
      assert.equal(await strip.locator('button').count(), 3);
      assert.equal(await page.getByRole('heading', { name: 'Листы проекта' }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Следующий лист' }).count(), 0);
      const dimensions = await strip.evaluate(el => [el.clientWidth, el.scrollWidth, el.firstElementChild.clientWidth]);
      assert.ok(dimensions[1] > dimensions[0] && dimensions[2] < dimensions[0]);
      if (mobile) await second.scrollIntoViewIfNeeded();
      else await strip.locator('button').first().press('ArrowRight');
      await act(second);
      await loaded(2);
      const next = dialog.getByRole('button', { name: 'Следующий лист' });
      await act(next);
      await loaded(3);
      await act(next);
      await loaded(1);
      await act(dialog.getByRole('button', { name: 'Увеличить' }));
      assert.equal(await dialog.locator('.zoom-value').innerText(), '130 %');
      await act(dialog.getByRole('button', { name: 'Сбросить' }));
      assert.equal(await dialog.locator('.zoom-value').innerText(), '100 %');
      if (mobile) await act(dialog.getByRole('button', { name: 'Закрыть' }));
      else await page.keyboard.press('Escape');
      await page.locator('dialog').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.dataset.page === '2');
      await page.getByRole('link', { name:'Положение о работе жюри' }).waitFor();
      assert.equal(await page.getByRole('link', { name:'Критерии третьего этапа' }).count(), 0);
      const guide = criterion.getByText('Подробнее о критерии', { exact:true });
      await act(guide);
      await weightNote.waitFor({state:'visible'});
      assert.equal(await criterion.locator('details[open]').count(), 1);
      await page.waitForFunction(text => document.querySelector('.criterion-final details[open] .scale-body')?.innerText.includes(text),
        mobile ? 'тревожность, радиофобию' : 'менее 4');
      if (mobile) {
        assert.equal(await page.locator('.guide-list li:visible').count(), 6);
        assert.match(await page.locator('.guide-list li:last-child').innerText(), /тревожность, радиофобию/);
      } else {
        assert.equal(await criterion.locator('details .scale-values li:visible').count(), 6);
        assert.equal(await criterion.locator('details p').filter({hasText:/менее 4/}).count(), 1);
      }
      await act(guide);
      await weightNote.waitFor({state:'hidden'});
      assert.equal(await criterion.locator('details[open]').count(), 0);
      assert.equal(await scale.locator('li:visible').count(), 6);
      const nominations = page.getByRole('button',{name:'Критерии номинаций',exact:true});
      const submitOffset = () => page.locator('.save-ballot').evaluate(el =>
        el.getBoundingClientRect().top - el.form.querySelector('.ballot-follow-up').getBoundingClientRect().top);
      const buttonOffset = await submitOffset();
      const reference = page.getByRole('complementary', {name:'Справочные материалы'});
      const juryRules = reference.getByRole('link', {name:'Положение о работе жюри',exact:true});
      assert.equal(await juryRules.count(), 1);
      const helpLayout = () => nominations.evaluate(button => {
        const rules = document.querySelector('.ballot-references .ballot-rules').getBoundingClientRect();
        const submit = button.form.querySelector('.save-ballot').getBoundingClientRect();
        const toggle = button.getBoundingClientRect();
        return [Math.abs(rules.left - toggle.left) < 1, toggle.bottom < submit.top, submit.bottom < rules.top];
      });
      assert.deepEqual(await helpLayout(), [true,true,true]);
      assert.equal(await nominations.getAttribute('aria-expanded'), 'false');
      await act(nominations);
      assert.equal(await nominations.getAttribute('aria-expanded'), 'true');
      assert.deepEqual(await helpLayout(), [true,true,true]);
      assert.ok((await submitOffset()) > buttonOffset);
      assert.equal(await page.locator('.nominations h3:visible').count(),4);
      const guideLayout = await page.locator('.nominations').evaluate(el => {
        const links = el.previousElementSibling.getBoundingClientRect();
        const title = el.querySelector('h3');
        return [title.getBoundingClientRect().top - links.bottom, getComputedStyle(title).fontFamily];
      });
      assert.ok(guideLayout[0] >= 12);
      assert.match(guideLayout[1], /MTS Compact/);
      assert.ok(await page.getByText(/Реализуемость\s+не\s+является обязательным условием/).isVisible());
      await act(nominations);
      assert.equal(await nominations.getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('.nominations h3:visible').count(), 0);
      assert.ok(Math.abs(await submitOffset() - buttonOffset) < 1);
      assert.equal(await page.locator('.criterion').count(), 1);
      assert.equal(await page.locator('.criterion input:checked').count(), 0);
      if (mobile) {
        await page.locator(onlyCriterion + '[value="0"]').locator('..').tap();
        await page.locator('textarea').fill('Мой комментарий');
      } else {
        await page.evaluate(({ user, work }) => {
          localStorage.setItem('jury.draft.v1/' + user + '/final_50_50/' + work, JSON.stringify({
            revision:0, answers:{concept:2, technical_review:4}, comment:'Мой комментарий'
          }));
        }, { user:fixtures.get(login), work:id });
        await page.reload();
        await page.locator('.save-ballot').waitFor();
        assert.equal(await page.locator('textarea').inputValue(), 'Мой комментарий');
        assert.equal(await page.locator(onlyCriterion + ':checked').inputValue(), '4');
      }
      for (const index of [1, 2]) {
        const option = recommendations.nth(index);
        if (mobile) await option.locator('..').tap();
        else await option.press('Space');
      }
      const workNavigation = () => page.getByRole('navigation', { name:'Соседние работы' });
      const neighbors = workNavigation();
      const previousWork = neighbors.getByRole('link', { name:'Предыдущая работа' });
      const nextWork = neighbors.getByRole('link', { name:'Следующая работа' });
      const firstWorkHeading = page.getByRole('heading', { name:works[0].title, exact:true });
      const secondWorkHeading = page.getByRole('heading', { name:works[1].title, exact:true });
      const lastWorkHeading = page.getByRole('heading', { name:works.at(-1).title, exact:true });
      const workHash = work => '#work/' + work.id;

      assert.equal(await previousWork.count(), 0);
      assert.equal(await nextWork.getAttribute('href'), workHash(works[1]));
      await act(nextWork);
      await secondWorkHeading.waitFor();
      assert.ok(await secondWorkHeading.evaluate(el => document.activeElement === el));
      assert.equal(new URL(page.url()).hash, workHash(works[1]));
      assert.equal(await page.locator('textarea').inputValue(), '');
      assert.equal(await previousWork.getAttribute('href'), workHash(works[0]));
      assert.equal(await nextWork.getAttribute('href'), workHash(works[2]));
      const neighborLayout = () => neighbors.evaluate(nav => {
        const bounds = nav.getBoundingClientRect();
        const rect = element => element.getBoundingClientRect();
        const anchors = [...nav.querySelectorAll('a')];
        const links = anchors.map(rect);
        const labels = anchors.map(a => rect(a.querySelector('span')));
        const arrows = anchors.map(a => rect(a.querySelector('svg')));
        const references = rect(document.querySelector('.ballot-references'));
        const gallery = rect(document.querySelector('.work-gallery .sheets'));
        const sameLine = Math.abs(links[0].top - links[1].top) < 1;
        return {
          underReferences: bounds.top > references.bottom,
          onGalleryEdges: Math.abs(arrows[0].left - gallery.left) < 1 && Math.abs(arrows[1].right - gallery.right) < 1,
          arrowsBesideLabels: arrows[0].right < labels[0].left && labels[1].right < arrows[1].left &&
            arrows.every((box, i) => Math.abs((box.top + box.bottom - labels[i].top - labels[i].bottom) / 2) < 1),
          sameLine,
          touchTargets: links.every(box => box.height >= 44 && box.width >= 44),
          fits: links.every(box => box.left >= 0 && box.right <= innerWidth + 1),
          separate: sameLine ? links[0].right < links[1].left : links[0].bottom < links[1].top
        };
      });
      assert.deepEqual(await neighborLayout(), { underReferences:true, onGalleryEdges:true, arrowsBesideLabels:true, sameLine:!mobile, touchTargets:true, fits:true, separate:true });
      assert.deepEqual(await neighbors.locator('.work-neighbor-arrow').evaluateAll(arrows => arrows.map(arrow => ({
        width: arrow.getBoundingClientRect().width,
        height: arrow.getBoundingClientRect().height,
        stroke: getComputedStyle(arrow.querySelector('path')).strokeWidth,
        paths: arrow.querySelectorAll('path').length,
        mirrored: getComputedStyle(arrow).transform !== 'none'
      }))), [
        { width:50, height:32, stroke:'2px', paths:1, mirrored:true },
        { width:50, height:32, stroke:'2px', paths:1, mirrored:false }
      ]);
      if (process.env.JURY_QA_SCREENSHOTS) {
        await page.evaluate(() => document.fonts.ready.then(() => {
          window.scrollTo({ top:document.documentElement.scrollHeight, behavior:'instant' });
        }));
        await page.waitForFunction(() => {
          const { top, bottom } = document.querySelector('.work-neighbors').getBoundingClientRect();
          return top >= 0 && bottom <= innerHeight + 1;
        });
        await page.screenshot({ path:path.join(process.env.JURY_QA_SCREENSHOTS, (mobile ? 'phone' : 'computer') + '-work-neighbors.png') });
      }
      if (mobile) {
        const viewport = page.viewportSize();
        await page.setViewportSize({ width:320, height:viewport.height });
        const style = await page.addStyleTag({url:'/text-200.css'});
        assert.deepEqual(await neighborLayout(), { underReferences:true, onGalleryEdges:true, arrowsBesideLabels:true, sameLine:false, touchTargets:true, fits:true, separate:true });
        await style.evaluate(node => node.remove());
        await page.setViewportSize(viewport);
      }
      await act(previousWork);
      await firstWorkHeading.waitFor();
      assert.equal(await page.locator(onlyCriterion + ':checked').inputValue(), String(answers[criterionKey]));
      assert.deepEqual(await page.locator('input[name=nomination_keys]:checked').evaluateAll(
        fields => fields.map(field => field.value)), ['statement','scale']);
      assert.equal(await page.locator('textarea').inputValue(), 'Мой комментарий');
      await page.goto(url + workHash(works.at(-1)));
      await lastWorkHeading.waitFor();
      assert.equal(await nextWork.count(), 0);
      assert.equal(await previousWork.getAttribute('href'), workHash(works.at(-2)));
      await act(previousWork);
      await page.getByRole('heading', { name:works.at(-2).title, exact:true }).waitFor();
      await page.goBack();
      await lastWorkHeading.waitFor();
      await page.goto(url + workHash(works[0]));
      await firstWorkHeading.waitFor();

      await act(page.getByRole('link',{name:'К списку работ'}));
      await page.waitForFunction(id => document.activeElement?.id === id, id);
      await act(page.locator('a[id="' + id + '"]'));
      assert.equal(await page.locator('textarea').inputValue(), 'Мой комментарий');
      await page.reload();
      await page.locator('.save-ballot').waitFor();
      assert.equal(await page.locator('textarea').inputValue(), 'Мой комментарий');
      assert.equal(await page.locator(onlyCriterion + ':checked').inputValue(), String(answers[criterionKey]));
      await act(page.getByRole('button', { name:'Выйти' }));
      await page.reload();
      await signIn('jury-08');
      await page.getByText('Этот аккаунт даёт доступ к просмотру работ.').waitFor();
      assert.equal(await page.getByRole('link', { name: 'Мой рейтинг работ' }).count(), 0);
      await act(page.getByRole('button', { name:'Выйти' }));
      await signIn('jury-07');
      assert.equal(await page.locator('textarea').inputValue(), '');
      assert.equal(await page.locator('.criterion input:checked').count(), 0);
      await act(page.getByRole('button', { name:'Выйти' }));
      await page.close();
      page = await context.newPage();
      await page.goto(url + '#work/' + id);
      await signIn(login);
      assert.equal(await page.locator('textarea').inputValue(), 'Мой комментарий');
      assert.equal(await page.locator(onlyCriterion + ':checked').inputValue(), String(answers[criterionKey]));
      assert.equal((await sheet(login)).ballots.some(b => b.work_id === id), false);
      const submit = page.locator('.save-ballot');
      const retryGuide = page.locator('.criterion-final summary');
      const retryNominations = page.getByRole('button', { name:'Критерии номинаций' });
      await act(retryGuide);
      await act(retryNominations);
      const originalForm = await submit.evaluateHandle(el => el.form);
      await page.evaluate(() => document.fonts.ready);
      if (!mobile) await submit.focus();
      await submit.evaluate(el => el.scrollIntoView({ block:'center', behavior:'instant' }));
      const startingPosition = await submit.evaluate(el => ({
        scroll: scrollY, button: el.getBoundingClientRect().top, height: document.documentElement.scrollHeight
      }));
      const failed = () => page.getByText(/Сервер\s+не\s+подтвердил\s+сохранение/).waitFor();
      if (mobile) await submit.tap();
      else await page.keyboard.press('Enter');
      await failed();
      assert.equal((await sheet(login)).ballots.some(b => b.work_id === id), false);
      assert.ok(await originalForm.evaluate(form => form === document.querySelector('#voting form')));
      await originalForm.dispose();
      assert.equal(await page.locator('.criterion-final details[open]').count(), 1);
      assert.equal(await retryNominations.getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('textarea').inputValue(), 'Мой комментарий');
      assert.equal(await page.locator(onlyCriterion + ':checked').inputValue(), String(answers[criterionKey]));
      assert.deepEqual(await page.locator('input[name=nomination_keys]:checked').evaluateAll(fields => fields.map(field => field.value)), ['statement','scale']);
      assert.ok(await submit.isEnabled());
      const finalPosition = await submit.evaluate(el => ({
        scroll: scrollY, button: el.getBoundingClientRect().top, height: document.documentElement.scrollHeight
      }));
      assert.ok(Math.abs(finalPosition.button - startingPosition.button) <= 2,
        'Save button moved in the viewport: ' + JSON.stringify({ startingPosition, finalPosition }));
      assert.ok(await page.locator('.ballot-feedback').evaluate(el => {
        const box = el.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= innerHeight && document.activeElement === el;
      }));
      await act(retryGuide);
      await act(retryNominations);
      await act(submit);
      await failed();
      await act(submit);
      await page.getByText('Оценка сохранена.', { exact:true }).waitFor();
      const savedBallot = (await sheet(login)).ballots.find(b => b.work_id === id);
      assert.equal(savedBallot.revision, 1);
      assert.deepEqual(savedBallot.nomination_keys, ['statement','scale']);
      if (process.env.JURY_QA_SCREENSHOTS) {
        const screenshot = suffix => path.join(process.env.JURY_QA_SCREENSHOTS, (mobile ? 'phone' : 'computer') + suffix);
        await page.locator('.recommendations').screenshot({ path:screenshot('-recommendations.png') });
        await page.locator('.ballot h2').evaluate(el => el.scrollIntoView({block:'start'}));
        await page.screenshot({ path:screenshot('-score-layout.png') });
        await page.locator('.criterion-final').screenshot({ path:screenshot('-criterion.png') });
        await page.locator('.work-return').evaluate(el => el.scrollIntoView({block:'center'}));
        await page.screenshot({ path:screenshot('-pdf-to-ballot.png') });
        await page.screenshot({ path:path.join(process.env.JURY_QA_SCREENSHOTS, (mobile ? 'mobile' : 'desktop') + '-ballot.png'),fullPage:true });
      }
      await act(page.getByRole('button',{ name:'Выйти' }));
      await signIn(login);
      await page.getByText('Оценка сохранена.', { exact:true }).waitFor();
      assert.equal(await page.locator('textarea').inputValue(), 'Мой комментарий');
      assert.equal(await page.locator(onlyCriterion + ':checked').inputValue(), String(answers[criterionKey]));
      assert.deepEqual(await page.locator('input[name=nomination_keys]').evaluateAll(fields => fields
        .filter(field => field.checked).map(field => field.value)), ['statement','scale']);
      await save(login, id, answers, 'Из другой вкладки', 1);
      await page.locator('textarea').fill('Моя правка');
      await act(submit);
      await page.getByRole('button',{ name:'Загрузить сохранённую версию' }).waitFor();
      assert.equal(await page.locator('textarea').inputValue(), 'Моя правка');
      await act(page.getByRole('button',{ name:'Загрузить сохранённую версию' }));
      await page.waitForFunction(() => document.querySelector('textarea')?.value === 'Из другой вкладки');
      await page.locator('textarea').fill('Исправленная оценка');
      await act(submit);
      await page.getByText('Оценка сохранена.', { exact:true }).waitFor();
      await act(page.getByRole('link',{ name:'К списку работ' }));
      await page.getByRole('link', { name: 'Регламент жюри' }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Рады видеть вас в составе жюри конкурса!' }).count(), 1);
      const steps = page.locator('.intro .step');
      assert.match(await steps.nth(0).innerText(), /^01/);
      assert.equal(await steps.nth(0).locator('[data-regulations]').count(), 1);
      assert.match((await steps.nth(1).locator(':scope > p').allTextContents()).join(' ').replace(/\s+/g, ' '), /^У вас есть доступ.+До 9 декабря.+14 декабря/);
      assert.equal(await steps.nth(0).getByText('Перед началом оценки вы можете ознакомиться с подробным регламентом жюри.', { exact:true }).count(), 1);
      const brief = steps.nth(1).getByRole('button', { name:'Задание третьего этапа', exact:true });
      await brief.waitFor();
      const stepButtonGeometry = () => steps.locator('.rules-button').evaluateAll(async buttons => {
        await document.fonts.ready;
        return buttons.map(button => {
          const range = document.createRange();
          range.selectNodeContents(button);
          return { height: button.getBoundingClientRect().height, lines: range.getClientRects().length };
        });
      });
      const checkStepButtons = async () => {
        const [rules, brief] = await stepButtonGeometry();
        assert.equal(rules.lines, 1);
        assert.deepEqual(brief, rules);
      };
      const mastheadGeometry = () => page.locator('.masthead-inner').evaluate(async header => {
        await document.fonts.ready;
        const logo = header.querySelector('img').getBoundingClientRect();
        const controls = [...header.querySelectorAll('nav a, button')].map(el => el.getBoundingClientRect());
        const separated = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
        return {
          height:header.getBoundingClientRect().height,
          sameRow:controls.every(box => Math.abs(box.top + box.bottom - controls[0].top - controls[0].bottom) < 2),
          usable:controls.length === 3 && controls.every((box, i) => box.width >= 44 && box.height >= 44 &&
            box.top >= logo.bottom && box.left >= 0 && box.right <= innerWidth + 1 &&
            controls.slice(i + 1).every(other => separated(box, other)))
        };
      });
      const checkMastheadRow = async () => {
        const { height, sameRow, usable } = await mastheadGeometry();
        assert.ok(height < 120 && sameRow && usable, JSON.stringify({height,sameRow,usable}));
      };
      const menuUnderlines = await page.locator('.masthead nav a').evaluateAll(links => links.map(link => {
        const {textDecorationColor, textDecorationThickness, textUnderlineOffset} = getComputedStyle(link);
        return {textDecorationColor, textDecorationThickness, textUnderlineOffset};
      }));
      assert.equal(menuUnderlines.length, 2);
      assert.deepEqual(menuUnderlines[0],menuUnderlines[1]);
      await checkStepButtons();
      if (mobile) await checkMastheadRow();
      const catalogueViewport = page.viewportSize();
      await page.setViewportSize({ width:mobile ? 320 : 740, height:catalogueViewport.height });
      await checkStepButtons();
      if (mobile) {
        await checkMastheadRow();
        const zoom = await page.addStyleTag({url:'/text-200.css'});
        assert.ok((await mastheadGeometry()).usable);
        await zoom.evaluate(node => node.remove());
      }
      await page.setViewportSize(catalogueViewport);
      const introduction = page.locator('.jury-introduction');
      assert.equal(await introduction.getByText('На третьем (текущем) этапе', { exact:true }).count(), 1);
      assert.equal(await introduction.getByText(/получили\s+задание/).count(), 1);
      assert.equal(await introduction.getByText(/одну\s+или\s+несколько\s+представленных\s+концепций/).count(), 1);
      assert.equal(await introduction.getByText(/конфликт\s+интересов|Спасибо|Регламент работы жюри/).count(), 0);
      assert.deepEqual(await page.locator('.work-number').allTextContents(), works.map((_, i) => String(i + 1).padStart(2, '0')));
      const regulations = page.getByRole('link', { name: 'Регламент жюри' });
      assert.equal(await regulations.getAttribute('href'), 'https://disk.360.yandex.ru/d/fixture');
      assert.equal(fault.regulationsRequests, undefined);
      await observeRegulationsPreview(page);
      let releaseRegulations;
      fault.regulationsGate = new Promise(resolve => { releaseRegulations = resolve; });
      try {
        const request = page.waitForRequest(req => new URL(req.url()).pathname.includes('/regulations/'));
        await act(regulations);
        await request;
        assert.ok(await page.locator('#projects-heading').isVisible());
        assert.equal(await page.locator('body').getAttribute('data-regulations-preview'), null);
      } finally { releaseRegulations(); }
      await page.waitForFunction(() => document.body.dataset.regulationsPreview?.startsWith('blob:'));
      assert.equal(await regulations.getAttribute('href'), 'https://disk.360.yandex.ru/d/fixture');
      assert.equal(fault.regulationsRequests, 1);
      const marked = page.locator('a[id="' + id + '"]');
      assert.equal(await marked.locator('.work-mark.is-scored svg').count(), 1);
      assert.ok((await marked.ariaSnapshot()).includes('Оценена'));
      assert.equal(await page.locator('.works .work-mark:not(.is-scored)').count(), 13);
      await act(page.getByRole('link', { name: 'Мой рейтинг работ' }));
      await page.locator('.ranking').waitFor();
      assert.equal(await page.locator('.ranking tbody tr').count(), 2);
      assert.equal(await page.locator('#ranking-order').count(), 0);
      const ownRank = page.locator('#rank-' + id).locator('../..');
      assert.equal(await ownRank.locator('td').last().innerText(), String(answers[criterionKey]));
      const rankedHrefs = await page.locator('.ranking tbody a').evaluateAll(links => links.map(a => a.hash));
      const inRanking = rankedHrefs.indexOf('#rating/work/' + id);
      assert.ok(inRanking === 0 || inRanking === 1);
      const neighborHash = rankedHrefs[1 - inRanking];
      const neighborId = neighborHash.split('/').at(-1);
      await act(page.locator('#rank-' + id));
      await page.getByRole('heading', { name: works[0].title }).waitFor();
      const rankingNavigation = workNavigation();
      const priorDirection = inRanking === 0 ? '[rel=next]' : '[rel=prev]';
      const updatedDirection = inRanking === 0 ? '[rel=prev]' : '[rel=next]';
      assert.equal(await rankingNavigation.locator(priorDirection).getAttribute('href'), neighborHash);
      assert.equal(await rankingNavigation.getByRole('link').count(), 1);

      const formBeforeRankingSave = await submit.evaluateHandle(el => el.form);
      const newScore = page.locator(onlyCriterion + '[value="' + (inRanking === 0 ? '0' : '5') + '"]');
      if (mobile) await newScore.locator('..').tap();
      else await newScore.press('Space');
      await act(submit);
      await page.getByText('Оценка сохранена.', { exact:true }).waitFor();
      assert.ok(await formBeforeRankingSave.evaluate(form => form === document.querySelector('#voting form')));
      await formBeforeRankingSave.dispose();
      assert.equal(await rankingNavigation.locator(priorDirection).count(), 0);
      const rankedNeighbor = rankingNavigation.locator(updatedDirection);
      assert.equal(await rankedNeighbor.getAttribute('href'), neighborHash);
      await act(rankedNeighbor);
      await page.getByRole('heading', { name:works.find(work => work.id === neighborId).title }).waitFor();
      assert.equal(new URL(page.url()).hash, neighborHash);
      assert.equal(await rankingNavigation.locator(priorDirection).getAttribute('href'), '#rating/work/' + id);
      await act(page.getByRole('link', { name: 'К моему рейтингу' }));
      await page.waitForFunction(id => document.activeElement?.id === 'rank-' + id, neighborId);
      assert.equal(await page.locator('#ranking-order').count(), 0);
      const atProjects = () => page.waitForFunction(() => {
        const section = document.querySelector('#projects');
        const heading = document.querySelector('#projects-heading');
        if (!section || !heading) return false;
        const origin = section.getBoundingClientRect().top;
        return Math.abs(origin) < 2 && heading.getBoundingClientRect().bottom < innerHeight;
      });
      await act(page.getByRole('link', { name: 'К списку работ' }));
      await atProjects();
      assert.equal(new URL(page.url()).hash, '#projects');
      assert.equal(await page.locator('.sheet-progress').innerText().then(t => t.replace(/\s+/g, ' ')), 'Оценено 2 из 15');
      await page.goto(url);
      await page.locator('.welcome h1').waitFor();
      assert.equal(await page.evaluate(() => scrollY), 0);
      if (process.env.JURY_QA_SCREENSHOTS) {
        await page.locator('.intro').screenshot({ path:path.join(process.env.JURY_QA_SCREENSHOTS,
          (mobile ? 'phone' : 'computer') + '-steps.png') });
        await page.evaluate(() => scrollTo(0, 0));
      }
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const projectsLink = page.getByRole('link', { name: 'Работы', exact:true });
      const motion = page.waitForFunction(() =>
        scrollY > 10 && document.querySelector('#projects').getBoundingClientRect().top > 10);
      await act(projectsLink);
      await motion;
      await atProjects();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'projects');
      await page.goBack();
      assert.equal(new URL(page.url()).hash, '');
      // Chromium can restore the top one CSS pixel from zero.
      await page.waitForFunction(() =>
        Math.abs(scrollY) <= 1 && document.activeElement === document.querySelector('.welcome h1'));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => {
        document.addEventListener('click', () => {
          document.body.dataset.projectsPosition = String(document.querySelector('#projects').getBoundingClientRect().top);
        }, { once:true });
      });
      await act(projectsLink);
      assert.ok(Math.abs(Number(await page.locator('body').getAttribute('data-projects-position'))) < 2);
      await atProjects();
      await page.evaluate(() => scrollTo(0, 0));
      await act(projectsLink);
      await atProjects();
      await page.goto(url + '#works');
      await atProjects();
      await act(page.getByRole('button',{ name:'Выйти' }));
      await signIn('jury-07');
      await act(page.locator('a[id="' + id + '"]'));
      assert.equal(await page.locator('.criterion input:checked').count(), 0);
      await activate('original');
      const stale = page.locator('input[name=concept][value="2"]');
      if (mobile) await stale.locator('..').tap(); else { await stale.focus(); await stale.press('Space'); }
      await act(submit);
      await act(page.getByRole('button',{name:'Открыть действующий лист'}));
      await page.locator('input[name=brief]').first().waitFor({state:'attached'});
      assert.equal(await page.locator('.criterion').count(),5);
      await activate(currentRubric);
      await page.reload();
      await page.getByText('Критерии номинаций', { exact:true }).waitFor();
      if (mobile) {
        await page.addStyleTag({url:'/text-200.css'});
        const overflow = await page.evaluate(() => [...document.querySelectorAll('main *')].filter(el =>
          !el.parentElement?.closest('.sheet-strip') && el.getBoundingClientRect().right > innerWidth + 1).map(el => el.tagName + '.' + el.className));
        assert.deepEqual(overflow, []);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.setViewportSize({ width: 320, height: 728 });
        const enlargedDialog = page.locator('dialog[open]');
        await act(page.locator('.sheet-strip [data-page="1"]'));
        await loaded(1);
        const view = await enlargedDialog.evaluate(el => ({
          imageHeight: el.querySelector('.sheet-pan').clientHeight,
          height: el.clientHeight,
          controlsEnd: el.querySelector('.sheet-controls').getBoundingClientRect().bottom,
          widthFits: el.scrollWidth <= el.clientWidth
        }));
        assert.ok(view.imageHeight >= view.height * .45 && view.controlsEnd <= view.height + 1 && view.widthFits);
        await act(enlargedDialog.getByRole('button', { name: 'Закрыть' }));
      }
      await context.close();
      await checkRoleLayout(browser, options, act, { login:'jury-02', criterion:'concept' });
      await checkRoleLayout(browser, options, act, { login:technicalTest, criterion:'technical_review' });
      await checkNominationRace(browser, options, act, mobile);
      console.log((mobile ? 'iPhone 13 WebKit' : channel) + ': regulation fetch and fallback, 50/50, both roles, neighboring works, enlarged text, two-tab nomination race and transfer, retry, conflict and rollback passed.');
    } finally { await browser.close(); }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  await db.close();
}
