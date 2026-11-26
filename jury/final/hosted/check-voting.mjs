import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium, devices, webkit } from 'playwright-core';
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
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema storage; create table storage.objects(bucket_id text);
  create table auth.users(id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
await db.exec(await readFile(new URL('schema.sql', import.meta.url), 'utf8'));
for (const [login, id] of fixtures) {
  await db.query('insert into auth.users values ($1,$2)', [id, login + '@jury.example.com']);
  await db.query('insert into public.jury_members values ($1)', [id]);
}
for (const [i, work] of works.entries()) {
  await db.query('insert into public.jury_works values ($1,$2,$3,$4)', [work.id, i + 1, work.title, work.bytes]);
}
await db.exec(await readFile(new URL('voting.sql', import.meta.url), 'utf8'));
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
const save = async (login, work, answers, comment, revision, rubric = currentRubric) => (await queryAs(login,
  'select public.jury_save_rubric_ballot($1,$2,$3,$4,$5) as data', [rubric, work, JSON.stringify(answers), comment, revision]))[0].data;
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
const tech = { concept:0, technical_review:4 };
assert.equal((await sheet('jury-08')).role, 'observer');
assert.deepEqual((await sheet('jury-03')).criteria.map(c=>[c.key,c.weight]), [['concept',50],['technical_review',50]]);
assert.deepEqual((await sheet('jury-01')).criteria.map(c=>c.key), ['concept']);
await assert.rejects(save('jury-08', probe, regular, '', 0), { code: '42501' });
await assert.rejects(save('jury-02', probe, tech, '', 0), { code: '22023' });
await assert.rejects(save('jury-02', probe, { concept:6 }, '', 0), { code: '22023' });
await assert.rejects(save('jury-02', probe, { concept:null }, '', 0), { code: '22023' });
await assert.rejects(save('jury-03', probe, regular, '', 0), { code: '22023' });
await assert.rejects(queryAs('jury-02', 'select * from public.jury_final_ballots'), { code: '42501' });
for (const [login, concept] of [['jury-01',1],['jury-02',3],['jury-04',4],['jury-05',5]]) {
  await save(login, probe, { concept }, '', 0);
}
assert.equal((await stats()).working_score, null);
await save('jury-03', probe, { concept:2, technical_review:4 }, '', 0);
assert.equal(Number((await stats()).working_score),3.5);
assert.equal((await stats()).meets_prize_feasibility_threshold,true);
await save('jury-03', probe, { concept:2, technical_review:3 }, '', 1);
assert.equal((await stats()).meets_prize_feasibility_threshold,false);
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
        const record = await save(login, body.p_work_id, body.p_answers, body.p_comment, body.p_revision, body.p_rubric);
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
      await page.goto(url + '#work/' + id);
      await signIn(login);
      await page.getByRole('heading', { name:'Ваша оценка' }).waitFor();
      const nextSheet = () => page.locator('.sheet-bar').getByRole('button', { name: 'Следующий лист' });
      const nextLarge = () => page.locator('dialog[open]').getByRole('button', { name: 'Следующий лист' });
      const loaded = () => page.waitForFunction(() => document.querySelector('.sheet-preview img[src]')?.naturalWidth > 0 && document.querySelector('.sheets > .sheet-status')?.textContent === '');
      await act(page.getByRole('button', { name: 'Повторить загрузку листа' }));
      await loaded();
      await act(nextSheet());
      await loaded();
      assert.match(await page.locator('.sheet-preview img').getAttribute('alt'), /2$/);
      await act(page.getByRole('button', { name: 'На весь экран' }));
      await page.locator('dialog[open]').waitFor();
      await act(nextLarge());
      await loaded();
      assert.equal(await nextLarge().getAttribute('aria-disabled'), 'true');
      await act(page.getByRole('button', { name: 'Увеличить' }));
      if (mobile) await act(page.getByRole('button', { name: 'Закрыть' }));
      else await page.keyboard.press('Escape');
      await page.locator('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('link', { name:'Положение о работе жюри' }).waitFor();
      assert.equal(await page.getByRole('link', { name:'Критерии третьего этапа' }).count(), 0);
      const guide = page.getByText('Что учитывать при оценке концепции', { exact:true });
      await act(guide);
      await page.waitForFunction(() =>
        document.querySelector('.guide-list li:last-child')?.innerText.includes('тревожность, радиофобию'));
      assert.equal(await page.locator('.guide-list li:visible').count(), 6);
      await act(guide);
      const nominations = page.getByText('Критерии номинаций',{exact:true});
      await act(nominations);
      assert.equal(await page.locator('.nominations h3:visible').count(),4);
      assert.ok(await page.getByText(/Реализуемость\s+не\s+является обязательным условием/).isVisible());
      await act(nominations);
      assert.equal(await page.locator('.criterion').count(), mobile ? 1 : 2);
      assert.equal(await page.locator('.criterion input:checked').count(), 0);
      const answers = mobile ? regular : tech;
      for (const [key, score] of Object.entries(answers)) {
        const radio = page.locator('input[name="' + key + '"][value="' + (score ?? 'na') + '"]');
        if (mobile) await radio.locator('..').tap();
        else { await radio.focus(); await radio.press('Space'); }
      }
      await page.locator('textarea').fill('Мой комментарий');
      await act(page.getByRole('link',{name:'К списку работ'}));
      await act(page.locator('a[id="' + id + '"]'));
      assert.equal(await page.locator('textarea').inputValue(), 'Мой комментарий');
      await page.reload();
      await page.locator('.save-ballot').waitFor();
      assert.equal(await page.locator('textarea').inputValue(), 'Мой комментарий');
      assert.equal(await page.locator('input[name=concept]:checked').inputValue(), '0');
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
      assert.equal(await page.locator('input[name=concept]:checked').inputValue(), '0');
      assert.equal((await sheet(login)).ballots.some(b => b.work_id === id), false);
      const submit = page.locator('.save-ballot');
      await act(submit);
      await page.getByText(/Сервер\s+не\s+подтвердил\s+сохранение/).waitFor();
      await act(submit);
      await page.getByText('Оценка сохранена.', { exact:true }).waitFor();
      assert.equal((await sheet(login)).ballots.find(b => b.work_id === id).revision, 1);
      if (process.env.JURY_QA_SCREENSHOTS) {
        await page.screenshot({ path:path.join(process.env.JURY_QA_SCREENSHOTS, (mobile ? 'mobile' : 'desktop') + '-ballot.png'),fullPage:true });
      }
      await act(page.getByRole('button',{ name:'Выйти' }));
      await signIn(login);
      await page.getByText('Оценка сохранена.', { exact:true }).waitFor();
      assert.equal(await page.locator('textarea').inputValue(), 'Мой комментарий');
      assert.equal(await page.locator('input[name=concept]:checked').inputValue(), '0');
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
      assert.equal((await page.locator('.jury-welcome').innerText()).includes('требованиям'), !mobile);
      await act(page.getByRole('link', { name: 'Мой рейтинг работ' }));
      await page.locator('.ranking').waitFor();
      assert.equal(await page.locator('.ranking tbody tr').count(), 2);
      if (!mobile) await page.locator('#ranking-order').selectOption('technical_review');
      await act(page.locator('#rank-' + id));
      await page.getByRole('heading', { name: works[0].title }).waitFor();
      await act(page.getByRole('link', { name: 'К моему рейтингу' }));
      await page.waitForFunction(id => document.activeElement?.id === 'rank-' + id, id);
      if (!mobile) assert.equal(await page.locator('#ranking-order').inputValue(), 'technical_review');
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
          el.getBoundingClientRect().right > innerWidth + 1).map(el => el.tagName + '.' + el.className));
        assert.deepEqual(overflow, []);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      console.log((mobile ? 'iPhone 13 WebKit' : 'Chrome') + ': 50/50, roles, nominations, retry, sign-in, conflict and rollback with preserved ballots passed.');
    } finally { await browser.close(); }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  await db.close();
}
