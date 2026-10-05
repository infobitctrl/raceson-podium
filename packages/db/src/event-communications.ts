import type { RequestSession, EventEmailKey, EventEmailSettings, SavedEventEmailSettings, EventEmailConfiguration } from "@raceson/domain";
import { isEventEmailSchedule } from "@raceson/domain";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { requireEditionAccess } from "./permissions.js";
import { createAdminSupabaseClient } from "./supabase.js";

const columns = "template_key,settings_json,updated_at";
export async function readEventEmailSetupStatus(client: ReturnType<typeof createAdminSupabaseClient>, editionId: string) {
  const { data, error } = await client.from("event_communication_settings")
    .select("template_key,settings_json").eq("event_edition_id", editionId);
  if (error) throw error;
  const saved = new Set((data ?? []).filter((row) => isEventEmailSchedule(row.template_key, row.settings_json?.schedule))
    .map((row) => row.template_key));
  return { ready: saved.size === 3, savedCount: saved.size };
}
function mapRow(row: { template_key: string; settings_json: unknown; updated_at: string }): SavedEventEmailSettings {
  return { templateKey: row.template_key as EventEmailKey, settings: row.settings_json as EventEmailSettings, updatedAt: row.updated_at };
}
export async function getEventEmailSettings(session: RequestSession, editionId: string, env: ServerEnv = loadServerEnv()): Promise<EventEmailConfiguration> {
  const edition = await requireEditionAccess(session, editionId, "communications.manage", env);
  const client = createAdminSupabaseClient(env);
  const [settings, organization, delivery] = await Promise.all([
    client.from("event_communication_settings").select(columns).eq("event_edition_id", editionId),
    client.from("organizations").select("contact_email,contact_phone,website_url,instagram_url,facebook_url,linkedin_url,youtube_url,tiktok_url,x_url")
      .eq("id", edition.organizationId).single(),
    client.rpc("service_event_email_status", { p_edition_id: editionId }),
  ]);
  if (delivery.error) throw delivery.error;
  if (settings.error) throw settings.error;
  if (organization.error) throw organization.error;
  const row = organization.data;
  const socialLinks = [
    ["Web", row.website_url], ["Instagram", row.instagram_url], ["Facebook", row.facebook_url],
    ["LinkedIn", row.linkedin_url], ["YouTube", row.youtube_url], ["TikTok", row.tiktok_url], ["X", row.x_url],
  ].filter((entry): entry is [string, string] => Boolean(entry[1])).map(([label, url]) => ({ label, url }));
  return { templates: (settings.data ?? []).map(mapRow), delivery: delivery.data, organizer: {
    contactEmail: row.contact_email ?? "", contactPhone: row.contact_phone ?? "", socialLinks,
  } };
}
export async function saveEventEmailSettings(session: RequestSession, editionId: string, templateKey: EventEmailKey,
  settings: EventEmailSettings, env: ServerEnv = loadServerEnv()) {
  await requireEditionAccess(session, editionId, "communications.manage", env);
  const { data, error } = await createAdminSupabaseClient(env).from("event_communication_settings")
    .upsert({ event_edition_id: editionId, template_key: templateKey, settings_json: settings,
      updated_by_user_id: session.account.userId, updated_at: new Date().toISOString() },
    { onConflict: "event_edition_id,template_key" }).select(columns).single();
  if (error) throw error;
  return mapRow(data);
}
