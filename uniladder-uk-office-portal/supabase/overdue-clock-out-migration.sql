-- Apply after retrospective-breaks-migration.sql. Existing clock-out RPC stays unchanged.
begin;
-- Replace clock-out to retain the final running break and attach recorded
-- intervals to the completed payroll entry.
create or replace function public.finish_active_shift_at(p_employee_id uuid, p_ended_at timestamptz, p_expected_start timestamptz)
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
  if v_shift.started_at is distinct from p_expected_start then raise exception 'Active shift changed; refresh and try again'; end if;
  v_end := p_ended_at;
  if v_end is null or v_end > clock_timestamp() then raise exception 'Clock-out must not be in the future'; end if;
  if v_end <= v_shift.started_at or v_end - v_shift.started_at > interval '24 hours' then
    raise exception 'Shift must be longer than zero and no more than 24 hours'; end if;

  -- Keep recorded breaks intact; require a corrected end after completed breaks.
  if exists (select 1 from public.shift_break_records b
    where b.employee_id = p_employee_id and b.shift_started_at = v_shift.started_at
      and b.time_entry_id is null and b.ended_at > v_end) then
    raise exception 'Clock-out cannot precede a completed break; contact your manager to correct break records';
  end if;
  v_break_seconds := v_shift.break_seconds + case when v_shift.break_started_at is not null
    then greatest(0, extract(epoch from (v_end - v_shift.break_started_at))) else 0 end;
  v_work_seconds := extract(epoch from (v_end - v_shift.started_at)) - v_break_seconds;
  if v_work_seconds <= 0 then raise exception 'No worked time recorded'; end if;
  v_hours := round((v_work_seconds / 3600)::numeric, 2);
  if v_hours <= 0 then raise exception 'Worked time is too short to record'; end if;

  insert into public.time_entries(employee_id, date, clock_in, clock_out, hours_worked, break_seconds)
  values(p_employee_id, (v_shift.started_at at time zone 'Europe/London')::date,
    (v_shift.started_at at time zone 'Europe/London')::time(0),
    (v_end at time zone 'Europe/London')::time(0), v_hours, v_break_seconds)
  returning id into v_id;

  if v_shift.break_started_at is not null and v_shift.break_started_at < v_end then
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

revoke all on function public.finish_active_shift_at(uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.finish_active_shift_at(uuid,timestamptz,timestamptz) to authenticated;
notify pgrst, 'reload schema';
commit;
