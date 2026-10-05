import { createHash } from "node:crypto";
import type { RequestSession } from "@raceson/domain/auth";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import {
  requireAthleteProfileId,
  requireCategoryAccess,
  requireOrganizationAccess,
  requireRegistrationAccess,
  requireVerifiedEmail,
  resolveRegistrationContext,
} from "./permissions.js";
import { createAdminSupabaseClient } from "./supabase.js";

export type RegistrationCommerceStatus = {
  registrationId: string;
  registrationStatus: string;
  paymentStatus: string;
  participationStatus: string;
  bibNumber: string | null;
  confirmedAt: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  quote: {
    id: string;
    state: string;
    currency: string;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    platformFeeCents: number;
    totalCents: number;
    lineItems: unknown[];
    expiresAt: string | null;
  } | null;
  capacityReservation: {
    state: string;
    source: string;
    expiresAt: string | null;
  } | null;
  waitlist: {
    state: string;
    queuePosition: number;
    offeredAt: string | null;
    offerExpiresAt: string | null;
  } | null;
  latestPaymentAttempt: {
    id: string;
    provider: string;
    status: string;
    amountCents: number;
    currency: string;
    checkoutUrl: string | null;
    expiresAt: string | null;
    completedAt: string | null;
    failureCode: string | null;
  } | null;
};

export type PreparedPaymentAttempt = {
  paymentIntentId: string;
  registrationId: string;
  quoteId: string;
  amountCents: number;
  currency: string;
  status: string;
  checkoutSessionId?: string | null;
  checkoutUrl?: string | null;
  expiresAt: string;
  providerAccountId: string;
  organizationId: string;
  replayed: boolean;
};

export type OrganizationPaymentOnboardingContext = {
  organization: {
    id: string;
    name: string;
    legalName: string | null;
    countryCode: string | null;
    contactEmail: string | null;
  };
  stripeAccount: {
    providerAccountId: string;
    status: string;
    transfersEnabled: boolean;
    payoutsEnabled: boolean;
    lastSyncedAt: string | null;
  } | null;
};

type ProviderPaymentOutcome = "succeeded" | "failed" | "processing" | "cancelled";

function hashIdempotencyKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function throwFinanceRpcError(error: { message: string }): never {
  const message = error.message;
  if (
    message.includes("registration_not_found")
    || message.includes("payment_intent_not_found")
    || message.includes("refund_not_found")
    || message.includes("category_not_found")
  ) {
    throw notFound("Registration commerce record not found");
  }
  if (
    message.includes("idempotency_key_reused")
    || message.includes("checkout_session_already_attached")
  ) {
    throw conflict("The idempotency key was already used for a different request");
  }
  if (message.includes("organization_payment_account_not_ready")) {
    throw conflict("Online card payments are not active for this organizer");
  }
  if (
    message.includes("registration_not_payable")
    || message.includes("registration_quote_expired")
    || message.includes("capacity_reservation_expired")
    || message.includes("settled_payment_not_found")
  ) {
    throw conflict("This registration can no longer be paid in its current state");
  }
  if (
    message.includes("invalid_refund_amount")
    || message.includes("refund_exceeds_settled_amount")
    || message.includes("invalid_offer_duration")
  ) {
    throw badRequest("The requested payment or waitlist operation is invalid");
  }
  throw error;
}

async function requireRegistrationSelfOrOrganizer(
  session: RequestSession,
  registrationId: string,
  env: ServerEnv,
) {
  const context = await resolveRegistrationContext(registrationId, env);
  if (
    session.account.primaryAthleteProfileId
    && context.athleteProfileId === session.account.primaryAthleteProfileId
  ) {
    requireVerifiedEmail(session);
    return context;
  }
  requireOrganizationAccess(session, context.organizationId, "finance.manage");
  return context;
}

