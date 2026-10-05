import { registrationFeeBalance } from "./registrations/fee-balances.js";
import type { RequestSession } from "@raceson/domain/auth";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { requireEditionAccess } from "./permissions.js";
import { createAdminSupabaseClient } from "./supabase.js";

const ACTIVE_REGISTRATION_STATUSES = new Set(["pending", "confirmed"]);
const CURRENT_QUOTE_STATES = new Set(["active", "accepted"]);
const OPEN_ATTEMPT_STATUSES = new Set(["created", "checkout_ready", "processing"]);
const CHUNK_SIZE = 200;

type FinanceCategoryRow = {
  id: string;
  name: string;
  display_order: number;
};

export type FinanceRegistrationInput = {
  id: string;
  event_category_id: string;
  athlete_profile_id: string;
  status: string;
  payment_status: string;
  created_at: string;
  paid_at: string | null;
  current_quote_id: string | null;
};

type FinanceAthleteRow = {
  id: string;
  display_name: string;
};

export type FinanceQuoteInput = {
  id: string;
  state: string;
  currency: string;
  total_cents: number;
};

export type FinancePaymentRequestInput = {
  registration_id: string;
  status: string;
  amount_cents: number;
  currency: string;
  reference_value: string;
  due_at: string;
  payment_reported_at: string | null;
  settled_at: string | null;
};

export type FinanceEvidenceInput = {
  registration_id: string;
  review_status: string;
  submitted_at: string;
};

export type FinancePaymentIntentInput = {
  registration_id: string;
  provider: string;
  status: string;
  currency: string;
  failure_code: string | null;
  created_at: string;
  completed_at: string | null;
};

export type FinanceLedgerInput = {
  registration_id: string;
  entry_type: string;
  amount_cents: number;
  currency: string;
  external_reference: string | null;
  description: string;
  metadata_json: unknown;
  effective_at: string;
};

export type OrganizerFinanceRegistration = {
  registrationId: string;
  athleteName: string;
  categoryId: string;
  categoryName: string;
  registrationStatus: string;
  paymentStatus: "paid" | "reported" | "overdue" | "unpaid" | "refunded" | "not_required";
  providerStatus: string | null;
  currency: string;
  expectedCents: number;
  collectedCents: number;
  refundedCents: number;
  outstandingCents: number;
  paymentMethod: "bank_transfer" | "card" | "desk" | "evidence" | "manual" | "none";
  reference: string | null;
  dueAt: string | null;
  reportedAt: string | null;
  settledAt: string | null;
  createdAt: string;
  submittedEvidenceCount: number;
  needsAttention: boolean;
};

export type OrganizerFinanceCurrencySummary = {
  currency: string;
  registrationCount: number;
  expectedCents: number;
  collectedCents: number;
  outstandingCents: number;
  refundedCents: number;
  netRetainedCents: number;
  collectionRate: number | null;
  paidCount: number;
  reportedCount: number;
  overdueCount: number;
  unpaidCount: number;
};

export type OrganizerFinanceRaceSummary = OrganizerFinanceCurrencySummary & {
  categoryId: string;
  categoryName: string;
  displayOrder: number;
};

export type OrganizerFinanceTrendPoint = {
  date: string;
  currency: string;
  expectedCents: number;
  collectedCents: number;
};

export type OrganizerFinanceDashboard = {
  eventEditionId: string;
  generatedAt: string;
  attention: {
    reportedTransfers: number;
    submittedEvidence: number;
    overdueRequests: number;
    failedOrPendingOnlinePayments: number;
  };
  currencies: OrganizerFinanceCurrencySummary[];
  races: OrganizerFinanceRaceSummary[];
  trend: OrganizerFinanceTrendPoint[];
  registrations: OrganizerFinanceRegistration[];
};

