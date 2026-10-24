-- Math Notebook: cloud sync for notebooks, resources and user settings (ADR 0005).
-- Apply after 0001 in the Supabase SQL editor or with `supabase db push`.

create or replace function public.mn_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ───────────────────────────────────────────────────────────── user settings

create table if not exists public.mn_user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  locale text check (locale in ('en', 'ja')),
  -- account-wide preferences (library order/sort, …); device-only ones stay in localStorage
  prefs jsonb not null default '{}' check (jsonb_typeof(prefs) = 'object' and octet_length(prefs::text) <= 64 * 1024),
  updated_at timestamptz not null default now()
);

drop trigger if exists mn_user_settings_touch on public.mn_user_settings;
create trigger mn_user_settings_touch
  before update on public.mn_user_settings
  for each row execute function public.mn_touch_updated_at();

alter table public.mn_user_settings enable row level security;
revoke all on public.mn_user_settings from anon;
grant select, insert, update on public.mn_user_settings to authenticated;

drop policy if exists "owner can read" on public.mn_user_settings;
create policy "owner can read" on public.mn_user_settings
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "owner can insert" on public.mn_user_settings;
create policy "owner can insert" on public.mn_user_settings
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "owner can update" on public.mn_user_settings;
create policy "owner can update" on public.mn_user_settings
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ───────────────────────────────────────────────────────────── notebook ink

-- null: legacy row whose snapshot still carries its ink inline; otherwise {line_id: ink hash}
alter table public.mn_notebooks add column if not exists ink_index jsonb
  check (ink_index is null or jsonb_typeof(ink_index) = 'object');
-- what a notebook card draws (problem + first lines with their ink), so the list never reads snapshots
alter table public.mn_notebooks add column if not exists preview jsonb
  check (preview is null or (jsonb_typeof(preview) = 'object' and octet_length(preview::text) <= 1024 * 1024));

-- Strokes are content-addressed per notebook: a save uploads only ink the server lacks.
create table if not exists public.mn_notebook_ink (
  notebook_id uuid not null references public.mn_notebooks (id) on delete cascade,
  hash text not null check (hash ~ '^sha256:[0-9a-f]{64}$'),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  strokes jsonb not null check (jsonb_typeof(strokes) = 'array' and octet_length(strokes::text) <= 4 * 1024 * 1024),
  created_at timestamptz not null default now(),
  primary key (notebook_id, hash)
);

alter table public.mn_notebook_ink enable row level security;
revoke all on public.mn_notebook_ink from anon;
grant select, insert, delete on public.mn_notebook_ink to authenticated;

drop policy if exists "owner can read" on public.mn_notebook_ink;
create policy "owner can read" on public.mn_notebook_ink
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "owner can insert" on public.mn_notebook_ink;
create policy "owner can insert" on public.mn_notebook_ink
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.mn_notebooks n where n.id = notebook_id and n.owner_id = (select auth.uid()))
  );

drop policy if exists "owner can delete" on public.mn_notebook_ink;
create policy "owner can delete" on public.mn_notebook_ink
  for delete to authenticated using (owner_id = (select auth.uid()));

/**
 * One atomic save: insert (expected revision null) or update by expected revision, add the ink
 * the server lacks, check every referenced ink exists, and drop ink no line references any more.
 * SECURITY INVOKER, so RLS and the guard trigger apply exactly as for direct table access.
 * Errors: PT409 conflict (HTTP 409), PT422 referenced ink missing (client resends all ink).
 */
