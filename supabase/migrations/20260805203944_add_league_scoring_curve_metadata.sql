-- Preserve the understandable inputs used to generate an immutable points
-- table. The explicit table remains the scoring source of truth, while this
-- metadata lets organizers reopen and adjust geometric or hybrid curves.

alter table public.league_scoring_rules
  add column if not exists scoring_method text not null default 'custom',
  add column if not exists scoring_parameters_json jsonb not null default '{}'::jsonb;

alter table public.league_scoring_rule_versions
  add column if not exists scoring_method text not null default 'custom',
  add column if not exists scoring_parameters_json jsonb not null default '{}'::jsonb;

alter table public.league_scoring_policy_versions
  add column if not exists scoring_method text not null default 'custom',
  add column if not exists scoring_parameters_json jsonb not null default '{}'::jsonb;

alter table public.league_scoring_rules
  add constraint league_scoring_rules_scoring_method_check
    check (scoring_method in ('geometric', 'hybrid', 'custom')),
  add constraint league_scoring_rules_scoring_parameters_check
    check (jsonb_typeof(scoring_parameters_json) = 'object');

alter table public.league_scoring_rule_versions
  add constraint league_scoring_rule_versions_scoring_method_check
    check (scoring_method in ('geometric', 'hybrid', 'custom')),
  add constraint league_scoring_rule_versions_scoring_parameters_check
    check (jsonb_typeof(scoring_parameters_json) = 'object');

alter table public.league_scoring_policy_versions
  add constraint league_scoring_policy_versions_scoring_method_check
    check (scoring_method in ('geometric', 'hybrid', 'custom')),
  add constraint league_scoring_policy_versions_scoring_parameters_check
    check (jsonb_typeof(scoring_parameters_json) = 'object');
