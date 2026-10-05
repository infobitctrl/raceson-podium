import Stripe from "stripe";
import type { RequestSession } from "@raceson/domain/auth";
import {
  ApiHttpError,
  applyStripeProviderEvent,
  applyStripeRefundProviderEvent,
  attachGuestStripeCheckoutSession,
  attachStripeCheckoutSession,
  getOrganizationPaymentOnboardingContext,
  prepareStripePaymentAttempt,
  prepareGuestStripePaymentAttempt,
  prepareStripeRefund,
  recordStripeRefundState,
  saveOrganizationStripeAccount,
  type ServerEnv,
} from "@raceson/db";

const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;

function requireStripe(env: ServerEnv) {
  if (!env.stripeSecretKey) {
    throw new ApiHttpError(
      503,
      "payments_not_configured",
      "Online card payments are not configured",
    );
  }
  const providerBaseUrl = env.stripeApiBaseUrl
    ? new URL(env.stripeApiBaseUrl)
    : null;
  if (
    providerBaseUrl
    && (
      (providerBaseUrl.protocol !== "http:" && providerBaseUrl.protocol !== "https:")
      || providerBaseUrl.pathname !== "/"
      || providerBaseUrl.search
      || providerBaseUrl.hash
    )
  ) {
    throw new ApiHttpError(
      500,
      "payments_not_configured",
      "STRIPE_API_BASE_URL must be an HTTP(S) origin without a path",
    );
  }
  const providerProtocol =
    providerBaseUrl?.protocol === "http:"
      ? "http"
      : providerBaseUrl?.protocol === "https:"
        ? "https"
        : undefined;
  return new Stripe(env.stripeSecretKey, {
    apiVersion: STRIPE_API_VERSION,
    ...(providerBaseUrl
      ? {
          protocol: providerProtocol,
          host: providerBaseUrl.hostname,
          port: providerBaseUrl.port || undefined,
        }
      : {}),
    appInfo: {
      name: "RacesOn V2",
      version: "0.1.0",
    },
  });
}

type CheckoutReturnOptions = {
  baseUrl?: string;
  registrationPath?: string;
};

function requireAppBaseUrl(env: ServerEnv, override?: string) {
  const baseUrl = override?.trim() || env.appBaseUrl;
  if (!baseUrl) {
    throw new ApiHttpError(
      503,
      "payments_not_configured",
      "APP_BASE_URL is required for payment return links",
    );
  }
  return baseUrl.replace(/\/+$/, "");
}

function checkoutReturnPath(options?: CheckoutReturnOptions) {
  const path = options?.registrationPath?.trim() || "/athlete/registrations";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new ApiHttpError(
      500,
      "payments_not_configured",
      "Payment return path is invalid",
    );
  }
  return path;
}

function applicationFeeAmount(amountCents: number, feeBps: number) {
  if (feeBps <= 0) return undefined;
  return Math.min(amountCents, Math.round((amountCents * feeBps) / 10_000));
}

