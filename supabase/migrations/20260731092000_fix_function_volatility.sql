/*
 * Match function volatility declarations to the operations used in their
 * bodies. Incorrect declarations can let PostgreSQL cache or reorder calls
 * under assumptions that are not true.
 */

alter function public.service_apply_analytics_export_filters(jsonb, jsonb)
  stable;

alter function public.service_render_analytics_export(jsonb, text[], text, jsonb)
  stable;

alter function public.service_get_branding_workspace(uuid, uuid)
  volatile;
