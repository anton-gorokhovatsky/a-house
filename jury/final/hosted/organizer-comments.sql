begin;

create schema if not exists jury_admin;
revoke all on schema jury_admin from public, anon, authenticated, service_role;

create or replace view jury_admin.comments with (security_invoker = true) as
select w.title as "Работа", split_part(u.email, '@', 1) as "Логин жюри",
  b.comment as "Комментарий", v.is_test as "Тестовая запись", b.updated_at as "Обновлено"
from public.jury_final_ballots b
join public.jury_final_control ctl on ctl.active_rubric = b.rubric
join public.jury_works w on w.id = b.work_id
join public.jury_final_voters v on v.user_id = b.user_id
join auth.users u on u.id = b.user_id
where b.comment ~ '[^[:space:]]';
revoke all on jury_admin.comments from public, anon, authenticated, service_role;

commit;