export type OrganizerFinanceDashboardInput = {
  eventEditionId: string;
  categories: FinanceCategoryRow[];
  registrations: FinanceRegistrationInput[];
  athletes: FinanceAthleteRow[];
  quotes: FinanceQuoteInput[];
  paymentRequests: FinancePaymentRequestInput[];
  evidence: FinanceEvidenceInput[];
  paymentIntents: FinancePaymentIntentInput[];
  ledger: FinanceLedgerInput[];
  now?: Date;
};

function cleanCurrency(value: string | null | undefined) {
  return value?.trim().toUpperCase() || "EUR";
}

function metadataSource(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const source = (metadata as { source?: unknown }).source;
  return typeof source === "string" ? source : null;
}

function paymentMethod(
  request: FinancePaymentRequestInput | undefined,
  intent: FinancePaymentIntentInput | undefined,
  ledger: FinanceLedgerInput[],
  evidenceCount: number,
): OrganizerFinanceRegistration["paymentMethod"] {
  if (request) return "bank_transfer";
  if (intent?.provider === "stripe") return "card";
  const source = ledger.map((entry) => metadataSource(entry.metadata_json)).find(Boolean);
  if (source === "race_day_desk") return "desk";
  if (source === "payment_evidence" || evidenceCount > 0) return "evidence";
  if (ledger.length) return "manual";
  return "none";
}

function summarizeCurrency(
  currency: string,
  registrations: OrganizerFinanceRegistration[],
): OrganizerFinanceCurrencySummary {
  const rows = registrations.filter((registration) => registration.currency === currency);
  const activeRows = rows.filter((registration) => ACTIVE_REGISTRATION_STATUSES.has(registration.registrationStatus));
  const expectedCents = rows.reduce((sum, registration) => sum + registration.expectedCents, 0);
  const collectedCents = rows.reduce((sum, registration) => sum + registration.collectedCents, 0);
  const refundedCents = rows.reduce((sum, registration) => sum + registration.refundedCents, 0);
  return {
    currency,
    registrationCount: activeRows.length,
    expectedCents,
    collectedCents,
    outstandingCents: rows.reduce((sum, registration) => sum + registration.outstandingCents, 0),
    refundedCents,
    netRetainedCents: Math.max(0, collectedCents - refundedCents),
    collectionRate: expectedCents > 0 ? collectedCents / expectedCents : null,
    paidCount: activeRows.filter((registration) => registration.paymentStatus === "paid").length,
    reportedCount: activeRows.filter((registration) => registration.paymentStatus === "reported").length,
    overdueCount: activeRows.filter((registration) => registration.paymentStatus === "overdue").length,
    unpaidCount: activeRows.filter((registration) => registration.paymentStatus === "unpaid").length,
  };
}

function buildTrend(
  registrations: OrganizerFinanceRegistration[],
  ledger: FinanceLedgerInput[],
) {
  const deltas = new Map<string, { expectedCents: number; collectedCents: number }>();
  const add = (date: string, currency: string, field: "expectedCents" | "collectedCents", amount: number) => {
    if (!amount) return;
    const key = `${currency}:${date.slice(0, 10)}`;
    const current = deltas.get(key) ?? { expectedCents: 0, collectedCents: 0 };
    current[field] += amount;
    deltas.set(key, current);
  };

  for (const registration of registrations) {
    add(registration.createdAt, registration.currency, "expectedCents", registration.expectedCents);
  }
  for (const entry of ledger) {
    if (entry.entry_type !== "charge" && entry.entry_type !== "adjustment") continue;
    add(entry.effective_at, cleanCurrency(entry.currency), "collectedCents", entry.amount_cents);
  }

  const points: OrganizerFinanceTrendPoint[] = [];
  const currencies = Array.from(new Set([...deltas.keys()].map((key) => key.split(":")[0]))).sort();
  for (const currency of currencies) {
    let expectedCents = 0;
    let collectedCents = 0;
    const dates = Array.from(deltas.keys())
      .filter((key) => key.startsWith(`${currency}:`))
      .map((key) => key.slice(currency.length + 1))
      .sort();
    for (const date of dates) {
      const delta = deltas.get(`${currency}:${date}`)!;
      expectedCents += delta.expectedCents;
      collectedCents = Math.max(0, collectedCents + delta.collectedCents);
      points.push({ date, currency, expectedCents, collectedCents });
    }
  }
  return points;
}

