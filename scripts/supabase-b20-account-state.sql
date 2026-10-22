-- casdrecords: estado de la cuenta para el acceso por pasos de B20.
-- Ejecutar como postgres. Solo lo llama el Worker de B20 con la clave secreta (service_role):
-- 'password' si la cuenta ya tiene contraseña, 'setup' si fue activada y aún no la crea,
-- 'none' si no existe. No devuelve ningún otro dato de la cuenta.
begin;

create or replace function public.b20_account_state(p_email text)
returns text
language sql stable security definer
set search_path = ''
as $$
  select case
    when u.id is null then 'none'
    when coalesce(u.encrypted_password, '') = '' then 'setup'
    else 'password'
  end
  from (select 1) as one
  left join auth.users u on lower(u.email) = lower(trim(p_email)) and u.deleted_at is null
  limit 1;
$$;

revoke all on function public.b20_account_state(text) from public, anon, authenticated;
grant execute on function public.b20_account_state(text) to service_role;
commit;
