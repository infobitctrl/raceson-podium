-- Normalize hosted ACL drift to the exact clean-replay browser and server
-- boundaries. The hosted project retained legacy automatic grants that are
-- absent from a clean local replay. Keep browser table access read-only except
-- for deleting a caller-owned pending event photo, preserve narrow column
-- projections, and remove only the identified unintended direct function
-- grants. Hashes pair with names so overloaded signatures remain unambiguous.

begin;

revoke all privileges on all tables in schema public from authenticated;
revoke all privileges on all sequences in schema public from authenticated;

alter default privileges for role postgres in schema public
  revoke all privileges on tables from authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from service_role;

grant select on table
  public.athlete_activities,
  public.athlete_badges,
  public.athlete_favorites,
  public.badge_definitions,
  public.bib_assignments,
  public.checkpoints,
  public.club_activities,
  public.club_memberships,
  public.club_posts,
  public.club_roles,
  public.club_stats,
  public.clubs,
  public.event_categories,
  public.event_category_selection_groups,
  public.event_category_track_snapshots,
  public.event_documents,
  public.event_edition_sports,
  public.event_editions,
  public.event_locations,
  public.event_photo_submissions,
  public.event_review_comments,
  public.event_reviews,
  public.event_series,
  public.league_club_standings,
  public.league_individual_standings,
  public.league_rounds,
  public.league_scoring_rules,
  public.league_seasons,
  public.league_sports,
  public.leagues,
  public.organizations,
  public.public_athlete_profiles,
  public.result_publications,
  public.result_rows,
  public.result_splits,
  public.sport_disciplines,
  public.track_attempts,
  public.track_condition_reports,
  public.track_render_cache,
  public.track_review_comments,
  public.track_review_reactions,
  public.track_reviews,
  public.track_templates,
  public.track_versions
to authenticated;

grant select (
  id,
  slug,
  display_name,
  gender,
  city,
  country_code,
  status,
  created_at,
  updated_at,
  merged_into_athlete_profile_id
) on table public.athlete_profiles to authenticated;

grant select (
  athlete_profile_id,
  show_city
) on table public.profile_visibility_settings to authenticated;

grant delete on table public.event_photo_submissions to authenticated;

do $$
declare
  target_function regprocedure;
  matched_count integer := 0;
