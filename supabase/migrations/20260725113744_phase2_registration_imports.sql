/*
 * Auditable registration CSV pipeline: preview rows are retained with their
 * normalized mapping and row-level errors; commit processes valid rows in
 * isolated subtransactions and never treats a spreadsheet as canonical state.
 */

alter table public.import_jobs
  add column organization_id uuid references public.organizations (id) on delete set null,
  add column event_edition_id uuid references public.event_editions (id) on delete cascade,
  add column requested_by_user_id uuid,
  add column idempotency_key_hash text,
  add column request_hash text,
  add column source_file_name text,
  add column mapping_json jsonb not null default '{}'::jsonb,
  add column total_rows integer not null default 0,
  add column valid_rows integer not null default 0,
  add column invalid_rows integer not null default 0,
  add column committed_at timestamptz;

alter table public.registrations
  add column consent_basis text not null default 'athlete_accepted',
  add constraint registrations_consent_basis_check
    check (consent_basis in ('athlete_accepted', 'organizer_attested', 'legacy_unknown'));

alter table public.import_jobs
  add constraint import_jobs_hash_pair_check
    check (
      (idempotency_key_hash is null and request_hash is null)
      or (
        idempotency_key_hash ~ '^[a-f0-9]{64}$'
        and request_hash ~ '^[a-f0-9]{64}$'
      )
    ),
  add constraint import_jobs_row_counts_check
    check (
      total_rows >= 0
      and valid_rows >= 0
      and invalid_rows >= 0
      and valid_rows + invalid_rows <= total_rows
    ),
  add constraint import_jobs_mapping_object_check
    check (jsonb_typeof(mapping_json) = 'object');

create unique index import_jobs_organization_idempotency_idx
  on public.import_jobs (organization_id, idempotency_key_hash)
  where organization_id is not null and idempotency_key_hash is not null;

create index import_jobs_edition_created_idx
  on public.import_jobs (event_edition_id, created_at desc)
  where event_edition_id is not null;

create table public.registration_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.import_jobs (id) on delete cascade,
  row_number integer not null,
  raw_json jsonb not null,
  normalized_json jsonb not null default '{}'::jsonb,
  row_status text not null,
  errors_json jsonb not null default '[]'::jsonb,
  athlete_profile_id uuid references public.athlete_profiles (id),
  registration_id uuid references public.registrations (id),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_job_id, row_number),
  check (row_number > 0),
  check (row_status in ('valid', 'invalid', 'imported', 'skipped')),
  check (jsonb_typeof(raw_json) = 'object'),
  check (jsonb_typeof(normalized_json) = 'object'),
  check (jsonb_typeof(errors_json) = 'array')
);

create index registration_import_rows_job_status_idx
  on public.registration_import_rows (import_job_id, row_status, row_number);

create trigger registration_import_rows_set_updated_at
before update on public.registration_import_rows
for each row execute function public.set_updated_at();

