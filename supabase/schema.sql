-- Nook cloud schema v1. Apply to a dedicated Nook project, then run Security Advisor.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  city text not null,
  area text not null,
  languages text[] not null default '{}',
  interests text[] not null default '{}',
  created_at timestamptz not null default now()
);
create table public.trust_assertions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  adult_verified boolean not null default false,
  woman_verified boolean not null default false,
  face_verified boolean not null default false,
  attended_plans integer not null default 0 check (attended_plans >= 0),
  restricted_until timestamptz,
  updated_at timestamptz not null default now()
);
create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('member','moderator')) default 'member'
);
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(title) between 3 and 60),
  category text not null,
  city text not null,
  area text not null,
  language text not null,
  description text not null default '',
  women_only boolean not null default false,
  trusted_only boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.memberships (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected','removed','blocked')),
  created_at timestamptz not null default now(),
  primary key(group_id,user_id)
);
create table public.safety_ratings (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  primary key(group_id,user_id)
);
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 10 and 500),
  status text not null default 'open' check (status in ('open','investigating','resolved','dismissed')),
  created_at timestamptz not null default now()
);
create table public.group_moderation (
  group_id uuid primary key references public.groups(id) on delete cascade,
  status text not null default 'clear' check (status in ('clear','under_review','restricted')),
  restricted_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.trust_assertions enable row level security;
alter table public.user_roles enable row level security;
alter table public.groups enable row level security;
alter table public.memberships enable row level security;
alter table public.safety_ratings enable row level security;
alter table public.reports enable row level security;
alter table public.group_moderation enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_insert_self on public.profiles for insert to authenticated with check ((select auth.uid())=id);
create policy profiles_update_self on public.profiles for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);
create policy trust_read_self on public.trust_assertions for select to authenticated using ((select auth.uid())=user_id);
create policy roles_read_self on public.user_roles for select to authenticated using ((select auth.uid())=user_id);
create policy groups_read on public.groups for select to authenticated using (true);
create policy groups_create on public.groups for insert to authenticated with check ((select auth.uid())=host_id);
create policy groups_update_host on public.groups for update to authenticated using ((select auth.uid())=host_id) with check ((select auth.uid())=host_id);
create policy memberships_read_self_or_host on public.memberships for select to authenticated using ((select auth.uid())=user_id or exists(select 1 from public.groups g where g.id=group_id and g.host_id=(select auth.uid())));
create policy memberships_request_self on public.memberships for insert to authenticated with check ((select auth.uid())=user_id and status='pending');
create policy memberships_host_decision on public.memberships for update to authenticated using (exists(select 1 from public.groups g where g.id=group_id and g.host_id=(select auth.uid()))) with check (exists(select 1 from public.groups g where g.id=group_id and g.host_id=(select auth.uid())));
create policy ratings_read on public.safety_ratings for select to authenticated using (true);
create policy ratings_verified_women on public.safety_ratings for insert to authenticated with check ((select auth.uid())=user_id and exists(select 1 from public.trust_assertions t where t.user_id=(select auth.uid()) and t.woman_verified and t.face_verified and (t.restricted_until is null or t.restricted_until<now())) and exists(select 1 from public.memberships m where m.group_id=safety_ratings.group_id and m.user_id=(select auth.uid()) and m.status='approved'));
create policy reports_create_self on public.reports for insert to authenticated with check ((select auth.uid())=reporter_id);
create policy reports_read_self_or_moderator on public.reports for select to authenticated using ((select auth.uid())=reporter_id or exists(select 1 from public.user_roles r where r.user_id=(select auth.uid()) and r.role='moderator'));
create policy moderation_read_host_or_moderator on public.group_moderation for select to authenticated using (exists(select 1 from public.groups g where g.id=group_id and g.host_id=(select auth.uid())) or exists(select 1 from public.user_roles r where r.user_id=(select auth.uid()) and r.role='moderator'));
create policy moderation_update_moderator on public.group_moderation for update to authenticated using (exists(select 1 from public.user_roles r where r.user_id=(select auth.uid()) and r.role='moderator')) with check (exists(select 1 from public.user_roles r where r.user_id=(select auth.uid()) and r.role='moderator'));

grant select,insert,update on public.profiles to authenticated;
grant select on public.trust_assertions,public.user_roles to authenticated;
grant select,insert,update on public.groups,public.memberships to authenticated;
grant select,insert on public.safety_ratings,public.reports to authenticated;
grant select,update on public.group_moderation to authenticated;
