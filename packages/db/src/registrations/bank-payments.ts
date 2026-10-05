import { createHash } from "node:crypto";
import type { RequestSession } from "@raceson/domain/auth";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { loadServerEnv, type ServerEnv } from "../env.js";
import {
  requireEditionAccess,
  requireOrganizationAccess,
  requireRegistrationAccess,
  requireVerifiedEmail,
  resolveRegistrationContext,
} from "../permissions.js";
import { createAdminSupabaseClient } from "../supabase.js";

const SUPPORTED_PAYMENT_MODELS = new Set(["HR00", "HR01"]);
const SUPPORTED_PURPOSE_CODES = new Set(["COST", "ADMG", "SCVE", "OTHR"]);

export type OrganizerBankTransferProfile = {
  id: string;
  organizationId: string;
  accountHolderName: string;
  iban: string;
  bic: string | null;
  accountHolderAddress: string | null;
  accountHolderPostalCode: string | null;
  accountHolderCity: string | null;
  accountHolderCountryCode: string;
  paymentModel: string;
  purposeCode: string;
  active: boolean;
  updatedAt: string;
};

export type OrganizerBankTransferContext = {
  organization: {
    id: string;
    name: string;
    legalName: string | null;
    countryCode: string | null;
  };
  profile: OrganizerBankTransferProfile | null;
};

export type OrganizerEventPaymentSetup = {
  eventId: string;
  organizationId: string;
  paidRaces: Array<{
    id: string;
    name: string;
    feeCents: number;
    currency: string;
  }>;
  profile: OrganizerBankTransferProfile | null;
  bankTransferEnabled: boolean;
  onsitePaymentEnabled: boolean;
  confirmed: boolean;
  confirmedAt: string | null;
  ready: boolean;
};

export type RegistrationBankTransferInstructions = {
  id: string;
  registrationId: string;
  quoteId: string;
  status: "awaiting_payment" | "reported" | "paid" | "cancelled";
  amountCents: number;
  currency: string;
  recipient: {
    name: string;
    iban: string;
    bic: string | null;
    address: string | null;
    postalCode: string | null;
    city: string | null;
    countryCode: string;
  };
  payer: {
    name: string;
    address: string | null;
    postalCode: string | null;
    city: string | null;
  };
  paymentModel: string;
  reference: string;
  purposeCode: string;
  description: string;
  dueAt: string;
  paymentReportedAt: string | null;
  settledAt: string | null;
  createdAt: string;
  eventName: string;
  categoryName: string;
  events: Array<{
    id: string;
    type: string;
    source: string;
    amountCents: number | null;
    currency: string | null;
    bankReference: string | null;
    reason: string | null;
    effectiveAt: string;
  }>;
};

type BankTransferProfileRow = {
  id: string;
  organization_id: string;
  account_holder_name: string;
  iban: string;
  bic: string | null;
  account_holder_address: string | null;
  account_holder_postal_code: string | null;
  account_holder_city: string | null;
  account_holder_country_code: string;
  payment_model: string;
  purpose_code: string;
  is_active: boolean;
  updated_at: string;
};

function mapBankTransferProfile(row: BankTransferProfileRow): OrganizerBankTransferProfile {
  return {
    id: row.id,
    organizationId: row.organization_id,
    accountHolderName: row.account_holder_name,
    iban: row.iban,
    bic: row.bic,
    accountHolderAddress: row.account_holder_address,
    accountHolderPostalCode: row.account_holder_postal_code,
    accountHolderCity: row.account_holder_city,
    accountHolderCountryCode: row.account_holder_country_code.trim(),
    paymentModel: row.payment_model,
    purposeCode: row.purpose_code.trim(),
    active: row.is_active,
    updatedAt: row.updated_at,
  };
}