create or replace function public.mn_save_notebook(
  p_id uuid,
  p_expected_revision bigint,
  p_title text,
  p_snapshot jsonb,
  p_preview jsonb,
  p_ink_index jsonb,
  p_new_ink jsonb
) returns table (revision bigint, updated_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
declare
  v_rev bigint;
  v_at timestamptz;
  v_index jsonb := coalesce(p_ink_index, '{}'::jsonb);
begin
  if p_expected_revision is null then
    insert into public.mn_notebooks as n (id, owner_id, title, revision, snapshot, preview, ink_index)
    values (p_id, auth.uid(), p_title, 1, p_snapshot, p_preview, v_index)
    on conflict (id) do nothing
    returning n.revision, n.updated_at into v_rev, v_at;
  else
    update public.mn_notebooks as n
       set title = p_title, snapshot = p_snapshot, preview = p_preview, ink_index = v_index, revision = p_expected_revision + 1
     where n.id = p_id and n.revision = p_expected_revision
    returning n.revision, n.updated_at into v_rev, v_at;
  end if;
  if v_rev is null then
    raise exception 'notebook changed elsewhere' using errcode = 'PT409';
  end if;

  insert into public.mn_notebook_ink (notebook_id, owner_id, hash, strokes)
  select p_id, auth.uid(), e ->> 'hash', e -> 'strokes'
    from jsonb_array_elements(coalesce(p_new_ink, '[]'::jsonb)) as e
  on conflict do nothing;

  if exists (
    select 1 from jsonb_each_text(v_index) as i
     where not exists (select 1 from public.mn_notebook_ink k where k.notebook_id = p_id and k.hash = i.value)
  ) then
    raise exception 'referenced ink is missing' using errcode = 'PT422';
  end if;

  delete from public.mn_notebook_ink k
   where k.notebook_id = p_id
     and not exists (select 1 from jsonb_each_text(v_index) as i where i.value = k.hash);

  return query select v_rev, v_at;
end;
$$;

revoke all on function public.mn_save_notebook(uuid, bigint, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.mn_save_notebook(uuid, bigint, text, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- ───────────────────────────────────────────────────────────── resources

create table if not exists public.mn_resources (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  notebook_id uuid not null references public.mn_notebooks (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  kind text not null check (kind in ('problem_sheet', 'textbook', 'notes')),
  mime text not null check (mime in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/markdown')),
  bytes bigint not null check (bytes between 0 and 30 * 1024 * 1024),
  sha256 text not null check (sha256 ~ '^sha256:[0-9a-f]{64}$'),
  page_count int not null check (page_count >= 1),
  pages int[] not null check (cardinality(pages) between 1 and 30),
  pinned_page int,
  builtin boolean not null default false,
  -- <owner>/<notebook>/<resource>/source.<ext> in bucket mn-resources; null for built-in text
  object_path text,
  upload_state text not null default 'pending' check (upload_state in ('pending', 'uploaded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (builtin = (object_path is null)),
  check (object_path is null or split_part(object_path, '/', 1) = owner_id::text and split_part(object_path, '/', 2) = notebook_id::text)
);

create index if not exists mn_resources_owner_notebook on public.mn_resources (owner_id, notebook_id, created_at);
create index if not exists mn_resources_notebook on public.mn_resources (notebook_id);

create table if not exists public.mn_resource_pages (
  resource_id uuid not null references public.mn_resources (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  page int not null check (page >= 1),
  text text not null default '' check (char_length(text) <= 30000),
  text_source text not null check (text_source in ('pdf', 'ocr', 'builtin', 'none')),
  -- 'running' is a client-side state and never persists
  ocr_state text not null check (ocr_state in ('not_needed', 'needed', 'done', 'failed')),
  thumb_path text,
  width int,
  height int,
  updated_at timestamptz not null default now(),
  primary key (resource_id, page)
);

drop trigger if exists mn_resources_touch on public.mn_resources;
create trigger mn_resources_touch
  before update on public.mn_resources
  for each row execute function public.mn_touch_updated_at();

drop trigger if exists mn_resource_pages_touch on public.mn_resource_pages;
create trigger mn_resource_pages_touch
  before update on public.mn_resource_pages
  for each row execute function public.mn_touch_updated_at();

-- owner, notebook and file identity are immutable; quota per owner and per notebook
create or replace function public.mn_resources_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.owner_id <> old.owner_id or new.notebook_id <> old.notebook_id
       or new.object_path is distinct from old.object_path or new.sha256 <> old.sha256 or new.bytes <> old.bytes then
      raise exception 'resource identity is immutable';
    end if;
    return new;
  end if;
  if (select coalesce(sum(r.bytes), 0) from public.mn_resources r where r.owner_id = new.owner_id) + new.bytes > 500 * 1024 * 1024 then
    raise exception 'storage quota exceeded (500 MiB)' using errcode = 'PT413';
  end if;
  if (select count(*) from public.mn_resources r where r.notebook_id = new.notebook_id) >= 20 then
    raise exception 'at most 20 resources per notebook' using errcode = 'PT413';
  end if;
  return new;
end;
$$;

drop trigger if exists mn_resources_guard on public.mn_resources;
create trigger mn_resources_guard
  before insert or update on public.mn_resources
  for each row execute function public.mn_resources_guard();

alter table public.mn_resources enable row level security;
alter table public.mn_resource_pages enable row level security;
revoke all on public.mn_resources from anon;
revoke all on public.mn_resource_pages from anon;
grant select, insert, update, delete on public.mn_resources to authenticated;
grant select, insert, update, delete on public.mn_resource_pages to authenticated;

drop policy if exists "owner can read" on public.mn_resources;
create policy "owner can read" on public.mn_resources
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "owner can insert" on public.mn_resources;
create policy "owner can insert" on public.mn_resources
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.mn_notebooks n where n.id = notebook_id and n.owner_id = (select auth.uid()))
  );

drop policy if exists "owner can update" on public.mn_resources;
create policy "owner can update" on public.mn_resources
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists "owner can delete" on public.mn_resources;
create policy "owner can delete" on public.mn_resources
  for delete to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "owner can read" on public.mn_resource_pages;
create policy "owner can read" on public.mn_resource_pages
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "owner can insert" on public.mn_resource_pages;
create policy "owner can insert" on public.mn_resource_pages
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.mn_resources r where r.id = resource_id and r.owner_id = (select auth.uid()))
  );

drop policy if exists "owner can update" on public.mn_resource_pages;
create policy "owner can update" on public.mn_resource_pages
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists "owner can delete" on public.mn_resource_pages;
create policy "owner can delete" on public.mn_resource_pages
  for delete to authenticated using (owner_id = (select auth.uid()));

-- ───────────────────────────────────────────────────────────── storage

-- private; files: <owner>/<notebook>/<resource>/source.<ext> and thumb-<page>.png
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mn-resources', 'mn-resources', false, 30 * 1024 * 1024, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "mn-resources owner can read" on storage.objects;
create policy "mn-resources owner can read" on storage.objects
  for select to authenticated
  using (bucket_id = 'mn-resources' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "mn-resources owner can upload to own notebook" on storage.objects;
create policy "mn-resources owner can upload to own notebook" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'mn-resources'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.mn_notebooks n
       where n.id::text = (storage.foldername(name))[2] and n.owner_id = (select auth.uid())
    )
  );

drop policy if exists "mn-resources owner can delete" on storage.objects;
create policy "mn-resources owner can delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'mn-resources' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- no UPDATE policy: uploads use upsert=false and objects are never rewritten in place

-- Files whose resource row is gone (notebook deleted offline, account deleted, failed client
-- cleanup). Read by the mn-storage-sweeper Edge Function with the service role only.
create or replace function public.mn_orphan_objects(p_limit int default 1000)
returns table (name text)
language sql stable security definer set search_path = '' as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'mn-resources'
     and o.created_at < now() - interval '1 hour'
     and not exists (
       select 1 from public.mn_resources r
        where r.id::text = (storage.foldername(o.name))[3]
          and r.owner_id::text = (storage.foldername(o.name))[1]
     )
   order by o.created_at
   limit greatest(1, least(p_limit, 1000));
$$;

revoke all on function public.mn_orphan_objects(int) from public, anon, authenticated;
grant execute on function public.mn_orphan_objects(int) to service_role;
