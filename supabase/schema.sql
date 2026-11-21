-- ============================================================================
-- HAM DELIVERY & RIDER CASH RECONCILIATION - SUPABASE POSTGRESQL SCHEMA
-- Sostituisce il vecchio foglio Excel HAM + Modulo "Qualità/Innovazione Barbiè"
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. TABELLA USERS (Admin/Cassiere + Rider)
-- ----------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  email text unique,
  pin_code text not null check (pin_code ~ '^[0-9]{4}$'),
  role text not null check (role in ('admin', 'rider')),
  rider_number integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_users_role_active on public.users(role, is_active);

-- ----------------------------------------------------------------------------
-- 2. TABELLA SHIFTS (Turni Giornalieri)
-- ----------------------------------------------------------------------------
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  status text not null default 'open' check (status in ('open', 'closed')),
  total_revenue numeric(10, 2) not null default 0.00,
  notes text not null default '',
  current_round integer not null default 1 check (current_round >= 1),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists idx_shifts_status_date on public.shifts(status, date desc);

-- ----------------------------------------------------------------------------
-- 3. TABELLA RIDER_SHIFTS (Cassa Rider per Turno)
-- ----------------------------------------------------------------------------
create table if not exists public.rider_shifts (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  rider_id uuid not null references public.users(id) on delete restrict,
  initial_float numeric(10, 2) not null default 0.00 check (initial_float >= 0),
  cash_collected numeric(10, 2) not null default 0.00 check (cash_collected >= 0),
  pos_collected numeric(10, 2) not null default 0.00 check (pos_collected >= 0),
  platform_prepaid numeric(10, 2) not null default 0.00 check (platform_prepaid >= 0),
  expected_cash_return numeric(10, 2)
    generated always as (round(initial_float + cash_collected, 2)) stored,
  actual_cash_returned numeric(10, 2),
  discrepancy numeric(10, 2)
    generated always as (
      case
        when actual_cash_returned is null then null
        else round(actual_cash_returned - (initial_float + cash_collected), 2)
      end
    ) stored,
  is_settled boolean not null default false,
  current_round integer not null default 1 check (current_round >= 1),
  created_at timestamptz not null default now(),
  unique (shift_id, rider_id)
);

create index if not exists idx_rider_shifts_shift on public.rider_shifts(shift_id);
create index if not exists idx_rider_shifts_rider on public.rider_shifts(rider_id);

-- ----------------------------------------------------------------------------
-- 4. TABELLA ORDERS (Consegne)
-- ----------------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  rider_id uuid not null references public.users(id) on delete restrict,
  customer_address text not null,
  lat double precision,
  lng double precision,
  platform text not null check (
    platform in ('App', 'Gestionale', 'JustEat', 'Diretto/Telefono', 'Glovo', 'Deliveroo', 'Altro')
  ),
  order_total numeric(10, 2) not null check (order_total >= 0),
  payment_method text not null check (
    payment_method in ('cash', 'pos_rider', 'prepaid_platform')
  ),
  change_needed numeric(10, 2) not null default 0.00 check (change_needed >= 0),
  status text not null default 'pending' check (
    status in ('pending', 'in_transit', 'delivered', 'cancelled')
  ),
  round_number integer not null default 1 check (round_number >= 1),
  is_moved boolean not null default false,
  moved_from_rider_id uuid references public.users(id) on delete set null,
  moved_from_rider_name text,
  moved_from_round integer,
  moved_at timestamptz,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index if not exists idx_orders_shift_rider on public.orders(shift_id, rider_id);
create index if not exists idx_orders_status on public.orders(status);

-- ----------------------------------------------------------------------------
-- 5. TABELLA QUALITY_LOGS (Modulo "Qualità/Innovazione Barbiè")
-- ----------------------------------------------------------------------------
create table if not exists public.quality_logs (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  rider_id uuid not null references public.users(id) on delete restrict,
  rating integer not null check (rating between 1 and 5),
  packaging_check boolean not null default true,
  notes text not null default '',
  bonus_malus_amount numeric(10, 2) not null default 0.00,
  created_at timestamptz not null default now()
);

create index if not exists idx_quality_logs_shift on public.quality_logs(shift_id);
create index if not exists idx_quality_logs_rider on public.quality_logs(rider_id);

