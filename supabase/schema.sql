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

-- Private profile details and owner-only avatar storage.
alter table public.profiles
  add column if not exists bio text not null default '' check (char_length(bio) <= 160),
  add column if not exists avatar_url text;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('avatars','avatars',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy avatars_insert_own on storage.objects for insert to authenticated
with check (bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy avatars_select_own on storage.objects for select to authenticated
using (bucket_id='avatars' and owner_id=(select auth.uid())::text);
create policy avatars_update_own on storage.objects for update to authenticated
using (bucket_id='avatars' and owner_id=(select auth.uid())::text)
with check (bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy avatars_delete_own on storage.objects for delete to authenticated
using (bucket_id='avatars' and owner_id=(select auth.uid())::text);

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
  venue_name text not null default '',
  budget_per_person smallint check (budget_per_person is null or budget_per_person between 0 and 100000),
  plan_note text not null default '' check (char_length(plan_note) <= 240),
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

-- One durable request per member and activity. Members see their own request;
-- hosts can review only requests for plans they created.
create table public.plan_requests (
  plan_id uuid not null references public.plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(plan_id,user_id)
);
create index plan_requests_user_id_idx on public.plan_requests(user_id);
alter table public.plan_requests enable row level security;
create policy plan_requests_read_self_or_host on public.plan_requests for select to authenticated
using ((select auth.uid())=user_id or exists(select 1 from public.plans p where p.id=plan_id and p.creator_id=(select auth.uid())));
create policy plan_requests_create_self on public.plan_requests for insert to authenticated
with check ((select auth.uid())=user_id and status='pending' and exists(
  select 1 from public.plans p where p.id=plan_id and p.creator_id<>(select auth.uid())
  and (not p.trusted_only or exists(
    select 1 from public.trust_assertions t where t.user_id=(select auth.uid())
    and t.adult_verified and t.face_verified and t.attended_plans>=3
    and (t.restricted_until is null or t.restricted_until<now())
  ))
));
create policy plan_requests_host_decision on public.plan_requests for update to authenticated
using (exists(select 1 from public.plans p where p.id=plan_id and p.creator_id=(select auth.uid())))
with check (exists(select 1 from public.plans p where p.id=plan_id and p.creator_id=(select auth.uid())));
grant select,insert,update on public.plan_requests to authenticated;
alter publication supabase_realtime add table public.plan_requests;

-- Private in-app alerts created by database events, never by an untrusted client.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('plan_request','plan_approved','plan_rejected')),
  title text not null check (char_length(title) between 1 and 80),
  body text not null check (char_length(body) between 1 and 180),
  plan_id uuid references public.plans(id) on delete cascade,
  read_at timestamptz, created_at timestamptz not null default now()
);
create index notifications_recipient_created_idx on public.notifications(recipient_id,created_at desc);
create index notifications_plan_id_idx on public.notifications(plan_id);
alter table public.notifications enable row level security;
create policy notifications_read_self on public.notifications for select to authenticated
using((select auth.uid())=recipient_id);
create policy notifications_update_self on public.notifications for update to authenticated
using((select auth.uid())=recipient_id) with check((select auth.uid())=recipient_id);
grant select,update on public.notifications to authenticated;
revoke insert,delete on public.notifications from anon,authenticated;
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create function private.notify_plan_request() returns trigger language plpgsql security definer
set search_path='' as $$
declare plan_row public.plans%rowtype;
begin
  select * into plan_row from public.plans where id=new.plan_id;
  if tg_op='INSERT' then
    insert into public.notifications(recipient_id,kind,title,body,plan_id)
    values(plan_row.creator_id,'plan_request','New activity request','Someone asked to join '||plan_row.title||'.',new.plan_id);
  elsif old.status is distinct from new.status and new.status in ('approved','rejected') then
    insert into public.notifications(recipient_id,kind,title,body,plan_id)
    values(new.user_id,case when new.status='approved' then 'plan_approved' else 'plan_rejected' end,
      case when new.status='approved' then 'You are approved' else 'Request update' end,
      case when new.status='approved' then 'Your request for '||plan_row.title||' was approved.' else 'Your request for '||plan_row.title||' was not approved this time.' end,new.plan_id);
  end if;
  return new;
end; $$;
revoke all on function private.notify_plan_request() from public,anon,authenticated;
create trigger plan_request_notifications after insert or update of status on public.plan_requests
for each row execute function private.notify_plan_request();
alter publication supabase_realtime add table public.notifications;

-- Account identity: username is public; age/gender and login email remain private.
create extension if not exists citext;
alter extension citext set schema extensions;
alter table public.profiles add column username citext;
create unique index profiles_username_unique_idx on public.profiles(username) where username is not null;
create table public.account_details (
  user_id uuid primary key references auth.users(id) on delete cascade,
  gender text not null check(gender in ('woman','man','non_binary','prefer_not_to_say')),
  declared_age smallint not null check(declared_age between 18 and 100),
  phone_e164 text, phone_verified_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.login_handles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username citext not null unique check(username ~ '^[a-zA-Z][a-zA-Z0-9_]{2,19}$'),
  email citext not null
);
alter table public.account_details enable row level security;
alter table public.login_handles enable row level security;
create policy account_details_read_self on public.account_details for select to authenticated
using((select auth.uid())=user_id);
create policy account_details_update_self on public.account_details for update to authenticated
using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
grant select,update on public.account_details to authenticated;
revoke all on public.login_handles from anon,authenticated;
create policy login_handles_deny_clients on public.login_handles for all to anon,authenticated
using(false) with check(false);
grant select on public.login_handles to service_role;
create schema nook_private;
revoke all on schema nook_private from public,anon,authenticated;
create function nook_private.create_account_records() returns trigger language plpgsql security definer
set search_path='' as $$
declare new_username text:=new.raw_user_meta_data->>'username';
new_gender text:=coalesce(new.raw_user_meta_data->>'gender','prefer_not_to_say');
new_age smallint:=(new.raw_user_meta_data->>'declared_age')::smallint;
begin
  if new_username is null or new_age is null then raise exception 'username and age are required'; end if;
  insert into public.login_handles values(new.id,new_username,new.email);
  insert into public.profiles(id,display_name,username,city,area)
    values(new.id,new_username,new_username,'Not set','Not set');
  insert into public.account_details(user_id,gender,declared_age) values(new.id,new_gender,new_age);
  insert into public.trust_assertions(user_id) values(new.id) on conflict do nothing;
  insert into public.user_roles(user_id,role) values(new.id,'member') on conflict do nothing;
  return new;
end; $$;
revoke all on function nook_private.create_account_records() from public,anon,authenticated;
create trigger nook_create_account_records after insert on auth.users
for each row execute function nook_private.create_account_records();

-- V1.1: private member blocking and moderator-only safety case workflow.
create table public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id), check (blocker_id <> blocked_id)
);
create index user_blocks_blocked_idx on public.user_blocks(blocked_id);
alter table public.user_blocks enable row level security;
create policy blocks_read_self on public.user_blocks for select to authenticated using ((select auth.uid())=blocker_id);
create policy blocks_create_self on public.user_blocks for insert to authenticated with check ((select auth.uid())=blocker_id);
create policy blocks_delete_self on public.user_blocks for delete to authenticated using ((select auth.uid())=blocker_id);
grant select,insert,delete on public.user_blocks to authenticated;

