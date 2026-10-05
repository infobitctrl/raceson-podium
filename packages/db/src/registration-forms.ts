import type { RequestSession } from "@raceson/domain/auth";
import { conflict, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { requireCategoryAccess } from "./permissions.js";
import { createAdminSupabaseClient } from "./supabase.js";
import { canViewPublishedEvent, type PublishedEventVisibility } from "./event-visibility.js";

export type RegistrationFormField = {
  id: string;
  key: string;
  label: string;
  type:
    | "text"
    | "textarea"
    | "number"
    | "boolean"
    | "select"
    | "multiselect"
    | "date"
    | "email"
    | "phone";
  helpText: string | null;
  placeholder: string | null;
  required: boolean;
  position: number;
  options: unknown[];
  validation: Record<string, unknown>;
};

export type RegistrationLegalDocument = {
  id: string;
  type: string;
  title: string;
  bodyMarkdown: string;
  locale: string;
  digest: string;
  required: boolean;
  position: number;
};

export type RegistrationConfiguration = {
  formVersionId: string;
  versionNumber: number;
  versionLabel: string;
  locale: string;
  title: string;
  digest: string;
  publishedAt: string;
  eligibility: {
    minimumAge: number | null;
    maximumAge: number | null;
    allowedGenders: Array<"F" | "M" | "U">;
    note: string | null;
  };
  participation: {
    access: "open" | "club_members";
    eligibleClubs: Array<{ id: string; name: string }>;
  };
  fields: RegistrationFormField[];
  documents: RegistrationLegalDocument[];
};

export type PublishRegistrationConfigurationInput = {
  versionLabel: string;
  title: string;
  locale: string;
  fields: Array<{
    key: string;
    label: string;
    type: RegistrationFormField["type"];
    helpText?: string | null;
    placeholder?: string | null;
    required?: boolean;
    position: number;
    options?: unknown[];
    validation?: Record<string, unknown>;
  }>;
  documents: Array<{
    type: string;
    title: string;
    bodyMarkdown: string;
    locale?: string | null;
    required?: boolean;
    position: number;
  }>;
};

const DEFAULT_PARTICIPATION_TERMS =
  "I confirm that the registration details are accurate and that I accept the published race rules, participation terms, safety requirements, and cancellation policy for this race.";

async function loadPublishedRegistrationConfiguration(
  categoryId: string,
  env: ServerEnv,
): Promise<RegistrationConfiguration> {
  const adminClient = createAdminSupabaseClient(env);
  const [
    { data: form, error: formError },
    { data: category, error: categoryError },
  ] = await Promise.all([
    adminClient
      .from("registration_form_versions")
      .select("id,version_number,version_label,locale,title,content_digest,published_at")
      .eq("event_category_id", categoryId)
      .eq("status", "published")
      .maybeSingle<{
        id: string;
        version_number: number;
        version_label: string;
        locale: string;
        title: string;
        content_digest: string;
        published_at: string;
      }>(),
    adminClient
      .from("event_categories")
      .select("event_edition_id,minimum_age,maximum_age,allowed_genders,eligibility_note")
      .eq("id", categoryId)
      .maybeSingle<{
        event_edition_id: string;
        minimum_age: number | null;
        maximum_age: number | null;
        allowed_genders: Array<"F" | "M" | "U">;
        eligibility_note: string | null;
      }>(),
  ]);

  if (formError) throw formError;
  if (categoryError) throw categoryError;
  if (!form) throw conflict("Registration configuration has not been published");
  if (!category) throw notFound("Race not found");

  const [{ data: edition, error: editionError }, { data: eligibleClubRows, error: eligibleClubError }] =
    await Promise.all([
      adminClient
        .from("event_editions")
        .select("registration_access")
        .eq("id", category.event_edition_id)
        .maybeSingle<{ registration_access: string }>(),
      adminClient
        .from("event_eligible_clubs")
        .select("club_id")
        .eq("event_edition_id", category.event_edition_id)
        .returns<Array<{ club_id: string }>>(),
    ]);
  if (editionError) throw editionError;
  if (eligibleClubError) throw eligibleClubError;

  const eligibleClubIds = (eligibleClubRows ?? []).map((row) => row.club_id);
  const { data: eligibleClubs, error: eligibleClubsError } = eligibleClubIds.length
    ? await adminClient
        .from("clubs")
        .select("id,name")
        .in("id", eligibleClubIds)
        .order("name", { ascending: true })
        .returns<Array<{ id: string; name: string }>>()
    : { data: [] as Array<{ id: string; name: string }>, error: null };
  if (eligibleClubsError) throw eligibleClubsError;

  const [{ data: fields, error: fieldsError }, { data: documents, error: documentsError }] =
    await Promise.all([
      adminClient
        .from("registration_form_fields")
        .select(
          "id,field_key,label,field_type,help_text,placeholder,is_required,position,options_json,validation_json",
        )
        .eq("form_version_id", form.id)
        .order("position", { ascending: true })
        .returns<Array<{
          id: string;
          field_key: string;
          label: string;
          field_type: RegistrationFormField["type"];
          help_text: string | null;
          placeholder: string | null;
          is_required: boolean;
          position: number;
          options_json: unknown[];
          validation_json: Record<string, unknown>;
        }>>(),
      adminClient
        .from("registration_legal_documents")
        .select(
          "id,document_type,title,body_markdown,locale,content_digest,is_required,position",
        )
        .eq("form_version_id", form.id)
        .order("position", { ascending: true })
        .returns<Array<{
          id: string;
          document_type: string;
          title: string;
          body_markdown: string;
          locale: string;
          content_digest: string;
          is_required: boolean;
          position: number;
        }>>(),
    ]);

  if (fieldsError) throw fieldsError;
  if (documentsError) throw documentsError;

  return {
    formVersionId: form.id,
    versionNumber: form.version_number,
    versionLabel: form.version_label,
    locale: form.locale,
    title: form.title,
    digest: form.content_digest,
    publishedAt: form.published_at,
    eligibility: {
      minimumAge: category.minimum_age,
      maximumAge: category.maximum_age,
      allowedGenders: category.allowed_genders,
      note: category.eligibility_note,
    },
    participation: {
      access: edition?.registration_access === "club_members" ? "club_members" : "open",
      eligibleClubs: eligibleClubs ?? [],
    },
    fields: (fields ?? []).map((field) => ({
      id: field.id,
      key: field.field_key,
      label: field.label,
      type: field.field_type,
      helpText: field.help_text,
      placeholder: field.placeholder,
      required: field.is_required,
      position: field.position,
      options: Array.isArray(field.options_json) ? field.options_json : [],
      validation: field.validation_json ?? {},
    })),
    documents: (documents ?? []).map((document) => ({
      id: document.id,
      type: document.document_type,
      title: document.title,
      bodyMarkdown: document.body_markdown,
      locale: document.locale,
      digest: document.content_digest,
      required: document.is_required,
      position: document.position,
    })),
  };
}

export async function getPublicRegistrationConfiguration(
  categoryId: string,
  env: ServerEnv = loadServerEnv(),
  session: RequestSession | null = null,
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: category, error: categoryError } = await adminClient
    .from("event_categories")
    .select("id,event_edition_id,status,organizer_deleted_at")
    .eq("id", categoryId)
    .maybeSingle<{ id: string; event_edition_id: string; status: string; organizer_deleted_at: string | null }>();

  if (categoryError) throw categoryError;
  if (!category || category.status === "draft" || category.organizer_deleted_at) throw notFound("Race not found");

  const { data: edition, error: editionError } = await adminClient
    .from("event_editions")
    .select("id,status,published_at,public_visibility,organizer_deleted_at")
    .eq("id", category.event_edition_id)
    .maybeSingle<PublishedEventVisibility>();

  if (editionError) throw editionError;
  if (!edition || !["published", "registration_open", "registration_closed"].includes(edition.status)
    || !await canViewPublishedEvent(edition, session?.account.primaryAthleteProfileId ?? null, env)) {
    throw notFound("Race not found");
  }

  return loadPublishedRegistrationConfiguration(categoryId, env);
}

