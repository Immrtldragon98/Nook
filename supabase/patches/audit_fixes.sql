-- Apply once after schema.sql on an existing Nook database. Fresh installs
-- already include this patch at the end of schema.sql. Transactional and rerunnable.
begin;
alter table public.plans alter column budget_per_person type integer;

-- Deleted targets become tombstones: retain the moderation evidence without
-- preventing deletion of the target account/content.
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.moderation_cases'::regclass
    and contype='c' and pg_get_constraintdef(oid) like '%target_type%target_user_id%' loop
    execute format('alter table public.moderation_cases drop constraint %I',c.conname);
  end loop;
end $$;
alter table public.moderation_cases add constraint moderation_target_shape check (
  (target_type='user' and target_plan_id is null and target_group_id is null) or
  (target_type='plan' and target_user_id is null and target_group_id is null) or
  (target_type='group' and target_user_id is null and target_plan_id is null)
);
create or replace function private.require_report_target() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.target_type='user' and new.target_user_id is null) or
     (new.target_type='plan' and new.target_plan_id is null) or
     (new.target_type='group' and new.target_group_id is null) then
    raise exception 'A report must identify an existing target';
  end if;
  return new;
end $$;
drop trigger if exists require_report_target on public.moderation_cases;
create trigger require_report_target before insert on public.moderation_cases for each row execute function private.require_report_target();
alter table public.connections drop constraint if exists connections_token_id_fkey;
alter table public.connections add constraint connections_token_id_fkey foreign key(token_id) references public.connection_qr_tokens(id) on delete cascade;

-- Internal helpers deliberately bypass RLS for narrow, authenticated lookups.
-- No raw block lists, trust assertions or QR rows are exposed to another user.
create or replace function private.blocked_with(other_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is null or exists(select 1 from public.user_blocks b where
    (b.blocker_id=auth.uid() and b.blocked_id=other_id) or
    (b.blocker_id=other_id and b.blocked_id=auth.uid()));
$$;
create or replace function private.trusted_member() returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.trust_assertions t where t.user_id=auth.uid()
    and t.adult_verified and t.face_verified and t.attended_plans>=3 and (t.restricted_until is null or t.restricted_until<now()));
$$;
create or replace function private.unrestricted_member() returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.trust_assertions t where t.user_id=auth.uid()
    and (t.restricted_until is null or t.restricted_until<now()));
$$;
create or replace function private.eligible_group(is_women boolean,is_trusted boolean) returns boolean language sql stable security definer set search_path='' as $$
  select private.unrestricted_member() and (not is_trusted or private.trusted_member()) and
    (not is_women or exists(select 1 from public.trust_assertions t where t.user_id=auth.uid() and t.woman_verified and t.face_verified and t.adult_verified));
$$;
revoke all on function private.blocked_with(uuid),private.trusted_member(),private.unrestricted_member(),private.eligible_group(boolean,boolean) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.blocked_with(uuid),private.trusted_member(),private.unrestricted_member(),private.eligible_group(boolean,boolean) to authenticated;

drop policy if exists plan_requests_not_blocked on public.plan_requests;
create policy plan_requests_not_blocked on public.plan_requests as restrictive for insert to authenticated with check
(exists(select 1 from public.plans p where p.id=plan_id and not private.blocked_with(p.creator_id)));
drop policy if exists memberships_not_blocked on public.memberships;
create policy memberships_not_blocked on public.memberships as restrictive for insert to authenticated with check
(exists(select 1 from public.groups g where g.id=group_id and not private.blocked_with(g.host_id)));
drop policy if exists connections_not_blocked on public.connections;
create policy connections_not_blocked on public.connections as restrictive for insert to authenticated with check (not private.blocked_with(addressee_id));
drop policy if exists memberships_request_self on public.memberships;
create policy memberships_request_self on public.memberships for insert to authenticated with check
(auth.uid()=user_id and status='pending' and exists(select 1 from public.groups g where g.id=group_id and private.eligible_group(g.women_only,g.trusted_only)));
drop policy if exists groups_create on public.groups;
create policy groups_create on public.groups for insert to authenticated with check(auth.uid()=host_id and private.eligible_group(women_only,trusted_only));
drop policy if exists groups_update_host on public.groups;
create policy groups_update_host on public.groups for update to authenticated using(auth.uid()=host_id) with check(auth.uid()=host_id and private.eligible_group(women_only,trusted_only));
drop policy if exists plans_update_self on public.plans;
create policy plans_update_self on public.plans for update to authenticated using(auth.uid()=creator_id)
with check(auth.uid()=creator_id and private.unrestricted_member() and (not trusted_only or private.trusted_member()));
drop policy if exists plans_create_self on public.plans;
create policy plans_create_self on public.plans for insert to authenticated with check(auth.uid()=creator_id and private.unrestricted_member() and (not trusted_only or private.trusted_member()));