-- ----------------------------------------------------------------------------
-- MOTORE DI RICONCILIAZIONE AUTOMATICO (TRIGGER POSTGRESQL)
-- Garantisce zero errori algebrici sul database ad ogni insert/update/delete.
-- ----------------------------------------------------------------------------
create or replace function public.recalculate_rider_and_shift_totals(
  p_shift_id uuid,
  p_rider_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_cash numeric(10, 2);
  v_pos numeric(10, 2);
  v_prepaid numeric(10, 2);
  v_shift_revenue numeric(10, 2);
begin
  -- Assicura che esista il record rider_shifts per questo rider nel turno
  insert into public.rider_shifts (shift_id, rider_id, initial_float)
  values (p_shift_id, p_rider_id, 0.00)
  on conflict (shift_id, rider_id) do nothing;

  -- Calcola i totali dagli ordini consegnati (delivered)
  select
    coalesce(sum(case when payment_method = 'cash' then order_total else 0 end), 0.00),
    coalesce(sum(case when payment_method = 'pos_rider' then order_total else 0 end), 0.00),
    coalesce(sum(case when payment_method = 'prepaid_platform' then order_total else 0 end), 0.00)
  into v_cash, v_pos, v_prepaid
  from public.orders
  where shift_id = p_shift_id
    and rider_id = p_rider_id
    and status = 'delivered';

  update public.rider_shifts
  set
    cash_collected = round(v_cash, 2),
    pos_collected = round(v_pos, 2),
    platform_prepaid = round(v_prepaid, 2)
  where shift_id = p_shift_id
    and rider_id = p_rider_id;

  -- Ricalcola il fatturato totale del turno (ordini consegnati di tutti i rider)
  select coalesce(sum(order_total), 0.00)
  into v_shift_revenue
  from public.orders
  where shift_id = p_shift_id
    and status = 'delivered';

  update public.shifts
  set total_revenue = round(v_shift_revenue, 2)
  where id = p_shift_id;
end;
$$;

create or replace function public.trg_orders_recalculate()
returns trigger
language plpgsql
security definer
as $$
begin
  if (tg_op = 'DELETE') then
    perform public.recalculate_rider_and_shift_totals(old.shift_id, old.rider_id);
    return old;
  elsif (tg_op = 'UPDATE') then
    if (old.shift_id <> new.shift_id or old.rider_id <> new.rider_id) then
      perform public.recalculate_rider_and_shift_totals(old.shift_id, old.rider_id);
    end if;
    perform public.recalculate_rider_and_shift_totals(new.shift_id, new.rider_id);
    return new;
  else
    perform public.recalculate_rider_and_shift_totals(new.shift_id, new.rider_id);
    return new;
  end if;
end;
$$;

drop trigger if exists orders_recalculate_totals on public.orders;
create trigger orders_recalculate_totals
after insert or update or delete on public.orders
for each row execute function public.trg_orders_recalculate();

-- ----------------------------------------------------------------------------
-- RPC LOGIN RAPIDO CON PIN A 4 CIFRE
-- ----------------------------------------------------------------------------
create or replace function public.login_with_pin(p_pin text)
returns setof public.users
language sql
security definer
as $$
  select *
  from public.users
  where pin_code = p_pin
    and is_active = true
  limit 1;
$$;

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RBAC)
-- ----------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.shifts enable row level security;
alter table public.rider_shifts enable row level security;
alter table public.orders enable row level security;
alter table public.quality_logs enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.users
    where auth_user_id = auth.uid()
      and role = 'admin'
      and is_active = true
  );
$$;

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
as $$
  select id from public.users
  where auth_user_id = auth.uid()
  limit 1;
$$;

-- Policies (per utenti autenticati via Supabase Auth)
drop policy if exists "users_select" on public.users;
create policy "users_select" on public.users
  for select to authenticated
  using (public.is_admin() or auth_user_id = auth.uid());

drop policy if exists "shifts_select" on public.shifts;
create policy "shifts_select" on public.shifts
  for select to authenticated
  using (true);

drop policy if exists "shifts_admin_all" on public.shifts;
create policy "shifts_admin_all" on public.shifts
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "rider_shifts_select" on public.rider_shifts;
create policy "rider_shifts_select" on public.rider_shifts
  for select to authenticated
  using (public.is_admin() or rider_id = public.current_app_user_id());

drop policy if exists "rider_shifts_admin_all" on public.rider_shifts;
create policy "rider_shifts_admin_all" on public.rider_shifts
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "orders_select" on public.orders;
create policy "orders_select" on public.orders
  for select to authenticated
  using (public.is_admin() or rider_id = public.current_app_user_id());

drop policy if exists "orders_admin_all" on public.orders;
create policy "orders_admin_all" on public.orders
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "orders_rider_update_own" on public.orders;
create policy "orders_rider_update_own" on public.orders
  for update to authenticated
  using (rider_id = public.current_app_user_id())
  with check (rider_id = public.current_app_user_id());

drop policy if exists "quality_logs_admin_all" on public.quality_logs;
create policy "quality_logs_admin_all" on public.quality_logs
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "quality_logs_rider_read" on public.quality_logs;
create policy "quality_logs_rider_read" on public.quality_logs
  for select to authenticated
  using (rider_id = public.current_app_user_id());

-- ----------------------------------------------------------------------------
-- SUPABASE REALTIME PUBLICATION
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'rider_shifts'
  ) then
    alter publication supabase_realtime add table public.rider_shifts;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'shifts'
  ) then
    alter publication supabase_realtime add table public.shifts;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'quality_logs'
  ) then
    alter publication supabase_realtime add table public.quality_logs;
  end if;
end $$;
