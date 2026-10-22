-- casdrecords: solo autenticación. No crea tablas de dominio de B20.
-- Ejecutar como postgres y activar la función como Custom Access Token Hook.
-- No sustituir un hook existente sin incorporar primero su comportamiento.
begin;
create schema if not exists b20_auth;
revoke all on schema b20_auth from public, anon, authenticated;
grant usage on schema b20_auth to supabase_auth_admin;

create or replace function b20_auth.access_token_hook(event jsonb)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  claims jsonb := event -> 'claims';
  verified boolean;
begin
  -- No se confía en user_metadata.email_verified: el usuario puede editarlo.
  select exists (
    select 1 from auth.users u
    where u.id = (event ->> 'user_id')::uuid
      and u.email_confirmed_at is not null
      and lower(u.email) = lower(claims ->> 'email')
      and coalesce((claims ->> 'is_anonymous')::boolean, false) = false
  ) into verified;
  claims := jsonb_set(claims, '{email_verified}', to_jsonb(verified));
  return jsonb_set(event, '{claims}', claims);
end;
$$;

revoke all on function b20_auth.access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function b20_auth.access_token_hook(jsonb) to supabase_auth_admin;
commit;