export async function getOrganizerRegistrationConfiguration(
  session: RequestSession,
  categoryId: string,
  env: ServerEnv = loadServerEnv(),
) {
  await requireCategoryAccess(session, categoryId, "manage", env);
  return loadPublishedRegistrationConfiguration(categoryId, env);
}

export async function publishRegistrationConfiguration(
  session: RequestSession,
  categoryId: string,
  input: PublishRegistrationConfigurationInput,
  env: ServerEnv = loadServerEnv(),
) {
  await requireCategoryAccess(session, categoryId, "manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const { error } = await adminClient.rpc("service_publish_registration_configuration", {
    p_event_category_id: categoryId,
    p_actor_user_id: session.account.userId,
    p_version_label: input.versionLabel,
    p_title: input.title,
    p_locale: input.locale,
    p_fields: input.fields.map((field) => ({
      field_key: field.key,
      label: field.label,
      field_type: field.type,
      help_text: field.helpText ?? null,
      placeholder: field.placeholder ?? null,
      is_required: field.required ?? false,
      position: field.position,
      options_json: field.options ?? [],
      validation_json: field.validation ?? {},
    })),
    p_documents: input.documents.map((document) => ({
      document_type: document.type,
      title: document.title,
      body_markdown: document.bodyMarkdown,
      locale: document.locale ?? input.locale,
      is_required: document.required ?? true,
      position: document.position,
    })),
  });

  if (error) {
    if (
      error.message.includes("registration_configuration_")
      || error.message.includes("required_legal_document_missing")
    ) {
      throw conflict("Registration form fields or legal documents are invalid or duplicated");
    }
    throw error;
  }

  return loadPublishedRegistrationConfiguration(categoryId, env);
}

export async function ensureDefaultRegistrationConfiguration(
  categoryId: string,
  actorUserId: string | null,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: existing, error: existingError } = await adminClient
    .from("registration_form_versions")
    .select("id")
    .eq("event_category_id", categoryId)
    .eq("status", "published")
    .maybeSingle<{ id: string }>();

  if (existingError) throw existingError;
  if (existing) return existing.id;

  const { data, error } = await adminClient.rpc("service_publish_registration_configuration", {
    p_event_category_id: categoryId,
    p_actor_user_id: actorUserId,
    p_version_label: "v1",
    p_title: "Race registration",
    p_locale: "en",
    p_fields: [],
    p_documents: [
      {
        document_type: "participation_terms",
        title: "Participation terms and cancellation policy",
        body_markdown: DEFAULT_PARTICIPATION_TERMS,
        locale: "en",
        is_required: true,
        position: 1,
      },
    ],
  });

  if (error) throw error;
  const record = data as { formVersionId?: string } | null;
  if (!record?.formVersionId) throw new Error("Default registration configuration was not created");
  return record.formVersionId;
}
