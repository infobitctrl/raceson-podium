import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestSession } from "@raceson/domain";
import { isEventEmailSchedule } from "@raceson/domain";
import { getEventEmailSettings, saveEventEmailSettings, type ServerEnv } from "@raceson/db";
import { z } from "zod";

const keySchema = z.enum(["registration", "reminder", "results"]);
export const eventEmailSettingsSchema = z.object({
  instructions: z.string().max(6000),
  contactEmail: z.union([z.literal(""), z.string().email().max(254)]),
  contactPhone: z.string().max(60).regex(/^[\d+() .-]*$/),
  schedule: z.object({
    mode: z.enum(["registration", "day_before", "after_race"]),
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    daysAfter: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  }).strict(),
}).strict();
type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;
type Dependencies = {
  env: ServerEnv;
  requireSession: (request: IncomingMessage) => Promise<RequestSession>;
  readJsonBody: (request: IncomingMessage) => Promise<JsonValue>;
  sendSuccess: (response: ServerResponse<IncomingMessage>, payload: JsonValue, statusCode?: number) => void;
  applyPrivateSessionHeaders: (response: ServerResponse<IncomingMessage>) => void;
};
export async function dispatchEventEmailSettingsRoutes(req: IncomingMessage, res: ServerResponse<IncomingMessage>, url: URL, deps: Dependencies) {
  const match = url.pathname.match(/^\/api\/v1\/organizer\/editions\/([^/]+)\/email-settings(?:\/([^/]+))?$/);
  if (!match || (req.method !== "GET" && req.method !== "POST")) return false;
  const editionId = z.string().uuid().parse(match[1]);
  const session = await deps.requireSession(req);
  deps.applyPrivateSessionHeaders(res);
  if (req.method === "GET" && !match[2]) {
    deps.sendSuccess(res, await getEventEmailSettings(session, editionId, deps.env));
    return true;
  }
  if (req.method === "POST" && match[2]) {
    const key = keySchema.parse(match[2]);
    const settings = eventEmailSettingsSchema.refine((value) => isEventEmailSchedule(key, value.schedule),
      "Schedule does not match the email template").parse(await deps.readJsonBody(req));
    deps.sendSuccess(res, await saveEventEmailSettings(session, editionId, key, settings, deps.env));
    return true;
  }
  return false;
}
