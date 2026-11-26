begin;

create table public.jury_members (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table public.jury_works (
  id text primary key check (id ~ '^[a-f0-9]{24}$'),
  position smallint not null unique check (position > 0),
  title text not null check (length(title) > 0),
  bytes bigint not null check (bytes > 0)
);

alter table public.jury_members enable row level security;
alter table public.jury_works enable row level security;
revoke all on public.jury_members, public.jury_works from anon, authenticated, public;
grant select on public.jury_members, public.jury_works to authenticated;
grant select, insert, update, delete on public.jury_members, public.jury_works to service_role;

create policy jury_member_reads_own_admission
  on public.jury_members for select to authenticated
  using (user_id = (select auth.uid()));

create policy jury_members_read_works
  on public.jury_works for select to authenticated
  using ((select exists (
    select 1 from public.jury_members as admission
    where admission.user_id = (select auth.uid())
  )));

create policy jury_members_read_final_pdfs
  on storage.objects for select to authenticated
  using (
    bucket_id = 'jury-final'
    and (select exists (
      select 1 from public.jury_members as admission
      where admission.user_id = (select auth.uid())
    ))
  );

commit;
