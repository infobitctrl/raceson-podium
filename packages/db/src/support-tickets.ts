import type { RequestSession } from "@raceson/domain/auth";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { createAdminSupabaseClient } from "./supabase.js";

export type SupportTicketCategory =
  | "general"
  | "account"
  | "athlete_profile"
  | "club"
  | "event"
  | "technical"
  | "other";

export type SupportTicketStatus = "open" | "in_progress" | "resolved" | "closed";

export type SupportTicket = {
  ticketId: string;
  subject: string;
  category: SupportTicketCategory;
  status: SupportTicketStatus;
  requester: {
    userId: string;
    displayName: string;
    email: string | null;
  };
  assignedAdministrator: {
    userId: string;
    displayName: string;
  } | null;
  messages: Array<{
    messageId: string;
    authorKind: "requester" | "platform_admin";
    authorName: string;
    body: string;
    createdAt: string;
  }>;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
};

type SupportTicketRow = {
  id: string;
  requester_user_id: string;
  subject: string;
  category: SupportTicketCategory;
  status: SupportTicketStatus;
  assigned_to_user_id: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
};

type SupportTicketMessageRow = {
  id: string;
  ticket_id: string;
  author_user_id: string | null;
  author_kind: "requester" | "platform_admin";
  body: string;
  created_at: string;
};

type UserProfileRow = {
  user_id: string;
  display_name: string | null;
  email: string | null;
};

const SUPPORT_TICKET_COLUMNS = [
  "id",
  "requester_user_id",
  "subject",
  "category",
  "status",
  "assigned_to_user_id",
  "last_message_at",
  "created_at",
  "updated_at",
].join(",");

export function canManageSupportTickets(platformRole: string | null | undefined) {
  return platformRole === "super_admin" || platformRole === "site_admin";
}

function requirePlatformAdministrator(session: RequestSession) {
  if (!canManageSupportTickets(session.account.platformRole)) {
    throw forbidden("Only platform administrators can manage support tickets.");
  }
}

export function throwSupportTicketRpcError(error: { code?: string; message?: string }): never {
  const rawMessage = error.message ?? "Support ticket command failed";
  const messages: Record<string, string> = {
    support_ticket_authentication_required: "Sign in before contacting platform support.",
    support_ticket_access_denied: "This support ticket belongs to another account.",
    support_ticket_admin_required: "Only platform administrators can manage support tickets.",
    support_ticket_not_found: "Support ticket not found.",
    support_ticket_closed: "This support ticket is closed. Start a new ticket if you still need help.",
    support_ticket_author_invalid: "The support ticket author type is invalid.",
    support_ticket_status_invalid: "The support ticket status is invalid.",
  };
  const message = messages[rawMessage] ?? rawMessage;
  if (
    error.code === "PGRST202"
    || rawMessage.includes("service_create_support_ticket")
    || rawMessage.includes("service_append_support_ticket_message")
    || rawMessage.includes("service_update_support_ticket_status")
  ) {
    throw conflict("Support ticket service is temporarily unavailable while the database is being updated. Please try again shortly.");
  }
  if (error.code === "28000" || error.code === "42501") throw forbidden(message);
  if (error.code === "P0002") throw notFound(message);
  if (error.code === "55000") throw conflict(message);
  if (error.code === "22023" || error.code === "23514") throw badRequest(message);
  throw error;
}

