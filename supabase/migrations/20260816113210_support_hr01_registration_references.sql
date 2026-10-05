/*
 * Add a control-digit-protected option for registration-specific Croatian
 * payment references. Existing HR00 references remain unchanged.
 */

create or replace function public.build_hr01_registration_reference(p_base_value text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  base_value text := regexp_replace(p_base_value, '\D', '', 'g');
  checksum_sum integer := 0;
  weight integer := 2;
  remainder integer;
  control_digit integer;
begin
  if base_value !~ '^[0-9]{1,11}$' then
    raise exception using errcode = '22023', message = 'invalid_hr01_reference_base';
  end if;

  base_value := lpad(base_value, 11, '0');
  for digit_position in reverse length(base_value)..1 loop
    checksum_sum := checksum_sum + substring(base_value from digit_position for 1)::integer * weight;
    weight := weight + 1;
  end loop;

  remainder := checksum_sum % 11;
  control_digit := case when remainder in (0, 1) then 0 else 11 - remainder end;
  return base_value || control_digit::text;
end;
$$;

create or replace function public.apply_registration_payment_reference_model()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.payment_model = 'HR01' then
    new.reference_value := public.build_hr01_registration_reference(right(new.reference_value, 11));
  end if;
  return new;
end;
$$;

create trigger registration_payment_requests_apply_reference_model
before insert on public.registration_payment_requests
for each row execute function public.apply_registration_payment_reference_model();

alter table public.registration_payment_requests
add constraint registration_payment_requests_hr01_reference_check
check (
  payment_model <> 'HR01'
  or reference_value = public.build_hr01_registration_reference(left(reference_value, 11))
);

comment on column public.organization_bank_transfer_profiles.payment_model is
  'Supported organizer choices are HR00 (unique reference) and HR01 (unique reference with MOD 11 control digit).';

revoke all on function public.build_hr01_registration_reference(text)
from public, anon, authenticated;
revoke all on function public.apply_registration_payment_reference_model()
from public, anon, authenticated;

grant execute on function public.build_hr01_registration_reference(text) to service_role;
grant execute on function public.apply_registration_payment_reference_model() to service_role;
