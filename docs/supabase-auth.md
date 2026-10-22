# Supabase Auth + SpacetimeDB en B20

Proyecto autorizado: **casdrecords**, referencia `tgtvvbqlmlljuufrutbk`.

Supabase solo gestiona credenciales, confirmación de correo, recuperación y sesiones.
Los perfiles, membresías, permisos, trabajos, archivos, calendario y mensajes permanecen
en el módulo de SpacetimeDB. B20 no consulta tablas de dominio de Supabase.

## Configuración realizada el 22 de octubre de 2026

- SQL aprobado aplicado mediante el plugin Supabase como `b20_auth_verified_email_hook`.
- Hook `b20_auth.access_token_hook` habilitado en Authentication → Auth Hooks, con aprobación explícita.
- Retorno exacto `http://localhost:5173/auth/callback` registrado, con aprobación explícita.
- Site URL existente `http://localhost:3000` conservada.
- Descubrimiento OIDC comprobado: `https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1/.well-known/openid-configuration`.
- JWKS comprobado: `https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1/.well-known/jwks.json`, clave ES256.
- API pública de configuración: email habilitado, registro habilitado, confirmación de correo requerida;
  Google, GitHub, teléfono y acceso anónimo deshabilitados.
- `.env.local` usa Supabase Auth con la clave publishable pública obtenida del proyecto.
  El preview actual usa `VITE_DATA_MODE=spacetime`, `wss://maincloud.spacetimedb.com` y `app-b20-34245`.
- No se publicó el módulo en Maincloud, no se cambió su proveedor de producción ni se vincularon cuentas reales.
- No se hicieron commits, push ni despliegues de Cloudflare.

El plugin permite SQL y consultar el proyecto, pero no editar los ajustes de Auth.
La activación del hook y el retorno se completaron en el panel. El SQL fuente reproducible
está en `scripts/supabase-b20-auth.sql`.

## Correo verificado

El hook calcula el claim **de primer nivel** `email_verified` a partir de `auth.users.email_confirmed_at`
y exige que el correo del token coincida con el correo confirmado. Nunca autoriza usando
`user_metadata.email_verified`, editable por la persona.

La función es `SECURITY INVOKER`, con `search_path` vacío, en el esquema privado `b20_auth`.
Solo `supabase_auth_admin` recibe USAGE/EXECUTE. Se comprobaron esos privilegios y la
ausencia de EXECUTE para `anon` y `authenticated`; metadatos falsificados no verifican una cuenta.

## Cliente

```dotenv
VITE_AUTH_PROVIDER=supabase
VITE_SUPABASE_URL=https://tgtvvbqlmlljuufrutbk.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_SUPABASE_OAUTH_PROVIDERS=
VITE_SUPABASE_PASSKEYS_ENABLED=false
```

Se usa `@supabase/supabase-js` **2.118.0**, fijado en package.json y package-lock.json.
Solo se aceptan claves `sb_publishable_` en el cliente; nunca claves secret/service_role.
La biblioteca administra refresh tokens, PKCE y eventos de sesión. El almacenamiento respeta
«Mantener mi sesión iniciada», elimina copias antiguas y permite cerrar la sesión local
incluso si falla la red. La renovación reemplaza el token utilizado por la conexión SpacetimeDB.

### Acceso sin registro abierto

Nadie crea su propia cuenta. **Invitar a alguien en B20 es lo que lo activa**, y el acceso va por pasos:

1. La persona escribe su correo y pulsa **Continuar**. La web pregunta al Worker de IA
   (`POST /auth/account/state`) en qué estado está esa cuenta:
   - `password`: ya tiene contraseña; se le pide la contraseña.
   - `setup`: está activada y aún no la crea. Se le envía un código de 6 dígitos.
   - `inactive`: no tiene cuenta ni invitación pendiente; se le pide que solicite acceso.
2. Si la cuenta no existe en Supabase, el Worker consulta al módulo con `auth_activation_check`
   (solo la identidad técnica de notificaciones puede llamarlo). Si el correo tiene una invitación
   pendiente, crea la cuenta con la API administrativa de Supabase y responde `setup`.
3. Tras confirmar el código, la contraseña es **obligatoria**: la app muestra "Crea tu contraseña"
   hasta guardarla. El código usa `shouldCreateUser: false`, así que nunca crea cuentas.
4. Si las passkeys están habilitadas, justo después se ofrece añadir una; se puede omitir.
5. "Olvidé mi contraseña" reutiliza el código y vuelve a pedir una contraseña nueva.

La marca `user_metadata.b20_password` solo decide qué pantalla mostrar; la autorización sigue
siendo el correo verificado por el hook y la membresía en SpacetimeDB.

Configuración necesaria antes de usarlo en producción:

