-- Apply after voting-role-split.sql. Old clients keep using the five-argument save.
begin;

alter table public.jury_final_ballots
  add column if not exists nomination_keys text[] not null default '{}'::text[];

create or replace function public.jury_final_rubric_sheet(p_rubric text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'rubric', r.id, 'criteria_url', r.criteria_url, 'regulations_url', ctl.regulations_url,
    'role', case when v.user_id is null then 'observer' when v.technical then 'technical' else 'juror' end,
    'nomination_recommendations', r.id = 'final_50_50' and v.user_id is not null and not v.technical,
    'accepting', ctl.accepting and r.id = ctl.active_rubric,
    'criteria', coalesce((select jsonb_agg(to_jsonb(c) order by c.position)
      from public.jury_final_criteria c where c.rubric = r.id
      and v.user_id is not null and public.jury_final_criterion_applies(c.rubric, c.technical, v.technical)), '[]'::jsonb),
    'ballots', coalesce((select jsonb_agg(jsonb_build_object('work_id', b.work_id, 'answers', visible.answers,
      'comment', b.comment, 'revision', b.revision,
      'nomination_keys', case when r.id = 'final_50_50' and not v.technical then b.nomination_keys else '{}'::text[] end))
      from public.jury_final_ballots b
      cross join lateral (select public.jury_final_visible_answers(b.rubric, b.answers, v.technical) as answers) visible
      where b.user_id = m.user_id and b.rubric = r.id and visible.answers <> '{}'::jsonb), '[]'::jsonb)
  ) from public.jury_members m
  cross join public.jury_final_control ctl
  join public.jury_final_rubrics r on r.id = coalesce(p_rubric, ctl.active_rubric)
  left join public.jury_final_voters v on v.user_id = m.user_id
  where m.user_id = (select auth.uid());
$$;

create or replace function public.jury_save_rubric_ballot(
  p_rubric text, p_work_id text, p_answers jsonb, p_comment text, p_revision integer, p_nomination_keys text[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  juror uuid := auth.uid();
  is_technical boolean;
  previous public.jury_final_ballots%rowtype;
  chosen text[];
  saved jsonb;
  revision_after integer;
begin
  -- The score and recommendations share the existing per-juror lock and transaction.
  select technical into is_technical from public.jury_final_voters where user_id = juror for update;
  if not found or is_technical or p_rubric is distinct from 'final_50_50' then
    raise sqlstate '42501' using message = 'Nomination recommendations require a final concept ballot';
  end if;
  select array(select key from unnest(array['context','statement','scale','experiment']::text[])
    with ordinality as allowed(key, position) where key = any(p_nomination_keys) order by position) into chosen;
  if p_nomination_keys is null or cardinality(p_nomination_keys) <> cardinality(chosen) then
    raise sqlstate '22023' using message = 'Unknown or duplicate nomination';
  end if;
  select * into previous from public.jury_final_ballots
    where rubric = p_rubric and user_id = juror and work_id = p_work_id;

  saved := public.jury_save_rubric_ballot(p_rubric, p_work_id, p_answers, p_comment, p_revision);
  if coalesce(previous.nomination_keys, '{}'::text[]) is distinct from chosen then
    if coalesce(previous.revision, 0) <> p_revision then
      raise sqlstate 'PT409' using message = 'BALLOT_CHANGED';
    end if;
    -- Advance the version once, including when only the recommendations change.
    revision_after := greatest((saved ->> 'revision')::integer, coalesce(previous.revision, 0) + 1);
    update public.jury_final_ballots
      set nomination_keys = chosen, revision = revision_after, updated_at = now()
      where rubric = p_rubric and user_id = juror and work_id = p_work_id;
    saved := saved || jsonb_build_object('revision', revision_after);
  end if;
  return saved || jsonb_build_object('nomination_keys', chosen);
end
$$;

revoke all on function public.jury_save_rubric_ballot(text, text, jsonb, text, integer, text[])
  from public, anon, authenticated;
grant execute on function public.jury_save_rubric_ballot(text, text, jsonb, text, integer, text[])
  to authenticated;

notify pgrst, 'reload schema';
commit;
