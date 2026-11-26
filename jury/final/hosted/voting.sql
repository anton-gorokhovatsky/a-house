-- Stage 3, jury regulations sections 7.3–7.7. Run after provisioning the members.
begin;

create table public.jury_final_voters (
  user_id uuid primary key references public.jury_members(user_id) on delete cascade,
  technical boolean not null default false,
  is_test boolean not null default false
);
create table public.jury_final_criteria (
  key text primary key,
  position smallint not null unique,
  label text not null,
  weight integer not null check (weight between 0 and 100),
  technical boolean not null default false,
  site_only boolean not null default false
);
insert into public.jury_final_criteria (position, key, label, weight, technical, site_only) values
  (1, 'brief', 'Соответствие архитектурному брифу', 10, false, false),
  (2, 'art', 'Художественный и эмоциональный эффект арт-объекта', 30, false, false),
  (3, 'ergonomics', 'Функциональность и эргономика', 0, false, false),
  (4, 'equipment', 'Технические ограничения и требования к размещению оборудования', 20, true, false),
  (5, 'feasibility', 'Реализуемость и конструктивная логика', 25, true, false),
  (6, 'economics', 'Экономическая эффективность строительства и эксплуатации', 15, false, false),
  (7, 'landscape', 'Интеграция в ландшафт и градостроительный контекст', 0, false, true);

-- Logins follow the numbered roster in section 2.3. Other admitted accounts can read the works.
insert into public.jury_final_voters (user_id, technical)
select m.user_id, u.email = 'jury-03@jury.example.com'
from public.jury_members m join auth.users u on u.id = m.user_id
where u.email ~ '^jury-0[1-7]@jury[.]example[.]com$';

do $roster$
begin
  if (select count(*) from public.jury_final_voters) <> 7 then
    raise exception 'Provision the seven numbered jury accounts before installing voting';
  end if;
end
$roster$;

create table public.jury_final_control (
  singleton boolean primary key default true check (singleton),
  accepting boolean not null,
  regulations_url text check (regulations_url ~ '^https://disk[.]360[.]yandex[.]ru/d/[A-Za-z0-9_-]+$')
);
insert into public.jury_final_control (accepting) values (true);

create table public.jury_final_ballots (
  user_id uuid not null references public.jury_final_voters(user_id),
  work_id text not null references public.jury_works(id),
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  comment text not null default '' check (length(comment) <= 5000),
  revision integer not null check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, work_id)
);
alter table public.jury_final_voters enable row level security;
alter table public.jury_final_criteria enable row level security;
alter table public.jury_final_control enable row level security;
alter table public.jury_final_ballots enable row level security;
revoke all on public.jury_final_voters, public.jury_final_criteria, public.jury_final_control, public.jury_final_ballots
  from public, anon, authenticated;
grant select, insert, update, delete on public.jury_final_voters, public.jury_final_ballots to service_role;
grant select on public.jury_final_criteria to service_role;
grant select, update on public.jury_final_control to service_role;

-- One authenticated read restores this juror's sheet for all 15 works.
create function public.jury_final_sheet() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'role', case when v.user_id is null then 'observer' when v.technical then 'technical' else 'juror' end,
    'accepting', ctl.accepting,
    'regulations_url', ctl.regulations_url,
    'criteria', coalesce((select jsonb_agg(to_jsonb(c) order by c.position)
      from public.jury_final_criteria c where v.user_id is not null and (not c.technical or v.technical)), '[]'::jsonb),
    'ballots', coalesce((select jsonb_agg(jsonb_build_object('work_id', b.work_id, 'answers', b.answers,
      'comment', b.comment, 'revision', b.revision)) from public.jury_final_ballots b
      where b.user_id = m.user_id), '[]'::jsonb)
  ) from public.jury_members m
  cross join public.jury_final_control ctl
  left join public.jury_final_voters v on v.user_id = m.user_id
  where m.user_id = (select auth.uid());
$$;

