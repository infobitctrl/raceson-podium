begin;

/*
 * Keep race-time representation immutable while giving directory reads a
 * canonical club identity. The reviewed rows below come from the 2026-08-06
 * staging cross-check; every data update is keyed by immutable UUID.
 */

alter table public.clubs
  add column if not exists merged_into_club_id uuid;

do $constraints$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.clubs'::regclass
      and conname = 'clubs_merged_into_club_id_fkey'
  ) then
    alter table public.clubs
      add constraint clubs_merged_into_club_id_fkey
      foreign key (merged_into_club_id)
      references public.clubs (id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.clubs'::regclass
      and conname = 'clubs_merged_into_club_id_not_self_check'
  ) then
    alter table public.clubs
      add constraint clubs_merged_into_club_id_not_self_check
      check (merged_into_club_id is null or merged_into_club_id <> id);
  end if;
end
$constraints$;

create index if not exists clubs_merged_into_club_id_idx
  on public.clubs (merged_into_club_id)
  where merged_into_club_id is not null;

comment on column public.clubs.merged_into_club_id is
  'Canonical directory identity for a merged club. Historical registrations and results retain their represented_club_id.';

create or replace function public.sync_approved_club_identity_merge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $sync_club_merge$
begin
  if new.merge_state = 'approved' then
    update public.clubs
    set
      merged_into_club_id = new.canonical_club_id,
      status = 'merged',
      verification_status = 'merged'
    where id = new.source_club_id
      and id <> new.canonical_club_id;
  end if;

  return new;
end
$sync_club_merge$;

revoke all on function public.sync_approved_club_identity_merge()
  from public, anon, authenticated;

drop trigger if exists club_identity_merges_sync_pointer
  on public.club_identity_merges;
create trigger club_identity_merges_sync_pointer
after insert or update of merge_state, canonical_club_id
on public.club_identity_merges
for each row execute function public.sync_approved_club_identity_merge();

update public.clubs club
set
  merged_into_club_id = merge.canonical_club_id,
  status = 'merged',
  verification_status = 'merged'
from public.club_identity_merges merge
where merge.source_club_id = club.id
  and merge.merge_state = 'approved';

create temporary table _reviewed_club_merges (
  source_club_id uuid primary key,
  source_name text not null,
  canonical_club_id uuid not null,
  canonical_name text not null
) on commit drop;

insert into _reviewed_club_merges (
  source_club_id,
  source_name,
  canonical_club_id,
  canonical_name
)
values
  ('bab054e0-58f0-4823-88ac-9224928607b5', 'AK Sibenik', 'a04cd621-b021-40f1-86a2-763d5b85bd35', 'AK Šibenik'),
  ('74d93f56-5504-44b8-91ea-dd043e97ad40', 'BK  Faust  Vrancic', 'f254dd62-2af4-45ea-8830-049338abe16c', 'BK Faust Vrančić'),
  ('4b45d6ce-d4d1-465d-98ac-65c2fa089dac', 'Bk Faust', 'f254dd62-2af4-45ea-8830-049338abe16c', 'BK Faust Vrančić'),
  ('77afb171-7895-4072-8b28-3d6ba12cd7fd', 'BK Faust Vrancic', 'f254dd62-2af4-45ea-8830-049338abe16c', 'BK Faust Vrančić'),
  ('74d858f3-7d48-490f-9ed6-0353d705e41a', 'Dracari', '81482261-557d-47b3-b259-c841e8058b73', 'Dračari'),
  ('a374de6e-e59e-4f92-aec4-ba36a00bd86d', 'Hpk sv Mihovil', 'ecfdfaef-bedf-4301-a598-77298703dd81', 'HPK sv. Mihovil'),
  ('ab7ce123-3b06-4c3f-a1a4-8581dd5ea5b5', 'Jaba sport', 'c95bd198-ba38-4c1f-a6e0-2b6a8dddb013', 'Jaba Šport'),
  ('866a7d38-3b2b-4c3e-94d0-934f546a6e54', 'KDPSR  Raslina', '0ce78423-05e6-417f-b32b-0b4d23d2617a', 'KDPSR Raslina'),
  ('e7e9a3cd-d070-44c9-a987-b93b2732894d', 'Run Club Sibenik', '74a87d6e-27bb-4f15-95e3-ff45b9262171', 'Run Club Šibenik'),
  ('4adc42f6-2dec-4cf4-b72b-28abc6dd5755', 'TK Šibenik', '877a4c67-b5ae-4f39-86f7-fde65b3017a8', 'TK Šibenik'),
  ('12217abc-d050-4a03-982d-3e7e23345647', 'Ttk STrks', 'f99ac863-6f5f-4869-972b-ccaee2dd1868', 'TTK Strka'),
  ('4952e3bd-2409-4381-a63e-046c550f73d1', 'TTKSTrka', 'f99ac863-6f5f-4869-972b-ccaee2dd1868', 'TTK Strka'),
  ('aceaec4b-03ce-4e9d-8b3a-b050f3ddad22', 'TKriatlon klub Šibenik', 'a388b501-4873-4299-84cd-8c7785d4c857', 'Triatlon klub Šibenik'),
  ('fd7c6073-a31c-4ce0-8cec-4307421796ae', 'X form', 'b81749df-5678-4f42-bfd5-bb9ffb259eeb', 'Xform');