-- Capacity changes and approvals lock the same parent row. The check runs in
-- the database transaction, including requests made outside the mobile UI.
create or replace function private.guard_plan_request() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.plans%rowtype; used integer; actor uuid:=auth.uid();
begin
  if tg_op='UPDATE' and (new.plan_id<>old.plan_id or new.user_id<>old.user_id or new.created_at<>old.created_at) then raise exception 'Request identity cannot change'; end if;
  select * into p from public.plans where id=new.plan_id for update;
  if not found then raise exception 'Activity unavailable'; end if;
  if actor is not null then
    if tg_op='INSERT' and (new.user_id<>actor or new.status<>'pending' or actor=p.creator_id) then raise exception 'Invalid request'; end if;
    if tg_op='UPDATE' and actor<>p.creator_id then raise exception 'Host approval required'; end if;
    if new.status in ('pending','approved') then
      if p.starts_at::timestamptz <= now() then raise exception 'Activity has already started'; end if;
      if exists(select 1 from public.user_blocks b where (b.blocker_id=new.user_id and b.blocked_id=p.creator_id) or (b.blocker_id=p.creator_id and b.blocked_id=new.user_id)) then raise exception 'Interaction blocked'; end if;
      if not exists(select 1 from public.trust_assertions t where t.user_id=new.user_id and (t.restricted_until is null or t.restricted_until<now())
        and (not p.trusted_only or (t.adult_verified and t.face_verified and t.attended_plans>=3))) then raise exception 'Membership requirements not met'; end if;
    end if;
  end if;
  if new.status='approved' then
    select count(*) into used from public.plan_requests r where r.plan_id=new.plan_id and r.status='approved' and r.user_id<>new.user_id;
    if used>=p.spots then raise exception 'Activity is full'; end if;
  end if;
  new.updated_at:=now();
  return new;
end $$;
drop trigger if exists guard_plan_request on public.plan_requests;
create trigger guard_plan_request before insert or update on public.plan_requests for each row execute function private.guard_plan_request();
create or replace function private.guard_plan_capacity() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.spots < (select count(*) from public.plan_requests where plan_id=new.id and status='approved') then raise exception 'Capacity is below approved attendance'; end if;
  return new;
end $$;
drop trigger if exists guard_plan_capacity on public.plans;
create trigger guard_plan_capacity before update of spots on public.plans for each row execute function private.guard_plan_capacity();

-- Only mutable fields may be updated; prevent host/member identity rewrites.
revoke update on public.connections,public.memberships,public.plan_requests from authenticated;
grant update(status) on public.connections,public.memberships to authenticated;
grant update(status,updated_at) on public.plan_requests to authenticated;
revoke update on public.notifications from authenticated;
grant update(read_at) on public.notifications to authenticated;
revoke update on public.profiles from authenticated;
grant update(id,display_name,city,area,languages,interests,bio,avatar_url) on public.profiles to authenticated;

-- The internal QR operation verifies both identity and possession of a live
-- opaque token. The public invoker wrapper exposes no privileged table access.
create or replace function private.request_connection(qr_token uuid,expected_owner uuid) returns void language plpgsql security definer set search_path='' as $$
declare owner uuid; actor uuid:=auth.uid();
begin
  if actor is null then raise exception 'Sign in required'; end if;
  select q.owner_id into owner from public.connection_qr_tokens q where q.id=qr_token and q.expires_at>now() for update;
  if owner is null or owner<>expected_owner or owner=actor then raise exception 'Invalid or expired QR'; end if;
  if private.blocked_with(owner) then raise exception 'Interaction blocked'; end if;
  -- Serialize reverse-direction requests as well as same-direction duplicates.
  perform 1 from public.profiles where id in (actor,owner) order by id for update;
  if exists(select 1 from public.connections c where (c.requester_id=actor and c.addressee_id=owner) or (c.requester_id=owner and c.addressee_id=actor)) then raise exception 'Connection or request already exists'; end if;
  insert into public.connections(requester_id,addressee_id,token_id,status) values(actor,owner,qr_token,'pending');
end $$;
create or replace function public.request_connection(qr_token uuid,expected_owner uuid) returns void language sql security invoker set search_path='' as $$select private.request_connection(qr_token,expected_owner);$$;
revoke all on function private.request_connection(uuid,uuid),public.request_connection(uuid,uuid) from public,anon;
grant execute on function private.request_connection(uuid,uuid),public.request_connection(uuid,uuid) to authenticated;
revoke insert on public.connections from authenticated;
drop policy if exists connections_reply_addressee on public.connections;
create policy connections_reply_addressee on public.connections for update to authenticated using(auth.uid()=addressee_id and status='pending')
with check(auth.uid()=addressee_id and status in ('accepted','blocked') and (status='blocked' or not private.blocked_with(requester_id)));