export function normalizeIban(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function isValidIban(value: string) {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith("HR") && !/^HR\d{19}$/.test(iban)) return false;
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const numeric = character >= "A"
      ? String(character.charCodeAt(0) - 55)
      : character;
    for (const digit of numeric) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

function normalizeOptional(value: string | null | undefined) {
  return value?.trim() || null;
}

function throwBankTransferRpcError(error: { message: string }): never {
  const message = error.message;
  if (message.includes("registration_not_found")) {
    throw notFound("Registration not found");
  }
  if (message.includes("bank_transfer_request_not_found")) {
    throw conflict("Bank transfer instructions are not available for this registration");
  }
  if (
    message.includes("invalid_bank_transfer_profile")
    || message.includes("invalid_manual_bank_payment")
    || message.includes("manual_bank_payment_amount_mismatch")
    || message.includes("manual_bank_payment_quote_mismatch")
  ) {
    throw badRequest("The bank transfer details do not match this registration payment request");
  }
  if (message.includes("registration_already_paid")) {
    throw conflict("This registration is already paid");
  }
  if (message.includes("bank_payment_idempotency_conflict")) {
    throw conflict("This bank payment request was already used for another registration");
  }
  if (message.includes("capacity_reservation_expired")) {
    throw conflict("The reserved place expired and the category is now full");
  }
  throw error;
}

async function requireRegistrationSelfOrFinance(
  session: RequestSession,
  registrationId: string,
  env: ServerEnv,
) {
  const context = await resolveRegistrationContext(registrationId, env);
  if (
    session.account.primaryAthleteProfileId
    && session.account.primaryAthleteProfileId === context.athleteProfileId
  ) {
    requireVerifiedEmail(session);
    return context;
  }
  requireOrganizationAccess(session, context.organizationId, "finance.manage");
  return context;
}

export async function getOrganizerBankTransferContext(
  session: RequestSession,
  organizationId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<OrganizerBankTransferContext> {
  requireOrganizationAccess(session, organizationId, "finance.manage");
  const adminClient = createAdminSupabaseClient(env);
  const [{ data: organization, error: organizationError }, { data: profile, error: profileError }] =
    await Promise.all([
      adminClient
        .from("organizations")
        .select("id,name,legal_name,country_code")
        .eq("id", organizationId)
        .maybeSingle<{
          id: string;
          name: string;
          legal_name: string | null;
          country_code: string | null;
        }>(),
      adminClient
        .from("organization_bank_transfer_profiles")
        .select("id,organization_id,account_holder_name,iban,bic,account_holder_address,account_holder_postal_code,account_holder_city,account_holder_country_code,payment_model,purpose_code,is_active,updated_at")
        .eq("organization_id", organizationId)
        .maybeSingle<BankTransferProfileRow>(),
    ]);

  if (organizationError) throw organizationError;
  if (profileError) throw profileError;
  if (!organization) throw notFound("Organization not found");

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      legalName: organization.legal_name,
      countryCode: organization.country_code?.trim() || null,
    },
    profile: profile ? mapBankTransferProfile(profile) : null,
  };
}

