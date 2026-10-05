create or replace function public.review_registration_payment_evidence_atomically(
  target_evidence_id uuid,
  target_reviewer_user_id uuid,
  target_review_status text,
  target_organizer_note text default null
)
returns table (
  evidence_id uuid,
  registration_id uuid,
  review_status text,
  payment_status public.payment_status
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  evidence_row public.registration_payment_evidence%rowtype;
  replacement_evidence_id uuid;
  resolved_payment_status public.payment_status;
begin
  if target_review_status not in ('verified', 'rejected') then
    raise exception using errcode = '22023', message = 'invalid_payment_evidence_review_status';
  end if;

  select *
  into evidence_row
  from public.registration_payment_evidence
  where id = target_evidence_id
  for update;

  if evidence_row.id is null then
    raise exception using errcode = 'P0002', message = 'payment_evidence_not_found';
  end if;

  perform 1
  from public.registrations
  where id = evidence_row.registration_id
  for update;

  update public.registration_payment_evidence
  set
    review_status = target_review_status,
    reviewed_by_user_id = target_reviewer_user_id,
    organizer_note = nullif(trim(target_organizer_note), ''),
    reviewed_at = now()
  where id = target_evidence_id;

  if target_review_status = 'verified' then
    update public.registrations
    set
      verified_payment_evidence_id = target_evidence_id,
      payment_status = 'paid'
    where id = evidence_row.registration_id
    returning registrations.payment_status into resolved_payment_status;
  else
    select evidence.id
    into replacement_evidence_id
    from public.registration_payment_evidence evidence
    where evidence.registration_id = evidence_row.registration_id
      and evidence.id <> target_evidence_id
      and evidence.review_status = 'verified'
    order by evidence.reviewed_at desc nulls last, evidence.submitted_at desc
    limit 1;

    update public.registrations registration
    set
      verified_payment_evidence_id = replacement_evidence_id,
      payment_status = case
        when replacement_evidence_id is not null then 'paid'::public.payment_status
        when verified_payment_evidence_id = target_evidence_id then 'unpaid'::public.payment_status
        else registration.payment_status
      end
    where registration.id = evidence_row.registration_id
    returning registration.payment_status into resolved_payment_status;
  end if;

  return query
  select
    target_evidence_id,
    evidence_row.registration_id,
    target_review_status,
    resolved_payment_status;
end;
$$;
