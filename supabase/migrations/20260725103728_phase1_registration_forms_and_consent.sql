/*
 * Versioned registration forms and immutable consent evidence.
 *
 * Published form bundles are append-only. Registrations retain the exact form,
 * field labels, answers, and legal-document digests presented at submission.
 * All tables and commands are server-only; public clients receive a curated
 * read model from the API.
 */

create table public.registration_form_versions (
  id uuid primary key default gen_random_uuid(),
  event_category_id uuid not null references public.event_categories (id) on delete cascade,
  version_number integer not null,
  version_label text not null,
  locale text not null default 'en',
  title text not null default 'Race registration',
  status text not null default 'draft',
  content_digest text not null,
  published_at timestamptz,
  retired_at timestamptz,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_category_id, version_number),
  unique (event_category_id, content_digest),
  check (version_number > 0),
  check (length(trim(version_label)) > 0),
  check (length(trim(locale)) > 0),
  check (length(trim(title)) > 0),
  check (content_digest ~ '^[a-f0-9]{64}$'),
  check (status in ('draft', 'published', 'retired')),
  check (
    (status = 'draft' and published_at is null and retired_at is null)
    or (status = 'published' and published_at is not null and retired_at is null)
    or (status = 'retired' and published_at is not null and retired_at is not null)
  )
);

create unique index registration_form_versions_one_published_uidx
  on public.registration_form_versions (event_category_id)
  where status = 'published';

