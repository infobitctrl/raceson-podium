/*
 * Payment-evidence metadata is a server-owned operational record.
 *
 * Authenticated clients upload the private object through the narrowly scoped
 * storage.objects policy, then register and review it through the API. Keeping
 * table privileges service-role-only prevents direct clients from bypassing the
 * atomic review workflow or creating conflicting review/payment state.
 */
revoke all on table public.registration_payment_evidence
  from public, anon, authenticated;

grant all on table public.registration_payment_evidence
  to service_role;