export async function getRegistrationCommerceStatus(
  session: RequestSession,
  registrationId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<RegistrationCommerceStatus> {
  await requireRegistrationSelfOrOrganizer(session, registrationId, env);
  return loadRegistrationCommerceStatus(registrationId, env);
}

async function loadRegistrationCommerceStatus(
  registrationId: string,
  env: ServerEnv,
): Promise<RegistrationCommerceStatus> {
  const adminClient = createAdminSupabaseClient(env);

  const { data: registration, error: registrationError } = await adminClient
    .from("registrations")
    .select("id,status,payment_status,participation_status,confirmed_at,paid_at,refunded_at,current_quote_id")
    .eq("id", registrationId)
    .maybeSingle<{
      id: string;
      status: string;
      payment_status: string;
      participation_status: string;
      confirmed_at: string | null;
      paid_at: string | null;
      refunded_at: string | null;
      current_quote_id: string | null;
    }>();
  if (registrationError) throw registrationError;
  if (!registration) throw notFound("Registration not found");

  const [
    quoteResult,
    reservationResult,
    waitlistResult,
    paymentResult,
    bibResult,
  ] = await Promise.all([
    registration.current_quote_id
      ? adminClient
        .from("registration_quotes")
        .select(
          "id,state,currency,subtotal_cents,discount_cents,tax_cents,platform_fee_cents,total_cents,line_items_json,expires_at",
        )
        .eq("id", registration.current_quote_id)
        .maybeSingle<{
          id: string;
          state: string;
          currency: string;
          subtotal_cents: number;
          discount_cents: number;
          tax_cents: number;
          platform_fee_cents: number;
          total_cents: number;
          line_items_json: unknown[];
          expires_at: string;
        }>()
      : Promise.resolve({ data: null, error: null }),
    adminClient
      .from("capacity_reservations")
      .select("state,source,expires_at")
      .eq("registration_id", registrationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ state: string; source: string; expires_at: string }>(),
    adminClient
      .from("registration_waitlist_entries")
      .select("state,queue_position,offered_at,offer_expires_at")
      .eq("registration_id", registrationId)
      .maybeSingle<{
        state: string;
        queue_position: number;
        offered_at: string | null;
        offer_expires_at: string | null;
      }>(),
    adminClient
      .from("payment_intents")
      .select(
        "id,provider,status,amount_cents,currency,checkout_url,expires_at,completed_at,failure_code",
      )
      .eq("registration_id", registrationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{
        id: string;
        provider: string;
        status: string;
        amount_cents: number;
        currency: string;
        checkout_url: string | null;
        expires_at: string | null;
        completed_at: string | null;
        failure_code: string | null;
      }>(),
    adminClient
      .from("bib_assignments")
      .select("bib_number")
      .eq("registration_id", registrationId)
      .is("revoked_at", null)
      .order("assigned_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ bib_number: string }>(),
  ]);

  for (const result of [
    quoteResult,
    reservationResult,
    waitlistResult,
    paymentResult,
    bibResult,
  ]) {
    if (result.error) throw result.error;
  }

  const quote = quoteResult.data;
  const reservation = reservationResult.data;
  const waitlist = waitlistResult.data;
  const payment = paymentResult.data;
  return {
    registrationId: registration.id,
    registrationStatus: registration.status,
    paymentStatus: registration.payment_status,
    participationStatus: registration.participation_status,
    bibNumber: bibResult.data?.bib_number?.trim() || null,
    confirmedAt: registration.confirmed_at,
    paidAt: registration.paid_at,
    refundedAt: registration.refunded_at,
    quote: quote
      ? {
        id: quote.id,
        state: quote.state,
        currency: quote.currency.trim(),
        subtotalCents: quote.subtotal_cents,
        discountCents: quote.discount_cents,
        taxCents: quote.tax_cents,
        platformFeeCents: quote.platform_fee_cents,
        totalCents: quote.total_cents,
        lineItems: quote.line_items_json,
        expiresAt: quote.expires_at === "infinity" ? null : quote.expires_at,
      }
      : null,
    capacityReservation: reservation
      ? {
        state: reservation.state,
        source: reservation.source,
        expiresAt: reservation.expires_at === "infinity" ? null : reservation.expires_at,
      }
      : null,
    waitlist: waitlist
      ? {
        state: waitlist.state,
        queuePosition: waitlist.queue_position,
        offeredAt: waitlist.offered_at,
        offerExpiresAt: waitlist.offer_expires_at,
      }
      : null,
    latestPaymentAttempt: payment
      ? {
        id: payment.id,
        provider: payment.provider,
        status: payment.status,
        amountCents: payment.amount_cents,
        currency: payment.currency.trim(),
        checkoutUrl: payment.checkout_url,
        expiresAt: payment.expires_at,
        completedAt: payment.completed_at,
        failureCode: payment.failure_code,
      }
      : null,
  };
}

async function validateGuestRegistrationAccess(
  registrationId: string,
  guestAccessToken: string,
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc(
    "service_validate_guest_registration_access",
    {
      p_registration_id: registrationId,
      p_token_hash: hashIdempotencyKey(guestAccessToken),
    },
  );
  if (error) {
    if (error.message.includes("invalid_guest_registration_access")) {
      throw forbidden("Guest registration access is invalid or expired");
    }
    throw error;
  }
  if (!data) throw forbidden("Guest registration access is invalid or expired");
  return data as {
    registrationId: string;
    guestEmail: string;
    expiresAt: string;
  };
}

export async function getGuestRegistrationCommerceStatus(
  registrationId: string,
  guestAccessToken: string,
  env: ServerEnv = loadServerEnv(),
) {
  await validateGuestRegistrationAccess(registrationId, guestAccessToken, env);
  return loadRegistrationCommerceStatus(registrationId, env);
}

export async function claimGuestRegistration(
  session: RequestSession,
  registrationId: string,
  guestAccessToken: string,
  env: ServerEnv = loadServerEnv(),
) {
  return claimGuestRegistrationWithTokenHash(
    session,
    registrationId,
    hashIdempotencyKey(guestAccessToken),
    env,
  );
}

type GuestRegistrationClaimResult = {
  registrationId: string;
  athleteProfileId: string;
  claimed: boolean;
  replayed: boolean;
  claimPending: boolean;
  claimRequestId: string | null;
};

async function submitGuestProfileMergeReview(
  session: RequestSession,
  registrationId: string,
  env: ServerEnv,
): Promise<GuestRegistrationClaimResult> {
  const adminClient = createAdminSupabaseClient(env);
  const { data: registration, error: registrationError } = await adminClient
    .from("registrations")
    .select("athlete_profile_id")
    .eq("id", registrationId)
    .maybeSingle<{ athlete_profile_id: string }>();
  if (registrationError) throw registrationError;
  if (!registration) throw notFound("Guest registration not found");

  const { data: request, error: requestError } = await adminClient.rpc(
    "service_submit_athlete_profile_claim",
    {
      p_actor_user_id: session.account.userId,
      p_athlete_profile_id: registration.athlete_profile_id,
      p_evidence_json: {
        source: "guest_registration_claim",
        registrationId,
        verifiedEmail: true,
        originalAccessGrant: true,
      },
      p_note:
        "Requested after a verified account with existing athlete history used the original guest-registration access grant.",
    },
  );
  if (requestError) throw requestError;
  const claimRequest = request as { requestId: string };
  return {
    registrationId,
    athleteProfileId: registration.athlete_profile_id,
    claimed: false,
    replayed: false,
    claimPending: true,
    claimRequestId: claimRequest.requestId,
  };
}

async function claimGuestRegistrationWithTokenHash(
  session: RequestSession,
  registrationId: string,
  tokenHash: string,
  env: ServerEnv,
): Promise<GuestRegistrationClaimResult> {
  requireVerifiedEmail(session);
  const verifiedEmail = session.account.email?.trim().toLowerCase();
  if (!verifiedEmail) {
    throw badRequest("A verified account email is required to claim this registration");
  }

  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_claim_guest_registration", {
    p_registration_id: registrationId,
    p_token_hash: tokenHash,
    p_user_id: session.account.userId,
    p_verified_email: verifiedEmail,
  });

  if (error) {
    if (
      error.message.includes("invalid_guest_registration_access")
      || error.message.includes("guest_claim_email_mismatch")
    ) {
      throw forbidden(
        "Sign in with the verified email used for this guest registration and use its original access link",
      );
    }
    if (error.message.includes("guest_claim_requires_profile_merge")) {
      return submitGuestProfileMergeReview(session, registrationId, env);
    }
    if (error.message.includes("guest_profile_already_claimed")) {
      throw conflict("This guest registration is already claimed by another account");
    }
    if (
      error.message.includes("guest_registration_not_found")
      || error.message.includes("account_profile_not_found")
    ) {
      throw notFound("Guest registration or account profile not found");
    }
    throw error;
  }

  const result = data as {
    registrationId: string;
    athleteProfileId: string;
    claimed: boolean;
    replayed: boolean;
  };
  return {
    ...result,
    claimPending: false,
    claimRequestId: null,
  };
}

export async function createGuestRegistrationClaimIntent(
  registrationId: string,
  guestAccessToken: string,
  env: ServerEnv = loadServerEnv(),
) {
  const access = await validateGuestRegistrationAccess(
    registrationId,
    guestAccessToken,
    env,
  );
  const expiresAt = new Date(Math.min(
    Date.parse(access.expiresAt),
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  )).toISOString();
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("guest_registration_claim_intents")
    .insert({
      registration_id: registrationId,
      token_hash: hashIdempotencyKey(guestAccessToken),
      expires_at: expiresAt,
    })
    .select("id,registration_id,expires_at")
    .single<{ id: string; registration_id: string; expires_at: string }>();
  if (error) {
    const missingIntentStorage = error.code === "42P01"
      || error.code === "PGRST205"
      || error.message.includes("guest_registration_claim_intents");
    if (!missingIntentStorage) throw error;
    return {
      intentId: null,
      registrationId,
      expiresAt,
    };
  }
  return {
    intentId: data.id,
    registrationId: data.registration_id,
    expiresAt: data.expires_at,
  };
}

export async function claimGuestRegistrationIntent(
  session: RequestSession,
  intentId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<GuestRegistrationClaimResult> {
  const adminClient = createAdminSupabaseClient(env);
  const { data: intent, error } = await adminClient
    .from("guest_registration_claim_intents")
    .select("id,registration_id,token_hash,expires_at,claimed_by_user_id,claimed_at,outcome,claim_request_id")
    .eq("id", intentId)
    .maybeSingle<{
      id: string;
      registration_id: string;
      token_hash: string;
      expires_at: string;
      claimed_by_user_id: string | null;
      claimed_at: string | null;
      outcome: "claimed" | "pending_review" | null;
      claim_request_id: string | null;
    }>();
  if (error) throw error;
  if (!intent || Date.parse(intent.expires_at) <= Date.now()) {
    throw forbidden("This guest registration claim link is invalid or expired");
  }

  if (intent.claimed_at) {
    if (intent.claimed_by_user_id !== session.account.userId) {
      throw forbidden("This guest registration claim link has already been used");
    }
    const { data: registration, error: registrationError } = await adminClient
      .from("registrations")
      .select("athlete_profile_id")
      .eq("id", intent.registration_id)
      .single<{ athlete_profile_id: string }>();
    if (registrationError) throw registrationError;
    return {
      registrationId: intent.registration_id,
      athleteProfileId: registration.athlete_profile_id,
      claimed: intent.outcome === "claimed",
      replayed: true,
      claimPending: intent.outcome === "pending_review",
      claimRequestId: intent.claim_request_id,
    };
  }

  const result = await claimGuestRegistrationWithTokenHash(
    session,
    intent.registration_id,
    intent.token_hash,
    env,
  );
  const { data: consumed, error: consumeError } = await adminClient
    .from("guest_registration_claim_intents")
    .update({
      claimed_by_user_id: session.account.userId,
      claimed_at: new Date().toISOString(),
      outcome: result.claimPending ? "pending_review" : "claimed",
      claim_request_id: result.claimRequestId,
    })
    .eq("id", intent.id)
    .is("claimed_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (consumeError) throw consumeError;
  if (!consumed) throw conflict("This guest registration claim link was used in another session");
  return result;
}

export async function prepareStripePaymentAttempt(
  session: RequestSession,
  registrationId: string,
  idempotencyKey: string,
  env: ServerEnv = loadServerEnv(),
) {
  const athleteProfileId = requireAthleteProfileId(session);
  const context = await resolveRegistrationContext(registrationId, env);
  requireVerifiedEmail(session);
  if (context.athleteProfileId !== athleteProfileId) {
    throw forbidden("You can only pay for your own registration");
  }

  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_prepare_payment_attempt", {
    p_registration_id: registrationId,
    p_actor_user_id: session.account.userId,
    p_provider: "stripe",
    p_idempotency_key_hash: hashIdempotencyKey(idempotencyKey),
  });
  if (error) throwFinanceRpcError(error);
  if (!data) throw new Error("Payment preparation returned no result");
  return data as PreparedPaymentAttempt;
}

export async function attachStripeCheckoutSession(
  session: RequestSession,
  input: {
    paymentIntentId: string;
    checkoutSessionId: string;
    checkoutUrl: string;
    expiresAt: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_attach_payment_checkout", {
    p_payment_intent_id: input.paymentIntentId,
    p_actor_user_id: session.account.userId,
    p_provider_checkout_session_id: input.checkoutSessionId,
    p_checkout_url: input.checkoutUrl,
    p_expires_at: input.expiresAt,
  });
  if (error) throwFinanceRpcError(error);
  if (!data) throw new Error("Checkout attachment returned no result");
  return data as Record<string, unknown>;
}