create table public.registration_form_fields (
  id uuid primary key default gen_random_uuid(),
  form_version_id uuid not null references public.registration_form_versions (id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type text not null,
  help_text text,
  placeholder text,
  is_required boolean not null default false,
  position integer not null,
  options_json jsonb not null default '[]'::jsonb,
  validation_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (form_version_id, field_key),
  unique (form_version_id, position),
  check (field_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  check (length(trim(label)) > 0),
  check (
    field_type in (
      'text',
      'textarea',
      'number',
      'boolean',
      'select',
      'multiselect',
      'date',
      'email',
      'phone'
    )
  ),
  check (position > 0),
  check (jsonb_typeof(options_json) = 'array'),
  check (jsonb_typeof(validation_json) = 'object')
);

create table public.registration_legal_documents (
  id uuid primary key default gen_random_uuid(),
  form_version_id uuid not null references public.registration_form_versions (id) on delete cascade,
  document_type text not null,
  title text not null,
  body_markdown text not null,
  locale text not null default 'en',
  content_digest text not null,
  is_required boolean not null default true,
  position integer not null,
  created_at timestamptz not null default now(),
  unique (form_version_id, document_type),
  unique (form_version_id, position),
  check (document_type ~ '^[a-z][a-z0-9_]{0,79}$'),
  check (length(trim(title)) > 0),
  check (length(trim(body_markdown)) > 0),
  check (length(trim(locale)) > 0),
  check (content_digest ~ '^[a-f0-9]{64}$'),
  check (position > 0)
);

alter table public.registrations
  add column registration_form_version_id uuid
    references public.registration_form_versions (id) on delete restrict;

alter table public.registration_answers
  add column form_version_id uuid references public.registration_form_versions (id) on delete restrict,
  add column form_field_id uuid references public.registration_form_fields (id) on delete restrict,
  add column field_type text,
  add column is_required boolean;

create table public.registration_consent_records (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete cascade,
  form_version_id uuid not null references public.registration_form_versions (id) on delete restrict,
  legal_document_id uuid not null references public.registration_legal_documents (id) on delete restrict,
  document_type text not null,
  document_title text not null,
  document_digest text not null,
  document_locale text not null,
  was_required boolean not null,
  accepted boolean not null,
  accepted_at timestamptz,
  subject_user_id uuid,
  subject_email_hash text,
  created_at timestamptz not null default now(),
  unique (registration_id, legal_document_id),
  check (document_digest ~ '^[a-f0-9]{64}$'),
  check (
    (accepted and accepted_at is not null)
    or (not accepted and accepted_at is null)
  ),
  check (not was_required or accepted)
);

create index registration_form_fields_version_position_idx
  on public.registration_form_fields (form_version_id, position);
create index registration_legal_documents_version_position_idx
  on public.registration_legal_documents (form_version_id, position);
create index registration_consent_records_registration_idx
  on public.registration_consent_records (registration_id);

create trigger registration_form_versions_set_updated_at
before update on public.registration_form_versions
for each row execute function public.set_updated_at();

create or replace function public.protect_registration_submission_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'registration_submission_evidence_is_immutable';
end;
$$;

create trigger registration_answers_immutable
before update or delete on public.registration_answers
for each row execute function public.protect_registration_submission_evidence();

create trigger registration_consents_immutable
before update or delete on public.registration_consent_records
for each row execute function public.protect_registration_submission_evidence();

create or replace function public.protect_published_registration_configuration()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  protected_status text;
begin
  if tg_table_name = 'registration_form_versions' then
    protected_status := old.status;
    if old.status = 'published'
       and new.status = 'retired'
       and new.published_at = old.published_at
       and new.retired_at is not null
       and (
         to_jsonb(new) - 'status' - 'retired_at' - 'updated_at'
       ) = (
         to_jsonb(old) - 'status' - 'retired_at' - 'updated_at'
       ) then
      return new;
    end if;
  else
    select version.status
    into protected_status
    from public.registration_form_versions version
    where version.id = old.form_version_id;
  end if;

  if protected_status in ('published', 'retired') then
    raise exception using errcode = '55000', message = 'published_registration_configuration_is_immutable';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger registration_form_versions_protect_published
before update or delete on public.registration_form_versions
for each row execute function public.protect_published_registration_configuration();

create trigger registration_form_fields_protect_published
before update or delete on public.registration_form_fields
for each row execute function public.protect_published_registration_configuration();

create trigger registration_legal_documents_protect_published
before update or delete on public.registration_legal_documents
for each row execute function public.protect_published_registration_configuration();

/*
 * Give every existing category a safe default bundle. Organizers can publish a
 * richer version later without invalidating registrations captured against v1.
 */
insert into public.registration_form_versions (
  event_category_id,
  version_number,
  version_label,
  locale,
  title,
  status,
  content_digest,
  published_at
)
select
  category.id,
  1,
  'v1',
  'en',
  'Race registration',
  'published',
  encode(public.digest('sitrail-default-registration-v1:' || category.id::text, 'sha256'), 'hex'),
  now()
from public.event_categories category
on conflict (event_category_id, version_number) do nothing;

insert into public.registration_legal_documents (
  form_version_id,
  document_type,
  title,
  body_markdown,
  locale,
  content_digest,
  is_required,
  position
)
select
  version.id,
  'participation_terms',
  'Participation terms and cancellation policy',
  'I confirm that the registration details are accurate and that I accept the published race rules, participation terms, safety requirements, and cancellation policy for this race.',
  version.locale,
  encode(
    public.digest(
      'sitrail-default-participation-terms-v1:' || version.event_category_id::text,
      'sha256'
    ),
    'hex'
  ),
  true,
  1
from public.registration_form_versions version
where version.version_number = 1
  and version.status = 'published'
on conflict (form_version_id, document_type) do nothing;

create or replace function public.create_default_registration_configuration_for_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_form_version_id uuid;
begin
  insert into public.registration_form_versions (
    event_category_id,
    version_number,
    version_label,
    locale,
    title,
    status,
    content_digest,
    published_at
  )
  values (
    new.id,
    1,
    'v1',
    'en',
    'Race registration',
    'published',
    encode(public.digest('sitrail-default-registration-v1:' || new.id::text, 'sha256'), 'hex'),
    now()
  )
  returning id into created_form_version_id;

  insert into public.registration_legal_documents (
    form_version_id,
    document_type,
    title,
    body_markdown,
    locale,
    content_digest,
    is_required,
    position
  )
  values (
    created_form_version_id,
    'participation_terms',
    'Participation terms and cancellation policy',
    'I confirm that the registration details are accurate and that I accept the published race rules, participation terms, safety requirements, and cancellation policy for this race.',
    'en',
    encode(
      public.digest('sitrail-default-participation-terms-v1:' || new.id::text, 'sha256'),
      'hex'
    ),
    true,
    1
  );

  return new;
end;
$$;

create trigger event_categories_create_default_registration_configuration
after insert on public.event_categories
for each row execute function public.create_default_registration_configuration_for_category();

revoke all on function public.create_default_registration_configuration_for_category()
  from public, anon, authenticated;

create or replace function public.service_store_registration_submission(
  p_registration_id uuid,
  p_form_version_id uuid,
  p_answers jsonb,
  p_accepted_document_ids uuid[],
  p_subject_user_id uuid,
  p_subject_email_hash text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  registration_row public.registrations%rowtype;
  form_row public.registration_form_versions%rowtype;
  required_field public.registration_form_fields%rowtype;
  answer_value jsonb;
  unknown_key text;
  missing_document_id uuid;
begin
  if jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'registration_answers_must_be_object';
  end if;

  select registration.*
  into registration_row
  from public.registrations registration
  where registration.id = p_registration_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'registration_not_found';
  end if;

  select version.*
  into form_row
  from public.registration_form_versions version
  where version.id = p_form_version_id
    and version.event_category_id = registration_row.event_category_id
    and version.status = 'published';

  if not found then
    raise exception using errcode = '22023', message = 'registration_form_version_invalid';
  end if;

  for required_field in
    select field.*
    from public.registration_form_fields field
    where field.form_version_id = form_row.id
      and field.is_required
  loop
    if not (coalesce(p_answers, '{}'::jsonb) ? required_field.field_key) then
      raise exception using
        errcode = '22023',
        message = 'registration_required_answer_missing',
        detail = required_field.field_key;
    end if;

    answer_value := coalesce(p_answers, '{}'::jsonb) -> required_field.field_key;
    if answer_value = 'null'::jsonb
       or (jsonb_typeof(answer_value) = 'string' and length(trim(answer_value #>> '{}')) = 0)
       or (jsonb_typeof(answer_value) = 'array' and jsonb_array_length(answer_value) = 0) then
      raise exception using
        errcode = '22023',
        message = 'registration_required_answer_missing',
        detail = required_field.field_key;
    end if;
  end loop;

  select answer.key
  into unknown_key
  from jsonb_each(coalesce(p_answers, '{}'::jsonb)) answer
  where not exists (
    select 1
    from public.registration_form_fields field
    where field.form_version_id = form_row.id
      and field.field_key = answer.key
  )
  limit 1;

  if unknown_key is not null then
    raise exception using
      errcode = '22023',
      message = 'registration_answer_field_unknown',
      detail = unknown_key;
  end if;

  select document.id
  into missing_document_id
  from public.registration_legal_documents document
  where document.form_version_id = form_row.id
    and document.is_required
    and not (document.id = any(coalesce(p_accepted_document_ids, array[]::uuid[])))
  limit 1;

  if missing_document_id is not null then
    raise exception using
      errcode = '22023',
      message = 'registration_required_consent_missing',
      detail = missing_document_id::text;
  end if;

  update public.registrations registration
  set registration_form_version_id = form_row.id
  where registration.id = registration_row.id
    and registration.registration_form_version_id is null;

  insert into public.registration_answers (
    registration_id,
    field_key,
    field_label,
    value_json,
    form_version_id,
    form_field_id,
    field_type,
    is_required
  )
  select
    registration_row.id,
    field.field_key,
    field.label,
    coalesce(p_answers, '{}'::jsonb) -> field.field_key,
    form_row.id,
    field.id,
    field.field_type,
    field.is_required
  from public.registration_form_fields field
  where field.form_version_id = form_row.id
    and coalesce(p_answers, '{}'::jsonb) ? field.field_key
  on conflict (registration_id, field_key) do nothing;

  insert into public.registration_consent_records (
    registration_id,
    form_version_id,
    legal_document_id,
    document_type,
    document_title,
    document_digest,
    document_locale,
    was_required,
    accepted,
    accepted_at,
    subject_user_id,
    subject_email_hash
  )
  select
    registration_row.id,
    form_row.id,
    document.id,
    document.document_type,
    document.title,
    document.content_digest,
    document.locale,
    document.is_required,
    document.id = any(coalesce(p_accepted_document_ids, array[]::uuid[])),
    case
      when document.id = any(coalesce(p_accepted_document_ids, array[]::uuid[]))
        then now()
      else null
    end,
    p_subject_user_id,
    nullif(trim(p_subject_email_hash), '')
  from public.registration_legal_documents document
  where document.form_version_id = form_row.id
  on conflict (registration_id, legal_document_id) do nothing;
end;
$$;

create or replace function public.service_create_registration_submission(
  p_event_category_id uuid,
  p_athlete_profile_id uuid,
  p_represented_club_id uuid,
  p_actor_user_id uuid,
  p_public_start_list_opt_in boolean,
  p_idempotency_key_hash text,
  p_idempotency_request_hash text,
  p_form_version_id uuid,
  p_answers jsonb,
  p_accepted_document_ids uuid[]
)
returns table (
  registration_id uuid,
  registration_status public.registration_status,
  payment_status public.payment_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  form_digest text;
  created record;
begin
  select version.content_digest
  into form_digest
  from public.registration_form_versions version
  where version.id = p_form_version_id
    and version.event_category_id = p_event_category_id
    and version.status = 'published';

  if form_digest is null then
    raise exception using errcode = '22023', message = 'registration_form_version_invalid';
  end if;

  select *
  into created
  from public.create_registration_atomically(
    target_event_category_id => p_event_category_id,
    target_athlete_profile_id => p_athlete_profile_id,
    target_represented_club_id => p_represented_club_id,
    target_changed_by_user_id => p_actor_user_id,
    target_source => 'direct',
    target_terms_version => form_digest,
    target_terms_accepted_at => now(),
    target_public_start_list_opt_in => p_public_start_list_opt_in,
    target_idempotency_key_hash => p_idempotency_key_hash,
    target_idempotency_request_hash => p_idempotency_request_hash
  );

  perform public.service_store_registration_submission(
    created.registration_id,
    p_form_version_id,
    p_answers,
    p_accepted_document_ids,
    p_actor_user_id,
    null
  );

  return query
  select
    created.registration_id,
    created.registration_status,
    created.payment_status;
end;
$$;

create or replace function public.service_create_guest_registration_submission(
  p_event_category_id uuid,
  p_athlete_slug_base text,
  p_first_name text,
  p_last_name text,
  p_display_name text,
  p_email text,
  p_date_of_birth date,
  p_gender text,
  p_city text,
  p_country_code text,
  p_phone text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_shirt_size text,
  p_public_start_list_opt_in boolean,
  p_idempotency_key_hash text,
  p_idempotency_request_hash text,
  p_form_version_id uuid,
  p_answers jsonb,
  p_accepted_document_ids uuid[]
)
returns table (
  registration_id uuid,
  registration_status public.registration_status,
  payment_status public.payment_status,
  athlete_profile_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  form_digest text;
  created record;
begin
  select version.content_digest
  into form_digest
  from public.registration_form_versions version
  where version.id = p_form_version_id
    and version.event_category_id = p_event_category_id
    and version.status = 'published';

  if form_digest is null then
    raise exception using errcode = '22023', message = 'registration_form_version_invalid';
  end if;

  select *
  into created
  from public.create_guest_registration_atomically(
    target_event_category_id => p_event_category_id,
    target_athlete_slug_base => p_athlete_slug_base,
    target_first_name => p_first_name,
    target_last_name => p_last_name,
    target_display_name => p_display_name,
    target_email => p_email,
    target_date_of_birth => p_date_of_birth,
    target_gender => p_gender,
    target_city => p_city,
    target_country_code => p_country_code,
    target_phone => p_phone,
    target_emergency_contact_name => p_emergency_contact_name,
    target_emergency_contact_phone => p_emergency_contact_phone,
    target_shirt_size => p_shirt_size,
    target_terms_version => form_digest,
    target_public_start_list_opt_in => p_public_start_list_opt_in,
    target_idempotency_key_hash => p_idempotency_key_hash,
    target_idempotency_request_hash => p_idempotency_request_hash
  );

  perform public.service_store_registration_submission(
    created.registration_id,
    p_form_version_id,
    p_answers,
    p_accepted_document_ids,
    null,
    encode(public.digest(lower(trim(p_email)), 'sha256'), 'hex')
  );

  return query
  select
    created.registration_id,
    created.registration_status,
    created.payment_status,
    created.athlete_profile_id;
end;
$$;

alter table public.registration_form_versions enable row level security;
alter table public.registration_form_fields enable row level security;
alter table public.registration_legal_documents enable row level security;
alter table public.registration_consent_records enable row level security;

revoke all on table
  public.registration_form_versions,
  public.registration_form_fields,
  public.registration_legal_documents,
  public.registration_consent_records,
  public.registration_answers
from anon, authenticated;

grant select, insert, update, delete on table
  public.registration_form_versions,
  public.registration_form_fields,
  public.registration_legal_documents
to service_role;

grant select, insert on table
  public.registration_consent_records,
  public.registration_answers
to service_role;

revoke all on function public.service_store_registration_submission(
  uuid, uuid, jsonb, uuid[], uuid, text
) from public, anon, authenticated;
revoke all on function public.service_create_registration_submission(
  uuid, uuid, uuid, uuid, boolean, text, text, uuid, jsonb, uuid[]
) from public, anon, authenticated;
revoke all on function public.service_create_guest_registration_submission(
  uuid, text, text, text, text, text, date, text, text, text, text, text, text,
  text, boolean, text, text, uuid, jsonb, uuid[]
) from public, anon, authenticated;

grant execute on function public.service_store_registration_submission(
  uuid, uuid, jsonb, uuid[], uuid, text
) to service_role;
grant execute on function public.service_create_registration_submission(
  uuid, uuid, uuid, uuid, boolean, text, text, uuid, jsonb, uuid[]
) to service_role;
grant execute on function public.service_create_guest_registration_submission(
  uuid, text, text, text, text, text, date, text, text, text, text, text, text,
  text, boolean, text, text, uuid, jsonb, uuid[]
) to service_role;

create or replace function public.service_publish_registration_configuration(
  p_event_category_id uuid,
  p_actor_user_id uuid,
  p_version_label text,
  p_title text,
  p_locale text,
  p_fields jsonb,
  p_documents jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_organization_id uuid;
  resolved_version_number integer;
  resolved_version_id uuid;
  resolved_digest text;
begin
  perform 1
  from public.event_categories category
  where category.id = p_event_category_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'category_not_found';
  end if;

  if length(trim(coalesce(p_version_label, ''))) = 0
     or length(trim(coalesce(p_title, ''))) = 0
     or length(trim(coalesce(p_locale, ''))) = 0
     or jsonb_typeof(coalesce(p_fields, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_documents, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'registration_configuration_invalid';
  end if;

  if jsonb_array_length(coalesce(p_fields, '[]'::jsonb)) > 40
     or jsonb_array_length(coalesce(p_documents, '[]'::jsonb)) > 20 then
    raise exception using errcode = '22023', message = 'registration_configuration_too_large';
  end if;

  if not exists (
    select 1
    from jsonb_to_recordset(coalesce(p_documents, '[]'::jsonb)) as document(
      document_type text,
      title text,
      body_markdown text,
      locale text,
      is_required boolean,
      position integer
    )
    where document.is_required
  ) then
    raise exception using errcode = '22023', message = 'required_legal_document_missing';
  end if;

  select series.organization_id
  into resolved_organization_id
  from public.event_categories category
  join public.event_editions edition on edition.id = category.event_edition_id
  join public.event_series series on series.id = edition.event_series_id
  where category.id = p_event_category_id;

  select coalesce(max(version.version_number), 0) + 1
  into resolved_version_number
  from public.registration_form_versions version
  where version.event_category_id = p_event_category_id;

  resolved_digest := encode(
    public.digest(
      convert_to(
        jsonb_build_object(
          'versionLabel', trim(p_version_label),
          'title', trim(p_title),
          'locale', trim(p_locale),
          'fields', coalesce(p_fields, '[]'::jsonb),
          'documents', coalesce(p_documents, '[]'::jsonb)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  update public.registration_form_versions version
  set
    status = 'retired',
    retired_at = now()
  where version.event_category_id = p_event_category_id
    and version.status = 'published';

  insert into public.registration_form_versions (
    event_category_id,
    version_number,
    version_label,
    locale,
    title,
    status,
    content_digest,
    published_at,
    created_by_user_id
  )
  values (
    p_event_category_id,
    resolved_version_number,
    trim(p_version_label),
    trim(p_locale),
    trim(p_title),
    'published',
    resolved_digest,
    now(),
    p_actor_user_id
  )
  returning id into resolved_version_id;

  insert into public.registration_form_fields (
    form_version_id,
    field_key,
    label,
    field_type,
    help_text,
    placeholder,
    is_required,
    position,
    options_json,
    validation_json
  )
  select
    resolved_version_id,
    trim(field.field_key),
    trim(field.label),
    field.field_type,
    nullif(trim(field.help_text), ''),
    nullif(trim(field.placeholder), ''),
    coalesce(field.is_required, false),
    field.position,
    coalesce(field.options_json, '[]'::jsonb),
    coalesce(field.validation_json, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_fields, '[]'::jsonb)) as field(
    field_key text,
    label text,
    field_type text,
    help_text text,
    placeholder text,
    is_required boolean,
    position integer,
    options_json jsonb,
    validation_json jsonb
  );

  insert into public.registration_legal_documents (
    form_version_id,
    document_type,
    title,
    body_markdown,
    locale,
    content_digest,
    is_required,
    position
  )
  select
    resolved_version_id,
    trim(document.document_type),
    trim(document.title),
    trim(document.body_markdown),
    coalesce(nullif(trim(document.locale), ''), trim(p_locale)),
    encode(
      public.digest(
        convert_to(
          jsonb_build_object(
            'documentType', trim(document.document_type),
            'title', trim(document.title),
            'body', trim(document.body_markdown),
            'locale', coalesce(nullif(trim(document.locale), ''), trim(p_locale))
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    coalesce(document.is_required, true),
    document.position
  from jsonb_to_recordset(coalesce(p_documents, '[]'::jsonb)) as document(
    document_type text,
    title text,
    body_markdown text,
    locale text,
    is_required boolean,
    position integer
  );

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    resolved_organization_id,
    p_actor_user_id,
    'registration_form_version',
    resolved_version_id,
    'registration.configuration_published',
    jsonb_build_object(
      'eventCategoryId', p_event_category_id,
      'versionNumber', resolved_version_number,
      'contentDigest', resolved_digest,
      'fieldCount', jsonb_array_length(coalesce(p_fields, '[]'::jsonb)),
      'documentCount', jsonb_array_length(coalesce(p_documents, '[]'::jsonb))
    )
  );

  return jsonb_build_object(
    'formVersionId', resolved_version_id,
    'versionNumber', resolved_version_number,
    'contentDigest', resolved_digest
  );
exception
  when unique_violation then
    raise exception using errcode = '22023', message = 'registration_configuration_duplicate_key_or_position';
end;
$$;

revoke all on function public.service_publish_registration_configuration(
  uuid, uuid, text, text, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.service_publish_registration_configuration(
  uuid, uuid, text, text, text, jsonb, jsonb
) to service_role;
