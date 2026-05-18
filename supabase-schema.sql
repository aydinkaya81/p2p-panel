create table if not exists public.partners (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  share numeric not null check (share >= 0 and share <= 100),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchases (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  partner_id text not null,
  platform text not null,
  try_amount numeric not null default 0,
  usdt_amount numeric not null default 0,
  created_at timestamptz not null,
  note text,
  transferred boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.sales (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  usdt_amount numeric not null default 0,
  try_received numeric not null default 0,
  fee numeric not null default 0,
  sold_at timestamptz not null,
  buyer text,
  created_at timestamptz not null default now()
);

alter table public.partners enable row level security;
alter table public.purchases enable row level security;
alter table public.sales enable row level security;

drop policy if exists "partners owner access" on public.partners;
drop policy if exists "purchases owner access" on public.purchases;
drop policy if exists "sales owner access" on public.sales;

create policy "partners owner access"
on public.partners
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "purchases owner access"
on public.purchases
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "sales owner access"
on public.sales
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
