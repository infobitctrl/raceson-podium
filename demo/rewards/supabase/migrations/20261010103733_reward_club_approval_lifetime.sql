begin;
-- Preserve every retained request, expiry and signature. Only new requests can
-- receive the longer lifetime; deployed V5/V6 authorizations remain <=24h.
do $$
declare constraint_name text;
begin
 select conname into strict constraint_name from pg_constraint
 where conrelid='app_private.reward_club_owner_approvals'::regclass
 and contype='c' and pg_get_constraintdef(oid) like '%expires_at%created_at%';
 execute format('alter table app_private.reward_club_owner_approvals drop constraint %I',constraint_name);
end $$;
alter table app_private.reward_club_owner_approvals
 add constraint reward_club_owner_approval_lifetime check (
  expires_at>created_at and expires_at<=created_at+interval '24 hours'
 );
commit;
