import {
  normalizeOrganizationPermissions,
  type RequestSession,
} from "@raceson/domain/auth";
import { badRequest, conflict, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { requireEditionAccess } from "./permissions.js";
import { createAdminSupabaseClient } from "./supabase.js";

export type StaffAssignmentState =
  | "planned"
  | "confirmed"
  | "checked_in"
  | "completed"
  | "no_show"
  | "replaced"
  | "cancelled";

export type OperationsTaskState =
  | "planned"
  | "ready"
  | "in_progress"
  | "blocked"
  | "done"
  | "waived";

export type WorkforceLogisticsState = {
  eventEditionId: string;
  assignments: Array<{
    id: string;
    eventCategoryId: string | null;
    categoryName: string | null;
    checkpointId: string | null;
    checkpointName: string | null;
    staffUserId: string | null;
    displayName: string;
    workerType: "staff" | "volunteer" | "contractor";
    roleCode: string;
    roleTitle: string;
    accessScope: "operations" | "registration" | "timing" | "safety" | "logistics" | "communications";
    permissionKeys: Array<
      | "events.manage"
      | "entrants.manage"
      | "race_day.manage"
      | "checkpoint_timing.enter"
      | "results.manage"
      | "communications.manage"
      | "safety.manage"
      | "logistics.manage"
    >;
    assignmentState: StaffAssignmentState;
    startsAt: string;
    endsAt: string;
    briefingRequired: boolean;
    briefingAcknowledgedAt: string | null;
    checkedInAt: string | null;
    completedAt: string | null;
    instructions: string | null;
    events: Array<{
      id: string;
      sequenceNumber: number;
      actionType: string;
      fromState: string | null;
      toState: string;
      note: string;
      payload: Record<string, unknown>;
      createdAt: string;
    }>;
  }>;
  tasks: Array<{
    id: string;
    eventCategoryId: string | null;
    categoryName: string | null;
    checkpointId: string | null;
    checkpointName: string | null;
    title: string;
    taskType: string;
    criticality: "routine" | "important" | "critical";
    taskState: OperationsTaskState;
    ownerAssignmentId: string | null;
    ownerName: string | null;
    dueAt: string | null;
    evidenceRequired: boolean;
    latestEvidence: Record<string, unknown>;
    dependencyTaskIds: string[];
    events: Array<{
      id: string;
      sequenceNumber: number;
      actionType: string;
      fromState: string | null;
      toState: string;
      note: string;
      evidence: Record<string, unknown>;
      createdAt: string;
    }>;
  }>;
  inventory: Array<{
    id: string;
    itemName: string;
    itemCategory: string;
    unitLabel: string;
    isCritical: boolean;
    reorderThreshold: number;
    totalQuantity: number;
    availableQuantity: number;
    allocatedQuantity: number;
    fieldQuantity: number;
    itemState: "active" | "retired";
    movements: Array<{
      id: string;
      sequenceNumber: number;
      movementType: string;
      quantity: number;
      checkpointId: string | null;
      checkpointName: string | null;
      locationLabel: string | null;
      note: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      createdAt: string;
    }>;
  }>;
  summary: {
    assignmentsActive: number;
    checkedIn: number;
    briefingBlockers: number;
    criticalTaskBlockers: number;
    inventoryAlerts: number;
  };
};

function mapOperationsError(error: { message?: string | null; details?: string | null }): never {
  const message = error.message ?? "workforce_logistics_operation_failed";
  if (message.includes("staff_assignment_input_invalid")) {
    throw badRequest("Staff assignments require a person, role, access scope, and valid shift window");
  }
  if (message.includes("staff_assignment_event_input_invalid")) {
    throw badRequest("Assignment actions require a supported action, note, and client race ID");
  }
  if (message.includes("operations_task_input_invalid")) {
    throw badRequest("Tasks require a title, type, criticality, and an owner plus due time when critical");
  }
  if (message.includes("operations_task_event_input_invalid")) {
    throw badRequest("Task actions require a supported action, note, evidence object, and client race ID");
  }
  if (message.includes("inventory_item_input_invalid")) {
    throw badRequest("Inventory items require a name, category, unit, and non-negative stock values");
  }
  if (message.includes("inventory_movement_input_invalid")) {
    throw badRequest("Inventory movements require a supported movement, positive quantity, and custody note");
  }
  if (message.includes("operations_scope_invalid")) {
    throw badRequest("The selected race, checkpoint, owner, replacement, or dependency is outside this race");
  }
  if (message.includes("staff_assignment_transition_invalid")) {
    throw conflict(`Staff assignment transition is not allowed${error.details ? ` (${error.details})` : ""}`);
  }
  if (message.includes("staff_briefing_acknowledgement_required")) {
    throw conflict("The required role briefing must be acknowledged before shift check-in");
  }
  if (message.includes("operations_task_transition_invalid")) {
    throw conflict(`Task transition is not allowed${error.details ? ` (${error.details})` : ""}`);
  }
  if (message.includes("operations_task_evidence_required")) {
    throw conflict("Completion evidence is required for this readiness task");
  }
  if (message.includes("operations_task_dependencies_open")) {
    throw conflict("Complete or waive every dependency before progressing this task");
  }
  if (message.includes("inventory_quantity_insufficient")) {
    throw conflict("The requested inventory movement exceeds the available custody bucket");
  }
  if (message.includes("inventory_item_not_active")) {
    throw conflict("Retired inventory cannot receive new movements");
  }
  if (message.includes("staff_assignment_not_found")) throw notFound("Staff assignment not found");
  if (message.includes("operations_task_not_found")) throw notFound("Operations task not found");
  if (message.includes("inventory_item_not_found")) throw notFound("Inventory item not found");
  if (message.includes("edition_not_found")) throw notFound("Race edition not found");
  if (message.includes("idempotency_key_reused")) {
    throw conflict("This client race ID was already used for different operations data");
  }
  throw error;
}

export async function getWorkforceLogisticsState(
  session: RequestSession,
  eventEditionId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<WorkforceLogisticsState> {
  await requireEditionAccess(
    session,
    eventEditionId,
    ["team.manage", "logistics.manage", "race_day.manage"],
    env,
  );
  const adminClient = createAdminSupabaseClient(env);
  const [assignmentsResponse, tasksResponse, inventoryResponse, categoriesResponse, checkpointsResponse] =
    await Promise.all([
      adminClient
        .from("event_staff_assignments")
        .select(
          "id,event_category_id,checkpoint_id,staff_user_id,display_name,worker_type,role_code,role_title,access_scope,permission_keys,assignment_state,starts_at,ends_at,briefing_required,briefing_acknowledged_at,checked_in_at,completed_at,instructions",
        )
        .eq("event_edition_id", eventEditionId)
        .order("starts_at", { ascending: true }),
      adminClient
        .from("event_operations_tasks")
        .select(
          "id,event_category_id,checkpoint_id,title,task_type,criticality,task_state,owner_assignment_id,due_at,evidence_required,latest_evidence_json,dependency_task_ids",
        )
        .eq("event_edition_id", eventEditionId)
        .order("due_at", { ascending: true, nullsFirst: false }),
      adminClient
        .from("event_inventory_items")
        .select(
          "id,item_name,item_category,unit_label,is_critical,reorder_threshold,total_quantity,available_quantity,allocated_quantity,field_quantity,item_state",
        )
        .eq("event_edition_id", eventEditionId)
        .order("item_name", { ascending: true }),
      adminClient
        .from("event_categories")
        .select("id,name")
        .eq("event_edition_id", eventEditionId),
      adminClient
        .from("checkpoints")
        .select("id,name,event_category_id"),
    ]);
  if (assignmentsResponse.error) throw assignmentsResponse.error;
  if (tasksResponse.error) throw tasksResponse.error;
  if (inventoryResponse.error) throw inventoryResponse.error;
  if (categoriesResponse.error) throw categoriesResponse.error;
  if (checkpointsResponse.error) throw checkpointsResponse.error;

  const assignmentRows = assignmentsResponse.data ?? [];
  const taskRows = tasksResponse.data ?? [];
  const inventoryRows = inventoryResponse.data ?? [];
  const assignmentIds = assignmentRows.map((assignment) => assignment.id);
  const taskIds = taskRows.map((task) => task.id);
  const inventoryIds = inventoryRows.map((item) => item.id);
  const [assignmentEventsResponse, taskEventsResponse, movementsResponse] = await Promise.all([
    assignmentIds.length
      ? adminClient
          .from("event_staff_assignment_events")
          .select("id,event_staff_assignment_id,sequence_number,action_type,from_state,to_state,note,payload_json,created_at")
          .in("event_staff_assignment_id", assignmentIds)
          .order("sequence_number", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    taskIds.length
      ? adminClient
          .from("event_operations_task_events")
          .select("id,event_operations_task_id,sequence_number,action_type,from_state,to_state,note,evidence_json,created_at")
          .in("event_operations_task_id", taskIds)
          .order("sequence_number", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    inventoryIds.length
      ? adminClient
          .from("event_inventory_movements")
          .select("id,event_inventory_item_id,sequence_number,movement_type,quantity,checkpoint_id,location_label,note,before_json,after_json,created_at")
          .in("event_inventory_item_id", inventoryIds)
          .order("sequence_number", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (assignmentEventsResponse.error) throw assignmentEventsResponse.error;
  if (taskEventsResponse.error) throw taskEventsResponse.error;
  if (movementsResponse.error) throw movementsResponse.error;

  const categoryNameById = new Map((categoriesResponse.data ?? []).map((category) => [category.id, category.name]));
  const checkpointNameById = new Map(
    (checkpointsResponse.data ?? [])
      .filter((checkpoint) => categoryNameById.has(checkpoint.event_category_id))
      .map((checkpoint) => [checkpoint.id, checkpoint.name]),
  );
  const assignmentNameById = new Map(assignmentRows.map((assignment) => [assignment.id, assignment.display_name]));

  type AssignmentEventRow = NonNullable<typeof assignmentEventsResponse.data>[number];
  type TaskEventRow = NonNullable<typeof taskEventsResponse.data>[number];
  type MovementRow = NonNullable<typeof movementsResponse.data>[number];
  const assignmentEventsByAssignment = new Map<string, AssignmentEventRow[]>();
  for (const assignmentEvent of assignmentEventsResponse.data ?? []) {
    const existing = assignmentEventsByAssignment.get(assignmentEvent.event_staff_assignment_id) ?? [];
    existing.push(assignmentEvent);
    assignmentEventsByAssignment.set(assignmentEvent.event_staff_assignment_id, existing);
  }
  const taskEventsByTask = new Map<string, TaskEventRow[]>();
  for (const taskEvent of taskEventsResponse.data ?? []) {
    const existing = taskEventsByTask.get(taskEvent.event_operations_task_id) ?? [];
    existing.push(taskEvent);
    taskEventsByTask.set(taskEvent.event_operations_task_id, existing);
  }
  const movementsByItem = new Map<string, MovementRow[]>();
  for (const movement of movementsResponse.data ?? []) {
    const existing = movementsByItem.get(movement.event_inventory_item_id) ?? [];
    existing.push(movement);
    movementsByItem.set(movement.event_inventory_item_id, existing);
  }

  const assignments: WorkforceLogisticsState["assignments"] = assignmentRows.map((assignment) => ({
    id: assignment.id,
    eventCategoryId: assignment.event_category_id,
    categoryName: assignment.event_category_id ? categoryNameById.get(assignment.event_category_id) ?? null : null,
    checkpointId: assignment.checkpoint_id,
    checkpointName: assignment.checkpoint_id ? checkpointNameById.get(assignment.checkpoint_id) ?? null : null,
    staffUserId: assignment.staff_user_id,
    displayName: assignment.display_name,
    workerType: assignment.worker_type,
    roleCode: assignment.role_code,
    roleTitle: assignment.role_title,
    accessScope: assignment.access_scope,
    permissionKeys: normalizeOrganizationPermissions(
      Array.isArray(assignment.permission_keys) ? assignment.permission_keys : [],
    ).filter((permission): permission is WorkforceLogisticsState["assignments"][number]["permissionKeys"][number] =>
      permission !== "organization.manage"
      && permission !== "team.manage"
      && permission !== "finance.manage"),
    assignmentState: assignment.assignment_state,
    startsAt: assignment.starts_at,
    endsAt: assignment.ends_at,
    briefingRequired: assignment.briefing_required,
    briefingAcknowledgedAt: assignment.briefing_acknowledged_at,
    checkedInAt: assignment.checked_in_at,
    completedAt: assignment.completed_at,
    instructions: assignment.instructions,
    events: (assignmentEventsByAssignment.get(assignment.id) ?? []).map((assignmentEvent) => ({
      id: assignmentEvent.id,
      sequenceNumber: assignmentEvent.sequence_number,
      actionType: assignmentEvent.action_type,
      fromState: assignmentEvent.from_state,
      toState: assignmentEvent.to_state,
      note: assignmentEvent.note,
      payload: assignmentEvent.payload_json as Record<string, unknown>,
      createdAt: assignmentEvent.created_at,
    })),
  }));
  const tasks: WorkforceLogisticsState["tasks"] = taskRows.map((task) => ({
    id: task.id,
    eventCategoryId: task.event_category_id,
    categoryName: task.event_category_id ? categoryNameById.get(task.event_category_id) ?? null : null,
    checkpointId: task.checkpoint_id,
    checkpointName: task.checkpoint_id ? checkpointNameById.get(task.checkpoint_id) ?? null : null,
    title: task.title,
    taskType: task.task_type,
    criticality: task.criticality,
    taskState: task.task_state,
    ownerAssignmentId: task.owner_assignment_id,
    ownerName: task.owner_assignment_id ? assignmentNameById.get(task.owner_assignment_id) ?? null : null,
    dueAt: task.due_at,
    evidenceRequired: task.evidence_required,
    latestEvidence: task.latest_evidence_json as Record<string, unknown>,
    dependencyTaskIds: task.dependency_task_ids,
    events: (taskEventsByTask.get(task.id) ?? []).map((taskEvent) => ({
      id: taskEvent.id,
      sequenceNumber: taskEvent.sequence_number,
      actionType: taskEvent.action_type,
      fromState: taskEvent.from_state,
      toState: taskEvent.to_state,
      note: taskEvent.note,
      evidence: taskEvent.evidence_json as Record<string, unknown>,
      createdAt: taskEvent.created_at,
    })),
  }));
  const inventory: WorkforceLogisticsState["inventory"] = inventoryRows.map((item) => ({
    id: item.id,
    itemName: item.item_name,
    itemCategory: item.item_category,
    unitLabel: item.unit_label,
    isCritical: item.is_critical,
    reorderThreshold: Number(item.reorder_threshold),
    totalQuantity: Number(item.total_quantity),
    availableQuantity: Number(item.available_quantity),
    allocatedQuantity: Number(item.allocated_quantity),
    fieldQuantity: Number(item.field_quantity),
    itemState: item.item_state,
    movements: (movementsByItem.get(item.id) ?? []).map((movement) => ({
      id: movement.id,
      sequenceNumber: movement.sequence_number,
      movementType: movement.movement_type,
      quantity: Number(movement.quantity),
      checkpointId: movement.checkpoint_id,
      checkpointName: movement.checkpoint_id ? checkpointNameById.get(movement.checkpoint_id) ?? null : null,
      locationLabel: movement.location_label,
      note: movement.note,
      before: movement.before_json as Record<string, unknown>,
      after: movement.after_json as Record<string, unknown>,
      createdAt: movement.created_at,
    })),
  }));
  const activeAssignments = assignments.filter(
    (assignment) => !["completed", "replaced", "cancelled"].includes(assignment.assignmentState),
  );
  return {
    eventEditionId,
    assignments,
    tasks,
    inventory,
    summary: {
      assignmentsActive: activeAssignments.length,
      checkedIn: assignments.filter((assignment) => assignment.assignmentState === "checked_in").length,
      briefingBlockers: activeAssignments.filter(
        (assignment) => assignment.briefingRequired && !assignment.briefingAcknowledgedAt,
      ).length,
      criticalTaskBlockers: tasks.filter(
        (task) => task.criticality === "critical" && !["done", "waived"].includes(task.taskState),
      ).length,
      inventoryAlerts: inventory.filter(
        (item) => item.isCritical && item.itemState === "active" && item.totalQuantity < item.reorderThreshold,
      ).length,
    },
  };
}

export async function createStaffAssignment(
  session: RequestSession,
  eventEditionId: string,
  input: {
    eventCategoryId?: string | null;
    checkpointId?: string | null;
    staffUserId?: string | null;
    displayName: string;
    workerType: "staff" | "volunteer" | "contractor";
    roleCode: string;
    roleTitle: string;
    accessScope: "operations" | "registration" | "timing" | "safety" | "logistics" | "communications";
    permissionKeys: WorkforceLogisticsState["assignments"][number]["permissionKeys"];
    startsAt: string;
    endsAt: string;
    leadUserId?: string | null;
    briefingRequired?: boolean;
    instructions?: string | null;
    replacementForAssignmentId?: string | null;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const edition = await requireEditionAccess(
    session,
    eventEditionId,
    "team.manage",
    env,
  );
  const adminClient = createAdminSupabaseClient(env);
  if (input.staffUserId) {
    const { data: membership, error: membershipError } = await adminClient
      .from("organization_memberships")
      .select("role,permission_keys,status,expires_at")
      .eq("organization_id", edition.organizationId)
      .eq("user_id", input.staffUserId)
      .maybeSingle<{
        role: string;
        permission_keys: unknown;
        status: string;
        expires_at: string | null;
      }>();
    if (membershipError) throw membershipError;
    if (
      !membership
      || membership.status !== "active"
      || (membership.expires_at && Date.parse(membership.expires_at) <= Date.now())
    ) {
      throw badRequest("The selected team account is not active in this organization");
    }
    const memberPermissions = normalizeOrganizationPermissions(
      Array.isArray(membership.permission_keys) ? membership.permission_keys : [],
    );
    if (
      membership.role !== "owner"
      && input.permissionKeys.some((permission) => !memberPermissions.includes(permission))
    ) {
      throw badRequest("A race duty cannot exceed the account's organization permissions");
    }
  }
  const { data, error } = await adminClient.rpc("service_create_staff_assignment", {
    p_event_edition_id: eventEditionId,
    p_event_category_id: input.eventCategoryId ?? null,
    p_checkpoint_id: input.checkpointId ?? null,
    p_staff_user_id: input.staffUserId ?? null,
    p_display_name: input.displayName,
    p_worker_type: input.workerType,
    p_role_code: input.roleCode,
    p_role_title: input.roleTitle,
    p_access_scope: input.accessScope,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_lead_user_id: input.leadUserId ?? null,
    p_briefing_required: input.briefingRequired ?? false,
    p_instructions: input.instructions ?? null,
    p_replacement_for_assignment_id: input.replacementForAssignmentId ?? null,
    p_actor_user_id: session.account.userId,
    p_client_event_id: input.clientEventId,
  });
  if (error) mapOperationsError(error);
  const assignmentId = (data as { id?: unknown } | null)?.id;
  if (typeof assignmentId === "string") {
    const { error: permissionsError } = await adminClient
      .from("event_staff_assignments")
      .update({ permission_keys: input.permissionKeys })
      .eq("id", assignmentId);
    if (permissionsError) throw permissionsError;
  }
  return data as Record<string, unknown>;
}

async function requireAssignmentAccess(
  session: RequestSession,
  assignmentId: string,
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("event_staff_assignments")
    .select("event_edition_id")
    .eq("id", assignmentId)
    .maybeSingle<{ event_edition_id: string }>();
  if (error) throw error;
  if (!data) throw notFound("Staff assignment not found");
  await requireEditionAccess(session, data.event_edition_id, "team.manage", env);
}

export async function appendStaffAssignmentEvent(
  session: RequestSession,
  assignmentId: string,
  input: {
    actionType: "confirm" | "briefing_acknowledgement" | "check_in" | "complete" | "no_show" | "replace" | "cancel" | "note";
    toState?: StaffAssignmentState | null;
    note: string;
    payload?: Record<string, unknown>;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireAssignmentAccess(session, assignmentId, env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_append_staff_assignment_event", {
    p_event_staff_assignment_id: assignmentId,
    p_actor_user_id: session.account.userId,
    p_action_type: input.actionType,
    p_to_state: input.toState ?? null,
    p_note: input.note,
    p_payload_json: input.payload ?? {},
    p_client_event_id: input.clientEventId,
  });
  if (error) mapOperationsError(error);
  return data as Record<string, unknown>;
}

export async function createOperationsTask(
  session: RequestSession,
  eventEditionId: string,
  input: {
    eventCategoryId?: string | null;
    checkpointId?: string | null;
    title: string;
    taskType: string;
    criticality: "routine" | "important" | "critical";
    ownerAssignmentId?: string | null;
    dueAt?: string | null;
    evidenceRequired?: boolean;
    dependencyTaskIds?: string[];
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireEditionAccess(session, eventEditionId, "logistics.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_create_operations_task", {
    p_event_edition_id: eventEditionId,
    p_event_category_id: input.eventCategoryId ?? null,
    p_checkpoint_id: input.checkpointId ?? null,
    p_title: input.title,
    p_task_type: input.taskType,
    p_criticality: input.criticality,
    p_owner_assignment_id: input.ownerAssignmentId ?? null,
    p_due_at: input.dueAt ?? null,
    p_evidence_required: input.evidenceRequired ?? false,
    p_dependency_task_ids: input.dependencyTaskIds ?? [],
    p_actor_user_id: session.account.userId,
    p_client_event_id: input.clientEventId,
  });
  if (error) mapOperationsError(error);
  return data as Record<string, unknown>;
}

async function requireTaskAccess(session: RequestSession, taskId: string, env: ServerEnv) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("event_operations_tasks")
    .select("event_edition_id")
    .eq("id", taskId)
    .maybeSingle<{ event_edition_id: string }>();
  if (error) throw error;
  if (!data) throw notFound("Operations task not found");
  await requireEditionAccess(session, data.event_edition_id, "logistics.manage", env);
}

export async function appendOperationsTaskEvent(
  session: RequestSession,
  taskId: string,
  input: {
    actionType: "ready" | "start" | "block" | "complete" | "waive" | "reopen" | "note";
    toState?: OperationsTaskState | null;
    note: string;
    evidence?: Record<string, unknown>;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireTaskAccess(session, taskId, env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_append_operations_task_event", {
    p_event_operations_task_id: taskId,
    p_actor_user_id: session.account.userId,
    p_action_type: input.actionType,
    p_to_state: input.toState ?? null,
    p_note: input.note,
    p_evidence_json: input.evidence ?? {},
    p_client_event_id: input.clientEventId,
  });
  if (error) mapOperationsError(error);
  return data as Record<string, unknown>;
}

export async function createEventInventoryItem(
  session: RequestSession,
  eventEditionId: string,
  input: {
    itemName: string;
    itemCategory: string;
    unitLabel: string;
    isCritical?: boolean;
    reorderThreshold?: number;
    initialQuantity: number;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireEditionAccess(session, eventEditionId, "logistics.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_create_event_inventory_item", {
    p_event_edition_id: eventEditionId,
    p_item_name: input.itemName,
    p_item_category: input.itemCategory,
    p_unit_label: input.unitLabel,
    p_is_critical: input.isCritical ?? false,
    p_reorder_threshold: input.reorderThreshold ?? 0,
    p_initial_quantity: input.initialQuantity,
    p_actor_user_id: session.account.userId,
    p_client_event_id: input.clientEventId,
  });
  if (error) mapOperationsError(error);
  return data as Record<string, unknown>;
}

async function requireInventoryAccess(
  session: RequestSession,
  inventoryItemId: string,
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("event_inventory_items")
    .select("event_edition_id")
    .eq("id", inventoryItemId)
    .maybeSingle<{ event_edition_id: string }>();
  if (error) throw error;
  if (!data) throw notFound("Inventory item not found");
  await requireEditionAccess(session, data.event_edition_id, "logistics.manage", env);
}

export async function recordInventoryMovement(
  session: RequestSession,
  inventoryItemId: string,
  input: {
    movementType: "allocate" | "release" | "dispatch" | "return" | "consume" | "damage" | "restock" | "adjust_loss";
    quantity: number;
    checkpointId?: string | null;
    locationLabel?: string | null;
    note: string;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireInventoryAccess(session, inventoryItemId, env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_record_inventory_movement", {
    p_event_inventory_item_id: inventoryItemId,
    p_actor_user_id: session.account.userId,
    p_movement_type: input.movementType,
    p_quantity: input.quantity,
    p_checkpoint_id: input.checkpointId ?? null,
    p_location_label: input.locationLabel ?? null,
    p_note: input.note,
    p_client_event_id: input.clientEventId,
  });
  if (error) mapOperationsError(error);
  return data as Record<string, unknown>;
}
