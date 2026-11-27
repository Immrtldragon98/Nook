import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite({extensions:{citext,pgcrypto}});
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema storage; create schema extensions;
  set search_path=public,extensions;
  create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated,anon,service_role;
  grant execute on function auth.uid() to authenticated,anon,service_role;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text);
  alter table storage.objects enable row level security;
  create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
  create publication supabase_realtime;
`);
await db.exec(readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
// Patches must also be safe to apply separately on an upgraded installation.
await db.exec(readFileSync(new URL('../supabase/patches/audit_fixes.sql',import.meta.url),'utf8'));
const host='00000000-0000-0000-0000-000000000001';
const member='00000000-0000-0000-0000-000000000002';
const other='00000000-0000-0000-0000-000000000003';
const third='00000000-0000-0000-0000-000000000004';
for (const [id,name] of [[host,'Host'],[member,'Member'],[other,'Other'],[third,'Third']]) {
  await db.query(`insert into auth.users values($1,$2,$3)`,[id,`${name}@example.test`,JSON.stringify({username:name,gender:'woman',declared_age:25})]);
}
async function actor(id,fn) {
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[id ?? '']);
  await db.exec('set role authenticated');
  try { return await fn(); } finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub','',false)`); }
}
const query=(sql,args=[])=>db.query(sql,args);
async function denied(id,sql,args=[]) { await assert.rejects(()=>actor(id,()=>query(sql,args))); }
let passed=0;
async function test(name,fn) { await fn(); passed++; console.log(`PASS ${name}`); }
let plan,token,reverseToken;
await test('profile updates work, but usernames cannot diverge from login handles',async()=>{
  await actor(member,()=>query(`update public.profiles set display_name='New member',city='Bengaluru',area='HSR' where id=$1`,[member]));
  await denied(member,`update public.profiles set username='StolenName' where id=$1`,[member]);
});
await test('budget supports the full UI range',async()=>{
  const result=await actor(host,()=>query(`insert into plans(creator_id,title,category,city,area,starts_at,language,spots,budget_per_person) values($1,'Test activity','Sports','Bengaluru','HSR','2099-01-01T12:00:00Z','English',2,100000) returning id`,[host]));
  plan=result.rows[0].id;
});
await test('unverified host cannot upgrade an ordinary plan into a trusted plan',async()=>{
  await denied(host,`update plans set trusted_only=true where id=$1`,[plan]);
});
await test('QR tokens remain private and cross-account connection requests succeed',async()=>{
  token=(await actor(host,()=>query(`insert into connection_qr_tokens(owner_id,expires_at) values($1,now()+interval '5 minutes') returning id`,[host]))).rows[0].id;
  assert.equal((await actor(member,()=>query('select id from connection_qr_tokens where id=$1',[token]))).rows.length,0);
  await actor(member,()=>query('select public.request_connection($1,$2)',[token,host]));
  assert.equal((await actor(host,()=>query('select status from connections'))).rows[0].status,'pending');
});
await test('requester cannot self-accept or forge connection identity; recipient can accept',async()=>{
  assert.equal((await actor(member,()=>query(`update connections set status='accepted' returning *`))).rows.length,0);
  await denied(host,`update connections set requester_id=$1`,[other]);
  assert.equal((await actor(host,()=>query(`update connections set status='accepted' returning status`))).rows[0].status,'accepted');
});
await test('expired, self, forged-owner and reverse duplicate QR requests are refused',async()=>{
  await denied(host,'select public.request_connection($1,$2)',[token,host]);
  await denied(other,'select public.request_connection($1,$2)',[token,member]);
  await query(`insert into connection_qr_tokens(id,owner_id,created_at,expires_at) values('10000000-0000-0000-0000-000000000001',$1,now()-interval '10 minutes',now()-interval '5 minutes')`,[host]);
  await denied(other,'select public.request_connection($1,$2)',['10000000-0000-0000-0000-000000000001',host]);
  reverseToken=(await actor(member,()=>query(`insert into connection_qr_tokens(owner_id,expires_at) values($1,now()+interval '5 minutes') returning id`,[member]))).rows[0].id;
  await denied(host,'select public.request_connection($1,$2)',[reverseToken,member]);
  await denied(other,`insert into connections(requester_id,addressee_id,token_id,status) values($1,$2,$3,'accepted')`,[other,host,token]);
});
await test('blocking prevents requests in both directions without revealing block lists',async()=>{
  await actor(host,()=>query('insert into user_blocks(blocker_id,blocked_id) values($1,$2)',[host,other]));
  assert.equal((await actor(other,()=>query('select * from user_blocks'))).rows.length,0);
  await denied(other,'select public.request_connection($1,$2)',[token,host]);
  await denied(other,'insert into plan_requests(plan_id,user_id) values($1,$2)',[plan,other]);
  await denied(host,'select public.request_connection($1,$2)',[reverseToken,member]); // duplicate remains rejected
});
await test('approval capacity is enforced and remaining spots reflect approved requests',async()=>{
  await query('delete from user_blocks');
  for(const id of [member,other,third]) await actor(id,()=>query('insert into plan_requests(plan_id,user_id) values($1,$2)',[plan,id]));
  for(const id of [member,other]) await actor(host,()=>query(`update plan_requests set status='approved' where plan_id=$1 and user_id=$2`,[plan,id]));
  await denied(host,`update plan_requests set status='approved' where plan_id=$1 and user_id=$2`,[plan,third]);
  const available=await actor(third,()=>query('select * from public.plan_availability($1)',[[plan]]));
  assert.equal(available.rows[0].remaining,0);
  await actor(host,()=>query('update plans set spots=3 where id=$1',[plan]));
  await actor(host,()=>query("update plan_requests set status='approved' where plan_id=$1 and user_id=$2",[plan,third]));
  await denied(host,'update plans set spots=2 where id=$1',[plan]);
  await actor(host,()=>query(`update plan_requests set status='rejected' where plan_id=$1 and user_id=$2`,[plan,member]));
  await actor(host,()=>query(`update plan_requests set status='approved' where plan_id=$1 and user_id=$2`,[plan,third]));
});
await test('host cannot rewrite request identities or notification contents',async()=>{
  await denied(host,'update plan_requests set user_id=$1 where plan_id=$2',[host,plan]);
  await denied(member,`update notifications set body='Fake approval'`);
  await actor(member,()=>query('update notifications set read_at=now()'));
});
await test('blocking or restrictions added after requesting are checked again at approval',async()=>{
  await actor(host,()=>query('insert into user_blocks(blocker_id,blocked_id) values($1,$2)',[host,member]));
  await denied(host,`update plan_requests set status='approved' where plan_id=$1 and user_id=$2`,[plan,member]);
  await query('delete from user_blocks');
  await query(`update trust_assertions set restricted_until=now()+interval '1 day' where user_id=$1`,[member]);
  await denied(host,`update plan_requests set status='approved' where plan_id=$1 and user_id=$2`,[plan,member]);
  await query('update trust_assertions set restricted_until=null where user_id=$1',[member]);
});
await test('women-only group creation requires server trust, not self-declared gender',async()=>{
  await denied(host,`insert into groups(host_id,title,category,city,area,language,women_only) values($1,'Test group','Sports','Bengaluru','HSR','English',true)`,[host]);
});
let group;
await test('group join and approval recheck blocks, trust and moderation restrictions',async()=>{
  group=(await actor(host,()=>query(`insert into groups(host_id,title,category,city,area,language) values($1,'Test group','Sports','Bengaluru','HSR','English') returning id`,[host]))).rows[0].id;
  await actor(host,()=>query('insert into user_blocks(blocker_id,blocked_id) values($1,$2)',[host,third]));
  await denied(third,'insert into memberships(group_id,user_id) values($1,$2)',[group,third]);
  await query('delete from user_blocks');
  await actor(other,()=>query('insert into memberships(group_id,user_id) values($1,$2)',[group,other]));
  await query(`update trust_assertions set restricted_until=now()+interval '1 day' where user_id=$1`,[other]);
  await denied(host,`update memberships set status='approved' where group_id=$1 and user_id=$2`,[group,other]);
  await query('update trust_assertions set restricted_until=null where user_id=$1',[other]);
  await actor(host,()=>query(`update memberships set status='approved' where group_id=$1 and user_id=$2`,[group,other]));
  await query(`insert into group_moderation(group_id,status) values($1,'restricted')`,[group]);
  await denied(member,'insert into memberships(group_id,user_id) values($1,$2)',[group,member]);
});
await test('daily report limits cannot be bypassed by forging old timestamps',async()=>{
  for(let n=0;n<5;n++) await actor(other,()=>query(`insert into moderation_cases(reporter_id,target_type,target_plan_id,reason,created_at) values($1,'plan',$2,'Misleading activity details','2000-01-01')`,[other,plan]));
  await denied(other,`insert into moderation_cases(reporter_id,target_type,target_plan_id,reason) values($1,'plan',$2,'Another activity report')`,[other,plan]);
});
await test('reported content and connected accounts can be deleted without losing moderation evidence',async()=>{
  const report=(await actor(member,()=>query(`insert into moderation_cases(reporter_id,target_type,target_plan_id,reason) values($1,'plan',$2,'Misleading activity details') returning id`,[member,plan]))).rows[0].id;
  const userReport=(await actor(member,()=>query("insert into moderation_cases(reporter_id,target_type,target_user_id,reason) values($1,'user',$2,'Inappropriate behaviour report') returning id",[member,host]))).rows[0].id;
  const groupReport=(await actor(member,()=>query("insert into moderation_cases(reporter_id,target_type,target_group_id,reason) values($1,'group',$2,'Unsafe group activity report') returning id",[member,group]))).rows[0].id;
  await query('delete from auth.users where id=$1',[host]);
  assert.equal((await query('select target_user_id from moderation_cases where id=$1',[userReport])).rows[0].target_user_id,null);
  assert.equal((await query('select target_group_id from moderation_cases where id=$1',[groupReport])).rows[0].target_group_id,null);
  assert.equal((await query('select * from plans where id=$1',[plan])).rows.length,0);
  assert.equal((await query('select * from connections')).rows.length,0);
  assert.equal((await query('select target_plan_id from moderation_cases where id=$1',[report])).rows[0].target_plan_id,null);
  await denied(member,`insert into moderation_cases(reporter_id,target_type,reason) values($1,'plan','Missing activity target')`,[member]);
});
await test('unauthenticated RPC calls are denied',async()=>{
  assert.equal((await actor(null,()=>query('select * from public.plan_availability($1)',[[plan]]))).rows.length,0);
  await db.exec('set role anon');
  try { await assert.rejects(()=>query('select public.plan_availability($1)',[[plan]])); } finally { await db.exec('reset role'); }
});
console.log(`${passed} database regression checks passed (PostgreSQL/PGlite; local auth/storage scaffolding).`);
await db.close();