export async function createStripeRegistrationCheckout(
  session: RequestSession,
  registrationId: string,
  idempotencyKey: string,
  env: ServerEnv,
  returnOptions?: CheckoutReturnOptions,
) {
  const stripe = requireStripe(env);
  const appBaseUrl = requireAppBaseUrl(env, returnOptions?.baseUrl);
  const registrationPath = checkoutReturnPath(returnOptions);
  const attempt = await prepareStripePaymentAttempt(
    session,
    registrationId,
    idempotencyKey,
    env,
  );

  if (attempt.checkoutSessionId && attempt.checkoutUrl) {
    return {
      paymentIntentId: attempt.paymentIntentId,
      checkoutSessionId: attempt.checkoutSessionId,
      checkoutUrl: attempt.checkoutUrl,
      expiresAt: attempt.expiresAt,
      replayed: true,
    };
  }

  const expiresAtSeconds = Math.floor(new Date(attempt.expiresAt).getTime() / 1000);
  const minimumCheckoutExpiry = Math.floor(Date.now() / 1000) + 30 * 60;
  if (!Number.isFinite(expiresAtSeconds) || expiresAtSeconds < minimumCheckoutExpiry) {
    throw new ApiHttpError(
      409,
      "checkout_window_too_short",
      "The reserved registration place is too close to expiry; refresh the quote",
    );
  }

  const metadata = {
    sitrailPaymentIntentId: attempt.paymentIntentId,
    sitrailRegistrationId: attempt.registrationId,
    sitrailQuoteId: attempt.quoteId,
    sitrailOrganizationId: attempt.organizationId,
  };
  const feeAmount = applicationFeeAmount(
    attempt.amountCents,
    env.stripePlatformFeeBps,
  );

  const checkoutSession = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: attempt.registrationId,
      customer_email: session.account.email ?? undefined,
      success_url:
        `${appBaseUrl}${registrationPath}`
        + `?registrationId=${encodeURIComponent(attempt.registrationId)}`
        + "&payment_return=1&session_id={CHECKOUT_SESSION_ID}",
      cancel_url:
        `${appBaseUrl}${registrationPath}`
        + `?registrationId=${encodeURIComponent(attempt.registrationId)}`
        + "&payment_cancelled=1",
      expires_at: expiresAtSeconds,
      metadata,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: attempt.currency.toLowerCase(),
            unit_amount: attempt.amountCents,
            product_data: {
              name: "Race registration",
              description: `RacesOn registration ${attempt.registrationId}`,
              metadata: {
                sitrailRegistrationId: attempt.registrationId,
                sitrailQuoteId: attempt.quoteId,
              },
            },
          },
        },
      ],
      payment_intent_data: {
        metadata,
        transfer_data: {
          destination: attempt.providerAccountId,
        },
        application_fee_amount: feeAmount,
      },
    },
    {
      idempotencyKey: `sitrail-checkout-${attempt.paymentIntentId}`,
    },
  );

  if (!checkoutSession.url) {
    throw new ApiHttpError(
      502,
      "provider_checkout_unavailable",
      "Stripe did not return a Checkout URL",
    );
  }

  const attached = await attachStripeCheckoutSession(
    session,
    {
      paymentIntentId: attempt.paymentIntentId,
      checkoutSessionId: checkoutSession.id,
      checkoutUrl: checkoutSession.url,
      expiresAt: new Date(checkoutSession.expires_at * 1000).toISOString(),
    },
    env,
  );

  return {
    ...attached,
    checkoutUrl: checkoutSession.url,
  };
}

export async function createStripeGuestRegistrationCheckout(
  registrationId: string,
  guestAccessToken: string,
  idempotencyKey: string,
  env: ServerEnv,
  returnOptions?: CheckoutReturnOptions,
) {
  const stripe = requireStripe(env);
  const appBaseUrl = requireAppBaseUrl(env, returnOptions?.baseUrl);
  const registrationPath = checkoutReturnPath(returnOptions);
  const { attempt, guestEmail } = await prepareGuestStripePaymentAttempt(
    registrationId,
    guestAccessToken,
    idempotencyKey,
    env,
  );

  if (attempt.checkoutSessionId && attempt.checkoutUrl) {
    return {
      paymentIntentId: attempt.paymentIntentId,
      checkoutSessionId: attempt.checkoutSessionId,
      checkoutUrl: attempt.checkoutUrl,
      expiresAt: attempt.expiresAt,
      replayed: true,
    };
  }

  const expiresAtSeconds = Math.floor(new Date(attempt.expiresAt).getTime() / 1000);
  const minimumCheckoutExpiry = Math.floor(Date.now() / 1000) + 30 * 60;
  if (!Number.isFinite(expiresAtSeconds) || expiresAtSeconds < minimumCheckoutExpiry) {
    throw new ApiHttpError(
      409,
      "checkout_window_too_short",
      "The reserved registration place is too close to expiry; refresh the quote",
    );
  }

  const metadata = {
    sitrailPaymentIntentId: attempt.paymentIntentId,
    sitrailRegistrationId: attempt.registrationId,
    sitrailQuoteId: attempt.quoteId,
    sitrailOrganizationId: attempt.organizationId,
    sitrailGuestCheckout: "true",
  };
  const feeAmount = applicationFeeAmount(
    attempt.amountCents,
    env.stripePlatformFeeBps,
  );
  const returnQuery = `guest_payment_return=${encodeURIComponent(attempt.registrationId)}`;
  const checkoutSession = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: attempt.registrationId,
      customer_email: guestEmail,
      success_url:
        `${appBaseUrl}${registrationPath}?${returnQuery}`
        + "&payment_return=1&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: `${appBaseUrl}${registrationPath}?${returnQuery}&payment_cancelled=1`,
      expires_at: expiresAtSeconds,
      metadata,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: attempt.currency.toLowerCase(),
            unit_amount: attempt.amountCents,
            product_data: {
              name: "Race registration",
              description: `RacesOn guest registration ${attempt.registrationId}`,
              metadata: {
                sitrailRegistrationId: attempt.registrationId,
                sitrailQuoteId: attempt.quoteId,
              },
            },
          },
        },
      ],
      payment_intent_data: {
        metadata,
        transfer_data: {
          destination: attempt.providerAccountId,
        },
        application_fee_amount: feeAmount,
      },
    },
    {
      idempotencyKey: `sitrail-checkout-${attempt.paymentIntentId}`,
    },
  );

  if (!checkoutSession.url) {
    throw new ApiHttpError(
      502,
      "provider_checkout_unavailable",
      "Stripe did not return a Checkout URL",
    );
  }

  const attached = await attachGuestStripeCheckoutSession(
    {
      registrationId,
      guestAccessToken,
      paymentIntentId: attempt.paymentIntentId,
      checkoutSessionId: checkoutSession.id,
      checkoutUrl: checkoutSession.url,
      expiresAt: new Date(checkoutSession.expires_at * 1000).toISOString(),
    },
    env,
  );

  return {
    ...attached,
    checkoutUrl: checkoutSession.url,
  };
}

