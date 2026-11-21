-- =============================================================================
-- HAM DELIVERY & RIDER CASH RECONCILIATION - CLEAN SEED DATA (ALTAMURA - ZERO DEMO ORDERS)
-- =============================================================================

-- Clear existing data
truncate table public.quality_logs, public.orders, public.rider_shifts, public.shifts, public.users cascade;

-- 1. USERS (1 Admin + 4 Riders)
insert into public.users (id, email, full_name, role, rider_number, pin_code, avatar_color, is_active)
values
  ('00000000-0000-0000-0000-000000000001', 'admin@ham-altamura.it', 'Cassa HAM (Admin)', 'admin', null, '0000', '#10b981', true),
  ('00000000-0000-0000-0000-000000000011', 'rider1@ham-altamura.it', 'MarcoGrande', 'rider', 1, '1111', '#3b82f6', true),
  ('00000000-0000-0000-0000-000000000012', 'rider2@ham-altamura.it', 'Lil Marco', 'rider', 2, '2222', '#8b5cf6', true),
  ('00000000-0000-0000-0000-000000000013', 'rider3@ham-altamura.it', 'AntoLor', 'rider', 3, '3333', '#f59e0b', true),
  ('00000000-0000-0000-0000-000000000014', 'rider4@ham-altamura.it', 'Carlo', 'rider', 4, '4444', '#ec4899', true);

-- 2. SHIFT (1 Open Shift today with € 0.00 revenue)
insert into public.shifts (id, date, status, total_revenue, notes, created_at, closed_at)
values
  ('10000000-0000-0000-0000-000000000001', current_date, 'open', 0.00, 'Turno serale attivo', now() - interval '1 hour', null);

-- 3. RIDER SHIFTS FOR ACTIVE SHIFT (all zeroed out, no fake balances)
insert into public.rider_shifts (shift_id, rider_id, initial_float, cash_collected, pos_collected, platform_prepaid, expected_cash_return, actual_cash_returned, discrepancy, is_settled)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', 0.00, 0.00, 0.00, 0.00, 0.00, null, null, false),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000012', 0.00, 0.00, 0.00, 0.00, 0.00, null, null, false),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000013', 0.00, 0.00, 0.00, 0.00, 0.00, null, null, false),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000014', 0.00, 0.00, 0.00, 0.00, 0.00, null, null, false);
