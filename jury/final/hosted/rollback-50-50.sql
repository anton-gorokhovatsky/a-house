-- The current web client also renders the original sheet. Both sets of ballots are retained.
begin;
update public.jury_final_control set active_rubric = 'original' where singleton;
commit;
