begin;
-- Hosted-copy issue flags use dedicated private history; legacy source RPCs remain closed.
create table app_private.reward_demo_copy_review_issue_events (
 id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
 setup_id uuid not null references app_private.reward_distribution_setups(id),
 slot integer not null check(slot between 0 and 5),
 issue_id uuid not null,
 action text not null check(action in('report','withdraw')),
 command jsonb not null,
 actor_user_id uuid not null references public.user_profiles(user_id),
 created_at timestamptz not null default clock_timestamp(),
 sequence bigint generated always as identity unique,
 unique(setup_id,slot,issue_id,action),
 foreign key(issue_id) references app_private.reward_demo_copy_review_issue_events(id),
 check(action<>'report' or issue_id=id)
);
create index reward_demo_copy_review_issue_scope on app_private.reward_demo_copy_review_issue_events(setup_id,slot,sequence desc);
alter table app_private.reward_demo_copy_review_issue_events enable row level security;
revoke all on app_private.reward_demo_copy_review_issue_events from public,anon,authenticated,service_role;
revoke all on sequence app_private.reward_demo_copy_review_issue_events_sequence_seq from public,anon,authenticated,service_role;
create trigger reward_demo_copy_issue_immutable before update or delete on app_private.reward_demo_copy_review_issue_events
 for each row execute function app_private.reward_result_review_immutable_v3();

create function public.service_reward_demo_copy_review_issues(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_setup_id uuid,p_slot integer,p_change jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare facts jsonb; rev bigint; report_allowed boolean; saved app_private.reward_demo_copy_review_issue_events%rowtype; original app_private.reward_demo_copy_review_issue_events%rowtype; rid uuid; iid uuid; issue_action text;
begin
 -- The existing copied-source reader verifies live reviewer/session/source scope
 -- and takes the same setup advisory lock used by approval writes.
 facts:=app_private.read_reward_demo_copy_allocation(p_actor_user_id,p_actor_session_id,p_chain_id,p_setup_id,p_slot,null);
 if coalesce((facts#>>array['execution','plan','caps',p_slot::text])::numeric,0)<=0 then raise exception 'invalid_reward_review_issue'; end if;
 select coalesce(max(sequence),0) into rev from app_private.reward_demo_copy_review_issue_events where setup_id=p_setup_id and slot=p_slot;
 report_allowed:=not exists(select 1 from app_private.reward_sponsor_allocation_approvals_v4 where setup_id=p_setup_id and slot=p_slot and decision='approved');
 if p_change is not null then
  if jsonb_typeof(p_change) is distinct from 'object' or coalesce(p_change->>'action','') not in('report','withdraw')
   or jsonb_typeof(p_change->'expectedRevision') is distinct from 'number' or coalesce(p_change->>'expectedRevision','') !~ '^[0-9]{1,15}$'
   or coalesce(p_change->>'requestId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or p_change->>'requestId'='00000000-0000-0000-0000-000000000000'
  then raise exception 'invalid_reward_review_issue'; end if;
  rid:=(p_change->>'requestId')::uuid; issue_action:=p_change->>'action';
  select * into saved from app_private.reward_demo_copy_review_issue_events where id=rid;
  if found then
   if saved.setup_id<>p_setup_id or saved.slot<>p_slot or saved.actor_user_id<>p_actor_user_id or saved.command<>p_change then raise exception 'reward_review_issue_conflict'; end if;
  else
   if rev<>(p_change->>'expectedRevision')::bigint then raise exception 'reward_review_issue_conflict'; end if;
   if issue_action='report' then
    if (select count(*) from jsonb_object_keys(p_change))<>5 or not(p_change ?& array['action','requestId','expectedRevision','contextHash','description'])
     or jsonb_typeof(p_change->'description') is distinct from 'string' or length(btrim(p_change->>'description')) not between 8 and 2000
     or coalesce(p_change->>'contextHash','') !~ '^[0-9a-f]{64}$'
    then raise exception 'invalid_reward_review_issue'; end if;
    if not report_allowed or p_change->>'contextHash' is distinct from facts->>'contextHash' then raise exception 'reward_review_issue_conflict'; end if;
    if (select count(*) from app_private.reward_demo_copy_review_issue_events where setup_id=p_setup_id and slot=p_slot and action='report')>=100 then raise exception 'reward_review_issue_limit'; end if;
    iid:=rid;
   else
    if (select count(*) from jsonb_object_keys(p_change))<>4 or not(p_change ?& array['action','requestId','expectedRevision','issueId']) or coalesce(p_change->>'issueId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid_reward_review_issue'; end if;
    iid:=(p_change->>'issueId')::uuid;
    select * into original from app_private.reward_demo_copy_review_issue_events where id=iid and setup_id=p_setup_id and slot=p_slot and action='report';
    if original.id is null or original.actor_user_id<>p_actor_user_id then raise exception 'reward_review_issue_not_owned'; end if;
    if exists(select 1 from app_private.reward_demo_copy_review_issue_events where issue_id=iid and action='withdraw') then raise exception 'reward_review_issue_conflict'; end if;
   end if;
   perform app_private.require_reward_demo_copy_reviewer(p_actor_user_id,p_actor_session_id);
   insert into app_private.reward_demo_copy_review_issue_events(id,setup_id,slot,issue_id,action,command,actor_user_id) values(rid,p_setup_id,p_slot,iid,issue_action,p_change,p_actor_user_id) returning sequence into rev;
  end if;
 end if;
 facts:=app_private.read_reward_demo_copy_allocation(p_actor_user_id,p_actor_session_id,p_chain_id,p_setup_id,p_slot,null);
 return jsonb_build_object('revision',rev,'contextHash',facts->>'contextHash','canReport',report_allowed,'issues',
 (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'description',r.command->>'description','createdBy',r.actor_user_id,'createdAt',r.created_at,'withdrawnAt',w.created_at,'canWithdraw',w.id is null and r.actor_user_id=p_actor_user_id) order by r.sequence desc),'[]'::jsonb)
 from app_private.reward_demo_copy_review_issue_events r left join app_private.reward_demo_copy_review_issue_events w on w.issue_id=r.id and w.action='withdraw'
 where r.setup_id=p_setup_id and r.slot=p_slot and r.action='report'));
end $$;

create function app_private.reward_demo_copy_approval_issue_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.decision='approved' then
  perform pg_advisory_xact_lock(hashtextextended('reward-setup:'||new.setup_id::text,0));
  if exists(select 1 from app_private.reward_demo_copy_review_issue_events r where r.setup_id=new.setup_id and r.slot=new.slot and r.action='report' and not exists(select 1 from app_private.reward_demo_copy_review_issue_events w where w.issue_id=r.id and w.action='withdraw')) then raise exception 'reward_review_issue_open'; end if;
 end if;
 return new;
end $$;
create trigger reward_demo_copy_approval_issue_guard before insert on app_private.reward_sponsor_allocation_approvals_v4
 for each row execute function app_private.reward_demo_copy_approval_issue_guard();
revoke all on function public.service_reward_demo_copy_review_issues(uuid,uuid,integer,uuid,integer,jsonb),
 app_private.reward_demo_copy_approval_issue_guard() from public,anon,authenticated,service_role;
grant execute on function public.service_reward_demo_copy_review_issues(uuid,uuid,integer,uuid,integer,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
