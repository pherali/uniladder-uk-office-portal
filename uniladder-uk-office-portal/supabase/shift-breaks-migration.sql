-- Run this once in Supabase SQL Editor BEFORE merging the break UI.
-- Breaks are unpaid; the full shift remains open while paused.
alter table public.active_shifts
  add column if not exists break_started_at timestamptz,
  add column if not exists break_seconds numeric not null default 0;
alter table public.time_entries
  add column if not exists break_seconds numeric not null default 0;

-- Server-side transitions avoid race conditions or user-clock manipulation.
create or replace function public.start_shift_break(p_employee_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_shift public.active_shifts%rowtype;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.manager_id = (select auth.uid())
  ) then raise exception 'Employee not found or access denied'; end if;

  select * into v_shift from public.active_shifts
    where employee_id = p_employee_id for update;
  if not found then raise exception 'No active shift found'; end if;
  if v_shift.break_started_at is not null then raise exception 'Already on a break'; end if;

  update public.active_shifts set break_started_at = clock_timestamp()
    where employee_id = p_employee_id;
end;
$$;

create or replace function public.end_shift_break(p_employee_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_shift public.active_shifts%rowtype;
declare v_end timestamptz;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.manager_id = (select auth.uid())
  ) then raise exception 'Employee not found or access denied'; end if;

  select * into v_shift from public.active_shifts
    where employee_id = p_employee_id for update;
  if not found then raise exception 'No active shift found'; end if;
  if v_shift.break_started_at is null then raise exception 'Shift is not on a break'; end if;
  v_end := clock_timestamp();

  update public.active_shifts
  set break_seconds = break_seconds + extract(epoch from (v_end - break_started_at)),
      break_started_at = null
  where employee_id = p_employee_id;
end;
$$;

-- Clock-out deducts completed breaks plus an in-progress break (if any).
create or replace function public.finish_active_shift(p_employee_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_shift public.active_shifts%rowtype;
  v_end timestamptz;
  v_break_seconds numeric;
  v_work_seconds numeric;
  v_hours numeric(6,2);
  v_id uuid;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.manager_id = (select auth.uid())
  ) then raise exception 'Employee not found or access denied'; end if;

  select * into v_shift from public.active_shifts
    where employee_id = p_employee_id for update;
  if not found then raise exception 'No active shift found'; end if;

  v_end := clock_timestamp();
  if v_end <= v_shift.started_at or v_end - v_shift.started_at > interval '24 hours' then
    raise exception 'Shift must be longer than zero and no more than 24 hours';
  end if;

  v_break_seconds := v_shift.break_seconds + case
    when v_shift.break_started_at is not null then extract(epoch from (v_end - v_shift.break_started_at))
    else 0 end;
  v_work_seconds := extract(epoch from (v_end - v_shift.started_at)) - v_break_seconds;
  if v_work_seconds <= 0 then raise exception 'No worked time recorded'; end if;

  v_hours := round((v_work_seconds / 3600)::numeric, 2);
  if v_hours <= 0 then
    raise exception 'Worked time is too short to record (minimum 0.01 hours)';
  end if;

  insert into public.time_entries(employee_id, date, clock_in, clock_out, hours_worked, break_seconds)
  values (p_employee_id,
    (v_shift.started_at at time zone 'Europe/London')::date,
    (v_shift.started_at at time zone 'Europe/London')::time(0),
    (v_end at time zone 'Europe/London')::time(0), v_hours, v_break_seconds)
  returning id into v_id;

  delete from public.active_shifts where employee_id = p_employee_id;
  return v_id;
end;
$$;

revoke all on function public.start_shift_break(uuid), public.end_shift_break(uuid), public.finish_active_shift(uuid) from public;
grant execute on function public.start_shift_break(uuid), public.end_shift_break(uuid), public.finish_active_shift(uuid) to authenticated;
