-- Math Notebook: per-notebook insights for the home page's progress section.
-- Apply after 0002 in the Supabase SQL editor or with `supabase db push`.
--
-- The client writes one row per notebook after each save: counts taken from the notebook, the
-- days it was saved on, and three subject tags the model reads from its content now and then.
-- A separate table, so recording insights never touches mn_notebooks' revision guard or the
-- save RPC; rows go when their notebook goes.

create table if not exists public.mn_notebook_insights (
  notebook_id uuid primary key references public.mn_notebooks (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- broad field, subfield, topic; lower case (normalized by the client)
  tags text[] not null default '{}' check (cardinality(tags) <= 3),
  -- hash of the content the tags were read from, its line count and when
  tags_hash text check (tags_hash is null or tags_hash ~ '^sha256:[0-9a-f]{64}$'),
  tags_lines int not null default 0 check (tags_lines >= 0),
  tagged_at timestamptz,
  stats jsonb check (stats is null or (jsonb_typeof(stats) = 'object' and octet_length(stats::text) <= 16 * 1024)),
  active_days date[] not null default '{}' check (cardinality(active_days) <= 400),
  updated_at timestamptz not null default now()
);

create index if not exists mn_notebook_insights_owner on public.mn_notebook_insights (owner_id);

drop trigger if exists mn_notebook_insights_touch on public.mn_notebook_insights;
create trigger mn_notebook_insights_touch
  before update on public.mn_notebook_insights
  for each row execute function public.mn_touch_updated_at();

alter table public.mn_notebook_insights enable row level security;
revoke all on public.mn_notebook_insights from anon;
grant select, insert, update, delete on public.mn_notebook_insights to authenticated;

drop policy if exists "owner can read" on public.mn_notebook_insights;
create policy "owner can read" on public.mn_notebook_insights
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "owner can insert" on public.mn_notebook_insights;
create policy "owner can insert" on public.mn_notebook_insights
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.mn_notebooks n where n.id = notebook_id and n.owner_id = (select auth.uid()))
  );

drop policy if exists "owner can update" on public.mn_notebook_insights;
create policy "owner can update" on public.mn_notebook_insights
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists "owner can delete" on public.mn_notebook_insights;
create policy "owner can delete" on public.mn_notebook_insights
  for delete to authenticated using (owner_id = (select auth.uid()));
