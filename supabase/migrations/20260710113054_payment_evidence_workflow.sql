insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'registration-payment-evidence',
  'registration-payment-evidence',
  false,
  5242880,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.registrations
  add column if not exists verified_payment_evidence_id uuid;

alter table public.registrations
  drop constraint if exists registrations_verified_payment_evidence_id_fkey;

alter table public.registrations
  add constraint registrations_verified_payment_evidence_id_fkey
  foreign key (verified_payment_evidence_id)
  references public.registration_payment_evidence (id)
  on delete set null;

create index if not exists registrations_verified_payment_evidence_idx
  on public.registrations (verified_payment_evidence_id)
  where verified_payment_evidence_id is not null;

create unique index if not exists registration_payment_evidence_object_path_uidx
  on public.registration_payment_evidence (object_path);

drop policy if exists registration_payment_evidence_upload_own
  on storage.objects;
create policy registration_payment_evidence_upload_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'registration-payment-evidence'
  and exists (
    select 1
    from public.registrations registration
    where registration.id::text = (storage.foldername(name))[1]
      and public.user_can_access_registration(registration.id)
  )
);

drop policy if exists registration_payment_evidence_delete_own
  on storage.objects;
create policy registration_payment_evidence_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'registration-payment-evidence'
  and exists (
    select 1
    from public.registrations registration
    where registration.id::text = (storage.foldername(name))[1]
      and public.user_can_access_registration(registration.id)
  )
);