async function hydrateSupportTickets(
  tickets: SupportTicketRow[],
  env: ServerEnv,
): Promise<SupportTicket[]> {
  if (!tickets.length) return [];

  const adminClient = createAdminSupabaseClient(env);
  const ticketIds = tickets.map((ticket) => ticket.id);
  const { data: messageData, error: messageError } = await adminClient
    .from("platform_support_ticket_messages")
    .select("id,ticket_id,author_user_id,author_kind,body,created_at")
    .in("ticket_id", ticketIds)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (messageError) throw messageError;

  const messages = (messageData ?? []) as SupportTicketMessageRow[];
  const profileUserIds = Array.from(new Set([
    ...tickets.flatMap((ticket) => [ticket.requester_user_id, ticket.assigned_to_user_id]),
    ...messages.map((message) => message.author_user_id),
  ].filter((userId): userId is string => Boolean(userId))));
  const profilesResult = profileUserIds.length
    ? await adminClient
        .from("user_profiles")
        .select("user_id,display_name,email")
        .in("user_id", profileUserIds)
    : { data: [] as UserProfileRow[], error: null };
  if (profilesResult.error) throw profilesResult.error;

  const profileByUserId = new Map(
    ((profilesResult.data ?? []) as UserProfileRow[]).map((profile) => [profile.user_id, profile]),
  );
  const messagesByTicketId = new Map<string, SupportTicketMessageRow[]>();
  for (const message of messages) {
    const ticketMessages = messagesByTicketId.get(message.ticket_id) ?? [];
    ticketMessages.push(message);
    messagesByTicketId.set(message.ticket_id, ticketMessages);
  }

  return tickets.map((ticket) => {
    const requester = profileByUserId.get(ticket.requester_user_id);
    const assignedAdministrator = ticket.assigned_to_user_id
      ? profileByUserId.get(ticket.assigned_to_user_id)
      : null;
    return {
      ticketId: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      status: ticket.status,
      requester: {
        userId: ticket.requester_user_id,
        displayName: requester?.display_name?.trim() || "Account holder",
        email: requester?.email ?? null,
      },
      assignedAdministrator: ticket.assigned_to_user_id
        ? {
            userId: ticket.assigned_to_user_id,
            displayName: assignedAdministrator?.display_name?.trim() || "Platform administrator",
          }
        : null,
      messages: (messagesByTicketId.get(ticket.id) ?? []).map((message) => {
        const author = message.author_user_id ? profileByUserId.get(message.author_user_id) : null;
        return {
          messageId: message.id,
          authorKind: message.author_kind,
          authorName: author?.display_name?.trim()
            || (message.author_kind === "platform_admin" ? "Platform support" : "Account holder"),
          body: message.body,
          createdAt: message.created_at,
        };
      }),
      lastMessageAt: ticket.last_message_at,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
    };
  });
}

export async function listCurrentUserSupportTickets(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("platform_support_tickets")
    .select(SUPPORT_TICKET_COLUMNS)
    .eq("requester_user_id", session.account.userId)
    .order("last_message_at", { ascending: false });
  if (error) throw error;
  return hydrateSupportTickets((data ?? []) as unknown as SupportTicketRow[], env);
}

export async function listPlatformSupportTickets(
  session: RequestSession,
  status: SupportTicketStatus | null = null,
  env: ServerEnv = loadServerEnv(),
) {
  requirePlatformAdministrator(session);
  const adminClient = createAdminSupabaseClient(env);
  let query = adminClient
    .from("platform_support_tickets")
    .select(SUPPORT_TICKET_COLUMNS)
    .order("last_message_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return hydrateSupportTickets((data ?? []) as unknown as SupportTicketRow[], env);
}

export async function createCurrentUserSupportTicket(
  session: RequestSession,
  input: { subject: string; category: SupportTicketCategory; message: string },
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_create_support_ticket", {
    p_requester_user_id: session.account.userId,
    p_subject: input.subject.trim(),
    p_category: input.category,
    p_body: input.message.trim(),
  });
  if (error) throwSupportTicketRpcError(error);
  return data as { ticketId: string; messageId: string; status: SupportTicketStatus; createdAt: string };
}

export async function replyToCurrentUserSupportTicket(
  session: RequestSession,
  ticketId: string,
  message: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_append_support_ticket_message", {
    p_actor_user_id: session.account.userId,
    p_ticket_id: ticketId,
    p_author_kind: "requester",
    p_body: message.trim(),
  });
  if (error) throwSupportTicketRpcError(error);
  return data as { ticketId: string; messageId: string; status: SupportTicketStatus; createdAt: string };
}

export async function replyToPlatformSupportTicket(
  session: RequestSession,
  ticketId: string,
  message: string,
  env: ServerEnv = loadServerEnv(),
) {
  requirePlatformAdministrator(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_append_support_ticket_message", {
    p_actor_user_id: session.account.userId,
    p_ticket_id: ticketId,
    p_author_kind: "platform_admin",
    p_body: message.trim(),
  });
  if (error) throwSupportTicketRpcError(error);
  return data as { ticketId: string; messageId: string; status: SupportTicketStatus; createdAt: string };
}

export async function updatePlatformSupportTicketStatus(
  session: RequestSession,
  ticketId: string,
  status: SupportTicketStatus,
  env: ServerEnv = loadServerEnv(),
) {
  requirePlatformAdministrator(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_update_support_ticket_status", {
    p_actor_user_id: session.account.userId,
    p_ticket_id: ticketId,
    p_status: status,
  });
  if (error) throwSupportTicketRpcError(error);
  return data as { ticketId: string; status: SupportTicketStatus; updatedAt: string };
}
