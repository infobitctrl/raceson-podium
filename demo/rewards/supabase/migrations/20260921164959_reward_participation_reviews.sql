begin;

-- Private, append-only sporting contribution decisions. Never award approval.
create table app_private.reward_participation_reviews (
  id uuid primary key check(id <> '00000000-0000-0000-0000-000000000000'),
  draft_id uuid not null references app_private.reward_planning_drafts(id),
  previous_review_id uuid,
  revision integer not null check(revision between 1 and 2147483645),
  source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
  review_body jsonb not null check(jsonb_typeof(review_body)='object' and octet_length(review_body::text)<=262144),
  reason text not null check(length(btrim(reason))>0 and length(reason)<=500 and reason !~ '[[:cntrl:]]'),
  reviewed_at timestamptz not null default clock_timestamp(),
  reviewed_by_user_id uuid not null references public.user_profiles(user_id),
  reviewed_session_id uuid not null,
  unique(draft_id,id), unique(draft_id,revision),
  foreign key(draft_id,previous_review_id) references app_private.reward_participation_reviews(draft_id,id),
  check(previous_review_id is distinct from id),
  check((revision=1)=(previous_review_id is null))
);
alter table app_private.reward_participation_reviews enable row level security;
revoke all on app_private.reward_participation_reviews from public,anon,authenticated,service_role;
grant select,insert on app_private.reward_participation_reviews to service_role;
create policy reward_participation_review_select on app_private.reward_participation_reviews for select to service_role using(true);
create policy reward_participation_review_insert on app_private.reward_participation_reviews for insert to service_role with check(true);
create trigger reward_participation_review_immutable before update or delete on app_private.reward_participation_reviews
  for each row execute function app_private.reward_result_review_immutable_v3();

create function app_private.reward_participation_review_dto(p app_private.reward_participation_reviews,p_source_hash text,p_latest_id uuid)
returns jsonb language sql stable security invoker set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('id',p.id,'previousReviewId',p.previous_review_id,'revision',p.revision,
    'review',p.review_body,'reason',p.reason,'reviewedAt',p.reviewed_at,'reviewedByUserId',p.reviewed_by_user_id,
    'current',coalesce(p.id=p_latest_id and p.source_hash=p_source_hash,false))
$$;

