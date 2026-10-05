alter table track_versions
  add column if not exists difficulty_level smallint;

alter table track_versions
  drop constraint if exists track_versions_difficulty_level_check;

alter table track_versions
  add constraint track_versions_difficulty_level_check
  check (difficulty_level is null or difficulty_level between 1 and 5);

comment on column track_versions.difficulty_level is
  'Organizer-selected route difficulty: 1 Beginner, 2 Intermediate, 3 Advanced, 4 Expert, 5 Ultra.';