export async function prepareGuestStripePaymentAttempt(
  registrationId: string,
  guestAccessToken: string,
  idempotencyKey: string,
  env: ServerEnv = loadServerEnv(),
) {
  const guestAccess = await validateGuestRegistrationAccess(
    registrationId,
    guestAccessToken,
    env,
  );
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_prepare_payment_attempt", {
    p_registration_id: registrationId,
    p_actor_user_id: null,
    p_provider: "stripe",
    p_idempotency_key_hash: hashIdempotencyKey(idempotencyKey),
  });
  if (error) throwFinanceRpcError(error);
  if (!data) throw new Error("Guest payment preparation returned no result");
  return {
    attempt: data as PreparedPaymentAttempt,
    guestEmail: guestAccess.guestEmail,
  };
}

export async function attachGuestStripeCheckoutSession(
  input: {
    registrationId: string;
    guestAccessToken: string;
    paymentIntentId: string;
    checkoutSessionId: string;
    checkoutUrl: string;
    expiresAt: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await validateGuestRegistrationAccess(
    input.registrationId,
    input.guestAccessToken,
    env,
  );
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_attach_payment_checkout", {
    p_payment_intent_id: input.paymentIntentId,
    p_actor_user_id: null,
    p_provider_checkout_session_id: input.checkoutSessionId,
    p_checkout_url: input.checkoutUrl,
    p_expires_at: input.expiresAt,
  });
  if (error) throwFinanceRpcError(error);
  if (!data) throw new Error("Guest checkout attachment returned no result");
  return data as Record<string, unknown>;
}

