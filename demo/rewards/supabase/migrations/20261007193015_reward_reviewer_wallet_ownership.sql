begin;
-- A retained operator address moves to the authorized reviewer through an
-- independently verified provider-owner signature. No grants or money move.
create table app_private.reward_review_wallet_handovers (
 request_id uuid primary key,
 reviewer_user_id uuid not null references auth.users(id), reviewer_session_id uuid not null,
 setup_id uuid not null, approval_id uuid not null, slot integer not null check(slot between 0 and 5),
 wallet text not null, wallet_id text not null, previous_subject text not null, previous_owner_id text not null,
 reviewer_subject text not null, settings_revision integer not null,
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default(clock_timestamp()+interval '15 minutes'),
 completed_at timestamptz, owner_id text
);
alter table app_private.reward_review_wallet_handovers enable row level security;
revoke all on app_private.reward_review_wallet_handovers from public,anon,authenticated,service_role;
create function public.service_reward_demo_copy_review_wallet_handover(p_actor_user_id uuid,p_actor_session_id uuid,p_setup_id uuid,p_slot integer,p_approval_id uuid,p_request_id uuid,
 p_wallet text,p_wallet_id text,p_reviewer_subject text,p_previous_subject text,p_previous_owner_id text,p_expected_revision integer,p_action text,p_owner_id text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare h app_private.reward_review_wallet_handovers%rowtype; v app_private.reward_wallet_settings%rowtype; f jsonb; next_settings jsonb;
begin
 perform app_private.require_reward_demo_copy_reviewer(p_actor_user_id,p_actor_session_id);
 perform pg_advisory_xact_lock(hashtextextended('reward-auto-creation',0));
 perform pg_advisory_xact_lock(hashtextextended('reward-wallet-administration',0));
 f:=app_private.reward_demo_copy_lifecycle(p_actor_user_id,p_actor_session_id,10143,p_setup_id,p_slot,p_approval_id);
 if f#>>'{upload,execution,plan,operator}' is distinct from p_wallet or f#>'{upload,current}' is distinct from 'true'::jsonb
  or f#>'{publication,current}' is distinct from 'true'::jsonb or p_request_id is null
  or p_reviewer_subject is null or p_reviewer_subject !~ '^did:privy:[a-zA-Z0-9_-]{1,100}$'
  or p_action is null or p_action not in('prepare','confirm') then raise exception 'review_wallet_handover_conflict'; end if;
 select * into v from app_private.reward_wallet_settings where singleton for update;
 select * into h from app_private.reward_review_wallet_handovers where request_id=p_request_id for update;
 if h.request_id is not null then
  if h.reviewer_user_id is distinct from p_actor_user_id or h.wallet is distinct from p_wallet or h.wallet_id is distinct from p_wallet_id
   or h.setup_id is distinct from p_setup_id or h.approval_id is distinct from p_approval_id or h.slot is distinct from p_slot
   or h.reviewer_subject is distinct from p_reviewer_subject then raise exception 'review_wallet_handover_conflict';end if;
  if h.completed_at is not null then
   if v.settings#>>'{controller,subject}' is distinct from h.reviewer_subject or v.settings#>>'{controller,ownerId}' is distinct from h.owner_id then raise exception 'review_wallet_handover_conflict';end if;
   return jsonb_build_object('completed',true,'revision',v.revision);
  end if;
 end if;
 if v.revision is distinct from p_expected_revision or v.settings#>>'{controller,wallet}' is distinct from p_wallet
  or v.settings#>>'{controller,walletId}' is distinct from p_wallet_id or v.settings#>>'{controller,ownerId}' is distinct from p_previous_owner_id
  or v.settings#>>'{controller,subject}' is distinct from p_previous_subject or p_previous_subject=p_reviewer_subject
  or v.settings#>>'{deployment,address}'=p_wallet then raise exception 'review_wallet_handover_conflict';end if;
 if exists(select 1 from app_private.reward_controller_transactions where sender=p_wallet and not confirmed)
  or exists(select 1 from app_private.reward_sponsor_auto_deployments where sender=p_wallet and not confirmed)
  then raise exception 'controller_transaction_pending';end if;
 if p_action='prepare' then
  if p_owner_id is not null then raise exception 'review_wallet_handover_conflict';end if;
  if exists(select 1 from app_private.reward_review_wallet_handovers x where x.wallet=p_wallet and x.request_id<>p_request_id and x.completed_at is null and x.expires_at>clock_timestamp()) then raise exception 'review_wallet_handover_conflict';end if;
  if h.request_id is null then
   insert into app_private.reward_review_wallet_handovers(request_id,reviewer_user_id,reviewer_session_id,setup_id,approval_id,slot,wallet,wallet_id,previous_subject,previous_owner_id,reviewer_subject,settings_revision)
    values(p_request_id,p_actor_user_id,p_actor_session_id,p_setup_id,p_approval_id,p_slot,p_wallet,p_wallet_id,p_previous_subject,p_previous_owner_id,p_reviewer_subject,p_expected_revision);
  else update app_private.reward_review_wallet_handovers set expires_at=clock_timestamp()+interval '15 minutes' where request_id=p_request_id;end if;
 else
  if h.request_id is null or p_owner_id is null or p_owner_id !~ '^[a-zA-Z0-9_-]{1,100}$' or p_owner_id=p_previous_owner_id then raise exception 'review_wallet_handover_conflict';end if;
  -- Change ownership metadata only. Immutable wallet/contract/operator addresses,
  -- deployment gas grant, award versions and deposited budgets remain identical.
  next_settings:=jsonb_set(v.settings,'{controller}',jsonb_build_object('subject',p_reviewer_subject,'wallet',p_wallet,'walletId',p_wallet_id,'ownerId',p_owner_id));
  insert into app_private.reward_wallet_changes(revision,settings,previous_settings,changed_by,reason)
   values(v.revision+1,next_settings,v.settings,p_actor_user_id,'Original wallet owner handed rewards execution to the authorized reviewer.');
  update app_private.reward_wallet_settings set revision=v.revision+1,settings=next_settings,updated_at=clock_timestamp() where singleton;
  update app_private.reward_review_wallet_handovers set owner_id=p_owner_id,completed_at=clock_timestamp() where request_id=p_request_id;
 end if;
 return jsonb_build_object('completed',p_action='confirm','revision',v.revision+(case when p_action='confirm' then 1 else 0 end));
end $$;
revoke all on function public.service_reward_demo_copy_review_wallet_handover(uuid,uuid,uuid,integer,uuid,uuid,text,text,text,text,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.service_reward_demo_copy_review_wallet_handover(uuid,uuid,uuid,integer,uuid,uuid,text,text,text,text,text,integer,text,text) to service_role;
-- Original native subject is retired after handover; history records do not
-- re-grant it. A short handover lease prevents a competing nonce reservation.
create or replace function app_private.require_reward_demo_copy_controller(p_operator text,p_subject text)
returns void language plpgsql volatile security definer set search_path='' as $$
declare revision integer; settings jsonb;
begin
 if p_operator is null or p_operator !~ '^0x[0-9a-f]{40}$' or p_operator in('0x'||repeat('0',40),'0x361ffea5d7c76b2db3d5573a241c94ed05e787ba')
  or p_subject is null or p_subject !~ '^did:privy:[a-zA-Z0-9_-]{1,100}$' then raise exception 'controller_scope_required';end if;
 select s.revision,s.settings into revision,settings from app_private.reward_wallet_settings s where singleton for share;
 if exists(select 1 from app_private.reward_review_wallet_handovers h where h.wallet=p_operator and ((h.completed_at is not null and h.reviewer_subject<>p_subject) or (h.completed_at is null and h.expires_at>clock_timestamp()))) then raise exception 'controller_scope_required';end if;
 if exists(select 1 from app_private.reward_review_wallet_handovers h where h.wallet=p_operator and h.completed_at is not null and h.reviewer_subject=p_subject and not public.service_user_has_organization_permission((select organization_id from public.leagues where id='ba81ced7-b2c5-4d51-95b6-d95d8c04fa36'),h.reviewer_user_id,'results.manage')) then raise exception 'controller_scope_required';end if;
 if coalesce(revision,0)=0 or not exists(select 1 from (
  select settings->'controller' controller union all select h.settings->'controller' from app_private.reward_wallet_changes h union all select h.previous_settings->'controller' from app_private.reward_wallet_changes h
 ) c where c.controller->>'wallet'=p_operator and c.controller->>'subject'=p_subject) then raise exception 'controller_scope_required';end if;
end $$;
commit;