export async function getOrganizerEventPaymentSetup(
  session: RequestSession,
  eventId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<OrganizerEventPaymentSetup> {
  const edition = await requireEditionAccess(session, eventId, "manage", env);
  requireOrganizationAccess(session, edition.organizationId, "finance.manage");
  const adminClient = createAdminSupabaseClient(env);
  const [categoriesResult, profileResult, settingResult] = await Promise.all([
    adminClient
      .from("event_categories")
      .select("id,name,registration_fee_cents,currency")
      .eq("event_edition_id", eventId)
      .neq("status", "draft")
      .gt("registration_fee_cents", 0)
      .order("name")
      .returns<Array<{
        id: string;
        name: string;
        registration_fee_cents: number;
        currency: string | null;
      }>>(),
    adminClient
      .from("organization_bank_transfer_profiles")
      .select("id,organization_id,account_holder_name,iban,bic,account_holder_address,account_holder_postal_code,account_holder_city,account_holder_country_code,payment_model,purpose_code,is_active,updated_at")
      .eq("organization_id", edition.organizationId)
      .maybeSingle<BankTransferProfileRow>(),
    adminClient
      .from("event_bank_transfer_settings")
      .select("bank_transfer_profile_id,is_enabled,onsite_payment_enabled,confirmed_at")
      .eq("event_edition_id", eventId)
      .maybeSingle<{
        bank_transfer_profile_id: string | null;
        is_enabled: boolean;
        onsite_payment_enabled: boolean;
        confirmed_at: string;
      }>(),
  ]);

  if (categoriesResult.error) throw categoriesResult.error;
  if (profileResult.error) throw profileResult.error;
  if (settingResult.error) throw settingResult.error;

  const profile = profileResult.data ? mapBankTransferProfile(profileResult.data) : null;
  const bankTransferEnabled = settingResult.data?.is_enabled === true;
  const onsitePaymentEnabled = settingResult.data?.onsite_payment_enabled === true;
  const hasPaymentMethod = bankTransferEnabled || onsitePaymentEnabled;
  const bankTransferReady = !bankTransferEnabled || Boolean(
    profile?.active
    && settingResult.data?.bank_transfer_profile_id === profile.id
    && Date.parse(settingResult.data.confirmed_at) >= Date.parse(profile.updatedAt)
  );
  const confirmed = Boolean(
    settingResult.data
    && hasPaymentMethod
    && bankTransferReady
  );
  const paidRaces = (categoriesResult.data ?? []).map((category) => ({
    id: category.id,
    name: category.name,
    feeCents: category.registration_fee_cents,
    currency: category.currency?.trim() || "EUR",
  }));

  return {
    eventId,
    organizationId: edition.organizationId,
    paidRaces,
    profile,
    bankTransferEnabled,
    onsitePaymentEnabled,
    confirmed,
    confirmedAt: confirmed ? settingResult.data?.confirmed_at ?? null : null,
    ready: paidRaces.length === 0 || confirmed,
  };
}

export async function confirmOrganizerEventPaymentSetup(
  session: RequestSession,
  eventId: string,
  input: {
    bankTransferEnabled: boolean;
    onsitePaymentEnabled: boolean;
  },
  env: ServerEnv = loadServerEnv(),
): Promise<OrganizerEventPaymentSetup> {
  const setup = await getOrganizerEventPaymentSetup(session, eventId, env);
  if (!setup.paidRaces.length) return setup;
  if (!input.bankTransferEnabled && !input.onsitePaymentEnabled) {
    throw badRequest("Enable bank transfer, onsite payment, or both for this paid race");
  }
  if (input.bankTransferEnabled && !setup.profile?.active) {
    throw conflict("Configure and activate the organizer bank-transfer details before confirming this race");
  }

  const adminClient = createAdminSupabaseClient(env);
  const confirmedAt = new Date().toISOString();
  const { error: settingError } = await adminClient
    .from("event_bank_transfer_settings")
    .upsert({
      event_edition_id: eventId,
      organization_id: setup.organizationId,
      bank_transfer_profile_id: input.bankTransferEnabled ? setup.profile?.id ?? null : null,
      is_enabled: input.bankTransferEnabled,
      onsite_payment_enabled: input.onsitePaymentEnabled,
      confirmed_by_user_id: session.account.userId,
      confirmed_at: confirmedAt,
    }, { onConflict: "event_edition_id" });
  if (settingError) throw settingError;

  let existingRegistrationCount = 0;
  if (input.bankTransferEnabled) {
    const categoryIds = setup.paidRaces.map((race) => race.id);
    const { data: registrations, error: registrationsError } = await adminClient
      .from("registrations")
      .select("id")
      .in("event_category_id", categoryIds)
      .in("payment_status", ["unpaid", "pending", "failed"])
      .neq("status", "waitlisted")
      .limit(1_000)
      .returns<Array<{ id: string }>>();
    if (registrationsError) throw registrationsError;
    existingRegistrationCount = registrations?.length ?? 0;

    for (const registration of registrations ?? []) {
      const { error } = await adminClient.rpc("service_ensure_registration_bank_transfer_request", {
        p_registration_id: registration.id,
        p_actor_user_id: session.account.userId,
      });
      if (error) throwBankTransferRpcError(error);
    }
  }

  const { error: auditError } = await adminClient.from("audit_log").insert({
    organization_id: setup.organizationId,
    actor_user_id: session.account.userId,
    entity_type: "event_edition",
    entity_id: eventId,
    action: "event_payment_methods.confirmed",
    metadata_json: {
      bankTransferEnabled: input.bankTransferEnabled,
      onsitePaymentEnabled: input.onsitePaymentEnabled,
      bankTransferProfileId: input.bankTransferEnabled ? setup.profile?.id ?? null : null,
      paidRaceCount: setup.paidRaces.length,
      existingRegistrationCount,
    },
  });
  if (auditError) throw auditError;

  return getOrganizerEventPaymentSetup(session, eventId, env);
}

export async function saveOrganizerBankTransferProfile(
  session: RequestSession,
  input: {
    organizationId: string;
    accountHolderName: string;
    iban: string;
    bic?: string | null;
    accountHolderAddress?: string | null;
    accountHolderPostalCode?: string | null;
    accountHolderCity?: string | null;
    accountHolderCountryCode: string;
    paymentModel: string;
    purposeCode: string;
    active: boolean;
  },
  env: ServerEnv = loadServerEnv(),
) {
  requireOrganizationAccess(session, input.organizationId, "finance.manage");
  const iban = normalizeIban(input.iban);
  const bic = normalizeOptional(input.bic)?.replace(/\s+/g, "").toUpperCase() ?? null;
  if (!isValidIban(iban)) throw badRequest("Enter a valid IBAN");
  if (bic && !/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) {
    throw badRequest("Enter a valid BIC / SWIFT with an 8- or 11-character bank code");
  }
  if (!SUPPORTED_PAYMENT_MODELS.has(input.paymentModel.trim().toUpperCase())) {
    throw badRequest("Choose a supported payment reference model");
  }
  if (!SUPPORTED_PURPOSE_CODES.has(input.purposeCode.trim().toUpperCase())) {
    throw badRequest("Choose a supported payment purpose code");
  }

  const adminClient = createAdminSupabaseClient(env);
  const { error } = await adminClient.rpc("service_save_organization_bank_transfer_profile", {
    p_organization_id: input.organizationId,
    p_actor_user_id: session.account.userId,
    p_account_holder_name: input.accountHolderName.trim(),
    p_iban: iban,
    p_bic: bic,
    p_account_holder_address: normalizeOptional(input.accountHolderAddress),
    p_account_holder_postal_code: normalizeOptional(input.accountHolderPostalCode),
    p_account_holder_city: normalizeOptional(input.accountHolderCity),
    p_account_holder_country_code: input.accountHolderCountryCode.trim().toUpperCase(),
    p_payment_model: input.paymentModel.trim().toUpperCase(),
    p_purpose_code: input.purposeCode.trim().toUpperCase(),
    p_is_active: input.active,
  });
  if (error) throwBankTransferRpcError(error);
  return getOrganizerBankTransferContext(session, input.organizationId, env);
}

async function loadRegistrationBankTransferInstructions(
  registrationId: string,
  env: ServerEnv,
): Promise<RegistrationBankTransferInstructions | null> {
  const adminClient = createAdminSupabaseClient(env);
  const { data: request, error: requestError } = await adminClient
    .from("registration_payment_requests")
    .select("id,registration_id,quote_id,status,amount_cents,currency,recipient_name,recipient_iban,recipient_bic,recipient_address,recipient_postal_code,recipient_city,recipient_country_code,payment_model,reference_value,purpose_code,payment_description,due_at,payment_reported_at,settled_at,created_at")
    .eq("registration_id", registrationId)
    .maybeSingle<{
      id: string;
      registration_id: string;
      quote_id: string;
      status: RegistrationBankTransferInstructions["status"];
      amount_cents: number;
      currency: string;
      recipient_name: string;
      recipient_iban: string;
      recipient_bic: string | null;
      recipient_address: string | null;
      recipient_postal_code: string | null;
      recipient_city: string | null;
      recipient_country_code: string;
      payment_model: string;
      reference_value: string;
      purpose_code: string;
      payment_description: string;
      due_at: string;
      payment_reported_at: string | null;
      settled_at: string | null;
      created_at: string;
    }>();
  if (requestError) throw requestError;
  if (!request) return null;

  const [{ data: registration, error: registrationError }, { data: events, error: eventsError }] =
    await Promise.all([
      adminClient
        .from("registrations")
        .select("athlete_profile_id,event_category_id,payment_status")
        .eq("id", registrationId)
        .maybeSingle<{
          athlete_profile_id: string;
          event_category_id: string;
          payment_status: string;
        }>(),
      adminClient
        .from("registration_payment_events")
        .select("id,event_type,source,amount_cents,currency,bank_reference,reason,effective_at")
        .eq("payment_request_id", request.id)
        .order("effective_at", { ascending: false })
        .returns<Array<{
          id: string;
          event_type: string;
          source: string;
          amount_cents: number | null;
          currency: string | null;
          bank_reference: string | null;
          reason: string | null;
          effective_at: string;
        }>>(),
    ]);
  if (registrationError) throw registrationError;
  if (eventsError) throw eventsError;
  if (!registration) throw notFound("Registration not found");

  const [{ data: athlete, error: athleteError }, { data: category, error: categoryError }] =
    await Promise.all([
      adminClient
        .from("athlete_profiles")
        .select("display_name,city")
        .eq("id", registration.athlete_profile_id)
        .maybeSingle<{ display_name: string; city: string | null }>(),
      adminClient
        .from("event_categories")
        .select("name,event_edition_id")
        .eq("id", registration.event_category_id)
        .maybeSingle<{ name: string; event_edition_id: string }>(),
    ]);
  if (athleteError) throw athleteError;
  if (categoryError) throw categoryError;
  if (!athlete || !category) throw notFound("Registration payment context not found");

  const { data: edition, error: editionError } = await adminClient
    .from("event_editions")
    .select("name")
    .eq("id", category.event_edition_id)
    .maybeSingle<{ name: string }>();
  if (editionError) throw editionError;
  if (!edition) throw notFound("Race edition not found");

  const settled = registration.payment_status === "paid" || request.status === "paid";
  return {
    id: request.id,
    registrationId: request.registration_id,
    quoteId: request.quote_id,
    status: settled ? "paid" : request.status,
    amountCents: request.amount_cents,
    currency: request.currency.trim(),
    recipient: {
      name: request.recipient_name,
      iban: request.recipient_iban,
      bic: request.recipient_bic,
      address: request.recipient_address,
      postalCode: request.recipient_postal_code,
      city: request.recipient_city,
      countryCode: request.recipient_country_code.trim(),
    },
    payer: {
      name: athlete.display_name,
      address: null,
      postalCode: null,
      city: athlete.city,
    },
    paymentModel: request.payment_model,
    reference: request.reference_value,
    purposeCode: request.purpose_code.trim(),
    description: request.payment_description,
    dueAt: request.due_at,
    paymentReportedAt: request.payment_reported_at,
    settledAt: request.settled_at,
    createdAt: request.created_at,
    eventName: edition.name,
    categoryName: category.name,
    events: (events ?? []).map((event) => ({
      id: event.id,
      type: event.event_type,
      source: event.source,
      amountCents: event.amount_cents,
      currency: event.currency?.trim() || null,
      bankReference: event.bank_reference,
      reason: event.reason,
      effectiveAt: event.effective_at,
    })),
  };
}

export async function getRegistrationBankTransferInstructions(
  session: RequestSession,
  registrationId: string,
  env: ServerEnv = loadServerEnv(),
) {
  await requireRegistrationSelfOrFinance(session, registrationId, env);
  const adminClient = createAdminSupabaseClient(env);
  const { error } = await adminClient.rpc("service_ensure_registration_bank_transfer_request", {
    p_registration_id: registrationId,
    p_actor_user_id: session.account.userId,
  });
  if (error) throwBankTransferRpcError(error);
  return loadRegistrationBankTransferInstructions(registrationId, env);
}

export async function reportRegistrationBankTransfer(
  session: RequestSession,
  registrationId: string,
  note: string | null,
  env: ServerEnv = loadServerEnv(),
) {
  const context = await resolveRegistrationContext(registrationId, env);
  requireVerifiedEmail(session);
  if (session.account.primaryAthleteProfileId !== context.athleteProfileId) {
    throw forbidden("You can only report payment for your own registration");
  }
  const adminClient = createAdminSupabaseClient(env);
  const { error } = await adminClient.rpc("service_report_registration_bank_transfer", {
    p_registration_id: registrationId,
    p_actor_user_id: session.account.userId,
    p_note: normalizeOptional(note),
  });
  if (error) throwBankTransferRpcError(error);
  return loadRegistrationBankTransferInstructions(registrationId, env);
}

async function validateGuestRegistrationAccess(
  registrationId: string,
  guestAccessToken: string,
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_validate_guest_registration_access", {
    p_registration_id: registrationId,
    p_token_hash: createHash("sha256").update(guestAccessToken).digest("hex"),
  });
  if (error || !data) throw forbidden("Guest registration access is invalid or expired");
}