- Ejecutar `scripts/supabase-b20-account-state.sql` como `postgres`. Crea `public.b20_account_state`,
  ejecutable solo por `service_role`.
- En **Authentication → Sign In / Providers**, desactivar **Allow new users to sign up**.
- En **Authentication → Emails → Magic Link**, usar el asunto «Tu código para entrar a B20» y pegar
  como cuerpo `docs/email/supabase-magic-link.html`, que lleva `{{ .Token }}` con el diseño de la
  edición Campus. Se regenera desde `apps/api/src/email/accessCode.ts` con
  `npm run email:templates -w @b20/api`; una prueba falla si el archivo queda desactualizado.
  La estrella del encabezado se sirve desde `https://b20.mx/email/estrella.png`
  (`apps/web/public/email/`), así que aparece cuando esa versión de la web esté publicada.
- Guardar la clave `sb_secret_…` como secreto del Worker de IA. Nunca va en el cliente:

  ```sh
  npx wrangler secret put SUPABASE_SECRET_KEY --config apps/api/wrangler.ai.jsonc
  ```

- Publicar el módulo (añade `auth_activation_check`) y desplegar el Worker de IA.

El Worker no limita todavía cuántas consultas de estado recibe; la respuesta revela si un correo
está activado. Si hiciera falta, añadir una regla de rate limiting de Cloudflare a esa ruta.

Google/GitHub solo aparecen al configurar `VITE_SUPABASE_OAUTH_PROVIDERS`; no están habilitados
en casdrecords. Las passkeys están preparadas detrás de una bandera y requieren habilitar/configurar
su RP ID y origins en Supabase. Su UI se ofrece solo en la web con WebAuthn; el APK necesita
la integración nativa correspondiente. No se cambió esa configuración ni se registraron credenciales.

Android conserva `mx.b20.app://auth/callback`; OAuth de extensión usa el retorno exacto
de `chrome.identity`. Esos retornos deben registrarse antes de usar esos flujos. El código,
la contraseña y su recuperación no requieren un navegador externo ni un retorno registrado.

Antes de activar a compañeros, comprobar el SMTP del proyecto: el servicio de correo
predeterminado de Supabase tiene restricciones de destinatarios y de envío. No se enviaron correos
de prueba ni se crearon cuentas reales durante esta integración.

## Cambio de producción y conservación de cuentas

1. Publicar el módulo compatible con `--delete-data=never` y mantener al propietario técnico actual.
2. Identificar la membresía original y la identidad de conexión nueva de cada cuenta mediante un
   proceso de recuperación verificado. **No usar nombres o metadatos editables como prueba.**
3. El propietario llama `link_auth_identity(sessionIdentity, memberIdentity)` para cada cuenta aprobada.
   No permite fusionar dos miembros, cambiar un vínculo existente, crear cadenas ni vincular el owner técnico.
   `unlink_auth_identity` revoca un vínculo explícitamente.
4. El propietario configura `set_supabase_auth` con issuer `https://tgtvvbqlmlljuufrutbk.supabase.co/auth/v1`,
   audiencia `authenticated` y `enabled=true`. Usa la fila adicional 1, conservando el proveedor
   anterior en la fila 0 para los miembros que todavía no han migrado. Registrar primero el
   retorno HTTPS exacto de la web final. Se puede revocar la fila adicional con `enabled=false`.
5. Ajustar los Workers: `OIDC_ISSUER` al issuer anterior, `OIDC_AUDIENCE=authenticated`,
   `OIDC_JWKS_URI` al JWKS anterior. La API valida firma RS256/ES256, issuer, audiencia,
   vencimiento, correo verificado y membresía activa en cada solicitud.
6. Activar `VITE_AUTH_PROVIDER=supabase` en el build de producción, publicar el cliente y
   reconectar los clientes existentes. Verificar login y permisos antes de retirar el flujo anterior;
   al finalizar la transición, `set_auth_config` puede sustituir el proveedor principal por Supabase.

### Obtener la identidad nueva de cada miembro

SpacetimeDB deriva la identidad del token con `Identity::from_claims(iss, sub)`. Con Supabase,
`sub` es el **User UID** de la cuenta, así que el propietario puede calcular la identidad sin
pedírsela a la persona ni confiar en datos que ella pueda editar.
`scripts/supabase-identity.mjs` replica esa derivación. Se verificó el 22 de octubre de 2026:
con el `iss` y el `sub` del token de la CLI produce exactamente la identidad que muestra
`spacetime login show`.

1. Activa su cuenta en Supabase antes de que entre. Los miembros actuales no tienen invitación
   pendiente, así que el Worker no los activa solo: en **Authentication → Users → Add user →
   Create new user**, usa su correo, una contraseña temporal que no compartas y **Auto Confirm**.
   No la invites en B20: con una invitación pendiente, `join_group` le crearía otra membresía.
