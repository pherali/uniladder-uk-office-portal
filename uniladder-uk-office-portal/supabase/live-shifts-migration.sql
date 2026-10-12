-- Run once in Supabase SQL Editor before deploying the new UI.
-- Active shifts are separate from completed payroll entries.
create table if not exists public.active_shifts (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  started_at timestamptz not null default now()
);
alter table public.active_shifts enable row level security;
grant select, insert, delete on public.active_shifts to authenticated;
drop policy if exists "Managers read active shifts" on public.active_shifts;
create policy "Managers read active shifts" on public.active_shifts for select to authenticated
using (exists (select 1 from public.employees e where e.id = employee_id and e.manager_id = (select auth.uid())));
drop policy if exists "Managers start active shifts" on public.active_shifts;
create policy "Managers start active shifts" on public.active_shifts for insert to authenticated
with check (exists (select 1 from public.employees e where e.id = employee_id and e.manager_id = (select auth.uid())));
drop policy if exists "Managers finish active shifts" on public.active_shifts;
create policy "Managers finish active shifts" on public.active_shifts for delete to authenticated
using (exists (select 1 from public.employees e where e.id = employee_id and e.manager_id = (select auth.uid())));

-- Atomic conversion: lock the active shift, insert the completed shift,
-- then delete the active row in the same transaction.
create or replace function public.finish_active_shift(p_employee_id uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_start timestamptz;
  v_end timestamptz := clock_timestamp();
  v_hours numeric(6,2);
  v_id uuid;
begin
  select started_at into v_start from public.active_shifts
    where employee_id = p_employee_id for update;
  if not found then raise exception 'No active shift found'; end if;
  if v_end <= v_start or v_end - v_start > interval '24 hours' then
    raise exception 'Shift must be longer than zero and no more than 24 hours; edit the record manually if needed';
  end if;
  v_hours := round((extract(epoch from (v_end - v_start)) / 3600)::numeric, 2);
  if v_hours <= 0 then raise exception 'Shift is too short to record (minimum 0.01 hours)'; end if;
  insert into public.time_entries(employee_id, date, clock_in, clock_out, hours_worked)
  values (p_employee_id, (v_start at time zone 'Europe/London')::date,
    (v_start at time zone 'Europe/London')::time(0),
    (v_end at time zone 'Europe/London')::time(0), v_hours)
  returning id into v_id;
  delete from public.active_shifts where employee_id = p_employee_id;
  return v_id;
end;
$$;
revoke all on function public.finish_active_shift(uuid) from public;
grant execute on function public.finish_active_shift(uuid) to authenticated;
