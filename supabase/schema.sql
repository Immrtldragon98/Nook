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

create index groups_host_id_idx on public.groups(host_id);
create index memberships_user_id_idx on public.memberships(user_id);
create index reports_group_id_idx on public.reports(group_id);
create index reports_reporter_id_idx on public.reports(reporter_id);
create index safety_ratings_user_id_idx on public.safety_ratings(user_id);

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
create policy trust_insert_unverified_self on public.trust_assertions for insert to authenticated with check ((select auth.uid())=user_id and not adult_verified and not woman_verified and not face_verified and attended_plans=0 and restricted_until is null);
create policy roles_read_self on public.user_roles for select to authenticated using ((select auth.uid())=user_id);
create policy roles_insert_member_self on public.user_roles for insert to authenticated with check ((select auth.uid())=user_id and role='member');
create policy groups_read on public.groups for select to authenticated using (true);
create policy groups_create on public.groups for insert to authenticated with check ((select auth.uid())=host_id);
create policy groups_update_host on public.groups for update to authenticated using ((select auth.uid())=host_id) with check ((select auth.uid())=host_id);
create policy memberships_read_self_or_host on public.memberships for select to authenticated using ((select auth.uid())=user_id or exists(select 1 from public.groups g where g.id=group_id and g.host_id=(select auth.uid())));
create policy memberships_request_self on public.memberships for insert to authenticated with check (
  (select auth.uid())=user_id and status='pending'
  and exists (
    select 1 from public.groups g where g.id=group_id
    and (not g.women_only or exists (select 1 from public.trust_assertions t where t.user_id=(select auth.uid()) and t.woman_verified and t.face_verified and (t.restricted_until is null or t.restricted_until<now())))
    and (not g.trusted_only or exists (select 1 from public.trust_assertions t where t.user_id=(select auth.uid()) and t.adult_verified and t.face_verified and t.attended_plans>=3 and (t.restricted_until is null or t.restricted_until<now())))
  )
);
create policy memberships_host_decision on public.memberships for update to authenticated using (exists(select 1 from public.groups g where g.id=group_id and g.host_id=(select auth.uid()))) with check (exists(select 1 from public.groups g where g.id=group_id and g.host_id=(select auth.uid())));
create policy ratings_read on public.safety_ratings for select to authenticated using (true);
create policy ratings_verified_women on public.safety_ratings for insert to authenticated with check ((select auth.uid())=user_id and exists(select 1 from public.trust_assertions t where t.user_id=(select auth.uid()) and t.woman_verified and t.face_verified and (t.restricted_until is null or t.restricted_until<now())) and exists(select 1 from public.memberships m where m.group_id=safety_ratings.group_id and m.user_id=(select auth.uid()) and m.status='approved'));
create policy reports_create_self on public.reports for insert to authenticated with check ((select auth.uid())=reporter_id);
create policy reports_read_self_or_moderator on public.reports for select to authenticated using ((select auth.uid())=reporter_id or exists(select 1 from public.user_roles r where r.user_id=(select auth.uid()) and r.role='moderator'));
create policy moderation_read_host_or_moderator on public.group_moderation for select to authenticated using (exists(select 1 from public.groups g where g.id=group_id and g.host_id=(select auth.uid())) or exists(select 1 from public.user_roles r where r.user_id=(select auth.uid()) and r.role='moderator'));
create policy moderation_update_moderator on public.group_moderation for update to authenticated using (exists(select 1 from public.user_roles r where r.user_id=(select auth.uid()) and r.role='moderator')) with check (exists(select 1 from public.user_roles r where r.user_id=(select auth.uid()) and r.role='moderator'));

grant select,insert,update on public.profiles to authenticated;
grant select,insert on public.trust_assertions,public.user_roles to authenticated;
grant select,insert,update on public.groups,public.memberships to authenticated;
grant select,insert on public.safety_ratings,public.reports to authenticated;
grant select,update on public.group_moderation to authenticated;

alter publication supabase_realtime add table public.groups, public.memberships;

-- Cloud plans and privacy-preserving, short-lived in-person connection QR codes.
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(title) between 3 and 80),
  category text not null, city text not null, area text not null,
  starts_at text not null check (char_length(starts_at) between 3 and 80),
  language text not null,
  spots smallint not null check (spots between 2 and 12),
  trusted_only boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.connection_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null check (expires_at <= created_at + interval '10 minutes'),
  created_at timestamptz not null default now()
);
create table public.connections (
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  token_id uuid not null references public.connection_qr_tokens(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','accepted','blocked')),
  created_at timestamptz not null default now(),
  primary key(requester_id,addressee_id), check(requester_id<>addressee_id)
);
create index plans_city_created_at_idx on public.plans(city,created_at desc);
create index plans_creator_id_idx on public.plans(creator_id);
create index connection_qr_tokens_owner_id_idx on public.connection_qr_tokens(owner_id);
create index connection_qr_tokens_expires_at_idx on public.connection_qr_tokens(expires_at);
create index connections_addressee_id_idx on public.connections(addressee_id);
create index connections_token_id_idx on public.connections(token_id);
alter table public.plans enable row level security;
alter table public.connection_qr_tokens enable row level security;
alter table public.connections enable row level security;
create policy plans_read_city on public.plans for select to authenticated using(true);
create policy plans_create_self on public.plans for insert to authenticated with check(
  (select auth.uid())=creator_id and (not trusted_only or exists(
    select 1 from public.trust_assertions t where t.user_id=(select auth.uid())
    and t.adult_verified and t.face_verified and t.attended_plans>=3
    and (t.restricted_until is null or t.restricted_until<now())
  ))
);
create policy plans_update_self on public.plans for update to authenticated
using((select auth.uid())=creator_id) with check((select auth.uid())=creator_id);
create policy qr_tokens_insert_self on public.connection_qr_tokens for insert to authenticated
with check((select auth.uid())=owner_id and expires_at>now());
create policy qr_tokens_read_self on public.connection_qr_tokens for select to authenticated
using((select auth.uid())=owner_id);
create policy connections_read_participant on public.connections for select to authenticated
using((select auth.uid()) in (requester_id,addressee_id));
create policy connections_request_with_live_token on public.connections for insert to authenticated
with check((select auth.uid())=requester_id and exists(
  select 1 from public.connection_qr_tokens q where q.id=token_id
  and q.owner_id=addressee_id and q.expires_at>now()
));
create policy connections_reply_addressee on public.connections for update to authenticated
using((select auth.uid())=addressee_id) with check((select auth.uid())=addressee_id);
grant select,insert,update on public.plans to authenticated;
grant select,insert on public.connection_qr_tokens to authenticated;
grant select,insert,update on public.connections to authenticated;
alter publication supabase_realtime add table public.plans;
