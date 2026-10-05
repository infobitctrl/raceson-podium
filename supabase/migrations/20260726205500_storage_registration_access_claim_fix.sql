begin;
-- Supabase Storage evaluates object policies in a service context where the
-- PostgREST request settings used by request_user_id() are not guaranteed.
-- Pass auth.uid() explicitly into a security-definer ownership check instead.
create or replace function public.user_can_access_registration_as_user(
  target_registration_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_user_id is not null
    and exists (
      select 1
      from public.registrations registration
      join public.athlete_profiles athlete
        on athlete.id = registration.athlete_profile_id
      where registration.id = target_registration_id
        and athlete.status = 'active'
        and athlete.merged_into_athlete_profile_id is null
        and (
          athlete.claimed_by_user_id = target_user_id
          or exists (
            select 1
            from public.user_profiles profile
            where profile.user_id = target_user_id
              and profile.primary_athlete_profile_id = athlete.id
          )
          or exists (
            select 1
            from public.athlete_claims claim
            where claim.athlete_profile_id = athlete.id
              and claim.claimant_user_id = target_user_id
              and claim.status = 'approved'
          )
          or exists (
            select 1
            from public.athlete_identities identity
            where identity.athlete_profile_id = athlete.id
              and identity.user_id = target_user_id
              and identity.is_verified
          )
        )
    )
$$;
revoke all on function public.user_can_access_registration_as_user(uuid, uuid) from public;
grant execute on function public.user_can_access_registration_as_user(uuid, uuid)
  to authenticated, service_role;
drop policy if exists registration_payment_evidence_upload_own
  on storage.objects;
create policy registration_payment_evidence_upload_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'registration-payment-evidence'
  and case
    when (storage.foldername(name))[1]
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.user_can_access_registration_as_user(
      ((storage.foldername(name))[1])::uuid,
      auth.uid()
    )
    else false
  end
);
drop policy if exists registration_payment_evidence_delete_own
  on storage.objects;
create policy registration_payment_evidence_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'registration-payment-evidence'
  and case
    when (storage.foldername(name))[1]
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then public.user_can_access_registration_as_user(
      ((storage.foldername(name))[1])::uuid,
      auth.uid()
    )
    else false
  end
);
commit;