create function public.service_read_reward_participation_review(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v jsonb; latest app_private.reward_participation_reviews%rowtype; history jsonb;
begin
  v:=public.service_read_reward_published_preview_v2(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  select * into latest from app_private.reward_participation_reviews where draft_id=p_draft_id order by revision desc limit 1;
  select coalesce(jsonb_agg(app_private.reward_participation_review_dto(r,v->>'sourceHash',latest.id) order by r.revision desc),'[]'::jsonb)
    into history from (select * from app_private.reward_participation_reviews where draft_id=p_draft_id order by revision desc limit 10) r;
  perform app_private.require_reward_account(p_actor_user_id,p_actor_session_id);
  if not app_private.reward_planning_authorized(p_actor_user_id,(v#>>'{record,organizationId}')::uuid) then raise exception 'reward_planning_not_found'; end if;
  return v || jsonb_build_object('review',case when latest.id is null then null else app_private.reward_participation_review_dto(latest,v->>'sourceHash',latest.id) end,
    'history',history,'recordedReview',null);
end $$;

-- Validate against every result in the exact imported snapshot, including
-- non-finishes in duplicate groups. No name-based or current-club inference.
create function app_private.validate_reward_participation_review(p_review jsonb,p_snapshot jsonb,p_source_hash text)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare d jsonb; rid text; actual jsonb; n integer; u text:='^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
begin
  if p_review is null or jsonb_typeof(p_review)<>'object' or octet_length(p_review::text)>262144
    or (select array_agg(k order by k) from jsonb_object_keys(p_review) k) is distinct from array['confirmedUnaffiliatedResultIds','duplicates','sourceHash','version']
    or p_review->'version' is distinct from '1'::jsonb or p_review->>'sourceHash' is distinct from p_source_hash
    or jsonb_typeof(p_review->'duplicates') is distinct from 'array'
    or jsonb_typeof(p_review->'confirmedUnaffiliatedResultIds') is distinct from 'array' then raise exception 'invalid_reward_participation_review'; end if;
  if jsonb_array_length(p_review->'duplicates')>20000 or jsonb_array_length(p_review->'confirmedUnaffiliatedResultIds')>20000 then raise exception 'invalid_reward_participation_review'; end if;
  if exists(select 1 from jsonb_array_elements(p_review->'duplicates') x group by x->>'round',x->>'athleteId' having count(*)>1) then raise exception 'invalid_reward_participation_review'; end if;
  for d in select value from jsonb_array_elements(p_review->'duplicates') loop
    if jsonb_typeof(d)<>'object' or (select array_agg(k order by k) from jsonb_object_keys(d) k) is distinct from array['athleteId','keepResultId','reason','resultIds','round']
      or d->'round' not in ('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb)
      or coalesce(d->>'athleteId','') !~ u or d->>'athleteId'='00000000-0000-0000-0000-000000000000'
      or jsonb_typeof(d->'reason') is distinct from 'string' or length(btrim(d->>'reason'))=0 or length(d->>'reason')>500 or d->>'reason' ~ '[[:cntrl:]]'
      or jsonb_typeof(d->'resultIds') is distinct from 'array' then raise exception 'invalid_reward_participation_review'; end if;
    if jsonb_array_length(d->'resultIds')<2 or jsonb_array_length(d->'resultIds')>20000
      or exists(select 1 from jsonb_array_elements(d->'resultIds') x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ u or x#>>'{}'='00000000-0000-0000-0000-000000000000')
      or (select count(distinct x) from jsonb_array_elements(d->'resultIds') x)<>jsonb_array_length(d->'resultIds')
      or (d->'keepResultId'<>'null'::jsonb and not (d->'resultIds' @> jsonb_build_array(d->'keepResultId'))) then raise exception 'invalid_reward_participation_review'; end if;
    select jsonb_agg(rr->'id' order by rr->>'id') into actual
      from jsonb_array_elements(p_snapshot->'results') rr
      join lateral jsonb_array_elements(p_snapshot#>'{catalogue,rounds}') ro on ro->'slot'=d->'round'
      join lateral jsonb_array_elements(ro->'races') ra on ra->>'id'=rr->>'raceId'
      where rr->>'athleteId'=d->>'athleteId';
    if actual is distinct from (select jsonb_agg(x order by x#>>'{}') from jsonb_array_elements(d->'resultIds') x) then raise exception 'invalid_reward_participation_review'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_review->'confirmedUnaffiliatedResultIds') x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ u)
    or (select count(distinct x) from jsonb_array_elements(p_review->'confirmedUnaffiliatedResultIds') x)<>jsonb_array_length(p_review->'confirmedUnaffiliatedResultIds') then raise exception 'invalid_reward_participation_review'; end if;
  for rid in select value from jsonb_array_elements_text(p_review->'confirmedUnaffiliatedResultIds') loop
    select count(*) into n from jsonb_array_elements(p_snapshot->'results') rr where rr->>'id'=rid
      and rr->'clubId'='null'::jsonb and rr->>'participationStatus'='finished'
      and jsonb_typeof(rr->'finishTimeMs')='number' and (rr->>'finishTimeMs')::numeric>0;
    if n<>1 then raise exception 'invalid_reward_participation_review'; end if;
  end loop;
end $$;

create function public.service_save_reward_participation_review(p_actor_user_id uuid,p_actor_session_id uuid,p_chain_id integer,p_draft_id uuid,
  p_request_id uuid,p_expected_review_id uuid,p_review jsonb,p_reason text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare d jsonb; v jsonb; old app_private.reward_participation_reviews%rowtype; saved app_private.reward_participation_reviews%rowtype;
begin
  d:=public.service_read_reward_planning_draft(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  perform 1 from public.organization_memberships where user_id=p_actor_user_id and organization_id=(d->>'organizationId')::uuid for share;
  perform 1 from public.organizations where id=(d->>'organizationId')::uuid for share;
  perform 1 from app_private.reward_planning_drafts where id=p_draft_id for update;
  v:=public.service_read_reward_participation_review(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if p_request_id is null or p_request_id='00000000-0000-0000-0000-000000000000' or p_request_id=p_expected_review_id
    or p_reason is null or length(btrim(p_reason))=0 or length(p_reason)>500 or p_reason ~ '[[:cntrl:]]' then raise exception 'invalid_reward_participation_review'; end if;
  select * into saved from app_private.reward_participation_reviews where id=p_request_id;
  if found then
    if saved.draft_id<>p_draft_id or saved.reviewed_by_user_id<>p_actor_user_id
      or saved.previous_review_id is distinct from p_expected_review_id or saved.review_body is distinct from p_review or saved.reason<>p_reason
      then raise exception 'reward_participation_review_conflict'; end if;
    return v || jsonb_build_object('recordedReview',app_private.reward_participation_review_dto(saved,v->>'sourceHash',(v#>>'{review,id}')::uuid));
  end if;
  if v->'snapshot'='null'::jsonb or v->>'sourceHash' is null then raise exception 'reward_participation_source_missing'; end if;
  if p_review->>'sourceHash' is distinct from v->>'sourceHash' then raise exception 'reward_participation_source_changed'; end if;
  select * into old from app_private.reward_participation_reviews where draft_id=p_draft_id order by revision desc limit 1;
  if old.id is distinct from p_expected_review_id then raise exception 'reward_participation_review_conflict'; end if;
  perform app_private.validate_reward_participation_review(p_review,v->'snapshot',v->>'sourceHash');
  insert into app_private.reward_participation_reviews(id,draft_id,previous_review_id,revision,source_hash,review_body,reason,reviewed_by_user_id,reviewed_session_id)
    values(p_request_id,p_draft_id,p_expected_review_id,coalesce(old.revision,0)+1,v->>'sourceHash',p_review,p_reason,p_actor_user_id,p_actor_session_id)
    returning * into saved;
  v:=public.service_read_reward_participation_review(p_actor_user_id,p_actor_session_id,p_chain_id,p_draft_id);
  if v->>'sourceHash' is distinct from saved.source_hash then raise exception 'reward_participation_source_changed'; end if;
  return v || jsonb_build_object('recordedReview',app_private.reward_participation_review_dto(saved,v->>'sourceHash',(v#>>'{review,id}')::uuid));
end $$;
revoke all on function app_private.reward_participation_review_dto(app_private.reward_participation_reviews,text,uuid),
  app_private.validate_reward_participation_review(jsonb,jsonb,text),
  public.service_read_reward_participation_review(uuid,uuid,integer,uuid),
  public.service_save_reward_participation_review(uuid,uuid,integer,uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function app_private.reward_participation_review_dto(app_private.reward_participation_reviews,text,uuid),
  app_private.validate_reward_participation_review(jsonb,jsonb,text),
  public.service_read_reward_participation_review(uuid,uuid,integer,uuid),
  public.service_save_reward_participation_review(uuid,uuid,integer,uuid,uuid,uuid,jsonb,text) to service_role;
commit;
