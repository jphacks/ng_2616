-- Math Notebook: owner-scoped notebook snapshots (spec §4.3).
-- Apply in the Supabase SQL editor or with `supabase db push`.

create table if not exists public.mn_notebooks (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  schema_version text not null default '2.0.0' check (schema_version = '2.0.0'),
  revision bigint not null default 1 check (revision >= 1),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 8 * 1024 * 1024),
  updated_at timestamptz not null default now()
);

create index if not exists mn_notebooks_owner_updated on public.mn_notebooks (owner_id, updated_at desc);

-- id and owner are immutable; revision increments by exactly one; updated_at is set by the database
create or replace function public.mn_notebooks_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.owner_id <> old.owner_id then
      raise exception 'id and owner_id are immutable';
    end if;
    if new.revision <> old.revision + 1 then
      raise exception 'revision must increase by exactly one';
    end if;
  elsif tg_op = 'INSERT' then
    if new.revision <> 1 then
      raise exception 'revision starts at 1';
    end if;
  end if;
  if (new.snapshot ->> 'id') is distinct from new.id::text then
    raise exception 'snapshot.id must equal id';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists mn_notebooks_guard on public.mn_notebooks;
create trigger mn_notebooks_guard
  before insert or update on public.mn_notebooks
  for each row execute function public.mn_notebooks_guard();

alter table public.mn_notebooks enable row level security;

revoke all on public.mn_notebooks from anon;
grant select, insert, update, delete on public.mn_notebooks to authenticated;

drop policy if exists "owner can read" on public.mn_notebooks;
create policy "owner can read" on public.mn_notebooks
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "owner can insert" on public.mn_notebooks;
create policy "owner can insert" on public.mn_notebooks
  for insert to authenticated with check (owner_id = (select auth.uid()));

drop policy if exists "owner can update" on public.mn_notebooks;
create policy "owner can update" on public.mn_notebooks
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists "owner can delete" on public.mn_notebooks;
create policy "owner can delete" on public.mn_notebooks
  for delete to authenticated using (owner_id = (select auth.uid()));