do $validate_reviewed_merges$
begin
  if exists (
    select 1
    from _reviewed_club_merges reviewed
    join public.clubs source on source.id = reviewed.source_club_id
    left join public.clubs canonical on canonical.id = reviewed.canonical_club_id
    where canonical.id is null
  ) then
    raise exception 'A reviewed club merge source exists without its canonical club';
  end if;
end
$validate_reviewed_merges$;

update public.clubs club
set name = reviewed.canonical_name
from (
  select distinct canonical_club_id, canonical_name
  from _reviewed_club_merges
) reviewed
where club.id = reviewed.canonical_club_id
  and club.name is distinct from reviewed.canonical_name;

insert into public.club_identity_merges (
  id,
  source_club_id,
  canonical_club_id,
  merge_state,
  reason,
  evidence_json,
  proposed_by_user_id,
  decided_by_user_id,
  decided_at,
  client_event_id
)
select
  md5('club-data-repair-20260806:merge:' || reviewed.source_club_id::text)::uuid,
  reviewed.source_club_id,
  reviewed.canonical_club_id,
  'approved',
  'Reviewed duplicate club identity from the 2026-08-06 staging data cross-check.',
  jsonb_build_object(
    'migration', '20260806073212_repair_club_identity_and_membership_provenance',
    'sourceName', reviewed.source_name,
    'canonicalName', reviewed.canonical_name,
    'preservesHistoricalRepresentation', true
  ),
  md5('club-data-repair-20260806:system-actor')::uuid,
  md5('club-data-repair-20260806:system-actor')::uuid,
  timestamptz '2026-08-06 07:32:12+00',
  md5('club-data-repair-20260806:merge-event:' || reviewed.source_club_id::text)::uuid
from _reviewed_club_merges reviewed
join public.clubs source on source.id = reviewed.source_club_id
join public.clubs canonical on canonical.id = reviewed.canonical_club_id
where not exists (
  select 1
  from public.club_identity_merges existing
  where existing.source_club_id = reviewed.source_club_id
    and existing.merge_state = 'approved'
)
on conflict (client_event_id) do nothing;

create temporary table _reviewed_club_aliases (
  canonical_club_id uuid not null,
  alias_name text not null,
  normalized_alias text not null,
  primary key (canonical_club_id, normalized_alias)
) on commit drop;

insert into _reviewed_club_aliases (canonical_club_id, alias_name, normalized_alias)
values
  ('a04cd621-b021-40f1-86a2-763d5b85bd35', 'AK Sibenik', 'ak sibenik'),
  ('f254dd62-2af4-45ea-8830-049338abe16c', 'BK Faust Vrancic', 'bk faust vrancic'),
  ('f254dd62-2af4-45ea-8830-049338abe16c', 'Bk Faust', 'bk faust'),
  ('81482261-557d-47b3-b259-c841e8058b73', 'Dracari', 'dracari'),
  ('ecfdfaef-bedf-4301-a598-77298703dd81', 'Hpk sv Mihovil', 'hpk sv mihovil'),
  ('c95bd198-ba38-4c1f-a6e0-2b6a8dddb013', 'Jaba sport', 'jaba sport'),
  ('0ce78423-05e6-417f-b32b-0b4d23d2617a', 'KDPSR  Raslina', 'kdpsr raslina'),
  ('74a87d6e-27bb-4f15-95e3-ff45b9262171', 'Run Club Sibenik', 'run club sibenik'),
  ('877a4c67-b5ae-4f39-86f7-fde65b3017a8', 'T.K.Šibenik', 't k sibenik'),
  ('f99ac863-6f5f-4869-972b-ccaee2dd1868', 'Ttk STrks', 'ttk strks'),
  ('f99ac863-6f5f-4869-972b-ccaee2dd1868', 'TTKSTrka', 'ttkstrka'),
  ('a388b501-4873-4299-84cd-8c7785d4c857', 'TKriatlon klub Šibenik', 'tkriatlon klub sibenik'),
  ('b81749df-5678-4f42-bfd5-bb9ffb259eeb', 'X form', 'x form');