export async function applyStripeProviderEvent(
  input: {
    providerEventId: string;
    eventType: string;
    livemode: boolean;
    payload: Record<string, unknown>;
    paymentIntentId: string | null;
    providerPaymentIntentId: string | null;
    outcome: ProviderPaymentOutcome;
    amountCents: number | null;
    currency: string | null;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_apply_payment_provider_event", {
    p_provider: "stripe",
    p_provider_event_id: input.providerEventId,
    p_event_type: input.eventType,
    p_signature_verified: true,
    p_livemode: input.livemode,
    p_payload_json: input.payload,
    p_payment_intent_id: input.paymentIntentId,
    p_provider_payment_intent_id: input.providerPaymentIntentId,
    p_outcome: input.outcome,
    p_amount_cents: input.amountCents,
    p_currency: input.currency,
  });
  if (error) throwFinanceRpcError(error);
  if (!data) throw new Error("Provider race application returned no result");
  return data as Record<string, unknown>;
}

export async function promoteNextWaitlistRegistration(
  session: RequestSession,
  categoryId: string,
  env: ServerEnv = loadServerEnv(),
) {
  await requireCategoryAccess(session, categoryId, "finance.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_promote_waitlist_offer", {
    p_event_category_id: categoryId,
    p_actor_user_id: session.account.userId,
  });
  if (error) throwFinanceRpcError(error);
  return data as Record<string, unknown> | null;
}