export async function getGuestRegistrationBankTransferInstructions(
  registrationId: string,
  guestAccessToken: string,
  env: ServerEnv = loadServerEnv(),
) {
  await validateGuestRegistrationAccess(registrationId, guestAccessToken, env);
  const adminClient = createAdminSupabaseClient(env);
  const { error } = await adminClient.rpc("service_ensure_registration_bank_transfer_request", {
    p_registration_id: registrationId,
    p_actor_user_id: null,
  });
  if (error) throwBankTransferRpcError(error);
  return loadRegistrationBankTransferInstructions(registrationId, env);
}

export async function reportGuestRegistrationBankTransfer(
  registrationId: string,
  guestAccessToken: string,
  note: string | null,
  env: ServerEnv = loadServerEnv(),
) {
  await validateGuestRegistrationAccess(registrationId, guestAccessToken, env);
  const adminClient = createAdminSupabaseClient(env);
  const { error } = await adminClient.rpc("service_report_registration_bank_transfer", {
    p_registration_id: registrationId,
    p_actor_user_id: null,
    p_note: normalizeOptional(note),
  });
  if (error) throwBankTransferRpcError(error);
  return loadRegistrationBankTransferInstructions(registrationId, env);
}

export async function recordRegistrationBankPayment(
  session: RequestSession,
  input: {
    registrationId: string;
    amountCents: number;
    currency: string;
    paidAt: string;
    bankReference?: string | null;
    reason: string;
    idempotencyKey: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireRegistrationAccess(session, input.registrationId, "finance.manage", env);
  const paidAt = new Date(input.paidAt);
  if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 5 * 60_000) {
    throw badRequest("Enter a valid payment booking time");
  }
  const adminClient = createAdminSupabaseClient(env);
  const { error } = await adminClient.rpc("service_record_registration_bank_payment", {
    p_registration_id: input.registrationId,
    p_actor_user_id: session.account.userId,
    p_amount_cents: input.amountCents,
    p_currency: input.currency.trim().toUpperCase(),
    p_paid_at: paidAt.toISOString(),
    p_bank_reference: normalizeOptional(input.bankReference),
    p_reason: input.reason.trim(),
    p_idempotency_key_hash: createHash("sha256").update(input.idempotencyKey).digest("hex"),
  });
  if (error) throwBankTransferRpcError(error);
  return loadRegistrationBankTransferInstructions(input.registrationId, env);
}

