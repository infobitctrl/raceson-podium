/*
 * Supabase installs pgcrypto in the extensions schema, while plain PostgreSQL
 * commonly installs it in public. The application functions use explicit
 * public.digest/public.gen_random_bytes references so their empty search_path
 * remains safe. Provide narrow wrappers only when pgcrypto lives in extensions.
 */
do $$
begin
  if to_regprocedure('public.digest(text,text)') is null
     and to_regprocedure('extensions.digest(text,text)') is not null then
    execute $function$
      create function public.digest(input text, algorithm text)
      returns bytea
      language sql
      immutable
      strict
      parallel safe
      set search_path = ''
      as 'select extensions.digest(input, algorithm)'
    $function$;
  end if;

  if to_regprocedure('public.digest(bytea,text)') is null
     and to_regprocedure('extensions.digest(bytea,text)') is not null then
    execute $function$
      create function public.digest(input bytea, algorithm text)
      returns bytea
      language sql
      immutable
      strict
      parallel safe
      set search_path = ''
      as 'select extensions.digest(input, algorithm)'
    $function$;
  end if;

  if to_regprocedure('public.gen_random_bytes(integer)') is null
     and to_regprocedure('extensions.gen_random_bytes(integer)') is not null then
    execute $function$
      create function public.gen_random_bytes(length integer)
      returns bytea
      language sql
      volatile
      strict
      parallel safe
      set search_path = ''
      as 'select extensions.gen_random_bytes(length)'
    $function$;
  end if;
end
$$;
revoke all on function public.digest(text, text) from public, anon, authenticated;
revoke all on function public.digest(bytea, text) from public, anon, authenticated;
revoke all on function public.gen_random_bytes(integer) from public, anon, authenticated;
grant execute on function public.digest(text, text) to service_role;
grant execute on function public.digest(bytea, text) to service_role;
grant execute on function public.gen_random_bytes(integer) to service_role;