create function public.jury_save_final_ballot(p_work_id text, p_answers jsonb, p_comment text, p_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  juror uuid := auth.uid();
  is_technical boolean;
  is_open boolean;
  previous public.jury_final_ballots%rowtype;
  saved public.jury_final_ballots%rowtype;
begin
  select technical into is_technical from public.jury_final_voters where user_id = juror for update;
  if not found then raise sqlstate '42501' using message = 'Voting access required'; end if;
  select accepting into is_open from public.jury_final_control for share;
  if is_open is not true then raise sqlstate 'PT403' using message = 'VOTING_CLOSED'; end if;
  if not exists (select 1 from public.jury_works where id = p_work_id) then
    raise sqlstate 'PT404' using message = 'Unknown work';
  end if;
  if p_revision is null or p_revision < 0 or p_comment is null or length(p_comment) > 5000
     or jsonb_typeof(p_answers) is distinct from 'object' then
    raise sqlstate '22023' using message = 'Invalid ballot';
  end if;
  if (select count(*) from jsonb_object_keys(p_answers)) <>
     (select count(*) from public.jury_final_criteria where not technical or is_technical)
     or exists (select 1 from public.jury_final_criteria c where (not c.technical or is_technical)
       and (not (p_answers ? c.key) or
         (p_answers -> c.key not in ('0','1','2','3','4','5') and not (c.site_only and p_answers -> c.key = 'null'::jsonb)))) then
    raise sqlstate '22023' using message = 'Fill in the applicable criteria with scores from 0 to 5';
  end if;
  select * into previous from public.jury_final_ballots where user_id = juror and work_id = p_work_id;
  if previous.answers = p_answers and previous.comment = p_comment then
    saved := previous;
  else
    if coalesce(previous.revision, 0) <> p_revision then
      raise sqlstate 'PT409' using message = 'BALLOT_CHANGED';
    end if;
    insert into public.jury_final_ballots (user_id, work_id, answers, comment, revision)
    values (juror, p_work_id, p_answers, p_comment, p_revision + 1)
    on conflict (user_id, work_id) do update set answers = excluded.answers, comment = excluded.comment,
      revision = excluded.revision, updated_at = now()
    returning * into saved;
  end if;
  return jsonb_build_object('work_id', saved.work_id, 'answers', saved.answers, 'comment', saved.comment, 'revision', saved.revision);
end
$$;
revoke all on function public.jury_final_sheet(), public.jury_save_final_ballot(text, jsonb, text, integer)
  from public, anon, authenticated;
grant execute on function public.jury_final_sheet(), public.jury_save_final_ballot(text, jsonb, text, integer)
  to authenticated;

-- Organizer's working figures. Official decisions are recorded in the jury protocol.
create view public.jury_final_work_summary with (security_invoker = true) as
with per_criterion as (
  select b.work_id, c.key, c.weight, avg((b.answers ->> c.key)::numeric) as mean
  from public.jury_final_ballots b join public.jury_final_voters v on v.user_id = b.user_id and not v.is_test
  join public.jury_final_criteria c on b.answers ? c.key
  group by b.work_id, c.key, c.weight
), totals as (
  select work_id, sum(mean * weight / 100) as weighted,
    max(mean) filter (where key = 'feasibility') as feasibility
  from per_criterion group by work_id
)
select w.position, w.id as work_id, w.title, count(b.user_id) as ballot_count,
  count(b.user_id) filter (where v.technical) as technical_count,
  case when count(b.user_id) >= 4 and t.feasibility is not null then t.weighted end as working_score,
  t.feasibility as mean_feasibility
from public.jury_works w left join (public.jury_final_ballots b
  join public.jury_final_voters v on v.user_id = b.user_id and not v.is_test) on b.work_id = w.id
left join totals t on t.work_id = w.id
group by w.id, w.position, w.title, t.weighted, t.feasibility;
revoke all on public.jury_final_work_summary from public, anon, authenticated;
grant select on public.jury_final_work_summary to service_role;
commit;
