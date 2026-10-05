import type { RequestSession } from "@raceson/domain/auth";
import { badRequest, conflict, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import {
  requireEditionAccess,
  requireOrganizationAccess,
} from "./permissions.js";
import { createAdminSupabaseClient } from "./supabase.js";

export type CommunicationTemplate = {
  id: string;
  organizationId: string;
  name: string;
  communicationType: "transactional" | "operational";
  channel: "email";
  versionNumber: number;
  status: "active" | "archived";
  subjectTemplate: string;
  bodyMarkdown: string;
  createdAt: string;
};

export type CommunicationCampaign = {
  id: string;
  eventEditionId: string;
  templateId: string;
  templateName: string;
  name: string;
  state: "scheduled" | "queued" | "processing" | "completed" | "cancelled" | "failed";
  recipientCount: number;
  scheduledAt: string;
  createdAt: string;
  subjectSnapshot: string;
};

function mapCommunicationError(error: { message?: string | null }): never {
  const message = error.message ?? "communication_operation_failed";
  if (message.includes("communication_template_input_invalid")) {
    throw badRequest("Template name, type, subject, and message are required");
  }
  if (message.includes("communication_campaign_input_invalid")) {
    throw badRequest("Campaign name, audience, and a valid schedule are required");
  }
  if (message.includes("communication_audience_invalid")) {
    throw badRequest("The selected audience includes a race outside this edition");
  }
  if (message.includes("communication_template_not_found")) {
    throw notFound("Active communication template not found");
  }
  if (message.includes("communication_campaign_not_found")) {
    throw notFound("Communication campaign not found");
  }
  if (message.includes("communication_cancel_reason_required")) {
    throw badRequest("A cancellation reason is required");
  }
  if (message.includes("communication_campaign_cannot_cancel")) {
    throw conflict("This campaign has already started delivery and cannot be cancelled");
  }
  throw error;
}

export async function listCommunicationTemplates(
  session: RequestSession,
  organizationId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<CommunicationTemplate[]> {
  requireOrganizationAccess(session, organizationId, "communications.manage");
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("communication_templates")
    .select(
      "id,organization_id,name,communication_type,channel,version_number,status,subject_template,body_markdown,created_at",
    )
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((template) => ({
    id: template.id,
    organizationId: template.organization_id,
    name: template.name,
    communicationType: template.communication_type as CommunicationTemplate["communicationType"],
    channel: "email",
    versionNumber: template.version_number,
    status: template.status as CommunicationTemplate["status"],
    subjectTemplate: template.subject_template,
    bodyMarkdown: template.body_markdown,
    createdAt: template.created_at,
  }));
}

export async function saveCommunicationTemplate(
  session: RequestSession,
  organizationId: string,
  input: {
    name: string;
    communicationType: "transactional" | "operational";
    subjectTemplate: string;
    bodyMarkdown: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  requireOrganizationAccess(session, organizationId, "communications.manage");
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_save_communication_template", {
    p_organization_id: organizationId,
    p_actor_user_id: session.account.userId,
    p_name: input.name,
    p_communication_type: input.communicationType,
    p_subject_template: input.subjectTemplate,
    p_body_markdown: input.bodyMarkdown,
  });
  if (error) mapCommunicationError(error);
  return data as CommunicationTemplate;
}

export async function listCommunicationCampaigns(
  session: RequestSession,
  eventEditionId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<CommunicationCampaign[]> {
  await requireEditionAccess(session, eventEditionId, "communications.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("communication_campaigns")
    .select(
      "id,event_edition_id,template_id,name,state,recipient_count,scheduled_at,created_at,subject_snapshot,communication_templates!inner(name)",
    )
    .eq("event_edition_id", eventEditionId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((campaign) => {
    const templateRelation = campaign.communication_templates as
      | { name: string }
      | Array<{ name: string }>;
    const template = Array.isArray(templateRelation) ? templateRelation[0] : templateRelation;
    return {
      id: campaign.id,
      eventEditionId: campaign.event_edition_id,
      templateId: campaign.template_id,
      templateName: template?.name ?? "Template",
      name: campaign.name,
      state: campaign.state as CommunicationCampaign["state"],
      recipientCount: campaign.recipient_count,
      scheduledAt: campaign.scheduled_at,
      createdAt: campaign.created_at,
      subjectSnapshot: campaign.subject_snapshot,
    };
  });
}

export async function scheduleCommunicationCampaign(
  session: RequestSession,
  eventEditionId: string,
  input: {
    templateId: string;
    name: string;
    registrationStatuses: Array<"pending" | "confirmed" | "waitlisted" | "offered" | "cancelled">;
    eventCategoryIds?: string[];
    scheduledAt: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireEditionAccess(session, eventEditionId, "communications.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_schedule_communication_campaign", {
    p_event_edition_id: eventEditionId,
    p_actor_user_id: session.account.userId,
    p_template_id: input.templateId,
    p_name: input.name,
    p_registration_statuses: input.registrationStatuses,
    p_event_category_ids: input.eventCategoryIds ?? [],
    p_scheduled_at: input.scheduledAt,
  });
  if (error) mapCommunicationError(error);
  return data as {
    id: string;
    eventEditionId: string;
    name: string;
    state: CommunicationCampaign["state"];
    recipientCount: number;
    scheduledAt: string;
    createdAt: string;
  };
}

export async function cancelCommunicationCampaign(
  session: RequestSession,
  campaignId: string,
  reason: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: campaign, error: campaignError } = await adminClient
    .from("communication_campaigns")
    .select("event_edition_id")
    .eq("id", campaignId)
    .maybeSingle<{ event_edition_id: string }>();
  if (campaignError) throw campaignError;
  if (!campaign) throw notFound("Communication campaign not found");
  await requireEditionAccess(session, campaign.event_edition_id, "communications.manage", env);

  const { data, error } = await adminClient.rpc("service_cancel_communication_campaign", {
    p_campaign_id: campaignId,
    p_actor_user_id: session.account.userId,
    p_reason: reason,
  });
  if (error) mapCommunicationError(error);
  return data as { id: string; state: "cancelled"; replayed: boolean };
}