begin
  for target_function in
    select procedure.oid::regprocedure
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    join (
      values
      ('d737b56cba2ac846a1e1009ae5861c4e', 'assign_participant_status_sequence'),
      ('c9ca132a0df0a4044e4a29a5e2135a5e', 'auth_user_display_name'),
      ('20ad87b06775aa5e5e7f438f1a784086', 'auth_user_provider_list'),
      ('63b85da1778f5f8046b8249233305ebb', 'block_field_signoff_for_open_incident'),
      ('08a5c26bcc41415190eabf35b040ce94', 'block_race_start_for_critical_incident'),
      ('729055534addfcb3b00c21dc4e7ac9aa', 'block_race_start_for_unhealthy_timing_fleet'),
      ('2f95b85571b94da14309cd5f20b3ce36', 'current_user_profile_id'),
      ('d189c12104f7db31f76d27585ed7310a', 'delete_user_account_data'),
      ('9ca8a381a0571f543e7a36da120fa0d8', 'enforce_active_club_membership_limit'),
      ('8f50cd3b3bba55e41123fcb1dfd29d7d', 'enforce_club_creator_membership'),
      ('002b873877a36b6e4abc866cd4626408', 'enforce_communication_campaign_cancellation_window'),
      ('0d34110e70385ae9e48263fafbf93786', 'enforce_result_publication_actor_permissions'),
      ('711a2c39f22181ff4c10b00c392de6ac', 'enqueue_league_standings_partner_event'),
      ('135d3f9c573742c2aa2daffe76b44010', 'enqueue_result_publication_partner_event'),
      ('417f19b9ab9a250394b2d79563c44492', 'guard_historical_import_record_resolution'),
      ('926e90097eef79e8cf321d9601bc6cd5', 'guard_league_standings_version_finalization'),
      ('2547bd8528609925eea0a2625be61931', 'guard_platform_record_organization_transfer'),
      ('1b65a1d2cf7e9f2bd3e930e4bc7a0aa8', 'initialize_punch_reconciliation_projection'),
      ('ae71ffc637f91114882d9c68298890ba', 'initialize_registration_bank_transfer_request'),
      ('b3bdebd84430c583caaa10398ea3bbb5', 'is_authenticated'),
      ('89d58a191ad2519643cbb12228bde8bb', 'is_organization_member'),
      ('9e7896ff60302aca88209a54bb554f40', 'is_race_public'),
      ('bd5a3c2c3df3de4d3292865858ba2ab9', 'organization_id_for_track_attempt'),
      ('6b057bd548e3a3172e82ef4952906d02', 'prevent_access_control_evidence_change'),
      ('2d97968fb1cb79adc8dfa8b6bfc95435', 'prevent_analytics_definition_or_event_change'),
      ('f4800caf1fd544a02d6a07610b1d70b6', 'prevent_brand_version_or_domain_event_change'),
      ('ebb51605a9f8365977473cf52889b9a4', 'prevent_communication_evidence_change'),
      ('f526bd4d599385186dee64d1a86d5648', 'prevent_finance_reporting_evidence_change'),
      ('bfde4daf7282946228e194a30cfada5e', 'prevent_immutable_financial_row_change'),
      ('72fb410eb8a77fa1e60c64168623c12d', 'prevent_registration_payment_event_change'),
      ('a39a5d128e35d4d48b36c6b27d81aed8', 'prevent_result_governance_evidence_change'),
      ('db284ab886e05d716e29db25859328d8', 'prevent_safety_evidence_mutation'),
      ('bf925791e5aff7f61dcb5e6f28bcd079', 'prevent_timing_integration_evidence_mutation'),
      ('a50dcee6aafdac42a89610e7183bdd0b', 'prevent_workforce_logistics_evidence_mutation'),
      ('a4903300182533c19bdd5297190d1f40', 'protect_active_club_owner'),
      ('280f38437ddb8d19d8f3669a2ed691ab', 'protect_analytics_export_job'),
      ('89ef1c4eb179972d728df1798f27be3c', 'protect_brand_asset'),
      ('b7b0811814e3457093e69ae26d08f788', 'protect_custom_domain_identity'),
      ('af66f39db59cd1468ab2c40ff0130b39', 'protect_payment_provider_event_evidence'),
      ('3b310ccf7902ce50edb4bc18f4159638', 'protect_published_registration_configuration'),
      ('2ee64aa6f55fbaa93661ab9a84ca375d', 'protect_registration_submission_evidence'),
      ('e8a4d783bb532cbb0f9bf5092e9d80e9', 'protect_result_credential_evidence'),
      ('1a9737efa50b20af98a3ae9e82444435', 'protect_result_publication_evidence'),
      ('9a04dedd4f11d4866adf899cfadb3e4a', 'protect_safety_plan_version_evidence'),
      ('24991df78bd8e5d23240f5b467d6d1cf', 'protect_versioned_access_definition'),
      ('bd6252482435b891be052c6a50539cb2', 'reject_phase5_immutable_mutation'),
      ('be576fcc44888364127485c97e6a2d05', 'request_jwt_claims'),
      ('7461c8661a67d43252660d36475cb89f', 'request_jwt_role'),
      ('1c6dd80078729161e60959f3b31fe0a5', 'set_updated_at'),
      ('33e830f8cdfdccd1a085d4064735027a', 'sync_club_membership_role'),
      ('63538a52ca8418824373d51450621d63', 'sync_registration_payment_request_from_ledger_charge'),
      ('b14c0649e1bc35f5b89815b4f7db8067', 'sync_user_profile_from_auth_user'),
      ('7387be0a31549c8549a9ededfadd25a2', 'user_has_event_permission')
    ) drift(signature_hash, function_name)
      on drift.function_name = procedure.proname
     and drift.signature_hash = md5(
       procedure.proname || E'\n' || pg_get_function_identity_arguments(procedure.oid)
     )
    where namespace.nspname = 'public'
  loop
    execute format(
      'revoke execute on function %s from authenticated',
      target_function
    );
    matched_count := matched_count + 1;
  end loop;

  if matched_count <> 53 then
    raise exception
      'Authenticated function ACL reconciliation matched % functions; expected 53',
      matched_count;
  end if;
