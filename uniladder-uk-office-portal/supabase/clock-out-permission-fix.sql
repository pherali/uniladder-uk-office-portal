-- Run in Supabase SQL Editor after live-shifts-migration.sql.
-- The original SECURITY INVOKER function cannot SELECT ... FOR UPDATE
-- without UPDATE privileges on active_shifts. Use a SECURITY DEFINER
-- function with explicit ownership checks instead.
create or replace function public.finish_active_shift(p_employee_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_hours numeric(6,2);
  v_id uuid;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.manager_id = (select auth.uid())
  ) then
    raise exception 'Employee not found or access denied';
  end if;

  select a.started_at into v_start
  from public.active_shifts a
  where a.employee_id = p_employee_id
  for update;

  if not found then raise exception 'No active shift found'; end if;
  v_end := clock_timestamp();
  if v_end <= v_start or v_end - v_start > interval '24 hours' then
    raise exception 'Shift must be longer than zero and no more than 24 hours';
  end if;

  v_hours := round((extract(epoch from (v_end - v_start)) / 3600)::numeric, 2);
  if v_hours <= 0 then
    raise exception 'Shift is too short to record (minimum 0.01 hours)';
  end if;

  insert into public.time_entries(employee_id, date, clock_in, clock_out, hours_worked)
  values (
    p_employee_id,
    (v_start at time zone 'Europe/London')::date,
    (v_start at time zone 'Europe/London')::time(0),
    (v_end at time zone 'Europe/London')::time(0),
    v_hours
  )
  returning id into v_id;

  delete from public.active_shifts where employee_id = p_employee_id;
  return v_id;
end;
$$;

revoke all on function public.finish_active_shift(uuid) from public;
grant execute on function public.finish_active_shift(uuid) to authenticated;