insert into public.club_aliases (
  id,
  club_id,
  alias_name,
  normalized_alias,
  alias_type,
  country_code,
  source_reference,
  created_by_user_id,
  client_event_id
)
select
  md5('club-data-repair-20260806:alias:' || alias.normalized_alias)::uuid,
  alias.canonical_club_id,
  alias.alias_name,
  alias.normalized_alias,
  'merged',
  'HR',
  'migration:20260806073212',
  md5('club-data-repair-20260806:system-actor')::uuid,
  md5('club-data-repair-20260806:alias-event:' || alias.normalized_alias)::uuid
from _reviewed_club_aliases alias
join public.clubs canonical on canonical.id = alias.canonical_club_id
where not exists (
  select 1
  from public.club_aliases existing
  where existing.normalized_alias = alias.normalized_alias
    and existing.country_code = 'HR'
);

/* Repair only the known import batch; user-originated memberships are kept. */
update public.club_memberships membership
set
  membership_origin = 'represented',
  is_primary = false
where membership.status = 'active'
  and membership.membership_origin = 'self_joined'
  and membership.created_at >= timestamptz '2026-08-05 00:00:00+00'
  and membership.created_at < timestamptz '2026-08-06 00:00:00+00'
  and not exists (
    select 1
    from public.club_membership_events event
    where event.membership_id = membership.id
  )
  and exists (
    select 1
    from public.registrations registration
    where registration.athlete_profile_id = membership.athlete_profile_id
      and registration.represented_club_id = membership.club_id
      and registration.source in (
        'import',
        'import:legacy_duplicate_cancelled',
        'legacy:legacy_reconciliation',
        'legacy:raslina_legacy_backfill',
        'legacy:web_form'
      )
  );

create temporary table _non_club_placeholders (
  club_id uuid primary key,
  expected_name text not null
) on commit drop;

insert into _non_club_placeholders (club_id, expected_name)
values
  ('8258366f-df8f-4ef4-a1d0-f1ec2f0f1c68', '/'),
  ('1b398f25-1079-4e05-a86a-4b495a8cfb6a', 'Bez'),
  ('a672d006-22ad-4ccb-bc73-0d832af9f98e', 'Nema'),
  ('dd793ce5-0902-4233-9500-f9e621a4bb94', 'Nemam Klub'),
  ('9cc6afe3-e0a7-4e8c-b00f-e1c59f0cf20d', 'Solo'),
  ('592a764c-eb89-4178-87ab-10f2068f11c3', 'IND'),
  ('1dd15d95-9dc7-4220-a721-ba071f382ec9', 'I ND'),
  ('464afd41-3884-4f07-a961-55f65ab61380', 'Individualni'),
  ('21b3bb69-3ec6-47ab-bada-87cbf6ddc58a', 'Indvidualac');

create temporary table _fixture_clubs (
  club_id uuid primary key,
  expected_name text not null
) on commit drop;

insert into _fixture_clubs (club_id, expected_name)
values
  ('d747aad6-0342-4436-ac9e-cb275aa1f1e4', 'Result Club'),
  ('fead9509-8fd2-4f65-8f64-5bbac2732ddd', 'After Club'),
  ('d8342271-da82-4880-8cc7-1a878d74c3dc', 'Before Club'),
  ('4fea3f3a-116b-4172-97cf-c1bbd3fd3681', 'QA Delete Team'),
  ('72d924d8-3da2-4970-a6a9-fae58b065c04', 'QA Clock Team'),
  ('364398eb-59d2-4bd9-98f2-2e1fdd009ae4', 'QA Result Team'),
  ('26c3b637-0087-4759-a632-5bbca0e0ed4a', 'QA Audit Team Updated'),
  ('28b4ffc6-4796-47d4-bc23-2f2e13e5c582', 'QA Audit Team'),
  ('4c962850-bd2a-409f-a6f7-e6a2c844621f', 'Live QA'),
  ('f8af0450-4ab6-40b7-a556-903fb0dbf1e2', 'Smoke Club'),
  ('cccca6f0-254c-44e5-a1dc-3df72ed37a8b', 'Tim 01'),
  ('2df25711-ed46-4b6c-8f70-0968d4de37bb', 'Tim 02'),
  ('12fa463b-43d3-4e13-befa-f68cfbe9cf02', 'Tim 03'),
  ('119730e8-df9c-4b3a-a305-122880b3c0e4', 'Tim 04'),
  ('1fe16332-58e0-473d-aca3-86920aab00e0', 'Tim 05'),
  ('22ff0efb-8041-47f5-bb05-fc1298e51b53', 'Tim 06'),
  ('28d2bebd-af05-4357-abf3-be3a93bae114', 'Tim 07'),
  ('1a0534bb-1f25-49b4-8cb8-f7fbde910f01', 'Tim 08'),
  ('2cb5b864-bf0c-4c82-a2ea-ddaca842e46b', 'Tim 09'),
  ('7f8177bf-94d0-4173-80f7-0af14026cacc', 'Tim 10'),
  ('5e7a6f62-71ce-4237-99db-abd888ea459f', 'Tim 11'),
  ('f39abb39-3e05-4fb5-9a18-435e55a4812e', 'Tim 12'),
  ('91caa943-f3b0-4c94-b2ae-1e26e847ebaf', 'Tim 13'),
  ('caa1d057-a51f-4a32-8105-11cda48fbeba', 'Tim 14'),
  ('a117ae04-cf27-4b65-99af-8d49c281e51e', 'Tim 15'),
  ('ba047bbf-a4fb-4cc2-bb04-b085e803a0b1', 'kajajja'),
  ('b569a314-9c02-43f0-b796-c85165025c52', 'kkkkkk'),
  ('8d326d9f-6394-4c2a-ad1b-b47fba6cb72b', 'aaaaaaaa'),
  ('dace878f-6014-45b4-889e-0919b14d47f0', 'Hdhhdhdh'),
  ('3a04a354-979e-47f3-9699-564527f84e5e', 'Bbbb'),
  ('090848aa-cac3-447b-bdfd-51eb57e46125', 'Aaaaaa'),
  ('c718fd92-15f7-478f-b59f-0ff6360d91c6', '22121'),
  ('beda7ff9-803c-45e3-8fb5-8e3a96ce86ee', 'aaaa'),
  ('19054800-543b-4fc6-aac3-bdb26e71010e', 'uxuy'),
  ('79e8b4ad-40bf-4854-b86c-6aa41c4d2910', 'zzzzzzzzzzz');

