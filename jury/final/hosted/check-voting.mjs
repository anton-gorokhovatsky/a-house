import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium, devices, webkit } from 'playwright-core';

const [site, postgresModule = '@electric-sql/pglite'] = process.argv.slice(2);
const { PGlite } = await import(postgresModule);
const db = new PGlite();
const fixtures = new Map(Array.from({ length: 15 }, (_, i) => {
  const login = 'jury-' + String(i + 1).padStart(2, '0');
  return [login, '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0')];
}));
const pdf = Buffer.from('%PDF-1.4\n%%EOF\n');
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
const sheet = async login => (await queryAs(login, 'select public.jury_final_sheet() as data'))[0].data;
const save = async (login, work, answers, comment, revision) => (await queryAs(login,
  'select public.jury_save_final_ballot($1,$2,$3,$4) as data', [work, JSON.stringify(answers), comment, revision]))[0].data;
const regular = { brief: 4, art: 5, ergonomics: 0, economics: 3, landscape: null };
const tech = { ...regular, equipment: 2, feasibility: 4 };
const probe = works[14].id;
assert.equal((await sheet('jury-08')).role, 'observer');
assert.equal((await sheet('jury-03')).criteria.length, 7);
assert.equal((await sheet('jury-01')).criteria.length, 5);
await assert.rejects(save('jury-08', probe, regular, '', 0), { code: '42501' });
await assert.rejects(save('jury-02', probe, tech, '', 0), { code: '22023' });
await assert.rejects(save('jury-02', probe, { ...regular, brief: 6 }, '', 0), { code: '22023' });
await assert.rejects(save('jury-02', probe, { ...regular, economics: null }, '', 0), { code: '22023' });
await assert.rejects(queryAs('jury-02', 'select * from public.jury_final_ballots'), { code: '42501' });
for (const login of ['jury-01', 'jury-02', 'jury-04', 'jury-05']) await save(login, probe, regular, '', 0);
const stats = async () => (await db.query('select * from public.jury_final_work_summary where work_id=$1', [probe])).rows[0];
assert.equal((await stats()).working_score, null);
await save('jury-03', probe, tech, '', 0);
assert.equal(Number((await stats()).working_score), 3.75);
await db.exec('update public.jury_final_control set accepting=false');
await assert.rejects(save('jury-01', works[4].id, regular, '', 0), { code: 'PT403' });
await db.exec('update public.jury_final_control set accepting=true');

const files = new Set(['index.html', 'cabinet.css', 'logo.svg', 'config.js', 'cabinet.js', 'voting.js', 'views.js']);
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (name === 'text-200.css') {
    res.writeHead(200, { 'content-type':'text/css' });
    return res.end('html { font-size:200% }');
  }
  if (!files.has(name)) return res.writeHead(404).end();
  const type = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml' }[path.extname(name)];
  res.writeHead(200, { 'content-type': type + '; charset=utf-8' });
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
      return fixtures.has(name) && body.password === 'test' ? reply(200, { access_token:name, refresh_token:'fixture', expires_in:3600 }) : reply(400, {});
    }
    if (!fixtures.has(login)) return reply(403);
    if (endpoint === '/auth/v1/logout') return reply(204);
    if (endpoint === '/rest/v1/jury_works') return reply(200, works);
    if (endpoint.endsWith('/jury_final_sheet')) return reply(200, await sheet(login));
    if (endpoint.endsWith('/jury_save_final_ballot')) {
      try {
        const record = await save(login, body.p_work_id, body.p_answers, body.p_comment, body.p_revision);
        if (fault.lost) { fault.lost = false; return route.abort('failed'); }
        return reply(200, record);
      } catch (e) { return reply(e.code === 'PT409' ? 409 : 403, { message:e.message }); }
    }
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
      const fault = { lost:true };
      await intercept(context, fault);
      const page = await context.newPage();
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
      await page.getByRole('link', { name:'Положение о работе жюри' }).waitFor();
      assert.equal(await page.locator('.criterion').count(), mobile ? 5 : 7);
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
      const submit = page.locator('.save-ballot');
      await act(submit);
      await page.getByText(/Сервер не подтвердил сохранение/).waitFor();
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
      assert.equal(await page.locator('input[name=ergonomics]:checked').inputValue(), '0');
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
      assert.equal(await page.locator('.sheet-progress').textContent(), 'Оценено 2 из 15');
      await act(page.getByRole('button',{ name:'Выйти' }));
      await signIn('jury-07');
      await act(page.locator('a[id="' + id + '"]'));
      assert.equal(await page.locator('.criterion input:checked').count(), 0);
      if (mobile) {
        await page.addStyleTag({url:'/text-200.css'});
        const overflow = await page.evaluate(() => [...document.querySelectorAll('main *')].filter(el =>
          el.getBoundingClientRect().right > innerWidth + 1).map(el => el.tagName + '.' + el.className));
        assert.deepEqual(overflow, []);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      console.log((mobile ? 'iPhone 13 WebKit' : 'Chrome') + ': scoring, retry, return, sign in again, conflict, edit and separate accounts passed.');
    } finally { await browser.close(); }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  await db.close();
}
