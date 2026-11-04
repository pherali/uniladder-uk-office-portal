-- Apply AFTER shift-breaks-migration.sql, and BEFORE merging the UI changes.
-- Records precise start/end intervals for newly logged breaks.
create table if not exists public.shift_break_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  shift_started_at timestamptz,
  time_entry_id uuid references public.time_entries(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint valid_break_interval check (ended_at > started_at)
);
create index if not exists shift_break_records_active_idx
  on public.shift_break_records(employee_id, shift_started_at);
create index if not exists shift_break_records_entry_idx
  on public.shift_break_records(time_entry_id);
alter table public.shift_break_records enable row level security;
drop policy if exists "Managers read break records" on public.shift_break_records;
create policy "Managers read break records" on public.shift_break_records
  for select to authenticated using (
    exists(select 1 from public.employees e
    where e.id = employee_id and e.manager_id = (select auth.uid()))
  );
revoke all on public.shift_break_records from anon, authenticated;
grant select on public.shift_break_records to authenticated;

-- Supports forgotten starts while currently on break.
-- Drop the old one-argument signature to avoid Supabase RPC ambiguity.
drop function if exists public.start_shift_break(uuid);
create function public.start_shift_break(
  p_employee_id uuid, p_started_at timestamptz default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_shift public.active_shifts%rowtype;
  v_start timestamptz;
  v_now timestamptz;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.employees e where e.id = p_employee_id
    and e.manager_id = (select auth.uid())
  ) then raise exception 'Employee not found or access denied'; end if;
  select * into v_shift from public.active_shifts
    where employee_id = p_employee_id for update;
  if not found then raise exception 'No active shift found'; end if;
  if v_shift.break_started_at is not null then raise exception 'Already on a break'; end if;
  v_now := clock_timestamp();
  v_start := coalesce(p_started_at, v_now);
  if v_start < v_shift.started_at or v_start > v_now then
    raise exception 'Break start must be within your active shift and not in the future';
  end if;
  if exists (
    select 1 from public.shift_break_records b where b.employee_id = p_employee_id
    and b.shift_started_at = v_shift.started_at
    and b.started_at < v_now and b.ended_at > v_start
  ) then raise exception 'Break overlaps an existing recorded break'; end if;
  update public.active_shifts set break_started_at = v_start
    where employee_id = p_employee_id;
end;
$$;

-- Resume finishes the open break and saves its exact timestamps.
create or replace function public.end_shift_break(p_employee_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_shift public.active_shifts%rowtype;
  v_end timestamptz;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.employees e where e.id = p_employee_id
    and e.manager_id = (select auth.uid())
  ) then raise exception 'Employee not found or access denied'; end if;
  select * into v_shift from public.active_shifts
    where employee_id = p_employee_id for update;
  if not found then raise exception 'No active shift found'; end if;
  if v_shift.break_started_at is null then raise exception 'Shift is not on a break'; end if;
  v_end := clock_timestamp();
  insert into public.shift_break_records(employee_id, shift_started_at, started_at, ended_at)
  values (p_employee_id, v_shift.started_at, v_shift.break_started_at, v_end);
  update public.active_shifts set
    break_seconds = break_seconds + extract(epoch from (v_end - break_started_at)),
    break_started_at = null
  where employee_id = p_employee_id;
end;
$$;

