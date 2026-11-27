-- Apply after voting-nominations.sql. Existing recommendations stay in their saved ballots.
begin;

create or replace function public.jury_final_check_nomination_choice()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  added text[] := new.nomination_keys;
begin
  if new.rubric <> 'final_50_50' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (new.rubric, new.user_id, new.work_id) = (old.rubric, old.user_id, old.work_id) then
      added := array(select unnest(new.nomination_keys) except select unnest(old.nomination_keys));
    end if;
  end if;
  if cardinality(added) = 0 then
    return new;
  end if;

  -- Write to the row already locked by the RPC. A transaction with a stale fixed snapshot must retry.
  update public.jury_final_voters as voter set is_test = voter.is_test where voter.user_id = new.user_id;
  if exists (
    select 1 from public.jury_final_ballots
    where rubric = new.rubric and user_id = new.user_id and work_id <> new.work_id
      and nomination_keys && added
  ) then
    raise sqlstate 'PT422' using message = 'NOMINATION_ALREADY_RECOMMENDED';
  end if;
  return new;
end
$$;

revoke all on function public.jury_final_check_nomination_choice() from public, anon, authenticated;

drop trigger if exists jury_final_one_work_per_nomination on public.jury_final_ballots;
create trigger jury_final_one_work_per_nomination
  before insert or update of nomination_keys, rubric, user_id, work_id on public.jury_final_ballots
  for each row execute function public.jury_final_check_nomination_choice();

-- Check while the trigger installation holds the table lock. Report conflicts without changing ballots.
do $$
begin
  if exists (
    select 1 from public.jury_final_ballots
    cross join lateral unnest(nomination_keys) as selection(nomination)
    where rubric = 'final_50_50'
    group by user_id, nomination having count(*) > 1
  ) then
    raise exception 'Existing recommendations overlap. Resolve the selections before applying the limit.';
  end if;
end
$$;

commit;
