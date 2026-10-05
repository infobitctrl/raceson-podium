-- Display enrichment only. Existing controller authorization, freshness and
-- immutable award documents remain authoritative; this function cannot write.
begin;
create function public.service_reward_controller_result_display(p_operator text,p_subject text,p_chain_id integer,p_setup_id uuid,p_approval_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare handoff jsonb; snapshot jsonb; draft uuid;
begin
 if p_setup_id is null or p_approval_id is null then raise exception 'controller_scope_required'; end if;
 -- Reuse assigned-operator, active campaign and current handoff checks under
 -- the existing campaign lock. No organizer identity is impersonated.
 handoff:=public.service_reward_controller_v4(p_operator,p_subject,p_chain_id,p_setup_id,p_approval_id);
 draft:=(handoff#>>'{upload,document,binding,draftId}')::uuid;
 select s.payload into snapshot from app_private.reward_planning_drafts d
 join app_private.reward_public_snapshots_v2 s on s.season_id=d.season_id and s.organization_id=d.organization_id
 where d.id=draft and d.chain_id=p_chain_id;
 return jsonb_build_object('documentHash',handoff#>>'{upload,documentHash}','snapshot',snapshot);
end $$;
revoke all on function public.service_reward_controller_result_display(text,text,integer,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_reward_controller_result_display(text,text,integer,uuid,uuid) to service_role;
commit;
