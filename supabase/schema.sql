-- Trip expense tracker schema
-- Run this in Supabase SQL Editor.

create extension if not exists "pgcrypto";

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  title text not null,
  category text not null check (category in ('car', 'food', 'gas', 'activity', 'other')),
  split_mode text not null check (split_mode in ('equal', 'custom')),
  amount_cents integer not null check (amount_cents > 0),
  receipt_url text,
  paid_by_member_id uuid not null references public.members(id),
  occurred_on date not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.expense_shares (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  owed_cents integer not null check (owed_cents >= 0),
  is_settled boolean not null default false,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  unique(expense_id, member_id)
);

create index if not exists idx_members_trip_id on public.members(trip_id);
create index if not exists idx_expenses_trip_id on public.expenses(trip_id);
create index if not exists idx_expense_shares_expense_id on public.expense_shares(expense_id);

alter table public.trips enable row level security;
alter table public.members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;

-- Simple no-auth policies for a private group app.
-- Replace with authenticated user-based policies before public use.
drop policy if exists "Allow all trips" on public.trips;
create policy "Allow all trips" on public.trips for all using (true) with check (true);

drop policy if exists "Allow all members" on public.members;
create policy "Allow all members" on public.members for all using (true) with check (true);

drop policy if exists "Allow all expenses" on public.expenses;
create policy "Allow all expenses" on public.expenses for all using (true) with check (true);

drop policy if exists "Allow all shares" on public.expense_shares;
create policy "Allow all shares" on public.expense_shares for all using (true) with check (true);

-- Public bucket for receipt images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-receipts',
  'expense-receipts',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

drop policy if exists "Public can view expense receipts" on storage.objects;
create policy "Public can view expense receipts"
on storage.objects for select
using (bucket_id = 'expense-receipts');

drop policy if exists "Public can upload expense receipts" on storage.objects;
create policy "Public can upload expense receipts"
on storage.objects for insert
with check (bucket_id = 'expense-receipts');

drop policy if exists "Public can update expense receipts" on storage.objects;
create policy "Public can update expense receipts"
on storage.objects for update
using (bucket_id = 'expense-receipts')
with check (bucket_id = 'expense-receipts');

drop policy if exists "Public can delete expense receipts" on storage.objects;
create policy "Public can delete expense receipts"
on storage.objects for delete
using (bucket_id = 'expense-receipts');

-- Seed one trip + six members (id is deterministic for easy env setup).
insert into public.trips (id, name)
values ('8a5eb18a-bda9-4cf9-99a8-08e18f5f6798', 'My Group Trip')
on conflict (id) do nothing;

insert into public.members (trip_id, name)
values
  ('8a5eb18a-bda9-4cf9-99a8-08e18f5f6798', 'Person 1'),
  ('8a5eb18a-bda9-4cf9-99a8-08e18f5f6798', 'Person 2'),
  ('8a5eb18a-bda9-4cf9-99a8-08e18f5f6798', 'Person 3'),
  ('8a5eb18a-bda9-4cf9-99a8-08e18f5f6798', 'Person 4'),
  ('8a5eb18a-bda9-4cf9-99a8-08e18f5f6798', 'Person 5'),
  ('8a5eb18a-bda9-4cf9-99a8-08e18f5f6798', 'Person 6')
on conflict do nothing;


-- Guard table for no-login PIN confirmation on Carm received payments.
create table if not exists public.trip_guard_settings (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  carm_receive_member_id uuid references public.members(id) on delete set null,
  carm_receive_pin_sha256 text,
  updated_at timestamptz not null default now()
);

insert into public.trip_guard_settings (trip_id, carm_receive_member_id)
select t.id,
  (
    select m.id
    from public.members m
    where m.trip_id = t.id
      and lower(trim(m.name)) in ('carm', 'carms')
    order by m.created_at asc
    limit 1
  )
from public.trips t
on conflict (trip_id) do update
set carm_receive_member_id = excluded.carm_receive_member_id;

-- Keep read/insert/delete open, but block anon updates to shares payable to Carm.
drop policy if exists "Allow all shares" on public.expense_shares;
drop policy if exists "Allow all shares read" on public.expense_shares;
drop policy if exists "Allow all shares insert" on public.expense_shares;
drop policy if exists "Allow all shares delete" on public.expense_shares;
drop policy if exists "Allow share updates except Carm receipts" on public.expense_shares;

create policy "Allow all shares read"
on public.expense_shares for select
using (true);

create policy "Allow all shares insert"
on public.expense_shares for insert
with check (true);

create policy "Allow all shares delete"
on public.expense_shares for delete
using (true);

create policy "Allow share updates except Carm receipts"
on public.expense_shares for update
using (
  not exists (
    select 1
    from public.expenses e
    join public.members payer on payer.id = e.paid_by_member_id
    where e.id = expense_shares.expense_id
      and lower(trim(payer.name)) in ('carm', 'carms')
  )
)
with check (
  not exists (
    select 1
    from public.expenses e
    join public.members payer on payer.id = e.paid_by_member_id
    where e.id = expense_shares.expense_id
      and lower(trim(payer.name)) in ('carm', 'carms')
  )
);

-- Member PIN settings for receiver-confirmed settlements (default PIN: 1234).
create table if not exists public.member_pin_settings (
  trip_id uuid not null references public.trips(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  pin_sha256 text not null,
  updated_at timestamptz not null default now(),
  primary key (trip_id, member_id)
);

alter table public.member_pin_settings enable row level security;

drop policy if exists "No direct access to member pin settings" on public.member_pin_settings;
create policy "No direct access to member pin settings"
on public.member_pin_settings for all
using (false)
with check (false);

insert into public.member_pin_settings (trip_id, member_id, pin_sha256)
select m.trip_id, m.id, encode(digest('1234', 'sha256'), 'hex')
from public.members m
on conflict (trip_id, member_id) do nothing;

create or replace function public.set_default_member_pin()
returns trigger
language plpgsql
as $$
begin
  insert into public.member_pin_settings (trip_id, member_id, pin_sha256)
  values (new.trip_id, new.id, encode(digest('1234', 'sha256'), 'hex'))
  on conflict (trip_id, member_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_set_default_member_pin on public.members;
create trigger trg_set_default_member_pin
after insert on public.members
for each row execute function public.set_default_member_pin();
