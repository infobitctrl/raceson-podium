create or replace function public.publish_result_run_atomically(
  target_event_category_id uuid,
  target_result_run_id uuid,
  target_publication_state public.publication_state,
  target_published_by_user_id uuid,
  target_change_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  latest_publication_id uuid;
  created_publication_id uuid;
begin
  perform 1
  from public.event_categories
  where id = target_event_category_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'category_not_found';
  end if;

  if not exists (
    select 1
    from public.result_runs
    where id = target_result_run_id
      and event_category_id = target_event_category_id
      and status = 'succeeded'
  ) then
    raise exception using errcode = 'P0001', message = 'successful_result_run_required';
  end if;

  select id into latest_publication_id
  from public.result_publications
  where event_category_id = target_event_category_id
  order by published_at desc, created_at desc, id desc
  limit 1;

  if target_publication_state = 'corrected' and latest_publication_id is null then
    raise exception using errcode = 'P0001', message = 'correction_requires_previous_publication';
  end if;

  insert into public.result_publications (
    event_category_id,
    result_run_id,
    publication_state,
    published_by_user_id,
    supersedes_publication_id,
    change_note
  ) values (
    target_event_category_id,
    target_result_run_id,
    target_publication_state,
    target_published_by_user_id,
    latest_publication_id,
    target_change_note
  )
  returning id into created_publication_id;

  update public.result_rows
  set result_status = case
    when target_publication_state = 'corrected' then 'corrected'::public.result_status
    when target_publication_state = 'official' then 'official'::public.result_status
    else 'provisional'::public.result_status
  end
  where result_run_id = target_result_run_id;

  return created_publication_id;
end;
$$;