create table public.moderation_cases (
  id uuid primary key default gen_random_uuid(), reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('user','plan','group')),
  target_user_id uuid references auth.users(id) on delete set null,
  target_plan_id uuid references public.plans(id) on delete set null,
  target_group_id uuid references public.groups(id) on delete set null,
  reason text not null check (char_length(reason) between 10 and 500),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open','under_review','resolved','dismissed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  resolved_at timestamptz, resolved_by uuid references auth.users(id) on delete set null,
  check ((target_type='user' and target_user_id is not null and target_plan_id is null and target_group_id is null) or (target_type='plan' and target_plan_id is not null and target_user_id is null and target_group_id is null) or (target_type='group' and target_group_id is not null and target_user_id is null and target_plan_id is null))
);
create index moderation_cases_status_created_idx on public.moderation_cases(status,created_at desc);
create index moderation_cases_target_user_idx on public.moderation_cases(target_user_id);
create index moderation_cases_target_plan_idx on public.moderation_cases(target_plan_id);
create index moderation_cases_target_group_idx on public.moderation_cases(target_group_id);
create index moderation_cases_resolved_by_idx on public.moderation_cases(resolved_by);
alter table public.moderation_cases enable row level security;
create policy cases_create_self on public.moderation_cases for insert to authenticated with check ((select auth.uid())=reporter_id and status='open' and resolved_at is null and resolved_by is null);
create policy cases_read_self_or_moderator on public.moderation_cases for select to authenticated using ((select auth.uid())=reporter_id or exists(select 1 from public.user_roles r where r.user_id=(select auth.uid()) and r.role='moderator'));
create policy cases_update_moderator on public.moderation_cases for update to authenticated using (exists(select 1 from public.user_roles r where r.user_id=(select auth.uid()) and r.role='moderator')) with check (exists(select 1 from public.user_roles r where r.user_id=(select auth.uid()) and r.role='moderator'));
grant select,insert,update on public.moderation_cases to authenticated;

