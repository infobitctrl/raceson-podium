import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestSession } from "@raceson/domain/auth";
import { isAllowedProfileAvatarUrl } from "@raceson/domain/athletes";
import {
  deletePlatformAccount,
  deletePlatformOrganization,
  getPlatformAccount,
  getPlatformOrganizationSupportContext,
  listPlatformAccountDeletionHistory,
  listPlatformAccounts,
  updatePlatformAccount,
  updatePlatformOrganization,
  type ServerEnv,
} from "@raceson/db";
import { z } from "zod";

const nullableEmailSchema = z.string().trim().email().max(254).nullable();
const reasonSchema = z.string().trim().min(8).max(1000);
const nullableText = (max: number) => z.string().trim().max(max).nullable();
const nullablePublicUrlSchema = z.string().trim().url().max(2048).refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "Use a valid http or https URL.").nullable();
const nullableProfileImageUrlSchema = z.string().trim().max(2048).refine(
  isAllowedProfileAvatarUrl,
  "Use a valid profile image URL or RacesOn avatar.",
).nullable();
const accountUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(200),
  email: nullableEmailSchema,
  expectedEmail: nullableEmailSchema,
  username: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{2,47}$/).nullable(),
  expectedUsername: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{2,47}$/).nullable(),
  firstName: nullableText(80),
  lastName: nullableText(80),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  gender: z.enum(["F", "M", "U"]).nullable(),
  city: nullableText(120),
  countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/).nullable(),
  phone: nullableText(40),
  jobTitle: nullableText(120),
  bio: nullableText(1200),
  websiteUrl: nullablePublicUrlSchema,
  instagramUrl: nullablePublicUrlSchema,
  facebookUrl: nullablePublicUrlSchema,
  linkedinUrl: nullablePublicUrlSchema,
  youtubeUrl: nullablePublicUrlSchema,
  tiktokUrl: nullablePublicUrlSchema,
  xUrl: nullablePublicUrlSchema,
  emergencyContactName: nullableText(120),
  emergencyContactPhone: nullableText(40),
  shirtSize: nullableText(12),
  locale: z.string().trim().min(1).max(24),
  timezone: z.string().trim().min(1).max(80),
  avatarUrl: nullableProfileImageUrlSchema,
  coverImageUrl: nullableProfileImageUrlSchema,
  organizerSetupEnabled: z.boolean(),
  reason: reasonSchema,
});
const accountDeleteSchema = z.object({
  confirmation: z.string().trim().min(1).max(320),
  reason: reasonSchema,
});
const organizationUpdateSchema = z.object({
  expectedSlug: z.string().trim().min(1).max(160),
  name: z.string().trim().min(2).max(200),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160),
  status: z.enum(["active", "inactive"]),
  contactEmail: nullableEmailSchema,
  countryCode: z.string().trim().length(2).nullable(),
  city: z.string().trim().max(200).nullable(),
  reason: reasonSchema,
});
const organizationDeleteSchema = z.object({
  confirmationName: z.string().trim().min(1).max(200),
  reason: reasonSchema,
});

export function parsePlatformAccountUpdate(value: unknown) {
  return accountUpdateSchema.parse(value);
}

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;
type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

type PlatformManagementRouteDependencies = {
  env: ServerEnv;
  requireSession: (request: ApiRequest) => Promise<RequestSession>;
  readJsonBody: (request: ApiRequest) => Promise<JsonValue>;
  sendSuccess: (response: ApiResponse, payload: JsonValue, statusCode?: number) => void;
  applyPrivateSessionHeaders: (response: ApiResponse) => void;
};

function managementTarget(pathname: string) {
  const match = pathname.match(
    /^\/api\/v1\/platform\/(accounts|organizations)\/([0-9a-f-]{36})$/i,
  );
  if (!match) return null;
  return {
    kind: z.enum(["accounts", "organizations"]).parse(match[1]?.toLowerCase()),
    targetId: z.string().uuid().parse(match[2]),
  };
}

export async function dispatchPlatformManagementRoutes(
  request: ApiRequest,
  response: ApiResponse,
  url: URL,
  dependencies: PlatformManagementRouteDependencies,
) {
  if (request.method === "GET" && url.pathname === "/api/v1/platform/accounts") {
    const session = await dependencies.requireSession(request);
    const result = await listPlatformAccounts(session, {
      page: z.coerce.number().int().positive().optional().parse(url.searchParams.get("page") ?? undefined),
      pageSize: z.coerce.number().int().min(1).max(50).optional().parse(url.searchParams.get("pageSize") ?? undefined),
      search: z.string().trim().max(200).optional().parse(url.searchParams.get("search") ?? undefined),
    }, dependencies.env);
    dependencies.applyPrivateSessionHeaders(response);
    dependencies.sendSuccess(response, result as unknown as JsonValue);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/platform/accounts/deletion-history") {
    const session = await dependencies.requireSession(request);
    const result = await listPlatformAccountDeletionHistory(session, {
      page: z.coerce.number().int().positive().optional().parse(url.searchParams.get("page") ?? undefined),
      pageSize: z.coerce.number().int().min(1).max(50).optional().parse(url.searchParams.get("pageSize") ?? undefined),
    }, dependencies.env);
    dependencies.applyPrivateSessionHeaders(response);
    dependencies.sendSuccess(response, result as unknown as JsonValue);
    return true;
  }

  const target = managementTarget(url.pathname);
  if (!target) return false;
  const session = await dependencies.requireSession(request);

  if (target.kind === "accounts" && request.method === "GET") {
    const result = await getPlatformAccount(
      session,
      target.targetId,
      dependencies.env,
    );
    dependencies.applyPrivateSessionHeaders(response);
    dependencies.sendSuccess(response, result as unknown as JsonValue);
    return true;
  }

  if (target.kind === "organizations" && request.method === "GET") {
    const result = await getPlatformOrganizationSupportContext(
      session,
      target.targetId,
      dependencies.env,
    );
    dependencies.applyPrivateSessionHeaders(response);
    dependencies.sendSuccess(response, result as unknown as JsonValue);
    return true;
  }

  const body = await dependencies.readJsonBody(request) ?? {};

  if (target.kind === "accounts" && request.method === "PATCH") {
    const result = await updatePlatformAccount(
      session,
      target.targetId,
      parsePlatformAccountUpdate(body),
      dependencies.env,
    );
    dependencies.sendSuccess(response, result as unknown as JsonValue);
    return true;
  }
  if (target.kind === "accounts" && request.method === "DELETE") {
    const result = await deletePlatformAccount(
      session,
      target.targetId,
      accountDeleteSchema.parse(body),
      dependencies.env,
    );
    dependencies.sendSuccess(response, result as unknown as JsonValue);
    return true;
  }
  if (target.kind === "organizations" && request.method === "PATCH") {
    const result = await updatePlatformOrganization(
      session,
      target.targetId,
      organizationUpdateSchema.parse(body),
      dependencies.env,
    );
    dependencies.sendSuccess(response, result as unknown as JsonValue);
    return true;
  }
  if (target.kind === "organizations" && request.method === "DELETE") {
    const result = await deletePlatformOrganization(
      session,
      target.targetId,
      organizationDeleteSchema.parse(body),
      dependencies.env,
    );
    dependencies.sendSuccess(response, result as unknown as JsonValue);
    return true;
  }

  return false;
}
