with active_ballots as (
  select w.position, w.id as work_id, w.title, split_part(u.email, '@', 1) as login,
    case when v.is_test then coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
      case when v.technical then 'Тест технического жюри' else 'Тестовый член жюри' end)
    end as test_name,
    (visible.answers ->> 'concept')::numeric as concept,
    (visible.answers ->> 'technical_review')::numeric as technical_score,
    case when b.rubric = 'final_50_50' then b.nomination_keys else '{}'::text[] end as nomination_keys,
    b.comment, v.is_test, b.updated_at
  from public.jury_final_ballots b
  join public.jury_final_control c on c.active_rubric = b.rubric
  join public.jury_works w on w.id = b.work_id
  join public.jury_final_voters v on v.user_id = b.user_id
  join auth.users u on u.id = b.user_id
  cross join lateral (select public.jury_final_visible_answers(b.rubric, b.answers, v.technical) as answers) visible
  where visible.answers <> '{}'::jsonb
), concepts as (
  select work_id, avg(concept) as mean_concept
  from active_ballots where not is_test group by work_id
), works as (
  select s.position, s.work_id, s.title, s.ballot_count, c.mean_concept,
    s.mean_feasibility, s.working_score, s.meets_prize_feasibility_threshold
  from public.jury_final_work_summary s left join concepts c using (work_id)
)
select jsonb_build_object(
  'rubric', (select active_rubric from public.jury_final_control where singleton),
  'as_of', statement_timestamp(),
  'works', coalesce((select jsonb_agg(to_jsonb(w) order by w.position) from works w), '[]'::jsonb),
  'ballots', coalesce((select jsonb_agg(to_jsonb(b) order by b.position, b.is_test, b.login)
    from active_ballots b), '[]'::jsonb)
) as report;
