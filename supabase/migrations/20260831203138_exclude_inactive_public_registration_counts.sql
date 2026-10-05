do $migration$
declare
  function_definition text;
  old_count text := $old$    count(*)::integer as registered_count,$old$;
  new_count text := $new$    count(*) filter (
      where r.status in ('pending', 'confirmed')
    )::integer as registered_count,$new$;
  replacement_count integer;
begin
  select pg_get_functiondef('public.public_registration_counts(uuid[])'::regprocedure)
  into function_definition;

  if strpos(function_definition, new_count) > 0 then
    return;
  end if;

  replacement_count := (
    length(function_definition) - length(replace(function_definition, old_count, ''))
  ) / length(old_count);
  if replacement_count <> 1 then
    raise exception 'Expected one public registration total expression, found %', replacement_count;
  end if;

  execute replace(function_definition, old_count, new_count);
end
$migration$;

comment on function public.public_registration_counts(uuid[]) is
  'Returns public per-category totals. registered_count includes active pending and confirmed registrations only; inactive rows remain available for audit without appearing in event totals.';