-- Log a break which has already finished, either on an active shift or
-- against an existing completed time entry.
create or replace function public.log_shift_break(
  p_employee_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_time_entry_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_shift public.active_shifts%rowtype;
  v_entry public.time_entries%rowtype;
  v_shift_start timestamptz;
  v_shift_end timestamptz;
  v_seconds numeric;
  v_new_hours numeric(6,2);
  v_id uuid;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.employees e where e.id = p_employee_id
    and e.manager_id = (select auth.uid())
  ) then raise exception 'Employee not found or access denied'; end if;
  if p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at then
    raise exception 'Break end must be after break start'; end if;
  if p_ended_at > clock_timestamp() then raise exception 'Break cannot end in the future'; end if;
  v_seconds := extract(epoch from (p_ended_at - p_started_at));

  if p_time_entry_id is null then
    select * into v_shift from public.active_shifts where employee_id = p_employee_id for update;
    if not found then raise exception 'No active shift found'; end if;
    if p_started_at < v_shift.started_at then raise exception 'Break starts before clock-in'; end if;
    if v_shift.break_started_at is not null then
      raise exception 'Resume the current break before logging a finished break'; end if;
    if exists (
      select 1 from public.shift_break_records b where b.employee_id = p_employee_id
      and b.shift_started_at = v_shift.started_at
      and b.started_at < p_ended_at and b.ended_at > p_started_at
    ) then raise exception 'Break overlaps another recorded break'; end if;
    if v_shift.break_seconds + v_seconds >= extract(epoch from (clock_timestamp() - v_shift.started_at)) then
      raise exception 'Break would leave no worked time'; end if;
    update public.active_shifts set break_seconds = break_seconds + v_seconds
      where employee_id = p_employee_id;
    insert into public.shift_break_records(employee_id, shift_started_at, started_at, ended_at)
      values (p_employee_id, v_shift.started_at, p_started_at, p_ended_at) returning id into v_id;
  else
    select * into v_entry from public.time_entries
      where id = p_time_entry_id and employee_id = p_employee_id for update;
    if not found then raise exception 'Completed shift not found'; end if;
    if v_entry.clock_in is null or v_entry.clock_out is null then
      raise exception 'A completed shift needs clock-in and clock-out times to log a break'; end if;
    v_shift_start := (v_entry.date + v_entry.clock_in) at time zone 'Europe/London';
    v_shift_end := (v_entry.date + v_entry.clock_out) at time zone 'Europe/London';
    if v_shift_end <= v_shift_start then v_shift_end :=
      ((v_entry.date + 1 + v_entry.clock_out) at time zone 'Europe/London'); end if;
    if p_started_at < v_shift_start or p_ended_at > v_shift_end then
      raise exception 'Break must fall entirely within the completed shift'; end if;
    if exists (
      select 1 from public.shift_break_records b where b.time_entry_id = p_time_entry_id
      and b.started_at < p_ended_at and b.ended_at > p_started_at
    ) then raise exception 'Break overlaps another recorded break'; end if;
    v_new_hours := round((v_entry.hours_worked - v_seconds / 3600)::numeric, 2);
    if v_new_hours <= 0 then raise exception 'Break would leave no worked time'; end if;
    update public.time_entries set hours_worked = v_new_hours,
      break_seconds = coalesce(break_seconds, 0) + v_seconds
      where id = p_time_entry_id;
    insert into public.shift_break_records(employee_id, time_entry_id, started_at, ended_at)
      values (p_employee_id, p_time_entry_id, p_started_at, p_ended_at) returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Replace clock-out to retain the final running break and attach recorded
-- intervals to the completed payroll entry.
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
    select 1 from public.employees e where e.id = p_employee_id
    and e.manager_id = (select auth.uid())
  ) then raise exception 'Employee not found or access denied'; end if;
  select * into v_shift from public.active_shifts
    where employee_id = p_employee_id for update;
  if not found then raise exception 'No active shift found'; end if;
  v_end := clock_timestamp();
  if v_end <= v_shift.started_at or v_end - v_shift.started_at > interval '24 hours' then
    raise exception 'Shift must be longer than zero and no more than 24 hours'; end if;

  v_break_seconds := v_shift.break_seconds + case when v_shift.break_started_at is not null
    then extract(epoch from (v_end - v_shift.break_started_at)) else 0 end;
  v_work_seconds := extract(epoch from (v_end - v_shift.started_at)) - v_break_seconds;
  if v_work_seconds <= 0 then raise exception 'No worked time recorded'; end if;
  v_hours := round((v_work_seconds / 3600)::numeric, 2);
  if v_hours <= 0 then raise exception 'Worked time is too short to record'; end if;

  insert into public.time_entries(employee_id, date, clock_in, clock_out, hours_worked, break_seconds)
  values(p_employee_id, (v_shift.started_at at time zone 'Europe/London')::date,
    (v_shift.started_at at time zone 'Europe/London')::time(0),
    (v_end at time zone 'Europe/London')::time(0), v_hours, v_break_seconds)
  returning id into v_id;

  if v_shift.break_started_at is not null then
    insert into public.shift_break_records(employee_id, shift_started_at, time_entry_id, started_at, ended_at)
    values(p_employee_id, v_shift.started_at, v_id, v_shift.break_started_at, v_end);
  end if;

  update public.shift_break_records set time_entry_id = v_id
  where employee_id = p_employee_id and shift_started_at = v_shift.started_at
    and time_entry_id is null;
  delete from public.active_shifts where employee_id = p_employee_id;
  return v_id;
end;
$$;

revoke all on function public.start_shift_break(uuid,timestamptz),
  public.end_shift_break(uuid), public.log_shift_break(uuid,timestamptz,timestamptz,uuid),
  public.finish_active_shift(uuid) from public;
grant execute on function public.start_shift_break(uuid,timestamptz),
  public.end_shift_break(uuid), public.log_shift_break(uuid,timestamptz,timestamptz,uuid),
  public.finish_active_shift(uuid) to authenticated;
notify pgrst, 'reload schema';