export async function recordRegistrationDeskPayment(
  session: RequestSession,
  input: {
    registrationId: string;
    idempotencyKey: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const context = await requireRegistrationAccess(
    session,
    input.registrationId,
    "entrants.manage",
    env,
  );
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_record_registration_desk_payment", {
    p_registration_id: input.registrationId,
    p_actor_user_id: session.account.userId,
    p_idempotency_key_hash: createHash("sha256").update(input.idempotencyKey).digest("hex"),
  });

  if (error) {
    if (error.message.includes("registration_not_found")) {
      throw notFound("Registration not found");
    }
    if (error.message.includes("registration_already_paid")) {
      throw conflict("This registration is already paid");
    }
    if (error.message.includes("registration_payment_not_payable")) {
      throw conflict("This registration payment cannot be marked paid at the Race Day desk");
    }
    if (error.message.includes("registration_payment_not_required")) {
      throw conflict("This registration does not require payment");
    }
    if (error.message.includes("registration_onsite_payment_disabled")) {
      throw conflict("Onsite payment is disabled for this race");
    }
    if (error.message.includes("registration_payment_quote_invalid")) {
      throw badRequest("The registration payment quote is missing or invalid");
    }
    if (error.message.includes("registration_desk_payment_idempotency_conflict")) {
      throw conflict("This desk payment request was already used for another registration");
    }
    if (error.message.includes("capacity_reservation_expired")) {
      throw conflict("The reserved place expired and the category is now full");
    }
    throw error;
  }

  return {
    ...(data as {
      registrationId: string;
      paymentStatus: string;
      registrationStatus: string;
      ledgerEntryId: string | null;
      replayed: boolean;
    }),
    eventEditionId: context.eventEditionId,
  };
}