export function buildOrganizerFinanceDashboard(
  input: OrganizerFinanceDashboardInput,
): OrganizerFinanceDashboard {
  const now = input.now ?? new Date();
  const categoryById = new Map(input.categories.map((category) => [category.id, category]));
  const athleteById = new Map(input.athletes.map((athlete) => [athlete.id, athlete]));
  const quoteById = new Map(input.quotes.map((quote) => [quote.id, quote]));
  const requestByRegistrationId = new Map(
    input.paymentRequests.map((request) => [request.registration_id, request]),
  );
  const evidenceByRegistrationId = new Map<string, FinanceEvidenceInput[]>();
  for (const evidence of input.evidence) {
    const rows = evidenceByRegistrationId.get(evidence.registration_id) ?? [];
    rows.push(evidence);
    evidenceByRegistrationId.set(evidence.registration_id, rows);
  }
  const intentByRegistrationId = new Map<string, FinancePaymentIntentInput>();
  for (const intent of [...input.paymentIntents].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (!intentByRegistrationId.has(intent.registration_id)) {
      intentByRegistrationId.set(intent.registration_id, intent);
    }
  }
  const ledgerByRegistrationId = new Map<string, FinanceLedgerInput[]>();
  for (const entry of input.ledger) {
    const rows = ledgerByRegistrationId.get(entry.registration_id) ?? [];
    rows.push(entry);
    ledgerByRegistrationId.set(entry.registration_id, rows);
  }

  const financialRecords = input.registrations.map<OrganizerFinanceRegistration>((registration) => {
    const category = categoryById.get(registration.event_category_id);
    const quote = registration.current_quote_id ? quoteById.get(registration.current_quote_id) : undefined;
    const request = requestByRegistrationId.get(registration.id);
    const evidence = evidenceByRegistrationId.get(registration.id) ?? [];
    const intent = intentByRegistrationId.get(registration.id);
    const entries = ledgerByRegistrationId.get(registration.id) ?? [];
    const chargeAndAdjustmentCents = entries
      .filter((entry) => entry.entry_type === "charge" || entry.entry_type === "adjustment")
      .reduce((sum, entry) => sum + entry.amount_cents, 0);
    const refundedCents = Math.abs(entries
      .filter((entry) => entry.entry_type === "refund")
      .reduce((sum, entry) => sum + entry.amount_cents, 0));
    const { expectedCents, collectedCents, outstandingCents } = registrationFeeBalance(registration.status, quote, chargeAndAdjustmentCents);
    const currency = cleanCurrency(quote?.currency ?? request?.currency ?? entries[0]?.currency);
    const overdue = Boolean(
      request
      && request.status !== "paid"
      && request.status !== "cancelled"
      && new Date(request.due_at).getTime() < now.getTime(),
    );
    const submittedEvidenceCount = evidence.filter((row) => row.review_status === "submitted").length;
    const reported = request?.status === "reported";
    const paid = collectedCents > 0
      || (expectedCents > 0 && outstandingCents === 0);
    const refunded = refundedCents > 0
      || registration.payment_status === "refunded"
      || registration.payment_status === "partially_refunded";
    const status: OrganizerFinanceRegistration["paymentStatus"] = refunded
      ? "refunded"
      : paid
        ? "paid"
        : overdue
          ? "overdue"
          : reported
            ? "reported"
            : expectedCents === 0
              ? "not_required"
              : "unpaid";
    const failedOrPendingIntent = Boolean(
      intent && (intent.status === "failed" || OPEN_ATTEMPT_STATUSES.has(intent.status)),
    );
    const settledAt = request?.settled_at
      ?? entries
        .filter((entry) => entry.entry_type === "charge" && entry.amount_cents > 0)
        .sort((a, b) => b.effective_at.localeCompare(a.effective_at))[0]?.effective_at
      ?? registration.paid_at;
    const reference = request?.reference_value
      ?? entries
        .filter((entry) => entry.external_reference)
        .sort((a, b) => b.effective_at.localeCompare(a.effective_at))[0]?.external_reference
      ?? null;

    return {
      registrationId: registration.id,
      athleteName: athleteById.get(registration.athlete_profile_id)?.display_name?.trim() || "Unknown athlete",
      categoryId: registration.event_category_id,
      categoryName: category?.name ?? "Race",
      registrationStatus: registration.status,
      paymentStatus: status,
      providerStatus: intent?.status ?? null,
      currency,
      expectedCents,
      collectedCents,
      refundedCents,
      outstandingCents,
      paymentMethod: paymentMethod(request, intent, entries, evidence.length),
      reference,
      dueAt: request?.due_at ?? null,
      reportedAt: request?.payment_reported_at ?? null,
      settledAt: settledAt ?? null,
      createdAt: registration.created_at,
      submittedEvidenceCount,
      needsAttention: overdue || reported || submittedEvidenceCount > 0 || failedOrPendingIntent,
    };
  }).sort((a, b) => {
    if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  // Match the organizer roster while retaining settled money and refunds in accounting.
  const registrations = financialRecords.filter((registration) =>
    ACTIVE_REGISTRATION_STATUSES.has(registration.registrationStatus));
  const accountingRecords = financialRecords.filter((registration) =>
    ACTIVE_REGISTRATION_STATUSES.has(registration.registrationStatus)
    || registration.collectedCents > 0 || registration.refundedCents > 0);
  const currencyCodes = Array.from(new Set(accountingRecords.map((registration) => registration.currency))).sort();
  const currencies = currencyCodes.map((currency) => summarizeCurrency(currency, accountingRecords));
  const races = input.categories.flatMap((category) => currencyCodes
    .filter((currency) => accountingRecords.some(
      (registration) => registration.categoryId === category.id && registration.currency === currency,
    ))
    .map((currency) => ({
      ...summarizeCurrency(
        currency,
        accountingRecords.filter((registration) => registration.categoryId === category.id),
      ),
      categoryId: category.id,
      categoryName: category.name,
      displayOrder: category.display_order,
    })))
    .sort((a, b) => a.displayOrder - b.displayOrder || a.categoryName.localeCompare(b.categoryName));
  const latestIntentByRegistrationId = intentByRegistrationId;

  return {
    eventEditionId: input.eventEditionId,
    generatedAt: now.toISOString(),
    attention: {
      reportedTransfers: registrations.filter((registration) => registration.paymentStatus === "reported").length,
      submittedEvidence: registrations.reduce(
        (sum, registration) => sum + registration.submittedEvidenceCount,
        0,
      ),
      overdueRequests: registrations.filter((registration) => registration.paymentStatus === "overdue").length,
      failedOrPendingOnlinePayments: registrations.filter((registration) => {
        const intent = latestIntentByRegistrationId.get(registration.registrationId);
        return intent?.provider === "stripe"
          && (intent.status === "failed" || OPEN_ATTEMPT_STATUSES.has(intent.status));
      }).length,
    },
    currencies,
    races,
    trend: buildTrend(registrations, input.ledger),
    registrations,
  };
}

function chunks<T>(values: T[]) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += CHUNK_SIZE) {
    result.push(values.slice(index, index + CHUNK_SIZE));
  }
  return result;
}