function metadataPaymentIntentId(
  object: Stripe.Checkout.Session | Stripe.PaymentIntent,
) {
  return object.metadata?.sitrailPaymentIntentId ?? null;
}

function stripePaymentIntentId(
  value: string | Stripe.PaymentIntent | null,
) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

export function verifyStripeWebhook(
  rawBody: Buffer,
  signature: string,
  env: ServerEnv,
) {
  const stripe = requireStripe(env);
  if (!env.stripeWebhookSecret) {
    throw new ApiHttpError(
      503,
      "payments_not_configured",
      "Stripe webhook verification is not configured",
    );
  }
  try {
    return stripe.webhooks.constructEvent(
      rawBody,
      signature,
      env.stripeWebhookSecret,
    );
  } catch {
    throw new ApiHttpError(
      400,
      "invalid_webhook_signature",
      "Stripe webhook signature verification failed",
    );
  }
}

export async function applyVerifiedStripeWebhook(
  event: Stripe.Event,
  env: ServerEnv,
) {
  if (event.type.startsWith("refund.")) {
    const refund = event.data.object as Stripe.Refund;
    const refundId = refund.metadata?.sitrailRefundId ?? null;
    const providerStatus =
      refund.status === "succeeded"
        ? "succeeded"
        : refund.status === "failed"
        ? "failed"
        : refund.status === "canceled"
        ? "cancelled"
        : "pending";

    return applyStripeRefundProviderEvent(
      {
        providerEventId: event.id,
        eventType: event.type,
        livemode: event.livemode,
        payload: event as unknown as Record<string, unknown>,
        refundId,
        providerRefundId: refund.id,
        providerStatus,
        failureMessage: refund.failure_reason ?? null,
      },
      env,
    );
  }

  let paymentIntentId: string | null = null;
  let providerPaymentIntentId: string | null = null;
  let outcome: "succeeded" | "failed" | "processing" | "cancelled" = "processing";
  let amountCents: number | null = null;
  let currency: string | null = null;

  if (event.type.startsWith("checkout.session.")) {
    const checkoutSession = event.data.object as Stripe.Checkout.Session;
    paymentIntentId = metadataPaymentIntentId(checkoutSession);
    providerPaymentIntentId = stripePaymentIntentId(checkoutSession.payment_intent);
    amountCents = checkoutSession.amount_total;
    currency = checkoutSession.currency?.toUpperCase() ?? null;
    if (
      event.type === "checkout.session.completed"
      || event.type === "checkout.session.async_payment_succeeded"
    ) {
      outcome = checkoutSession.payment_status === "paid" ? "succeeded" : "processing";
    } else if (event.type === "checkout.session.async_payment_failed") {
      outcome = "failed";
    } else if (event.type === "checkout.session.expired") {
      outcome = "cancelled";
    }
  } else if (event.type.startsWith("payment_intent.")) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    paymentIntentId = metadataPaymentIntentId(paymentIntent);
    providerPaymentIntentId = paymentIntent.id;
    amountCents = paymentIntent.amount_received || paymentIntent.amount;
    currency = paymentIntent.currency.toUpperCase();
    if (event.type === "payment_intent.succeeded") outcome = "succeeded";
    if (event.type === "payment_intent.payment_failed") outcome = "failed";
    if (event.type === "payment_intent.canceled") outcome = "cancelled";
  }

  return applyStripeProviderEvent(
    {
      providerEventId: event.id,
      eventType: event.type,
      livemode: event.livemode,
      payload: event as unknown as Record<string, unknown>,
      paymentIntentId,
      providerPaymentIntentId,
      outcome,
      amountCents,
      currency,
    },
    env,
  );
}