export async function unmarkRegistrationDeskPayment(
  session: RequestSession,
  input: {
    registrationId: string;
    idempotencyKey: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const context = await requireRegistrationAccess(
    session,
    input.registrationId,
    "entrants.manage",
    env,
  );
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_unmark_registration_desk_payment", {
    p_registration_id: input.registrationId,
    p_actor_user_id: session.account.userId,
    p_idempotency_key_hash: createHash("sha256").update(input.idempotencyKey).digest("hex"),
  });

  if (error) {
    if (error.message.includes("registration_not_found")) {
      throw notFound("Registration not found");
    }
    if (error.message.includes("registration_payment_not_paid")) {
      throw conflict("This registration is not marked as paid");
    }
    if (error.message.includes("registration_payment_reversal_after_checkin")) {
      throw conflict("Payment cannot be unmarked after check-in or race activity");
    }
    if (error.message.includes("registration_desk_payment_not_recorded")) {
      throw conflict("Only a payment recorded at the Race Day desk can be unmarked here");
    }
    if (error.message.includes("registration_desk_payment_reversal_idempotency_conflict")) {
      throw conflict("This payment reversal request was already used for another registration");
    }
    if (error.message.includes("invalid_registration_desk_payment_reversal")) {
      throw badRequest("The payment reversal request is invalid");
    }
    throw error;
  }

  return {
    ...(data as {
      registrationId: string;
      paymentStatus: string;
      ledgerEntryId: string;
      replayed: boolean;
    }),
    eventEditionId: context.eventEditionId,
  };
}
