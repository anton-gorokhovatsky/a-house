-- Install once after voting.sql. The existing sheet stays active until the organizer switches it.
begin;

create table public.jury_final_rubrics (
  id text primary key,
  criteria_url text check (criteria_url ~ '^https://docs[.]google[.]com/document/d/[A-Za-z0-9_-]+(/edit)?$')
);
insert into public.jury_final_rubrics (id) values ('original'), ('final_50_50');
alter table public.jury_final_rubrics enable row level security;
revoke all on public.jury_final_rubrics from public, anon, authenticated;
grant select, update on public.jury_final_rubrics to service_role;

alter table public.jury_final_control add column active_rubric text not null default 'original'
  references public.jury_final_rubrics(id);
alter table public.jury_final_criteria add column rubric text not null default 'original'
  references public.jury_final_rubrics(id);
alter table public.jury_final_criteria drop constraint jury_final_criteria_pkey,
  drop constraint jury_final_criteria_position_key,
  add primary key (rubric, key), add unique (rubric, position);
alter table public.jury_final_ballots add column rubric text not null default 'original'
  references public.jury_final_rubrics(id);
alter table public.jury_final_ballots drop constraint jury_final_ballots_pkey,
  add primary key (rubric, user_id, work_id);

insert into public.jury_final_criteria (rubric, position, key, label, weight, technical) values
  ('final_50_50', 1, 'concept', 'Концепция, художественный и эмоциональный эффект', 50, false),
  ('final_50_50', 2, 'technical_review', 'Реализуемость, эффективность, конструктивная логика и соответствие техническим требованиям', 50, true);

create function public.jury_final_rubric_sheet(p_rubric text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'rubric', r.id, 'criteria_url', r.criteria_url, 'regulations_url', ctl.regulations_url,
    'role', case when v.user_id is null then 'observer' when v.technical then 'technical' else 'juror' end,
    'accepting', ctl.accepting and r.id = ctl.active_rubric,
    'criteria', coalesce((select jsonb_agg(to_jsonb(c) order by c.position)
      from public.jury_final_criteria c where c.rubric = r.id
      and v.user_id is not null and (not c.technical or v.technical)), '[]'::jsonb),
    'ballots', coalesce((select jsonb_agg(jsonb_build_object('work_id', b.work_id, 'answers', b.answers,
      'comment', b.comment, 'revision', b.revision)) from public.jury_final_ballots b
      where b.user_id = m.user_id and b.rubric = r.id), '[]'::jsonb)
  ) from public.jury_members m
  cross join public.jury_final_control ctl
  join public.jury_final_rubrics r on r.id = coalesce(p_rubric, ctl.active_rubric)
  left join public.jury_final_voters v on v.user_id = m.user_id
  where m.user_id = (select auth.uid());
$$;