2. En esa misma lista, copiar su **User UID**.
3. Confirmar con la persona, por un canal que ya conozcas, que ese correo es suyo. El nombre
   visible del miembro no sirve como prueba: lo edita cada quien.
4. Listar las membresías activas y elegir la suya:

   ```sh
   spacetime sql -s maincloud app-b20-34245 "SELECT identity, display_name FROM member WHERE status = 'active'"
   ```

5. Generar el comando y ejecutarlo tras revisarlo:

   ```sh
   npm run spacetime:supabase-identity -- <user-uid> --member <identidad-del-miembro>
   ```

El script no llama a Maincloud. Si te equivocas de miembro, `unlink_auth_identity` con la
identidad de sesión revoca el vínculo.

**Vincular antes de que la persona se una por su cuenta.** Si hay una invitación pendiente con
su correo, `join_group` crearía una membresía nueva para la identidad de Supabase, y después
`link_auth_identity` la rechazaría por no poder fusionar membresías. Antes del cambio, revoca
con `revoke_invitation` las invitaciones de personas que ya son miembros.

Una vez vinculada, la persona escribe su correo en la web; como su cuenta ya tiene la contraseña
temporal, usa **Olvidé mi contraseña**, confirma el código y crea la suya.

La tabla privada `auth_identity_link` conserva la identidad de dominio antigua. Los reducers,
procedures y vistas resuelven la identidad de miembro de forma consistente para preservar
autoría, progreso, mensajes privados y claves de IA. Las credenciales del propietario técnico
permanecen separadas. El cliente requiere la vista propia `my_auth_identity` para reconocer un
vínculo; una caché de otra cuenta nunca basta para aceptar su membresía.

## Validación

- Suite completa: **1,550 pruebas**, incluyendo sesiones, claims falsificados, ES256 y vinculación.
- Typecheck de todos los workspaces aprobado.
- Build web, extensión y Workers en dry-run aprobado.
- Smoke de servidor SpacetimeDB real y aislado: vinculación, autoría e historial de mensajes,
  privacidad, reinicio y revocación de membresía. Ejecutar con `npm run test:spacetime:auth`.
- No se completó login con una cuenta real; requiere que su titular introduzca sus credenciales.
- Revisión visual de localhost pendiente: se denegó acceso del navegador a ese origen.

## Limpieza de la aplicación anterior, autorizada por el propietario

El 22 de octubre de 2026 se aplicó mediante el plugin la migración
`reset_legacy_schema_for_b20_auth_only`, con autorización explícita de eliminar la base anterior.
El SQL reproducible está en `scripts/supabase-reset-for-b20.sql`.

Se eliminaron las **19 tablas, 5 vistas, 11 funciones y 4 enums** del esquema `public`,
junto con sus datos, índices, constraints, triggers y permisos. El esquema se recreó vacío,
sin acceso para `anon` ni `authenticated`: B20 utiliza Supabase únicamente para Auth.
Se conservaron los esquemas administrados por Supabase, el historial de migraciones y el
hook privado `b20_auth.access_token_hook`. No había usuarios ni sesiones de Auth ni Edge Functions.

Verificación remota posterior: cero relaciones, funciones y tipos personalizados en `public`;
cero usuarios y sesiones; permisos del hook correctos y metadatos falsificados rechazados.
Los [advisors de seguridad](https://supabase.com/dashboard/project/tgtvvbqlmlljuufrutbk/advisors/security)
devolvieron **cero hallazgos**: los objetos inseguros de la aplicación anterior ya no existen.

**Storage conservado por decisión del usuario:** permanece el bucket privado `client-documents`, con un PDF de muestra
de 2,320 bytes. Tras los bloqueos del navegador, el usuario indicó expresamente dejar el bucket.
La limpieza se considera terminada con esa excepción; no se debe volver a intentar eliminarlo.

## Preview con datos reales

El servidor de desarrollo se inició en `http://localhost:5173/`, con `.env.local` apuntando
a Maincloud `app-b20-34245` y `VITE_DATA_MODE=spacetime`. No se usa la entrada de diseño ni fixtures.
La base publicada se inspeccionó de forma anónima y todavía carece de `my_auth_identity`,
`my_onboarding` y `typing_presence`; requiere publicar el módulo compatible antes de conectar
el frontend nuevo. El login de la CLI se inició con `--no-browser` y está pendiente de que
el propietario complete el acceso. No se ha publicado ni cambiado la configuración de Maincloud.
Supabase no tenía usuarios registrados al iniciar esta solicitud: cada titular debe crear o
iniciar su cuenta y confirmar el correo; la membresía y las vinculaciones las autoriza el propietario.
