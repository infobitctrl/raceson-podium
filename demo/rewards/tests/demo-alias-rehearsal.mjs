// Reuse the complete disposable hosted claim workflow, replacing only its adult fixture.
// All writes (including synthetic signatures/receipts) roll back; no chain/provider calls.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const port=process.argv[2],psql=process.argv[3]??'psql';
assert.match(port??'',/^\d{4,5}$/);
let sql=readFileSync(new URL('./hosted-copy-claims.sql',import.meta.url),'utf8');
const replace=(from,to)=>{assert(sql.includes(from),`Fixture changed: ${from.slice(0,70)}`);sql=sql.replace(from,()=>to);};
replace("update public.athlete_profiles set date_of_birth='1990-01-01',birth_year=1990\n where id=(select athlete_id from app_private.reward_demo_copy_accounts where user_id='7c000000-0000-4000-8000-000000000002');",`update public.account_login_identifiers set username='demo.athlete1' where user_id='7c000000-0000-4000-8000-000000000002';
do $$ declare u uuid:='7c000000-0000-4000-8000-000000000002'; a uuid; batch text:='073a68cf7703e72af9954d5b05c77bf1e7519a1e7c47b56ec57e07a3655f1644'; begin
 select athlete_id into a from app_private.reward_demo_copy_accounts where user_id=u;
 if not app_private.reward_demo_rehearsal_alias(u,a,10143,batch) then raise exception 'Provisioned alias denied';end if;
 if exists(select 1 from public.athlete_profiles where id=a and date_of_birth is not null) then raise exception 'DOB fabricated';end if;
 if app_private.reward_demo_rehearsal_alias(u,a,1,batch) or app_private.reward_demo_rehearsal_alias(u,a,31337,batch)
 or app_private.reward_demo_rehearsal_alias(u,a,10143,repeat('f',64)) or app_private.reward_demo_rehearsal_alias(gen_random_uuid(),a,10143,batch)
 or app_private.reward_demo_rehearsal_alias(u,gen_random_uuid(),10143,batch) then raise exception 'Scope leaked';end if;
 update app_private.reward_demo_copy_accounts set active=false where user_id=u;
 if app_private.reward_demo_rehearsal_alias(u,a,10143,batch) then raise exception 'Inactive alias accepted';end if;
 update app_private.reward_demo_copy_accounts set active=true where user_id=u;
 update public.account_login_identifiers set username='foreign' where user_id=u;
 if app_private.reward_demo_rehearsal_alias(u,a,10143,batch) then raise exception 'Foreign username accepted';end if;
 update public.account_login_identifiers set username='demo.athlete1' where user_id=u;
 if has_function_privilege('service_role','app_private.reward_demo_rehearsal_alias(uuid,uuid,integer,text)','EXECUTE') then raise exception 'Helper exposed';end if;
end $$;`);
replace("'attestation',jsonb_build_object('verifiedDateOfBirth','1990-01-01')", "'attestation',jsonb_build_object('schemaVersion',4,'policy','podium-demo-alias-rehearsal-v1','chainId',10143,'claimId',cid)");
replace("if f->'current'<>'true'::jsonb then raise exception 'Disposable adult readiness not current';end if;", "if f->'current'<>'true'::jsonb or f->>'rehearsalPolicy' is distinct from 'podium-demo-alias-rehearsal-v1' then raise exception 'Labelled rehearsal not current';end if;");
replace(" f:=public.service_reward_demo_copy_claim(reviewer,rsid,cid,'reviewer','intent',b::text);",` perform pg_temp.must_fail(format('select public.service_reward_demo_copy_claim(%L,%L,%L,%L,%L,%L)',reviewer,rsid,cid,'reviewer','intent',jsonb_set(b,'{attestation,chainId}','1')::text),'invalid_sponsor_claim');
 perform pg_temp.must_fail(format('select public.service_reward_demo_copy_claim(%L,%L,%L,%L,%L,%L)',reviewer,rsid,cid,'reviewer','intent',jsonb_set(b,'{attestation,claimId}',to_jsonb(gen_random_uuid()))::text),'invalid_sponsor_claim');
 f:=public.service_reward_demo_copy_claim(reviewer,rsid,cid,'reviewer','intent',b::text);`);
const result=spawnSync(psql,['-X','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
if(result.status!==0){process.stderr.write(result.stderr??String(result.error));process.exit(result.status??1);}
console.log('Rehearsal policy: exact alias/chain/batch/claim, unknown-age baseline, wallet/session, explicit recipient consent, native authority, receipt/idempotency, pagination and revoked reviewer checks passed; rollback complete.');
