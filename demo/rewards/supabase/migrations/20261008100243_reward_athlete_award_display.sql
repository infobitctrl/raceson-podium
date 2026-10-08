-- Presentation-only labels from the immutable launch revision, not an editable draft.
-- Preserve the existing private athlete/session filter, ordering and receipt facts.
begin;
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.service_reward_demo_copy_athlete_awards(uuid,uuid,text)'::regprocedure);
 if strpos(definition,$needle$r.beneficiary_id,e.plan->>'version' protocol_version$needle$)=0
  or strpos(definition,$needle$ join app_private.reward_demo_copy_launch_sources b$needle$)=0
  or strpos(definition,$needle$'athleteProfileId',beneficiary_id,'claims'$needle$)=0 then
  raise exception 'unexpected_athlete_awards_definition';
 end if;
 definition:=replace(definition,$needle$r.beneficiary_id,e.plan->>'version' protocol_version$needle$,
  $code$r.beneficiary_id,e.plan->>'version' protocol_version,revision.configuration award_configuration$code$);
 definition:=replace(definition,$needle$ join app_private.reward_demo_copy_launch_sources b$needle$,
  $code$ left join app_private.reward_sponsor_launches launch on launch.id=a.launch_id and launch.setup_id=a.setup_id
 left join app_private.reward_setup_revisions revision on revision.setup_id=launch.setup_id and revision.revision=launch.setup_revision
 join app_private.reward_demo_copy_launch_sources b$code$);
 definition:=replace(definition,$needle$'athleteProfileId',beneficiary_id,'claims'$needle$,
  $code$'athleteProfileId',beneficiary_id,'display',jsonb_build_object(
   'campaignName',nullif(award_configuration->>'name',''),
   'eventName',case when award_configuration#>>'{sponsorSelection,eventEditionId}' is not null
    then nullif(award_configuration#>>'{context,eventName}','')
    else nullif(award_configuration#>>'{context,programmeName}','') end,
   'scopeName',case when award_configuration#>>'{sponsorSelection,eventEditionId}' is not null then null
    else (select nullif(node->>'name','') from jsonb_array_elements(award_configuration#>'{guided,pots}') pot
     join jsonb_array_elements(award_configuration#>'{root,children}') node on node->>'id'=pot->>'nodeId'
     where pot->>'slot'=page.slot::text limit 1) end),'claims'$code$);
 execute definition;
end $migration$;
notify pgrst,'reload schema';
commit;