-- Return counts only; do not expose the identities of other attendees.
create or replace function private.plan_availability(plan_ids uuid[]) returns table(plan_id uuid,remaining integer) language sql stable security definer set search_path='' as $$
  select p.id,greatest(0,p.spots::integer-(select count(*)::integer from public.plan_requests r where r.plan_id=p.id and r.status='approved'))
  from public.plans p where auth.uid() is not null and p.id=any(plan_ids);
$$;
create or replace function public.plan_availability(plan_ids uuid[]) returns table(plan_id uuid,remaining integer) language sql stable security invoker set search_path='' as $$select * from private.plan_availability(plan_ids);$$;
revoke all on function private.plan_availability(uuid[]),public.plan_availability(uuid[]) from public,anon;
grant execute on function private.plan_availability(uuid[]),public.plan_availability(uuid[]) to authenticated;
revoke all on function private.require_report_target(),private.guard_plan_request(),private.guard_plan_capacity() from public,anon,authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='connections') then
    alter publication supabase_realtime add table public.connections;
  end if;
end $$;
-- Group approvals must recheck eligibility and block state at decision time.
create or replace function private.guard_group_membership() returns trigger language plpgsql security definer set search_path='' as $$
declare g public.groups%rowtype;
begin
  if tg_op='UPDATE' and (new.group_id<>old.group_id or new.user_id<>old.user_id or new.created_at<>old.created_at) then raise exception 'Membership identity cannot change'; end if;
  select * into g from public.groups where id=new.group_id;
  if new.status in ('pending','approved') then
    if exists(select 1 from public.group_moderation m where m.group_id=new.group_id and m.status='restricted' and (m.restricted_until is null or m.restricted_until>now())) then raise exception 'Group is restricted'; end if;
    if exists(select 1 from public.user_blocks b where (b.blocker_id=new.user_id and b.blocked_id=g.host_id) or (b.blocker_id=g.host_id and b.blocked_id=new.user_id)) then raise exception 'Interaction blocked'; end if;
    if not exists(select 1 from public.trust_assertions t where t.user_id=new.user_id and (t.restricted_until is null or t.restricted_until<now())
      and (not g.women_only or (t.adult_verified and t.face_verified and t.woman_verified))
      and (not g.trusted_only or (t.adult_verified and t.face_verified and t.attended_plans>=3))) then raise exception 'Membership requirements not met'; end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_group_membership on public.memberships;
create trigger guard_group_membership before insert or update on public.memberships for each row execute function private.guard_group_membership();
revoke all on function private.guard_group_membership() from public,anon,authenticated;

create or replace function private.delete_owned_account_content() returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from public.plans where creator_id=old.id;
  delete from public.groups where host_id=old.id;
  return old;
end $$;
drop trigger if exists nook_delete_owned_content on auth.users;
create trigger nook_delete_owned_content before delete on auth.users for each row execute function private.delete_owned_account_content();
revoke all on function private.delete_owned_account_content() from public,anon,authenticated;

-- Clients cannot manufacture a future created_at to extend QR lifetime.
revoke insert on public.connection_qr_tokens from authenticated;
grant insert(owner_id,expires_at) on public.connection_qr_tokens to authenticated;
-- Self-referential INSERT rate-limit policies recurse during RLS expansion.
-- Serialize each account/table budget in a private trigger instead.
drop policy if exists moderation_cases_rate_limit on public.moderation_cases;
drop policy if exists plan_requests_rate_limit on public.plan_requests;
drop policy if exists memberships_rate_limit on public.memberships;
drop policy if exists blocks_rate_limit on public.user_blocks;
create or replace function private.guard_daily_limit() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); used integer; cap integer; owner_column text;
begin
  if actor is null then return new; end if;
  case tg_table_name
    when 'moderation_cases' then cap:=5; owner_column:='reporter_id';
    when 'plan_requests' then cap:=12; owner_column:='user_id';
    when 'memberships' then cap:=12; owner_column:='user_id';
    when 'user_blocks' then cap:=30; owner_column:='blocker_id';
    else raise exception 'Unsupported rate limit';
  end case;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||tg_table_name,0));
  execute format('select count(*) from public.%I where %I=$1 and created_at>now()-interval ''24 hours''',tg_table_name,owner_column) into used using actor;
  if used>=cap then raise exception 'Daily limit reached. Try again later'; end if;
  new.created_at:=now();
  return new;
end $$;
revoke all on function private.guard_daily_limit() from public,anon,authenticated;
drop trigger if exists guard_daily_limit on public.moderation_cases;
create trigger guard_daily_limit before insert on public.moderation_cases for each row execute function private.guard_daily_limit();
drop trigger if exists guard_daily_limit on public.plan_requests;
create trigger guard_daily_limit before insert on public.plan_requests for each row execute function private.guard_daily_limit();
drop trigger if exists guard_daily_limit on public.memberships;
create trigger guard_daily_limit before insert on public.memberships for each row execute function private.guard_daily_limit();
drop trigger if exists guard_daily_limit on public.user_blocks;
create trigger guard_daily_limit before insert on public.user_blocks for each row execute function private.guard_daily_limit();
commit;