async function loadByRegistrationChunks<T>(
  registrationIds: string[],
  load: (ids: string[]) => Promise<{ data: T[] | null; error: { message: string } | null }>,
) {
  if (!registrationIds.length) return [] as T[];
  const results = await Promise.all(chunks(registrationIds).map(load));
  const rows: T[] = [];
  for (const result of results) {
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
  }
  return rows;
}

export async function getOrganizerFinanceDashboard(
  session: RequestSession,
  eventEditionId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<OrganizerFinanceDashboard> {
  await requireEditionAccess(session, eventEditionId, "finance.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const { data: categories, error: categoryError } = await adminClient
    .from("event_categories")
    .select("id,name,display_order")
    .eq("event_edition_id", eventEditionId)
    .is("organizer_deleted_at", null)
    .order("display_order", { ascending: true })
    .returns<FinanceCategoryRow[]>();
  if (categoryError) throw categoryError;
  if (!categories?.length) {
    return buildOrganizerFinanceDashboard({
      eventEditionId,
      categories: [],
      registrations: [],
      athletes: [],
      quotes: [],
      paymentRequests: [],
      evidence: [],
      paymentIntents: [],
      ledger: [],
    });
  }

  const categoryIds = categories.map((category) => category.id);
  const registrations: FinanceRegistrationInput[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await adminClient
      .from("registrations")
      .select("id,event_category_id,athlete_profile_id,status,payment_status,created_at,paid_at,current_quote_id")
      .in("event_category_id", categoryIds)
      .is("organizer_removed_at", null)
      .order("created_at", { ascending: false })
      .range(from, from + 999)
      .returns<FinanceRegistrationInput[]>();
    if (error) throw error;
    registrations.push(...(data ?? []));
    if (!data || data.length < 1_000) break;
  }

  const registrationIds = registrations.map((registration) => registration.id);
  const athleteIds = Array.from(new Set(registrations.map((registration) => registration.athlete_profile_id)));
  const quoteIds = Array.from(new Set(
    registrations.map((registration) => registration.current_quote_id).filter((id): id is string => Boolean(id)),
  ));

  const [athletes, quotes, paymentRequests, evidence, paymentIntents, ledger] = await Promise.all([
    loadByRegistrationChunks<FinanceAthleteRow>(athleteIds, async (ids) => {
      const result = await adminClient.from("athlete_profiles").select("id,display_name").in("id", ids)
        .returns<FinanceAthleteRow[]>();
      return result;
    }),
    loadByRegistrationChunks<FinanceQuoteInput>(quoteIds, async (ids) => {
      const result = await adminClient.from("registration_quotes").select("id,state,currency,total_cents").in("id", ids)
        .returns<FinanceQuoteInput[]>();
      return result;
    }),
    loadByRegistrationChunks<FinancePaymentRequestInput>(registrationIds, async (ids) => {
      const result = await adminClient.from("registration_payment_requests")
        .select("registration_id,status,amount_cents,currency,reference_value,due_at,payment_reported_at,settled_at")
        .in("registration_id", ids).returns<FinancePaymentRequestInput[]>();
      return result;
    }),
    loadByRegistrationChunks<FinanceEvidenceInput>(registrationIds, async (ids) => {
      const result = await adminClient.from("registration_payment_evidence")
        .select("registration_id,review_status,submitted_at")
        .in("registration_id", ids).returns<FinanceEvidenceInput[]>();
      return result;
    }),
    loadByRegistrationChunks<FinancePaymentIntentInput>(registrationIds, async (ids) => {
      const result = await adminClient.from("payment_intents")
        .select("registration_id,provider,status,currency,failure_code,created_at,completed_at")
        .in("registration_id", ids).order("created_at", { ascending: false })
        .returns<FinancePaymentIntentInput[]>();
      return result;
    }),
    loadByRegistrationChunks<FinanceLedgerInput>(registrationIds, async (ids) => {
      const result = await adminClient.from("financial_ledger_entries")
        .select("registration_id,entry_type,amount_cents,currency,external_reference,description,metadata_json,effective_at")
        .in("registration_id", ids).order("effective_at", { ascending: true })
        .returns<FinanceLedgerInput[]>();
      return result;
    }),
  ]);

  return buildOrganizerFinanceDashboard({
    eventEditionId,
    categories,
    registrations,
    athletes,
    quotes,
    paymentRequests,
    evidence,
    paymentIntents,
    ledger,
  });
}