create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(), case_id uuid not null references public.moderation_cases(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null, action text not null check (char_length(action) between 3 and 100),
  note text not null default '' check (char_length(note) <= 500), created_at timestamptz not null default now()
);
create index moderation_actions_case_created_idx on public.moderation_actions(case_id,created_at);
create index moderation_actions_actor_idx on public.moderation_actions(actor_id);
alter table public.moderation_actions enable row level security;
create policy actions_read_moderator on public.moderation_actions for select to authenticated using (exists(select 1 from public.user_roles r where r.user_id=(select auth.uid()) and r.role='moderator'));
create policy actions_create_moderator on public.moderation_actions for insert to authenticated with check (exists(select 1 from public.user_roles r where r.user_id=(select auth.uid()) and r.role='moderator') and (select auth.uid())=actor_id);
grant select,insert on public.moderation_actions to authenticated;

create policy plan_requests_not_blocked on public.plan_requests as restrictive for insert to authenticated with check (not exists (select 1 from public.plans p join public.user_blocks b on b.blocked_id=p.creator_id where p.id=plan_id and b.blocker_id=(select auth.uid())));
create policy memberships_not_blocked on public.memberships as restrictive for insert to authenticated with check (not exists (select 1 from public.groups g join public.user_blocks b on b.blocked_id=g.host_id where g.id=group_id and b.blocker_id=(select auth.uid())));
create policy connections_not_blocked on public.connections as restrictive for insert to authenticated with check (not exists (select 1 from public.user_blocks b where b.blocker_id=(select auth.uid()) and b.blocked_id=addressee_id));
create policy moderation_cases_rate_limit on public.moderation_cases as restrictive for insert to authenticated with check ((select count(*) from public.moderation_cases c where c.reporter_id=(select auth.uid()) and c.created_at > now() - interval '24 hours') < 5);
create policy plan_requests_rate_limit on public.plan_requests as restrictive for insert to authenticated with check ((select count(*) from public.plan_requests r where r.user_id=(select auth.uid()) and r.created_at > now() - interval '24 hours') < 12);
create policy memberships_rate_limit on public.memberships as restrictive for insert to authenticated with check ((select count(*) from public.memberships m where m.user_id=(select auth.uid()) and m.created_at > now() - interval '24 hours') < 12);
create policy blocks_rate_limit on public.user_blocks as restrictive for insert to authenticated with check ((select count(*) from public.user_blocks b where b.blocker_id=(select auth.uid()) and b.created_at > now() - interval '24 hours') < 30);
