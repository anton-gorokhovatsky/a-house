import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium, devices, webkit } from 'playwright-core';
import { reportRows } from './sheets-rows.mjs';
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
assert.equal((await sheet('jury-03')).nomination_recommendations, false);
assert.equal((await sheet('jury-08')).nomination_recommendations, false);
await assert.rejects(recommend('jury-08', ['context'], 0), { code:'42501' });
await assert.rejects(recommend('jury-03', ['context'], 0), { code:'42501' });
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
console.log('PGlite: optional nominations, role restrictions, old-client edits, revision checks and report passed.');

console.log('PGlite: role-specific ballots, historical scores, retries, 50/50, export, test exclusions and both rollbacks passed.');
if (process.env.JURY_QA_DB_ONLY) {
  await db.close();
  process.exit(0);
}

const files = new Set(['index.html', ...cabinetAssets.keys(), 'config.js', 'cabinet.js', 'gallery.js', 'ranking.js', 'sheets.js', 'voting.js', 'views.js', 'criteria.js', 'typography.js']);
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (name === 'text-200.css') {
    res.writeHead(200, { 'content-type':'text/css' });
    return res.end('html { font-size:200% }');
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
      try {
        const record = await save(login, body.p_work_id, body.p_answers, body.p_comment, body.p_revision, body.p_rubric, body.p_nomination_keys);
        if (fault.lost) { fault.lost = false; return route.abort('failed'); }
        return reply(200, record);
      } catch (e) { return reply(e.code.startsWith('PT') ? Number(e.code.slice(2)) : 403, { message:e.message }); }
    }
    if (req.headers().range && fault.sheetError) { fault.sheetError = false; return reply(503); }
    if (endpoint.startsWith('/storage/v1/object/authenticated/')) return route.fulfill({ status:200, headers:cors, contentType:'application/pdf', body:pdf });
    return reply(404);
  });
}

try {
  for (const [engine, login] of [[webkit, 'jury-01'], [chromium, 'jury-03']]) {
    const mobile = engine === webkit;
    const browser = await engine.launch(mobile ? {} : { channel: 'chrome' });
    try {
      const context = await browser.newContext(mobile ? devices['iPhone 13'] : { viewport:{ width:1440, height:900 } });
      const fault = { lost:true, sheetError:true };
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
      await page.getByRole('heading', { name:'Ваша оценка' }).waitFor();
      assert.equal(await page.getByText('Критерии оценки', { exact: true }).count(), 0);
      assert.equal(await page.locator('input[name=technical_review]').count(), mobile ? 0 : 6);
      assert.equal(await page.locator('input[name=concept]').count(), mobile ? 6 : 0);
      assert.equal(await page.getByText('Шкала оценки концепции', { exact:true }).count(), mobile ? 1 : 0);
      assert.equal(await page.getByText('Шкала реализуемости', { exact:true }).count(), mobile ? 0 : 1);
      const recommendations = page.locator('input[name=nomination_keys]');
      assert.equal(await recommendations.count(), mobile ? 4 : 0);
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
      const guide = page.getByText('Что учитывать при оценке концепции', { exact:true });
      if (mobile) {
        await act(guide);
        await page.waitForFunction(() =>
          document.querySelector('.guide-list li:last-child')?.innerText.includes('тревожность, радиофобию'));
        assert.equal(await page.locator('.guide-list li:visible').count(), 6);
        await act(guide);
      } else {
        assert.equal(await guide.count(), 0);
        const scale = page.getByText('Шкала реализуемости', { exact:true });
        await act(scale);
        assert.equal(await page.locator('.scale-values li:visible').count(), 6);
        await act(scale);
      }
      const nominations = page.getByText('Критерии номинаций',{exact:true});
      await act(nominations);
      assert.equal(await page.locator('.nominations h3:visible').count(),4);
      assert.ok(await page.getByText(/Реализуемость\s+не\s+является обязательным условием/).isVisible());
      await act(nominations);
      assert.equal(await page.locator('.criterion').count(), 1);
      assert.equal(await page.locator('.criterion input:checked').count(), 0);
      if (mobile) {
        await page.locator(onlyCriterion + '[value="0"]').locator('..').tap();
        await recommendations.nth(0).locator('..').tap();
        await recommendations.nth(3).locator('..').tap();
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
      await act(page.getByRole('link',{name:'К списку работ'}));
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
      await act(submit);
      await page.getByText(/Сервер\s+не\s+подтвердил\s+сохранение/).waitFor();
      await act(submit);
      await page.getByText('Оценка сохранена.', { exact:true }).waitFor();
      const savedBallot = (await sheet(login)).ballots.find(b => b.work_id === id);
      assert.equal(savedBallot.revision, 1);
      assert.deepEqual(savedBallot.nomination_keys, mobile ? ['context','experiment'] : []);
      if (process.env.JURY_QA_SCREENSHOTS) {
        if (mobile) await page.locator('.recommendations').screenshot({ path:path.join(process.env.JURY_QA_SCREENSHOTS, 'recommendations-phone.png') });
        await page.screenshot({ path:path.join(process.env.JURY_QA_SCREENSHOTS, (mobile ? 'mobile' : 'desktop') + '-ballot.png'),fullPage:true });
      }
      await act(page.getByRole('button',{ name:'Выйти' }));
      await signIn(login);
      await page.getByText('Оценка сохранена.', { exact:true }).waitFor();
      assert.equal(await page.locator('textarea').inputValue(), 'Мой комментарий');
      assert.equal(await page.locator(onlyCriterion + ':checked').inputValue(), String(answers[criterionKey]));
      assert.deepEqual(await page.locator('input[name=nomination_keys]').evaluateAll(fields => fields
        .filter(field => field.checked).map(field => field.value)), mobile ? ['context','experiment'] : []);
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
      assert.equal(await steps.nth(1).getByRole('button', { name: 'Бриф для участников 3‑го этапа' }).count(), 1);
      assert.deepEqual(await page.locator('.work-number').allTextContents(), works.map((_, i) => String(i + 1).padStart(2, '0')));
      const regulations = page.getByRole('link', { name: 'Регламент жюри' });
      assert.match(await regulations.getAttribute('href'), /^blob:/);
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
      await act(page.locator('#rank-' + id));
      await page.getByRole('heading', { name: works[0].title }).waitFor();
      await act(page.getByRole('link', { name: 'К моему рейтингу' }));
      await page.waitForFunction(id => document.activeElement?.id === 'rank-' + id, id);
      assert.equal(await page.locator('#ranking-order').count(), 0);
      await act(page.getByRole('link', { name: 'К списку работ' }));
      assert.equal(await page.locator('.sheet-progress').innerText().then(t => t.replace(/\s+/g, ' ')), 'Оценено 2 из 15');
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
      console.log((mobile ? 'iPhone 13 WebKit' : 'Chrome') + ': 50/50, roles, nominations, retry, sign-in, conflict and rollback with preserved ballots passed.');
    } finally { await browser.close(); }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  await db.close();
}