export async function createStripeRegistrationRefund(
  session: RequestSession,
  input: {
    registrationId: string;
    amountCents: number;
    reason: string;
    organizerNote?: string | null;
    idempotencyKey: string;
  },
  env: ServerEnv,
) {
  const stripe = requireStripe(env);
  const prepared = await prepareStripeRefund(session, input, env);
  if (
    prepared.status === "succeeded"
    || prepared.status === "failed"
    || prepared.status === "cancelled"
  ) {
    return prepared;
  }

  if (!prepared.providerPaymentIntentId) {
    throw new ApiHttpError(
      409,
      "provider_payment_reference_missing",
      "The settled provider payment reference is missing",
    );
  }

  const refund = await stripe.refunds.create(
    {
      payment_intent: prepared.providerPaymentIntentId,
      amount: prepared.amountCents,
      reason: "requested_by_customer",
      metadata: {
        sitrailRefundId: prepared.refundId,
        sitrailRegistrationId: prepared.registrationId,
      },
    },
    {
      idempotencyKey: `sitrail-refund-${prepared.refundId}`,
    },
  );

  const providerStatus =
    refund.status === "succeeded"
      ? "succeeded"
      : refund.status === "failed"
      ? "failed"
      : refund.status === "canceled"
      ? "cancelled"
      : "pending";
  return recordStripeRefundState(
    session,
    {
      refundId: prepared.refundId,
      providerRefundId: refund.id,
      providerStatus,
      failureMessage: refund.failure_reason ?? null,
    },
    env,
  );
}

export async function refreshStripeOrganizationPaymentAccount(
  session: RequestSession,
  organizationId: string,
  env: ServerEnv,
) {
  const stripe = requireStripe(env);
  const context = await getOrganizationPaymentOnboardingContext(
    session,
    organizationId,
    env,
  );
  if (!context.stripeAccount?.providerAccountId) {
    throw new ApiHttpError(
      409,
      "payment_account_not_created",
      "Start secure payment onboarding before refreshing account requirements",
    );
  }

  const account = await stripe.v2.core.accounts.retrieve(
    context.stripeAccount.providerAccountId,
    {
      include: [
        "configuration.recipient",
        "defaults",
        "future_requirements",
        "identity",
        "requirements",
      ],
    },
  );
  const recipient = account.configuration?.recipient;
  const transfersCapability =
    recipient?.capabilities?.stripe_balance?.stripe_transfers;
  const payoutsCapability = recipient?.capabilities?.stripe_balance?.payouts;
  const transfersEnabled = transfersCapability?.status === "active";
  const payoutsEnabled = payoutsCapability?.status === "active";
  const requirements = account.requirements ?? {};
  const hasPastDueRequirement = account.requirements?.entries?.some(
    (entry) => entry.minimum_deadline.status === "past_due",
  ) ?? false;
  const hasRestrictedCapability =
    transfersCapability?.status === "restricted"
    || transfersCapability?.status === "unsupported";
  const accountStatus = account.closed
    ? "disabled"
    : transfersEnabled && payoutsEnabled
    ? "active"
    : hasPastDueRequirement || hasRestrictedCapability
    ? "restricted"
    : "onboarding";

  await saveOrganizationStripeAccount(
    session,
    {
      organizationId,
      providerAccountId: account.id,
      status: accountStatus,
      transfersEnabled,
      payoutsEnabled,
      onboardingState: {
        appliedConfigurations: account.applied_configurations,
        dashboard: account.dashboard,
        closed: account.closed ?? false,
        transferCapabilityStatus: transfersCapability?.status ?? null,
        payoutCapabilityStatus: payoutsCapability?.status ?? null,
      },
      requirementsSnapshot: requirements as unknown as Record<string, unknown>,
    },
    env,
  );

  return getOrganizationPaymentOnboardingContext(session, organizationId, env);
}

