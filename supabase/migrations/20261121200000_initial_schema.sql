create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  updated_at timestamptz default now()
);

insert into public.profiles (id, display_name, avatar_url)
select
  id,
  coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'user_name', 'Driver'),
  coalesce(raw_user_meta_data->>'avatar_url', '')
from auth.users
on conflict (id) do nothing;

create table if not exists public.predictions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_key bigint not null,
  predicted_lap_seconds numeric(8,3) not null,
  actual_lap_seconds numeric(8,3),
  score integer,
  created_at timestamptz default now(),
  unique(user_id, session_key)
);

alter table public.profiles enable row level security;
alter table public.predictions enable row level security;

create policy "Profiles are public"
  on public.profiles for select using (true);

create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

create policy "Predictions are public"
  on public.predictions for select using (true);

create policy "Users can insert own predictions"
  on public.predictions for insert with check (auth.uid() = user_id);

create policy "Users can update own predictions"
  on public.predictions for update using (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'user_name', 'Driver'),
    coalesce(new.raw_user_meta_data->>'avatar_url', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
