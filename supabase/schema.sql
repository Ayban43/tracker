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