export async function createStripeOrganizationOnboardingLink(
  session: RequestSession,
  organizationId: string,
  idempotencyKey: string,
  env: ServerEnv,
) {
  const stripe = requireStripe(env);
  const appBaseUrl = requireAppBaseUrl(env);
  const context = await getOrganizationPaymentOnboardingContext(
    session,
    organizationId,
    env,
  );

  const include = [
    "configuration.recipient",
    "defaults",
    "future_requirements",
    "identity",
    "requirements",
  ] as const;
  const account = context.stripeAccount
    ? await stripe.v2.core.accounts.retrieve(
      context.stripeAccount.providerAccountId,
      { include: [...include] },
    )
    : await stripe.v2.core.accounts.create(
      {
        display_name: context.organization.legalName ?? context.organization.name,
        contact_email: context.organization.contactEmail ?? session.account.email ?? undefined,
        dashboard: "express",
        identity: {
          country: (context.organization.countryCode ?? "HR").toUpperCase(),
        },
        configuration: {
          recipient: {
            capabilities: {
              stripe_balance: {
                stripe_transfers: {
                  requested: true,
                },
              },
            },
          },
        },
        defaults: {
          currency: "eur",
          locales: ["hr-HR", "en"],
          responsibilities: {
            fees_collector: "application",
            losses_collector: "application",
          },
          profile: {
            doing_business_as: context.organization.name,
            product_description: "Trail running race registrations and race services",
          },
        },
        metadata: {
          sitrailOrganizationId: context.organization.id,
        },
        include: [...include],
      },
      {
        idempotencyKey: `sitrail-account-${organizationId}-${idempotencyKey}`,
      },
    );

  const recipient = account.configuration?.recipient;
  const transfersCapability =
    recipient?.capabilities?.stripe_balance?.stripe_transfers;
  const payoutsCapability = recipient?.capabilities?.stripe_balance?.payouts;
  const transfersEnabled = transfersCapability?.status === "active";
  const payoutsEnabled = payoutsCapability?.status === "active";
  const requirements = account.requirements ?? {};
  const hasPastDueRequirement = account.requirements?.entries?.some(
    (entry) => entry.minimum_deadline.status === "past_due",
  ) ?? false;
  const hasRestrictedCapability =
    transfersCapability?.status === "restricted"
    || transfersCapability?.status === "unsupported";
  const accountStatus = account.closed
    ? "disabled"
    : transfersEnabled && payoutsEnabled
    ? "active"
    : hasPastDueRequirement || hasRestrictedCapability
    ? "restricted"
    : "onboarding";

  const saved = await saveOrganizationStripeAccount(
    session,
    {
      organizationId,
      providerAccountId: account.id,
      status: accountStatus,
      transfersEnabled,
      payoutsEnabled,
      onboardingState: {
        appliedConfigurations: account.applied_configurations,
        dashboard: account.dashboard,
        closed: account.closed ?? false,
        transferCapabilityStatus: transfersCapability?.status ?? null,
        payoutCapabilityStatus: payoutsCapability?.status ?? null,
      },
      requirementsSnapshot: requirements as unknown as Record<string, unknown>,
    },
    env,
  );

  const returnPath =
    `/organizer/settings/payments?organizationId=${encodeURIComponent(organizationId)}`;
  const useCase = transfersEnabled
    ? {
      type: "account_update" as const,
      account_update: {
        configurations: ["recipient" as const],
        collection_options: {
          fields: "eventually_due" as const,
          future_requirements: "include" as const,
        },
        refresh_url: `${appBaseUrl}${returnPath}&refresh=1`,
        return_url: `${appBaseUrl}${returnPath}&returned=1`,
      },
    }
    : {
      type: "account_onboarding" as const,
      account_onboarding: {
        configurations: ["recipient" as const],
        collection_options: {
          fields: "eventually_due" as const,
          future_requirements: "include" as const,
        },
        refresh_url: `${appBaseUrl}${returnPath}&refresh=1`,
        return_url: `${appBaseUrl}${returnPath}&returned=1`,
      },
    };

  const accountLink = await stripe.v2.core.accountLinks.create(
    {
      account: account.id,
      use_case: useCase,
    },
    {
      idempotencyKey: `sitrail-account-link-${organizationId}-${idempotencyKey}`,
    },
  );

  return {
    account: saved,
    onboardingUrl: accountLink.url,
    expiresAt: accountLink.expires_at,
  };
}
