-- Uniladder UK Office Portal — Supabase schema
-- Run this entire file in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.manager_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (char_length(username) between 2 and 50),
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  hourly_wage numeric(10, 2) not null check (hourly_wage >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  hours_worked numeric(6, 2) not null check (hours_worked > 0 and hours_worked <= 24),
  created_at timestamptz not null default now()
);

create index if not exists employees_manager_id_idx on public.employees(manager_id);
create index if not exists time_entries_employee_date_idx on public.time_entries(employee_id, date desc);

-- Create a public profile row from safe signup metadata.
create or replace function public.handle_new_manager()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.manager_profiles (id, username)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'username'), ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_manager();

alter table public.manager_profiles enable row level security;
alter table public.employees enable row level security;
alter table public.time_entries enable row level security;

-- Profiles: managers can only read/update their own profile.
drop policy if exists "Managers read own profile" on public.manager_profiles;
create policy "Managers read own profile"
on public.manager_profiles for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Managers update own profile" on public.manager_profiles;
create policy "Managers update own profile"
on public.manager_profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- Employees: all CRUD is restricted to the authenticated manager's own rows.
drop policy if exists "Managers read own employees" on public.employees;
create policy "Managers read own employees"
on public.employees for select
to authenticated
using ((select auth.uid()) = manager_id);

drop policy if exists "Managers insert own employees" on public.employees;
create policy "Managers insert own employees"
on public.employees for insert
to authenticated
with check ((select auth.uid()) = manager_id);

drop policy if exists "Managers update own employees" on public.employees;
create policy "Managers update own employees"
on public.employees for update
to authenticated
using ((select auth.uid()) = manager_id)
with check ((select auth.uid()) = manager_id);

drop policy if exists "Managers delete own employees" on public.employees;
create policy "Managers delete own employees"
on public.employees for delete
to authenticated
using ((select auth.uid()) = manager_id);

-- Time entries inherit ownership through their employee.
drop policy if exists "Managers read own time entries" on public.time_entries;
create policy "Managers read own time entries"
on public.time_entries for select
to authenticated
using (exists (
  select 1 from public.employees
  where employees.id = time_entries.employee_id
    and employees.manager_id = (select auth.uid())
));

drop policy if exists "Managers insert own time entries" on public.time_entries;
create policy "Managers insert own time entries"
on public.time_entries for insert
to authenticated
with check (exists (
  select 1 from public.employees
  where employees.id = time_entries.employee_id
    and employees.manager_id = (select auth.uid())
));

drop policy if exists "Managers update own time entries" on public.time_entries;
create policy "Managers update own time entries"
on public.time_entries for update
to authenticated
using (exists (
  select 1 from public.employees
  where employees.id = time_entries.employee_id
    and employees.manager_id = (select auth.uid())
))
with check (exists (
  select 1 from public.employees
  where employees.id = time_entries.employee_id
    and employees.manager_id = (select auth.uid())
));

drop policy if exists "Managers delete own time entries" on public.time_entries;
create policy "Managers delete own time entries"
on public.time_entries for delete
to authenticated
using (exists (
  select 1 from public.employees
  where employees.id = time_entries.employee_id
    and employees.manager_id = (select auth.uid())
));

-- Keep anonymous users out and grant normal app access to authenticated users.
revoke all on public.manager_profiles, public.employees, public.time_entries from anon;
grant select, update on public.manager_profiles to authenticated;
grant select, insert, update, delete on public.employees, public.time_entries to authenticated;
grant all on public.manager_profiles, public.employees, public.time_entries to service_role;
