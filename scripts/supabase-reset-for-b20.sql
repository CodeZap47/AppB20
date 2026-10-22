-- DESTRUCTIVO. Proyecto autorizado: casdrecords / tgtvvbqlmlljuufrutbk.
-- Elimina el dominio de la aplicación anterior; conserva Supabase y el Auth de B20.
-- Los archivos/buckets deben eliminarse mediante Storage, nunca borrando sus filas SQL.
begin;

do $$
begin
  if to_regprocedure('b20_auth.access_token_hook(jsonb)') is null then
    raise exception 'Falta el hook de B20; verifica el proyecto antes de continuar.';
  end if;
  if exists (select 1 from pg_extension where extnamespace = 'public'::regnamespace) then
    raise exception 'Hay extensiones en public; revisar antes de eliminar el esquema.';
  end if;
  if exists (
    select 1 from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal and p.pronamespace = 'public'::regnamespace
      and c.relnamespace <> 'public'::regnamespace
  ) then
    raise exception 'Hay triggers externos dependientes de public; revisar antes de continuar.';
  end if;
end;
$$;

drop schema public cascade;
create schema public authorization postgres;
comment on schema public is 'Reserved. B20 uses Supabase Auth; application data lives in SpacetimeDB.';
revoke all on schema public from public, anon, authenticated;
grant all on schema public to postgres, service_role;

commit;