end
$$;

do $$
declare
  target_function regprocedure;
  matched_count integer := 0;
begin
  for target_function in
    select procedure.oid::regprocedure
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    join (
      values
      ('d737b56cba2ac846a1e1009ae5861c4e', 'assign_participant_status_sequence'),
      ('c9ca132a0df0a4044e4a29a5e2135a5e', 'auth_user_display_name'),
      ('20ad87b06775aa5e5e7f438f1a784086', 'auth_user_provider_list'),
      ('63b85da1778f5f8046b8249233305ebb', 'block_field_signoff_for_open_incident'),
      ('08a5c26bcc41415190eabf35b040ce94', 'block_race_start_for_critical_incident'),
      ('729055534addfcb3b00c21dc4e7ac9aa', 'block_race_start_for_unhealthy_timing_fleet'),
      ('92dc2dbf0e8fb3d5199cca8c2301ac6f', 'build_platform_invalidation_payload'),
      ('cbaccb9f188564c9918a361b6b66c448', 'can_manage_club'),
      ('126a9ba8d22bc742ee8d354a57bf2969', 'can_manage_organization'),
      ('6437bddd5b46e939a7cc17313d28ff26', 'can_time_organization'),
      ('9c516c8e2ff227901644406a8c0d1f38', 'canonical_club_identity_id'),
      ('e72f13489a4791f7a33cf6f636eecf76', 'close_category_checkpoints_on_finish'),
      ('c6243662f7deed7a9000996989a97416', 'complete_event_edition_after_final_result_publication'),
      ('944676120d8ed706923547d0231a6e94', 'create_default_registration_configuration_for_category'),
      ('7d0fd19308244e974c4a440cbcc219ff', 'current_primary_athlete_profile_id'),
      ('2f95b85571b94da14309cd5f20b3ce36', 'current_user_profile_id'),
      ('9ca8a381a0571f543e7a36da120fa0d8', 'enforce_active_club_membership_limit'),
      ('8f50cd3b3bba55e41123fcb1dfd29d7d', 'enforce_club_creator_membership'),
      ('002b873877a36b6e4abc866cd4626408', 'enforce_communication_campaign_cancellation_window'),
      ('bd2b05a620631693345dc849d25043c1', 'enforce_event_club_participation_access'),
      ('52c2b8676e01fc62a92cf81677129b61', 'enforce_registration_category_eligibility'),
      ('0d34110e70385ae9e48263fafbf93786', 'enforce_result_publication_actor_permissions'),
      ('7f2a7fd160e9b06c9632bae6c9d4f177', 'enforce_user_profile_primary_athlete_owner'),
      ('711a2c39f22181ff4c10b00c392de6ac', 'enqueue_league_standings_partner_event'),
      ('99350d25e5e3c4429042c43d8d6851f3', 'enqueue_platform_invalidation'),
      ('135d3f9c573742c2aa2daffe76b44010', 'enqueue_result_publication_partner_event'),
      ('129253fb2daa1dee1a95fc9fc3a5adbf', 'guard_active_organization_owner_update'),
      ('417f19b9ab9a250394b2d79563c44492', 'guard_historical_import_record_resolution'),
      ('926e90097eef79e8cf321d9601bc6cd5', 'guard_league_standings_version_finalization'),
      ('2547bd8528609925eea0a2625be61931', 'guard_platform_record_organization_transfer'),
      ('1b65a1d2cf7e9f2bd3e930e4bc7a0aa8', 'initialize_punch_reconciliation_projection'),
      ('ae71ffc637f91114882d9c68298890ba', 'initialize_registration_bank_transfer_request'),
      ('af04dec24def29c176ddd027bd0e432d', 'is_athlete_profile_public'),
      ('b3bdebd84430c583caaa10398ea3bbb5', 'is_authenticated'),
      ('3e908a36b37837c1ee35a581d61e1e7e', 'is_badge_definition_public'),
      ('56f158bb9c4a55874624cfea736bc4d8', 'is_club_public'),
      ('9348581f8313f6649f31575a8621cb30', 'is_event_category_public'),
      ('03360c7f25de46ef2b2a174a09e2f0c3', 'is_event_edition_public'),
      ('cf45654d5df43a84481cbe4e2ab3879e', 'is_event_series_public'),
      ('2278d1b7438bbfa7160265377becbe3d', 'is_league_club_standing_public'),
      ('d90ed2d593b320cb8d3946eb8538cd9e', 'is_league_individual_standing_public'),
      ('d013c6133c0bb3c4840505d521f4c652', 'is_league_public'),
      ('49db7b0bcae0ccda3286f2749a6c72b5', 'is_league_round_public'),
      ('355a256549c15b9a90847abbfef8d395', 'is_league_scoring_rule_public'),
      ('4ef6ea6e0e704354fb413592952fdc0e', 'is_league_season_public'),
      ('89d58a191ad2519643cbb12228bde8bb', 'is_organization_member'),
      ('9e7896ff60302aca88209a54bb554f40', 'is_race_public'),
      ('10b70d03c858d42af02346a9ce7ee0d6', 'is_result_row_public'),
      ('4a4abd0a90fca771fecacc7db98b257d', 'is_result_run_public'),
      ('abed5b7059b2013b260e26c1b258ef30', 'is_result_split_public'),
      ('b5f24e85326a1b33bfb430eeebe4f14d', 'is_track_template_public'),
      ('40d62095a650fcc31494948265b27ee8', 'is_track_version_public'),
      ('b755366bec23cde409c771dbfe32de10', 'normalize_club_identity_name'),
      ('ef5f7def74f3eb27790a087fcff29396', 'normalize_represented_club_identity'),
      ('614c95a890c373e931488a4595ede87c', 'organization_can_delegate_permissions'),
      ('29fc9d1dd647fed33acf5699247fe6e9', 'organization_has_permission'),
      ('38927c30b373188533617f3c884ffc63', 'organization_id_for_athlete_badge'),
      ('e042d188f9729061f3aa729b34510be4', 'organization_id_for_badge_definition'),
      ('cd162f8eeb4041f1910ea77dcedd1535', 'organization_id_for_bib_assignment'),
      ('210bcc9093eddde8c746b7300c09a237', 'organization_id_for_checkin'),
      ('267520bcdee85be190ee032f211ea85b', 'organization_id_for_checkpoint'),
      ('e941dfdab313299e44f7f52b040cd085', 'organization_id_for_event_category'),
      ('c6ab8c290c384e2f9586f74b4eb00eb9', 'organization_id_for_event_document'),
      ('45efbfd7f8362bb5aa7e23b950fd9e0b', 'organization_id_for_event_edition'),
      ('fd9cf7f8d50ef8d0711eb53877d05c28', 'organization_id_for_event_registration_field'),
      ('73dc51b2372adf7ec7979a83a15fbf18', 'organization_id_for_event_series'),
      ('178a5e833d69a98c3b52514908f4d17e', 'organization_id_for_league_club_standing'),
      ('877cf13c0910b9980f3f3b0b024e7ffa', 'organization_id_for_league_individual_standing'),
      ('7e007d205d0aa81a0021f14b4af638eb', 'organization_id_for_league_round'),
      ('ff186d5e3ef505361a6ea2ef7e3f6bc3', 'organization_id_for_league_scoring_rule'),
      ('6f14ccb5b14caa5d1c910cfecf2a9f2d', 'organization_id_for_league_season'),
      ('09ccc7249e87351ef1aa0e1e6056b87f', 'organization_id_for_league'),
      ('caee575007c452d1b6e988f607ae6375', 'organization_id_for_participant_status'),
      ('9a0401373891e59765b78790eedd146d', 'organization_id_for_punch_event_revision'),
      ('4e229df61393560a5053bc96469854da', 'organization_id_for_punch_event'),
      ('aec267b529fdbfcce0185abde6040b0c', 'organization_id_for_registration_answer'),
      ('12822cc509260d121d56640be28af82e', 'organization_id_for_registration_status_history'),
      ('bb8266c47c9951cd488348b6ed8ed16e', 'organization_id_for_registration'),
      ('64b6c36661d294c2c9b086ecd18f67a4', 'organization_id_for_result_publication'),
      ('dbec8519579d5d7f8ef8c52401a71131', 'organization_id_for_result_row'),
      ('7d93f2efb3c2f99d5398b22f72a38601', 'organization_id_for_result_run'),
      ('4c5120d707cacb7a3fec7afc07021465', 'organization_id_for_result_split'),
      ('0919f3d9158a6ffa869d5ac8fdcf9232', 'organization_id_for_snapshot'),
      ('ed4f6db075cddf363f908e5240291003', 'organization_id_for_timing_session'),
      ('bd5a3c2c3df3de4d3292865858ba2ab9', 'organization_id_for_track_attempt'),
      ('4ccfbab024a3364b0cf1581e52213dd7', 'organization_id_for_track_template'),
      ('4db3737a130b5607a9cb480f66e8320c', 'organization_id_for_track_version'),
      ('6b057bd548e3a3172e82ef4952906d02', 'prevent_access_control_evidence_change'),
      ('2d97968fb1cb79adc8dfa8b6bfc95435', 'prevent_analytics_definition_or_event_change'),
      ('f4800caf1fd544a02d6a07610b1d70b6', 'prevent_brand_version_or_domain_event_change'),
      ('ebb51605a9f8365977473cf52889b9a4', 'prevent_communication_evidence_change'),
      ('f526bd4d599385186dee64d1a86d5648', 'prevent_finance_reporting_evidence_change'),
      ('bfde4daf7282946228e194a30cfada5e', 'prevent_immutable_financial_row_change'),
      ('72fb410eb8a77fa1e60c64168623c12d', 'prevent_registration_payment_event_change'),
      ('a39a5d128e35d4d48b36c6b27d81aed8', 'prevent_result_governance_evidence_change'),
      ('db284ab886e05d716e29db25859328d8', 'prevent_safety_evidence_mutation'),
      ('bf925791e5aff7f61dcb5e6f28bcd079', 'prevent_timing_integration_evidence_mutation'),
      ('a50dcee6aafdac42a89610e7183bdd0b', 'prevent_workforce_logistics_evidence_mutation'),
      ('a4903300182533c19bdd5297190d1f40', 'protect_active_club_owner'),
      ('280f38437ddb8d19d8f3669a2ed691ab', 'protect_analytics_export_job'),
      ('89ef1c4eb179972d728df1798f27be3c', 'protect_brand_asset'),
      ('b7b0811814e3457093e69ae26d08f788', 'protect_custom_domain_identity'),
      ('c424ebaa8e3e6c5b2d8a4b5783bd87c4', 'protect_domain_event'),
      ('736610cb44cde430afaa71470b3c6683', 'protect_league_mapping_source_version'),
      ('af66f39db59cd1468ab2c40ff0130b39', 'protect_payment_provider_event_evidence'),
      ('3b310ccf7902ce50edb4bc18f4159638', 'protect_published_registration_configuration'),
      ('2ee64aa6f55fbaa93661ab9a84ca375d', 'protect_registration_submission_evidence'),
      ('e8a4d783bb532cbb0f9bf5092e9d80e9', 'protect_result_credential_evidence'),
      ('1a9737efa50b20af98a3ae9e82444435', 'protect_result_publication_evidence'),
      ('9a04dedd4f11d4866adf899cfadb3e4a', 'protect_safety_plan_version_evidence'),
      ('24991df78bd8e5d23240f5b467d6d1cf', 'protect_versioned_access_definition'),
      ('bdd48f5eb5bd184ffb44e260b99eb21f', 'refresh_track_review_reaction_counts'),
      ('8810ccdd01a4e22cd33864a68ce2bfd4', 'reject_duplicate_active_club_identity'),
      ('bd6252482435b891be052c6a50539cb2', 'reject_phase5_immutable_mutation'),
      ('ed80587d89b1a0ef45148ed722d521f6', 'reject_start_list_snapshot_mutation'),
      ('36d9bbeb244e4d76dbf5fac221e27d2b', 'reject_timing_snapshot_mutation'),
      ('be576fcc44888364127485c97e6a2d05', 'request_jwt_claims'),
      ('7461c8661a67d43252660d36475cb89f', 'request_jwt_role'),
      ('31f06873162546bff4d88d7184495888', 'request_user_id'),
      ('298903337de4efb8c4041c3f167c95e2', 'seed_new_club_roles'),
      ('1c6dd80078729161e60959f3b31fe0a5', 'set_updated_at'),
      ('3122448729178cf40156063d3e787f42', 'sync_approved_club_identity_merge'),
      ('33e830f8cdfdccd1a085d4064735027a', 'sync_club_membership_role'),
      ('d358e0d0391e9096e6c82c7242d831ac', 'sync_current_result_status_to_registration'),
      ('63538a52ca8418824373d51450621d63', 'sync_registration_payment_request_from_ledger_charge'),
      ('b14c0649e1bc35f5b89815b4f7db8067', 'sync_user_profile_from_auth_user'),
      ('f41052d78c33986f5c3b4a7c5f301cae', 'user_can_access_athlete_profile'),
      ('ac58ce0311f0f4e6573249a5d1d7002b', 'user_can_access_registration'),
      ('7387be0a31549c8549a9ededfadd25a2', 'user_has_event_permission')
    ) drift(signature_hash, function_name)
      on drift.function_name = procedure.proname
     and drift.signature_hash = md5(
       procedure.proname || E'\n' || pg_get_function_identity_arguments(procedure.oid)
     )
    where namespace.nspname = 'public'
  loop
    execute format(
      'revoke execute on function %s from service_role',
      target_function
    );
    matched_count := matched_count + 1;
  end loop;

  if matched_count <> 129 then
    raise exception
      'Service-role function ACL reconciliation matched % functions; expected 129',
      matched_count;
  end if;