create function public.jury_save_rubric_ballot(p_rubric text, p_work_id text, p_answers jsonb, p_comment text, p_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  juror uuid := auth.uid();
  is_technical boolean;
  ctl public.jury_final_control%rowtype;
  previous public.jury_final_ballots%rowtype;
  saved public.jury_final_ballots%rowtype;
begin
  select technical into is_technical from public.jury_final_voters where user_id = juror for update;
  if not found then raise sqlstate '42501' using message = 'Voting access required'; end if;
  select * into strict ctl from public.jury_final_control where singleton for share;
  if p_rubric is distinct from ctl.active_rubric then raise sqlstate 'PT412' using message = 'RUBRIC_CHANGED'; end if;
  if not ctl.accepting then raise sqlstate 'PT403' using message = 'VOTING_CLOSED'; end if;
  if not exists (select 1 from public.jury_works where id = p_work_id) then
    raise sqlstate 'PT404' using message = 'Unknown work';
  end if;
  if p_revision is null or p_revision < 0 or p_comment is null or length(p_comment) > 5000
     or jsonb_typeof(p_answers) is distinct from 'object' then
    raise sqlstate '22023' using message = 'Invalid ballot';
  end if;
  if (select count(*) from jsonb_object_keys(p_answers)) <>
     (select count(*) from public.jury_final_criteria c where c.rubric = p_rubric and (not c.technical or is_technical))
     or exists (select 1 from public.jury_final_criteria c where c.rubric = p_rubric and (not c.technical or is_technical)
       and (not (p_answers ? c.key) or
         (p_answers -> c.key not in ('0','1','2','3','4','5') and not (c.site_only and p_answers -> c.key = 'null'::jsonb)))) then
    raise sqlstate '22023' using message = 'Fill in the applicable criteria with scores from 0 to 5';
  end if;
  select * into previous from public.jury_final_ballots
    where rubric = p_rubric and user_id = juror and work_id = p_work_id;
  if previous.answers = p_answers and previous.comment = p_comment then
    saved := previous;
  else
    if coalesce(previous.revision, 0) <> p_revision then raise sqlstate 'PT409' using message = 'BALLOT_CHANGED'; end if;
    insert into public.jury_final_ballots (rubric, user_id, work_id, answers, comment, revision)
    values (p_rubric, juror, p_work_id, p_answers, p_comment, p_revision + 1)
    on conflict (rubric, user_id, work_id) do update set answers = excluded.answers, comment = excluded.comment,
      revision = excluded.revision, updated_at = now()
    returning * into saved;
  end if;
  return jsonb_build_object('rubric', saved.rubric, 'work_id', saved.work_id, 'answers', saved.answers,
    'comment', saved.comment, 'revision', saved.revision);
end
$$;

-- Keep open tabs from the earlier release bound to exactly the sheet they displayed.
create or replace function public.jury_final_sheet() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select public.jury_final_rubric_sheet('original');
$$;
create or replace function public.jury_save_final_ballot(p_work_id text, p_answers jsonb, p_comment text, p_revision integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  return public.jury_save_rubric_ballot('original', p_work_id, p_answers, p_comment, p_revision);
exception when sqlstate 'PT412' then
  raise sqlstate 'PT403' using message = 'VOTING_CLOSED';
end
$$;
revoke all on function public.jury_final_rubric_sheet(text), public.jury_save_rubric_ballot(text, text, jsonb, text, integer)
  from public, anon, authenticated;
grant execute on function public.jury_final_rubric_sheet(text), public.jury_save_rubric_ballot(text, text, jsonb, text, integer)
  to authenticated;

create or replace view public.jury_final_work_summary with (security_invoker = true) as
with active_ballots as (
  select b.*, v.technical from public.jury_final_ballots b
  join public.jury_final_voters v on v.user_id = b.user_id and not v.is_test
  join public.jury_final_control ctl on ctl.active_rubric = b.rubric
), per_criterion as (
  select b.work_id, c.key, c.weight, avg((b.answers ->> c.key)::numeric) as mean
  from active_ballots b join public.jury_final_criteria c on c.rubric = b.rubric and b.answers ? c.key
  group by b.work_id, c.key, c.weight
), totals as (
  select work_id, sum(mean * weight / 100) as weighted,
    max(mean) filter (where key in ('feasibility','technical_review')) as feasibility
  from per_criterion group by work_id
)
select w.position, w.id as work_id, w.title, count(b.user_id) as ballot_count,
  count(b.user_id) filter (where b.technical) as technical_count,
  case when count(b.user_id) >= 4 and t.feasibility is not null then t.weighted end as working_score,
  t.feasibility as mean_feasibility, ctl.active_rubric as rubric,
  t.feasibility >= 4 as meets_prize_feasibility_threshold
from public.jury_works w cross join public.jury_final_control ctl
left join active_ballots b on b.work_id = w.id left join totals t on t.work_id = w.id
group by w.id, w.position, w.title, t.weighted, t.feasibility, ctl.active_rubric;
commit;
