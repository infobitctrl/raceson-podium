begin;
do $$ declare fn regprocedure; begin
  foreach fn in array array[
    'app_private.reward_athlete_claim_proof_document(app_private.reward_athlete_claim_proofs)'::regprocedure,
    'public.service_read_reward_athlete_claim_proofs(uuid,uuid,uuid,text)'::regprocedure,
    'public.service_list_reward_athlete_claims(uuid,uuid,integer,uuid)'::regprocedure,
    'public.service_read_reward_athlete_payment_status(uuid,uuid,integer,uuid)'::regprocedure,
    'public.service_read_reward_athlete_consent_context(uuid,uuid,uuid)'::regprocedure,
    'public.service_record_reward_athlete_claim_proof(uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz)'::regprocedure
  ] loop
    if exists(select 1 from pg_proc where oid=fn and prosecdef)
      or has_function_privilege('anon',fn,'execute') or has_function_privilege('authenticated',fn,'execute')
      or not has_function_privilege('service_role',fn,'execute') then raise exception 'Incorrect claim proof grants: %',fn; end if;
  end loop;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app_private' and c.relname='reward_athlete_claim_proofs' and c.relrowsecurity)
    or has_table_privilege('anon','app_private.reward_athlete_claim_proofs','select,insert,update,delete')
    or has_table_privilege('authenticated','app_private.reward_athlete_claim_proofs','select,insert,update,delete')
    or has_table_privilege('service_role','app_private.reward_athlete_claim_proofs','update,delete')
    or not has_table_privilege('service_role','app_private.reward_athlete_claim_proofs','select')
    or not has_table_privilege('service_role','app_private.reward_athlete_claim_proofs','insert') then raise exception 'Incorrect claim proof table grants'; end if;
end $$;
set local role anon;
do $$ begin
  begin perform public.service_read_reward_athlete_claim_proofs(null,null,null,null);raise exception 'Anonymous proof read';exception when insufficient_privilege then null;end;
  begin perform public.service_list_reward_athlete_claims(null,null,31337,null);raise exception 'Anonymous history read';exception when insufficient_privilege then null;end;
  begin perform public.service_read_reward_athlete_payment_status(null,null,31337,null);raise exception 'Anonymous payment read';exception when insufficient_privilege then null;end;
  begin perform public.service_read_reward_athlete_consent_context(null,null,null);raise exception 'Anonymous consent read';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform public.service_read_reward_athlete_claim_proofs(null,null,null,null);raise exception 'Browser proof read';exception when insufficient_privilege then null;end;
  begin perform public.service_list_reward_athlete_claims(null,null,31337,null);raise exception 'Browser history read';exception when insufficient_privilege then null;end;
  begin perform public.service_read_reward_athlete_payment_status(null,null,31337,null);raise exception 'Browser payment read';exception when insufficient_privilege then null;end;
  begin perform public.service_read_reward_athlete_consent_context(null,null,null);raise exception 'Browser consent read';exception when insufficient_privilege then null;end;
  begin perform public.service_record_reward_athlete_claim_proof(null,null,null,null,null,null,null,null);raise exception 'Browser proof write';exception when insufficient_privilege then null;end;
end $$;
rollback;
