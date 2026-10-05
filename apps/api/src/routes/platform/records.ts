import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestSession } from "@raceson/domain/auth";
import {
  deletePlatformRecord,
  getPlatformRecordDeletionPreflight,
  listPlatformRecords,
  transferPlatformRecordOwnership,
  updatePlatformRecord,
  type ServerEnv,
} from "@raceson/db";
import { z } from "zod";

const platformRecordKindSchema = z.enum(["athletes", "clubs", "tracks", "events", "leagues"]);
const platformEventRecordScopeSchema = z.enum(["current", "deleted", "sandbox", "orphaned", "all"]);
const nullableShortText = z.string().trim().max(320).nullable();
const nullableLongText = z.string().trim().max(10_000).nullable();
const countryCodeSchema = z.string().trim().length(2).nullable();

const updateSchemas = {
  athletes: z.object({
    firstName: z.string().trim().min(1).max(120),
    lastName: z.string().trim().min(1).max(120),
    displayName: z.string().trim().min(2).max(200),
    dateOfBirth: z.string().date().nullable(),
    primaryEmail: z.string().trim().email().max(320).nullable(),
    city: nullableShortText,
    countryCode: countryCodeSchema,
    status: z.enum(["active", "inactive"]),
  }).transform((input) => ({ kind: "athletes" as const, ...input })),
  clubs: z.object({
    name: z.string().trim().min(2).max(200),
    city: nullableShortText,
    region: nullableShortText,
    countryCode: countryCodeSchema,
    status: z.enum(["active", "inactive"]),
    verificationStatus: z.enum(["unverified", "verified", "flagged"]),
  }).transform((input) => ({ kind: "clubs" as const, ...input })),
  tracks: z.object({
    name: z.string().trim().min(2).max(200),
    terrainType: nullableShortText,
    locationLabel: nullableShortText,
    notes: nullableLongText,
  }).transform((input) => ({ kind: "tracks" as const, ...input })),
  events: z.object({
    name: z.string().trim().min(2).max(200),
    description: nullableLongText,
    locationName: nullableShortText,
    countryCode: countryCodeSchema,
    status: z.enum(["active", "inactive"]),
  }).transform((input) => ({ kind: "events" as const, ...input })),
  leagues: z.object({
    name: z.string().trim().min(2).max(200),
    description: nullableLongText,
    status: z.enum(["draft", "active", "archived"]),
  }).transform((input) => ({ kind: "leagues" as const, ...input })),
} satisfies Record<string, z.ZodType>;

const transferSchema = z.object({
  expectedOwnerId: z.string().uuid().nullable(),
  newOwnerId: z.string().uuid().nullable().optional(),
  newOwnerEmail: z.string().trim().email().max(320).nullable().optional(),
  confirmationName: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(8).max(1000),
});

const deleteSchema = z.object({
  confirmationName: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(8).max(1000),
});

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;
type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

type PlatformRecordRouteDependencies = {
  env: ServerEnv;
  requireSession: (request: ApiRequest) => Promise<RequestSession>;
  readJsonBody: (request: ApiRequest) => Promise<JsonValue>;
  sendSuccess: (response: ApiResponse, payload: JsonValue, statusCode?: number) => void;
  applyPrivateSessionHeaders: (response: ApiResponse) => void;
};

function recordRoute(pathname: string) {
  const match = pathname.match(
    /^\/api\/v1\/platform\/records\/(athletes|clubs|tracks|events|leagues)\/([0-9a-f-]{36})(?:\/(ownership-transfer|deletion-preflight|delete))?$/i,
  );
  if (!match) return null;
  return {
    kind: platformRecordKindSchema.parse(match[1]?.toLowerCase()),
    recordId: z.string().uuid().parse(match[2]),
    action: match[3] ?? null,
  };
}

export async function dispatchPlatformRecordRoutes(
  request: ApiRequest,
  response: ApiResponse,
  url: URL,
  dependencies: PlatformRecordRouteDependencies,
) {
  if (request.method === "GET" && url.pathname === "/api/v1/platform/records") {
    const session = await dependencies.requireSession(request);
    const page = await listPlatformRecords(session, {
      kind: platformRecordKindSchema.parse(url.searchParams.get("kind")),
      page: z.coerce.number().int().positive().optional().parse(url.searchParams.get("page") ?? undefined),
      pageSize: z.coerce.number().int().min(1).max(50).optional().parse(url.searchParams.get("pageSize") ?? undefined),
      search: url.searchParams.get("search"),
      eventScope: platformEventRecordScopeSchema.optional().parse(url.searchParams.get("eventScope") ?? undefined),
    }, dependencies.env);
    dependencies.applyPrivateSessionHeaders(response);
    dependencies.sendSuccess(response, page as unknown as JsonValue);
    return true;
  }

  const route = recordRoute(url.pathname);
  if (!route) return false;

  if (request.method === "PATCH" && route.action === null) {
    const session = await dependencies.requireSession(request);
    const body = await dependencies.readJsonBody(request);
    const input = updateSchemas[route.kind].parse(body ?? {});
    const result = await updatePlatformRecord(session, route.recordId, input, dependencies.env);
    dependencies.sendSuccess(response, result as unknown as JsonValue);
    return true;
  }

  if (request.method === "POST" && route.action === "ownership-transfer") {
    const session = await dependencies.requireSession(request);
    const body = transferSchema.parse(await dependencies.readJsonBody(request) ?? {});
    const result = await transferPlatformRecordOwnership(session, route.recordId, {
      kind: route.kind,
      ...body,
    }, dependencies.env);
    dependencies.sendSuccess(response, result as unknown as JsonValue);
    return true;
  }

  if (request.method === "GET" && route.action === "deletion-preflight") {
    const session = await dependencies.requireSession(request);
    const result = await getPlatformRecordDeletionPreflight(session, route.recordId, {
      kind: route.kind,
    }, dependencies.env);
    dependencies.applyPrivateSessionHeaders(response);
    dependencies.sendSuccess(response, result as unknown as JsonValue);
    return true;
  }

  if (request.method === "POST" && route.action === "delete") {
    const session = await dependencies.requireSession(request);
    const body = deleteSchema.parse(await dependencies.readJsonBody(request) ?? {});
    const result = await deletePlatformRecord(session, route.recordId, {
      kind: route.kind,
      ...body,
    }, dependencies.env);
    dependencies.sendSuccess(response, result as unknown as JsonValue);
    return true;
  }

  return false;
}
