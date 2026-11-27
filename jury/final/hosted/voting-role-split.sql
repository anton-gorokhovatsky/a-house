-- Apply after voting-50-50.sql. No edits to the roster, ballots or voting window.
begin;

create or replace function public.jury_final_criterion_applies(
  p_rubric text, p_criterion_technical boolean, p_voter_technical boolean
) returns boolean
language sql immutable strict set search_path = '' as $$
  select case when p_rubric = 'final_50_50' then p_criterion_technical = p_voter_technical
    else not p_criterion_technical or p_voter_technical end;
$$;

create or replace function public.jury_final_visible_answers(
  p_rubric text, p_answers jsonb, p_voter_technical boolean
) returns jsonb
language sql stable strict set search_path = '' as $$
  select coalesce(jsonb_object_agg(c.key, p_answers -> c.key), '{}'::jsonb)
  from public.jury_final_criteria c
  where c.rubric = p_rubric and p_answers ? c.key
    and public.jury_final_criterion_applies(c.rubric, c.technical, p_voter_technical);
$$;

revoke all on function public.jury_final_criterion_applies(text, boolean, boolean),
  public.jury_final_visible_answers(text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.jury_final_criterion_applies(text, boolean, boolean),
  public.jury_final_visible_answers(text, jsonb, boolean) to service_role;

create or replace function public.jury_final_rubric_sheet(p_rubric text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'rubric', r.id, 'criteria_url', r.criteria_url, 'regulations_url', ctl.regulations_url,
    'role', case when v.user_id is null then 'observer' when v.technical then 'technical' else 'juror' end,
    'accepting', ctl.accepting and r.id = ctl.active_rubric,
    'criteria', coalesce((select jsonb_agg(to_jsonb(c) order by c.position)
      from public.jury_final_criteria c where c.rubric = r.id
      and v.user_id is not null and public.jury_final_criterion_applies(c.rubric, c.technical, v.technical)), '[]'::jsonb),
    'ballots', coalesce((select jsonb_agg(jsonb_build_object('work_id', b.work_id, 'answers', visible.answers,
      'comment', b.comment, 'revision', b.revision))
      from public.jury_final_ballots b
      cross join lateral (select public.jury_final_visible_answers(b.rubric, b.answers, v.technical) as answers) visible
      where b.user_id = m.user_id and b.rubric = r.id and visible.answers <> '{}'::jsonb), '[]'::jsonb)
  ) from public.jury_members m
  cross join public.jury_final_control ctl
  join public.jury_final_rubrics r on r.id = coalesce(p_rubric, ctl.active_rubric)
  left join public.jury_final_voters v on v.user_id = m.user_id
  where m.user_id = (select auth.uid());
$$;

create or replace function public.jury_save_rubric_ballot(p_rubric text, p_work_id text, p_answers jsonb, p_comment text, p_revision integer)
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
  -- A tab showing the previous technical sheet must reload before it can save.
  if p_rubric = 'final_50_50' and is_technical and p_answers ? 'technical_review'
     and (p_answers - 'concept') = jsonb_build_object('technical_review', p_answers -> 'technical_review')
     and (p_answers ? 'concept') <> public.jury_final_criterion_applies(p_rubric, false, true) then
    raise sqlstate 'PT412' using message = 'RUBRIC_CHANGED';
  end if;
  if (select count(*) from jsonb_object_keys(p_answers)) <>
     (select count(*) from public.jury_final_criteria c where c.rubric = p_rubric and public.jury_final_criterion_applies(c.rubric, c.technical, is_technical))
     or exists (select 1 from public.jury_final_criteria c where c.rubric = p_rubric and public.jury_final_criterion_applies(c.rubric, c.technical, is_technical)
       and (not (p_answers ? c.key) or
         (p_answers -> c.key not in ('0','1','2','3','4','5') and not (c.site_only and p_answers -> c.key = 'null'::jsonb)))) then
    raise sqlstate '22023' using message = 'Fill in the applicable criteria with scores from 0 to 5';
  end if;
  select * into previous from public.jury_final_ballots
    where rubric = p_rubric and user_id = juror and work_id = p_work_id;
  if public.jury_final_visible_answers(p_rubric, previous.answers, is_technical) = p_answers
     and previous.comment = p_comment then
    saved := previous;
  else
    if coalesce(previous.revision, 0) <> p_revision then raise sqlstate 'PT409' using message = 'BALLOT_CHANGED'; end if;
    insert into public.jury_final_ballots (rubric, user_id, work_id, answers, comment, revision)
    -- Keep an earlier concept score in the raw ballot when it is no longer editable.
    values (p_rubric, juror, p_work_id, coalesce(previous.answers, '{}'::jsonb) || p_answers, p_comment, p_revision + 1)
    on conflict (rubric, user_id, work_id) do update set answers = excluded.answers, comment = excluded.comment,
      revision = excluded.revision, updated_at = now()
    returning * into saved;
  end if;
  return jsonb_build_object('rubric', saved.rubric, 'work_id', saved.work_id, 'answers', p_answers,
    'comment', saved.comment, 'revision', saved.revision);
end
$$;

create or replace view public.jury_final_work_summary with (security_invoker = true) as
with active_ballots as (
  select b.work_id, b.user_id, b.rubric, v.technical, visible.answers
  from public.jury_final_ballots b
  join public.jury_final_voters v on v.user_id = b.user_id and not v.is_test
  join public.jury_final_control ctl on ctl.active_rubric = b.rubric
  cross join lateral (select public.jury_final_visible_answers(b.rubric, b.answers, v.technical) as answers) visible
  where visible.answers <> '{}'::jsonb
), per_criterion as (
  select b.work_id, c.key, c.weight, avg((b.answers ->> c.key)::numeric) as mean
  from active_ballots b join public.jury_final_criteria c on c.rubric = b.rubric and b.answers ? c.key
  group by b.work_id, c.key, c.weight
), totals as (
  select work_id, sum(mean * weight / 100) as weighted,
    max(mean) filter (where key = 'concept') as concept,
    max(mean) filter (where key in ('feasibility','technical_review')) as feasibility
  from per_criterion group by work_id
)
select w.position, w.id as work_id, w.title, count(b.user_id) as ballot_count,
  count(b.user_id) filter (where b.technical) as technical_count,
  case when count(b.user_id) >= 4 and t.feasibility is not null
    and (ctl.active_rubric <> 'final_50_50' or t.concept is not null) then t.weighted end as working_score,
  t.feasibility as mean_feasibility, ctl.active_rubric as rubric,
  t.feasibility >= 4 as meets_prize_feasibility_threshold
from public.jury_works w cross join public.jury_final_control ctl
left join active_ballots b on b.work_id = w.id left join totals t on t.work_id = w.id
group by w.id, w.position, w.title, t.weighted, t.concept, t.feasibility, ctl.active_rubric;
commit;