update public.club_memberships membership
set
  status = 'removed',
  is_primary = false
from (
  select club_id, expected_name from _non_club_placeholders
  union all
  select club_id, expected_name from _fixture_clubs
) reviewed
join public.clubs club
  on club.id = reviewed.club_id
 and club.name = reviewed.expected_name
where membership.club_id = reviewed.club_id
  and membership.status <> 'removed';

update public.clubs club
set
  status = 'inactive',
  verification_status = 'flagged'
from (
  select club_id, expected_name from _non_club_placeholders
  union all
  select club_id, expected_name from _fixture_clubs
) reviewed
where club.id = reviewed.club_id
  and club.name = reviewed.expected_name;

do $post_repair_assertions$
begin
  if exists (
    select 1
    from _reviewed_club_merges reviewed
    join public.clubs source on source.id = reviewed.source_club_id
    where source.merged_into_club_id is distinct from reviewed.canonical_club_id
       or source.status <> 'merged'
       or source.verification_status <> 'merged'
       or not exists (
         select 1
         from public.club_identity_merges merge
         where merge.source_club_id = reviewed.source_club_id
           and merge.canonical_club_id = reviewed.canonical_club_id
           and merge.merge_state = 'approved'
       )
  ) then
    raise exception 'Reviewed club identities were not fully merged';
  end if;

  if exists (
    select 1
    from public.clubs source
    join public.clubs canonical on canonical.id = source.merged_into_club_id
    where source.merged_into_club_id is not null
      and canonical.status <> 'active'
  ) then
    raise exception 'A merged club points to a non-active canonical club';
  end if;

  if exists (
    select 1
    from public.club_memberships membership
    where membership.status = 'active'
      and membership.membership_origin = 'self_joined'
      and membership.created_at >= timestamptz '2026-08-05 00:00:00+00'
      and membership.created_at < timestamptz '2026-08-06 00:00:00+00'
      and not exists (
        select 1
        from public.club_membership_events event
        where event.membership_id = membership.id
      )
      and exists (
        select 1
        from public.registrations registration
        where registration.athlete_profile_id = membership.athlete_profile_id
          and registration.represented_club_id = membership.club_id
          and registration.source in (
            'import',
            'import:legacy_duplicate_cancelled',
            'legacy:legacy_reconciliation',
            'legacy:raslina_legacy_backfill',
            'legacy:web_form'
          )
      )
  ) then
    raise exception 'Imported represented memberships remain misclassified as self-joined';
  end if;

  if exists (
    select 1
    from public.clubs club
    join (
      select club_id, expected_name from _non_club_placeholders
      union all
      select club_id, expected_name from _fixture_clubs
    ) reviewed on reviewed.club_id = club.id and reviewed.expected_name = club.name
    where club.status = 'active'
  ) then
    raise exception 'Reviewed placeholder or fixture clubs remain active';
  end if;
end
$post_repair_assertions$;

commit;