export async function prepareStripeRefund(
  session: RequestSession,
  input: {
    registrationId: string;
    amountCents: number;
    reason: string;
    organizerNote?: string | null;
    idempotencyKey: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireRegistrationAccess(session, input.registrationId, "finance.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_prepare_payment_refund", {
    p_registration_id: input.registrationId,
    p_actor_user_id: session.account.userId,
    p_amount_cents: input.amountCents,
    p_reason: input.reason,
    p_organizer_note: input.organizerNote ?? null,
    p_idempotency_key_hash: hashIdempotencyKey(input.idempotencyKey),
  });
  if (error) throwFinanceRpcError(error);
  if (!data) throw new Error("Refund preparation returned no result");
  return data as {
    refundId: string;
    registrationId: string;
    paymentIntentId: string;
    providerPaymentIntentId: string;
    amountCents: number;
    currency: string;
    status: string;
    providerRefundId?: string | null;
    replayed: boolean;
  };
}

export async function completeStripeRefund(
  session: RequestSession,
  input: {
    refundId: string;
    providerRefundId: string | null;
    succeeded: boolean;
    failureMessage?: string | null;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: refund, error: refundError } = await adminClient
    .from("payment_refunds")
    .select("registration_id")
    .eq("id", input.refundId)
    .maybeSingle<{ registration_id: string }>();
  if (refundError) throw refundError;
  if (!refund) throw notFound("Refund not found");
  await requireRegistrationAccess(session, refund.registration_id, "finance.manage", env);

  const { data, error } = await adminClient.rpc("service_complete_payment_refund", {
    p_refund_id: input.refundId,
    p_actor_user_id: session.account.userId,
    p_provider_refund_id: input.providerRefundId,
    p_succeeded: input.succeeded,
    p_failure_message: input.failureMessage ?? null,
  });
  if (error) throwFinanceRpcError(error);
  if (!data) throw new Error("Refund completion returned no result");
  return data as Record<string, unknown>;
}

export async function recordStripeRefundState(
  session: RequestSession,
  input: {
    refundId: string;
    providerRefundId: string | null;
    providerStatus: "pending" | "succeeded" | "failed" | "cancelled";
    failureMessage?: string | null;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: refund, error: refundError } = await adminClient
    .from("payment_refunds")
    .select("registration_id")
    .eq("id", input.refundId)
    .maybeSingle<{ registration_id: string }>();
  if (refundError) throw refundError;
  if (!refund) throw notFound("Refund not found");
  await requireRegistrationAccess(session, refund.registration_id, "finance.manage", env);

  const { data, error } = await adminClient.rpc("service_record_payment_refund_state", {
    p_refund_id: input.refundId,
    p_actor_user_id: session.account.userId,
    p_provider_refund_id: input.providerRefundId,
    p_provider_status: input.providerStatus,
    p_failure_message: input.failureMessage ?? null,
  });
  if (error) throwFinanceRpcError(error);
  if (!data) throw new Error("Refund state update returned no result");
  return data as Record<string, unknown>;
}

export async function applyStripeRefundProviderEvent(
  input: {
    providerEventId: string;
    eventType: string;
    livemode: boolean;
    payload: Record<string, unknown>;
    refundId: string | null;
    providerRefundId: string;
    providerStatus: "pending" | "succeeded" | "failed" | "cancelled";
    failureMessage?: string | null;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_apply_refund_provider_event", {
    p_provider: "stripe",
    p_provider_event_id: input.providerEventId,
    p_event_type: input.eventType,
    p_signature_verified: true,
    p_livemode: input.livemode,
    p_payload_json: input.payload,
    p_refund_id: input.refundId,
    p_provider_refund_id: input.providerRefundId,
    p_provider_status: input.providerStatus,
    p_failure_message: input.failureMessage ?? null,
  });
  if (error) throwFinanceRpcError(error);
  if (!data) throw new Error("Refund provider race returned no result");
  return data as Record<string, unknown>;
}

