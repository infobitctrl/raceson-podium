-- Default portal replay must not acquire the testnet reward schema or RPCs.
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'app_private') and c.relname like 'reward\_%' escape '\'
  ) or exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app_private') and p.proname like '%reward\_%' escape '\'
  ) then
    raise exception 'Production migration replay contains isolated reward objects';
  end if;
end
$$;
