/*
 * Phase 5 database hardening.
 *
 * Keep the historical migrations immutable while correcting function bodies
 * that PostgreSQL's static function checker can prove are unsafe or
 * environment-dependent:
 *
 * - the manual-payment reviewer used an unqualified PL/pgSQL variable whose
 *   name also exists as a registration_quotes column;
 * - the timing-plan publisher used an unqualified temporary relation while
 *   running with an empty search_path.
 *
 * Rebuilding from pg_get_functiondef preserves the complete deployed function
 * contract and makes this migration safe for databases where the historical
 * functions have already been installed.
 */

do $hardening$
declare
  function_definition text;
  original_definition text;
  stage_start integer;
  stage_tail_start integer;
  stage_tail_marker constant text := E'\n\n  if exists (';
  point_source constant text := E'from (\n    select\n      (entry.value->>''category_id'')::uuid as category_id,\n      (entry.value->>''checkpoint_id'')::uuid as checkpoint_id,\n      entry.value->>''capture_mode'' as capture_mode,\n      nullif(entry.value->>''primary_device_id'', '''')::uuid as primary_device_id,\n      nullif(trim(entry.value->>''backup_method''), '''') as backup_method,\n      nullif(trim(entry.value->>''operator_label''), '''') as operator_label,\n      entry.ordinality::integer as position\n    from jsonb_array_elements(p_points) with ordinality as entry(value, ordinality)\n  ) point';
begin
  select pg_get_functiondef(
    'public.review_registration_payment_evidence_atomically(uuid,uuid,text,text)'::regprocedure
  )
  into function_definition;

  if position(E'\n  organization_id uuid;' in function_definition) > 0 then
    function_definition := replace(
      function_definition,
      E'  organization_id uuid;',
      E'  resolved_organization_id uuid;'
    );
    function_definition := replace(
      function_definition,
      E'  into organization_id\n  from public.event_editions',
      E'  into resolved_organization_id\n  from public.event_editions'
    );
    function_definition := replace(
      function_definition,
      E'        registration_row.event_category_id,\n        organization_id,\n        coalesce(max(existing.version), 0) + 1,',
      E'        registration_row.event_category_id,\n        resolved_organization_id,\n        coalesce(max(existing.version), 0) + 1,'
    );
    function_definition := replace(
      function_definition,
      E'    values (\n      organization_id,\n      registration_row.id,',
      E'    values (\n      resolved_organization_id,\n      registration_row.id,'
    );
    function_definition := replace(
      function_definition,
      E'  values (\n    organization_id,\n    target_reviewer_user_id,',
      E'  values (\n    resolved_organization_id,\n    target_reviewer_user_id,'
    );

    if position(E'\n  organization_id uuid;' in function_definition) > 0
       or position(E'\n        organization_id,\n        coalesce(max(existing.version)' in function_definition) > 0 then
      raise exception 'manual_payment_function_hardening_failed';
    end if;

    execute function_definition;
  elsif position(E'\n  resolved_organization_id uuid;' in function_definition) = 0 then
    raise exception 'manual_payment_function_shape_unknown';
  end if;

  select pg_get_functiondef(
    'public.service_publish_timing_plan(uuid,uuid,text,integer,jsonb)'::regprocedure
  )
  into function_definition;

  if position('timing_plan_input_points' in function_definition) > 0 then
    original_definition := function_definition;
    stage_start := position('  create temporary table if not exists ' in function_definition);
    if stage_start = 0 then
      raise exception 'timing_plan_stage_start_not_found';
    end if;

    stage_tail_start := position(
      stage_tail_marker in substring(function_definition from stage_start)
    );
    if stage_tail_start = 0 then
      raise exception 'timing_plan_stage_end_not_found';
    end if;

    function_definition :=
      substring(function_definition from 1 for stage_start - 1)
      || '  if exists ('
      || substring(
        function_definition
        from stage_start + stage_tail_start - 1 + char_length(stage_tail_marker)
      );

    function_definition := replace(
      function_definition,
      'from pg_temp.timing_plan_input_points point',
      point_source
    );
    function_definition := replace(
      function_definition,
      'from timing_plan_input_points point',
      point_source
    );
    function_definition := replace(
      function_definition,
      'from pg_temp.timing_plan_input_points',
      point_source
    );
    function_definition := replace(
      function_definition,
      'from timing_plan_input_points',
      point_source
    );

    if function_definition = original_definition
       or position('timing_plan_input_points' in function_definition) > 0 then
      raise exception 'timing_plan_function_hardening_failed';
    end if;

    execute function_definition;
  elsif position('jsonb_array_elements(p_points) with ordinality' in function_definition) = 0 then
    raise exception 'timing_plan_function_shape_unknown';
  end if;
end
$hardening$;
