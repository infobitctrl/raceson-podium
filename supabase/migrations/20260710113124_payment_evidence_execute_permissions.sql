do $$
begin
  execute 'revoke all on function public.review_registration_payment_evidence_atomically(uuid, uuid, text, text) from public, anon, authenticated';
  execute 'grant execute on function public.review_registration_payment_evidence_atomically(uuid, uuid, text, text) to service_role';
end
$$;
