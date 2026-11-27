-- Return to the previous 50/50 roles without switching rubrics or rewriting ballots.
-- A technical ballot created after the split has no concept score until its author adds one.
begin;
create or replace function public.jury_final_criterion_applies(
  p_rubric text, p_criterion_technical boolean, p_voter_technical boolean
) returns boolean
language sql immutable strict set search_path = '' as $$
  select not p_criterion_technical or p_voter_technical;
$$;
commit;