create or replace function public.service_create_registration_import_preview(
  p_event_edition_id uuid,
  p_actor_user_id uuid,
  p_source_file_name text,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_mapping jsonb,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_organization_id uuid;
  existing_job public.import_jobs%rowtype;
  created_job public.import_jobs%rowtype;
  row_json jsonb;
  total_count integer;
  valid_count integer;
  invalid_count integer;
begin
  if p_idempotency_key_hash !~ '^[a-f0-9]{64}$'
     or p_request_hash !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(coalesce(p_mapping, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0
     or jsonb_array_length(p_rows) > 2000 then
    raise exception using errcode = '22023', message = 'registration_import_preview_invalid';
  end if;

  select series.organization_id
  into resolved_organization_id
  from public.event_editions edition
  join public.event_series series on series.id = edition.event_series_id
  where edition.id = p_event_edition_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'edition_not_found';
  end if;

  select job.*
  into existing_job
  from public.import_jobs job
  where job.organization_id = resolved_organization_id
    and job.idempotency_key_hash = p_idempotency_key_hash;

  if found then
    if existing_job.request_hash <> p_request_hash then
      raise exception using errcode = '23505', message = 'idempotency_key_reused';
    end if;
    return jsonb_build_object(
      'jobId', existing_job.id,
      'status', existing_job.status,
      'totalRows', existing_job.total_rows,
      'validRows', existing_job.valid_rows,
      'invalidRows', existing_job.invalid_rows,
      'replayed', true
    );
  end if;

  total_count := jsonb_array_length(p_rows);
  select count(*)::integer
  into valid_count
  from jsonb_array_elements(p_rows) row_item
  where row_item->>'status' = 'valid';
  invalid_count := total_count - valid_count;

  insert into public.import_jobs (
    source,
    job_type,
    status,
    organization_id,
    event_edition_id,
    requested_by_user_id,
    idempotency_key_hash,
    request_hash,
    source_file_name,
    mapping_json,
    total_rows,
    valid_rows,
    invalid_rows,
    summary_json
  )
  values (
    'organizer_csv',
    'registration_import',
    'previewed',
    resolved_organization_id,
    p_event_edition_id,
    p_actor_user_id,
    p_idempotency_key_hash,
    p_request_hash,
    nullif(trim(p_source_file_name), ''),
    coalesce(p_mapping, '{}'::jsonb),
    total_count,
    valid_count,
    invalid_count,
    jsonb_build_object(
      'totalRows', total_count,
      'validRows', valid_count,
      'invalidRows', invalid_count
    )
  )
  returning * into created_job;

  for row_json in
    select value
    from jsonb_array_elements(p_rows)
  loop
    insert into public.registration_import_rows (
      import_job_id,
      row_number,
      raw_json,
      normalized_json,
      row_status,
      errors_json
    )
    values (
      created_job.id,
      (row_json->>'rowNumber')::integer,
      coalesce(row_json->'raw', '{}'::jsonb),
      coalesce(row_json->'normalized', '{}'::jsonb),
      case when row_json->>'status' = 'valid' then 'valid' else 'invalid' end,
      coalesce(row_json->'errors', '[]'::jsonb)
    );
  end loop;

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
    'import_job',
    created_job.id,
    'registration_import.previewed',
    created_job.summary_json
  );

  return jsonb_build_object(
    'jobId', created_job.id,
    'status', created_job.status,
    'totalRows', total_count,
    'validRows', valid_count,
    'invalidRows', invalid_count,
    'replayed', false
  );
end;
$$;

create or replace function public.service_commit_registration_import(
  p_import_job_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row public.import_jobs%rowtype;
  import_row public.registration_import_rows%rowtype;
  normalized jsonb;
  resolved_category_id uuid;
  resolved_athlete_profile_id uuid;
  created_registration record;
  normalized_email text;
  slug_base text;
  slug_candidate text;
  slug_suffix integer;
  imported_count integer := 0;
  skipped_count integer := 0;
  failed_count integer := 0;
  idempotency_hash text;
begin
  select job.*
  into job_row
  from public.import_jobs job
  where job.id = p_import_job_id
    and job.job_type = 'registration_import'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'registration_import_not_found';
  end if;

  if job_row.status = 'completed' then
    return job_row.summary_json || jsonb_build_object(
      'jobId', job_row.id,
      'status', job_row.status,
      'replayed', true
    );
  end if;
  if job_row.status <> 'previewed' then
    raise exception using errcode = 'P0001', message = 'registration_import_not_committable';
  end if;
  if job_row.invalid_rows > 0 then
    raise exception using errcode = 'P0001', message = 'registration_import_has_invalid_rows';
  end if;
  if exists (
    select 1
    from public.edition_operational_controls control
    where control.event_edition_id = job_row.event_edition_id
      and control.start_list_state = 'frozen'
  ) then
    raise exception using errcode = 'P0001', message = 'start_list_is_frozen';
  end if;

  update public.import_jobs
  set status = 'processing', started_at = now()
  where id = job_row.id;

  for import_row in
    select row_item.*
    from public.registration_import_rows row_item
    where row_item.import_job_id = job_row.id
      and row_item.row_status = 'valid'
    order by row_item.row_number
    for update
  loop
    begin
      normalized := import_row.normalized_json;
      normalized_email := lower(trim(normalized->>'email'));
      resolved_category_id := (normalized->>'categoryId')::uuid;
      resolved_athlete_profile_id := null;

      if nullif(trim(normalized->>'firstName'), '') is null
         or nullif(trim(normalized->>'lastName'), '') is null
         or nullif(normalized_email, '') is null
         or nullif(normalized->>'dateOfBirth', '') is null
         or normalized->>'gender' not in ('F', 'M', 'U')
         or not exists (
           select 1
           from public.event_categories category
           where category.id = resolved_category_id
             and category.event_edition_id = job_row.event_edition_id
         ) then
        raise exception using errcode = '22023', message = 'registration_import_row_invalid';
      end if;

      select identity.athlete_profile_id
      into resolved_athlete_profile_id
      from public.athlete_identities identity
      where identity.identity_type = 'email'
        and lower(identity.identity_value) = normalized_email
      limit 1;

      if resolved_athlete_profile_id is null then
        select athlete.id
        into resolved_athlete_profile_id
        from public.athlete_profiles athlete
        where lower(athlete.primary_email::text) = normalized_email
          and athlete.merged_into_athlete_profile_id is null
        order by athlete.created_at
        limit 1;
      end if;

      if resolved_athlete_profile_id is null then
        slug_base := trim(
          both '-'
          from regexp_replace(
            translate(
              lower((normalized->>'firstName') || '-' || (normalized->>'lastName')),
              'čćžšđ',
              'cczsd'
            ),
            '[^a-z0-9]+',
            '-',
            'g'
          )
        );
        if slug_base = '' then
          slug_base := 'imported-athlete';
        end if;
        slug_candidate := slug_base;
        slug_suffix := 1;

        loop
          begin
            insert into public.athlete_profiles (
              slug,
              first_name,
              last_name,
              display_name,
              gender,
              date_of_birth,
              city,
              country_code,
              primary_email,
              is_claimed,
              status
            )
            values (
              slug_candidate,
              trim(normalized->>'firstName'),
              trim(normalized->>'lastName'),
              trim((normalized->>'firstName') || ' ' || (normalized->>'lastName')),
              normalized->>'gender',
              (normalized->>'dateOfBirth')::date,
              nullif(trim(normalized->>'city'), ''),
              nullif(upper(trim(normalized->>'countryCode')), ''),
              normalized_email,
              false,
              'active'
            )
            returning id into resolved_athlete_profile_id;
            exit;
          exception
            when unique_violation then
              slug_suffix := slug_suffix + 1;
              slug_candidate := format('%s-%s', slug_base, slug_suffix);
          end;
        end loop;

        insert into public.athlete_identities (
          athlete_profile_id,
          identity_type,
          identity_value,
          is_verified
        )
        values (
          resolved_athlete_profile_id,
          'email',
          normalized_email,
          false
        );

        insert into public.profile_visibility_settings (athlete_profile_id)
        values (resolved_athlete_profile_id);

        insert into public.athlete_registration_profiles (
          athlete_profile_id,
          phone,
          emergency_contact_name,
          emergency_contact_phone
        )
        values (
          resolved_athlete_profile_id,
          nullif(trim(normalized->>'phone'), ''),
          nullif(trim(normalized->>'emergencyContactName'), ''),
          nullif(trim(normalized->>'emergencyContactPhone'), '')
        );
      end if;

      if exists (
        select 1
        from public.athlete_profiles athlete
        where athlete.id = resolved_athlete_profile_id
          and athlete.date_of_birth is distinct from (normalized->>'dateOfBirth')::date
      ) then
        raise exception using
          errcode = 'P0001',
          message = 'athlete_identity_conflict',
          detail = 'Email matched an athlete with a different date of birth.';
      end if;

      if exists (
        select 1
        from public.registrations registration
        where registration.event_category_id = resolved_category_id
          and registration.athlete_profile_id = resolved_athlete_profile_id
      ) then
        update public.registration_import_rows
        set
          row_status = 'skipped',
          athlete_profile_id = resolved_athlete_profile_id,
          errors_json = errors_json || jsonb_build_array('Athlete is already registered for this race.'),
          processed_at = now()
        where id = import_row.id;
        skipped_count := skipped_count + 1;
        continue;
      end if;

      idempotency_hash := encode(
        public.digest(
          convert_to(job_row.id::text || ':' || import_row.row_number::text, 'UTF8'),
          'sha256'
        ),
        'hex'
      );

      select *
      into created_registration
      from public.create_registration_atomically(
        resolved_category_id,
        resolved_athlete_profile_id,
        null,
        p_actor_user_id,
        'import',
        'organizer-import-v1',
        now(),
        false,
        idempotency_hash,
        idempotency_hash
      );

      update public.registrations
      set consent_basis = 'organizer_attested'
      where id = created_registration.registration_id;

      update public.registration_import_rows
      set
        row_status = 'imported',
        athlete_profile_id = resolved_athlete_profile_id,
        registration_id = created_registration.registration_id,
        processed_at = now()
      where id = import_row.id;
      imported_count := imported_count + 1;
    exception
      when unique_violation then
        update public.registration_import_rows
        set
          row_status = 'skipped',
          errors_json = errors_json || jsonb_build_array('Athlete is already registered for this race.'),
          processed_at = now()
        where id = import_row.id;
        skipped_count := skipped_count + 1;
      when others then
        update public.registration_import_rows
        set
          row_status = 'invalid',
          errors_json = errors_json || jsonb_build_array(sqlerrm),
          processed_at = now()
        where id = import_row.id;
        failed_count := failed_count + 1;
    end;
  end loop;

  update public.import_jobs
  set
    status = 'completed',
    completed_at = now(),
    committed_at = now(),
    summary_json = summary_json || jsonb_build_object(
      'importedRows', imported_count,
      'skippedRows', skipped_count,
      'failedRows', failed_count
    )
  where id = job_row.id
  returning * into job_row;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    metadata_json
  )
  values (
    job_row.organization_id,
    p_actor_user_id,
    'import_job',
    job_row.id,
    'registration_import.committed',
    job_row.summary_json
  );

  return job_row.summary_json || jsonb_build_object(
    'jobId', job_row.id,
    'status', job_row.status,
    'replayed', false
  );
end;
$$;

alter table public.registration_import_rows enable row level security;

revoke all on table public.registration_import_rows
  from public, anon, authenticated;
grant all on table public.registration_import_rows
  to service_role;

revoke all on function public.service_create_registration_import_preview(
  uuid, uuid, text, text, text, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.service_commit_registration_import(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.service_create_registration_import_preview(
  uuid, uuid, text, text, text, jsonb, jsonb
) to service_role;
grant execute on function public.service_commit_registration_import(uuid, uuid)
  to service_role;