end
$$;

do $$
declare
  unexpected_record record;
begin
  for unexpected_record in
    select class.relname, upper(acl.privilege_type) as privilege_type
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    cross join lateral aclexplode(
      coalesce(class.relacl, acldefault('r', class.relowner))
    ) acl
    join pg_roles grantee on grantee.oid = acl.grantee
    where namespace.nspname = 'public'
      and class.relkind in ('r', 'p', 'v', 'm', 'f')
      and grantee.rolname = 'authenticated'
      and (
        upper(acl.privilege_type) in ('INSERT', 'UPDATE')
        or (
          upper(acl.privilege_type) = 'DELETE'
          and class.relname <> 'event_photo_submissions'
        )
      )
  loop
    raise exception 'Unexpected authenticated table privilege remains: %.%',
      unexpected_record.relname,
      unexpected_record.privilege_type;
  end loop;

  if not has_table_privilege(
    'authenticated',
    'public.event_editions',
    'SELECT'
  ) or not has_table_privilege(
    'authenticated',
    'public.public_athlete_profiles',
    'SELECT'
  ) or not has_table_privilege(
    'authenticated',
    'public.event_photo_submissions',
    'SELECT,DELETE'
  ) then
    raise exception 'Authenticated table allowlist is incomplete';
  end if;

  if not has_column_privilege(
    'authenticated',
    'public.athlete_profiles',
    'display_name',
    'SELECT'
  ) or has_column_privilege(
    'authenticated',
    'public.athlete_profiles',
    'primary_email',
    'SELECT'
  ) then
    raise exception 'Authenticated athlete projection column grants are invalid';
  end if;

  for unexpected_record in
    select distinct procedure.oid::regprocedure as function_signature
    from pg_policy policy
    join pg_depend dependency
      on dependency.classid = 'pg_policy'::regclass
     and dependency.objid = policy.oid
    join pg_proc procedure
      on dependency.refclassid = 'pg_proc'::regclass
     and dependency.refobjid = procedure.oid
    join pg_namespace function_namespace
      on function_namespace.oid = procedure.pronamespace
    where function_namespace.nspname = 'public'
      and (
        0 = any(policy.polroles)
        or 'authenticated'::regrole::oid = any(policy.polroles)
      )
      and not has_function_privilege(
        'authenticated',
        procedure.oid,
        'EXECUTE'
      )
  loop
    raise exception 'Authenticated RLS policy helper lacks EXECUTE: %',
      unexpected_record.function_signature;
  end loop;
end
$$;

commit;