export async function runPaymentReconciliation(
  session: RequestSession,
  organizationId: string,
  env: ServerEnv = loadServerEnv(),
) {
  requireOrganizationAccess(session, organizationId, "finance.manage");
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_run_payment_reconciliation", {
    p_organization_id: organizationId,
    p_actor_user_id: session.account.userId,
  });
  if (error) throwFinanceRpcError(error);
  if (!data) throw new Error("Reconciliation returned no result");
  return data as Record<string, unknown>;
}

export async function getOrganizationPaymentOnboardingContext(
  session: RequestSession,
  organizationId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<OrganizationPaymentOnboardingContext> {
  requireOrganizationAccess(session, organizationId, "finance.manage");
  const adminClient = createAdminSupabaseClient(env);
  const [{ data: organization, error: organizationError }, { data: account, error: accountError }] =
    await Promise.all([
      adminClient
        .from("organizations")
        .select("id,name,legal_name,country_code,contact_email")
        .eq("id", organizationId)
        .maybeSingle<{
          id: string;
          name: string;
          legal_name: string | null;
          country_code: string | null;
          contact_email: string | null;
        }>(),
      adminClient
        .from("organization_payment_accounts")
        .select(
          "provider_account_id,status,charges_enabled,payouts_enabled,last_synced_at",
        )
        .eq("organization_id", organizationId)
        .eq("provider", "stripe")
        .maybeSingle<{
          provider_account_id: string | null;
          status: string;
          charges_enabled: boolean;
          payouts_enabled: boolean;
          last_synced_at: string | null;
        }>(),
    ]);

  if (organizationError) throw organizationError;
  if (accountError) throw accountError;
  if (!organization) throw notFound("Organization not found");

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      legalName: organization.legal_name,
      countryCode: organization.country_code,
      contactEmail: organization.contact_email,
    },
    stripeAccount: account?.provider_account_id
      ? {
        providerAccountId: account.provider_account_id,
        status: account.status,
        transfersEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        lastSyncedAt: account.last_synced_at,
      }
      : null,
  };
}

export async function saveOrganizationStripeAccount(
  session: RequestSession,
  input: {
    organizationId: string;
    providerAccountId: string;
    status: "not_started" | "onboarding" | "restricted" | "active" | "disabled";
    transfersEnabled: boolean;
    payoutsEnabled: boolean;
    onboardingState: Record<string, unknown>;
    requirementsSnapshot: Record<string, unknown>;
  },
  env: ServerEnv = loadServerEnv(),
) {
  requireOrganizationAccess(session, input.organizationId, "finance.manage");
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_save_organization_payment_account", {
    p_organization_id: input.organizationId,
    p_actor_user_id: session.account.userId,
    p_provider_account_id: input.providerAccountId,
    p_status: input.status,
    p_transfers_enabled: input.transfersEnabled,
    p_payouts_enabled: input.payoutsEnabled,
    p_onboarding_state_json: input.onboardingState,
    p_requirements_snapshot_json: input.requirementsSnapshot,
  });
  if (error) throwFinanceRpcError(error);
  if (!data) throw new Error("Payment account sync returned no result");
  return data as Record<string, unknown>;
}
