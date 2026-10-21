# Despliegue

Cómo subir App B20 a internet. Nada de esto crea cuentas ni cobra por sí solo: cada paso
que necesita una cuenta lo hace una persona del grupo.

## Qué va a dónde

| Pieza | Dónde | Por qué |
| --- | --- | --- |
| Base de datos en tiempo real (`packages/spacetime-module`) | SpacetimeDB **Maincloud** | Es el servicio administrado de los creadores de SpacetimeDB; se publica con la misma CLI que en local y tiene plan gratuito. |
| Web/PWA (`apps/web`) | **Cloudflare Pages** | Sirve la web estática con HTTPS y subdominio gratuito `*.pages.dev`; un dominio propio se compra aparte. |
| Backend (`apps/api`) | **Google Cloud Run** con `apps/api/Dockerfile` | Reúne Secret Manager, Cloud Storage y Gemini; el acceso se administra en SpacetimeAuth. Se apaga cuando no hay uso. |
| OpenMAIC | **Google Cloud Run**, servicio aparte con su imagen Docker | Decisión previa: contenedor propio en un subdominio propio, junto al backend. |
| Extensión (`apps/extension`) | Chrome Web Store | Pago único de registro de desarrollador. |
| Android (`apps/android`) | APK firmado (después Google Play) | Necesita el proyecto de Firebase para FCM. |

Con dominio propio quedaría, por ejemplo: `app.<dominio>` (web), `api.<dominio>` (backend) y
`maic.<dominio>` (OpenMAIC). Sin dominio todo funciona con las direcciones que da cada servicio
(`*.pages.dev`, `*.run.app`).

## Base de datos elegida

Los comandos de Maincloud de esta guía apuntan a **`app-b20-34245`**, la base indicada para
B20. Su identidad indicada es `c2006d3bbe49dc8cabbfa144282ee0af8edb84292d74f2e48128a0e0f4f626ba`. El nombre e
identidad de base son distintos al Client ID del cliente de SpacetimeAuth; este último se
obtiene en **SpacetimeAuth → Clients**.

En desarrollo local se puede conservar `app-b20` con el servidor `http://localhost:3000`.
No ejecutes una creación con `--template chat-react-ts` en este repositorio: la aplicación y el
módulo ya existen. El módulo B20 ya está publicado en esa base, con `auth_config` para
`client_034jL0AHYYQ1bps8SupHU0` y la primera invitación de administrador guardados. La variable temporal
para adoptar la base vacía ya se retiró. La web ya está publicada en
https://app-b20.pages.dev; la API aún no está alojada.

## Fase temporal: autenticación real y datos simulados

**SpacetimeAuth por enlace al correo, con `VITE_DATA_MODE=demo`.** Cualquier correo verificado
puede entrar a la interfaz temporal sin invitación. SpacetimeAuth se utiliza siempre, incluso
con `?demo`; una configuración ausente muestra un error y no habilita acceso sin sesión.
Google es opcional.

La simulación utiliza los ejemplos existentes, con perfiles y roles ficticios identificados
como tales. Ajustes muestra la cuenta autenticada real por separado. Los datos viven en
memoria por identidad: renovar la sesión los conserva; recargar, salir o cambiar de cuenta
los reinicia. No se guardan datos simulados en `localStorage` ni se abre una conexión a Maincloud.

El modo `VITE_DATA_MODE=spacetime` conserva SpacetimeProvider y MembershipGate para activar
posteriormente los datos reales con invitaciones. La base y la API mantienen sus controles de
membresía. Al migrar se conservarán las cuentas de SpacetimeAuth; los cambios de la simulación
no se importan automáticamente. Los detalles están en [`spacetimeauth.md`](spacetimeauth.md).

## Pendientes de la fase temporal

1. **Completar la primera prueba humana por correo.** Los callbacks están guardados; probar
   el enlace de SpacetimeAuth y el acceso de un correo verificado sin invitación en
   https://app-b20.pages.dev. Sigue la [guía de Cloudflare Pages](cloudflare-pages.md).
2. **Comprobar el aislamiento de la simulación.** Renovar la sesión conserva los cambios;
   recargar, cerrar sesión o cambiar de identidad los reinicia. No deben producirse conexiones
   ni escrituras a Maincloud. Las cuentas reales y los perfiles ficticios deben distinguirse.
3. **Antes de activar datos reales**, probar persistencia, privacidad, invitaciones y bajas
   con dos cuentas en `VITE_DATA_MODE=spacetime`. Esta restricción no se usa en la demo actual.
4. **IA, archivos y notificaciones.** La interfaz de IA/BYOK aún no conecta con la API. Su
   servicio, almacenamiento de claves, adjuntos y push requieren trabajo propio. No bloquean
   publicar la interfaz temporal.
5. **Otras presentaciones.** PWA instalada, extensión y APK necesitan pruebas en sus entornos
   reales y sus retornos de autenticación registrados antes de distribuirse.

## Pasos

### 0. Cuentas (una sola vez)

- Cuenta en Cloudflare para publicar la web.
- Proyecto en Google Cloud con facturación activada solo cuando se publique la API en Cloud Run.
- CLI de SpacetimeDB instalada y `spacetime login`.

### 1. Proyecto SpacetimeAuth

El proyecto y el cliente `client_034jL0AHYYQ1bps8SupHU0` ya existen. Ya están guardados los
retornos locales, `https://app-b20.pages.dev/auth/callback` y
`https://app-b20.pages.dev/auth/logout`, más los del enlace anterior `af0dd1ec.app-b20.pages.dev`
para conservar su acceso. Usa la URL estable; no registres cada hash nuevo ni comodines. El
correo debe estar verificado para la fase `demo`; la invitación solo se exige al activar
`spacetime`. Google es opcional para este piloto.

Sigue los detalles de [`spacetimeauth.md`](spacetimeauth.md). Si vas a distribuir la extensión o
Android, registra también sus retornos y client IDs correspondientes.

### 2. SpacetimeDB en Maincloud: preparado para la fase de datos reales

```sh
npm run spacetime:publish:maincloud
npm run spacetime:generate

# Ejecutar con la misma identidad de CLI que publicó la base:
spacetime call -s maincloud app-b20-34245 set_auth_config \
  '"https://auth.spacetimedb.com/oidc"' '["<client-id-web>","<client-id-extension>","<client-id-android>"]'
spacetime call -s maincloud app-b20-34245 invite_member '"tu-correo@gmail.com"' true
```

El script de Maincloud usa `--delete-data=never`; el script `spacetime:publish` sigue apuntando
a la base local `app-b20`. El módulo, `auth_config` y la primera invitación ya están preparados:
los comandos con placeholders se conservan como referencia para otra instalación. El caso de
adopción de una base vacía existente se explica en [SpacetimeAuth](spacetimeauth.md#actualizar-una-base-vacía-que-ya-existía);
la identidad propietaria de CLI es distinta a la identidad de base y al Client ID de auth.

Estos pasos no son necesarios para entrar a la simulación actual. Al activar
`VITE_DATA_MODE=spacetime`, la lista debe contener los client IDs usados y la persona debe
unirse con su correo invitado. Las demás invitaciones se administrarán desde Ajustes. La
identidad OIDC no es la identidad de la CLI que administra la base.

Variables del cliente: `VITE_SPACETIME_URI=wss://maincloud.spacetimedb.com` y
`VITE_SPACETIME_DB=app-b20-34245`. Las audiencias del módulo deben coincidir con `OIDC_AUDIENCE` del
backend. No se aceptan sesiones de otros proyectos aunque compartan el emisor de SpacetimeAuth.

### 3. Backend en Cloud Run

```sh
# Repositorio de imágenes (una sola vez)
gcloud artifacts repositories create b20 --repository-format=docker --location=us-central1
gcloud services enable secretmanager.googleapis.com run.googleapis.com cloudbuild.googleapis.com

# Cuenta de servicio del backend: solo puede manejar secretos que empiecen con `byok-`
gcloud iam service-accounts create b20-api
gcloud projects add-iam-policy-binding <proyecto> \
  --member serviceAccount:b20-api@<proyecto>.iam.gserviceaccount.com \
  --role roles/secretmanager.admin \
  --condition 'title=solo-byok,expression=resource.name.extract("secrets/{name}/").startsWith("byok-") || resource.type == "cloudresourcemanager.googleapis.com/Project"'

# Construir la imagen con apps/api/Dockerfile y desplegarla
gcloud builds submit --config apps/api/cloudbuild.yaml .
gcloud run deploy b20-api \
  --image us-central1-docker.pkg.dev/<proyecto>/b20/api \
  --service-account b20-api@<proyecto>.iam.gserviceaccount.com \
  --region us-central1 --allow-unauthenticated \
  --set-env-vars "^;^SECRET_STORE=gcp;GCP_PROJECT_ID=<proyecto>;OIDC_ISSUER=https://auth.spacetimedb.com/oidc;OIDC_AUDIENCE=<client-id-web>,<client-id-extension>,<client-id-android>;SPACETIMEDB_URI=https://maincloud.spacetimedb.com;SPACETIMEDB_MODULE=app-b20-34245;GEMINI_MODEL=<modelo>;CORS_ORIGINS=https://<web>,capacitor://localhost,https://localhost"
```

Cada alumno queda con un secreto `byok-<hash>` (sin su correo ni su id en el nombre). Al cambiar
su clave se destruye la versión anterior y al quitarla se borra el secreto. La condición del rol
deja crear secretos en el proyecto pero solo leer, cambiar o borrar los `byok-*`. Costo
aproximado: 0.06 USD al mes por secreto activo y 0.03 USD por cada 10 000 lecturas; el backend
recuerda cada clave 5 minutos para no leerla en cada generación.

`--allow-unauthenticated` solo abre la puerta de Cloud Run; cada ruta de `/ai` sigue exigiendo el
ID token de SpacetimeAuth y membresía activa en SpacetimeDB. `/health` responde `{"ok":true}`
para comprobar que quedó arriba.

### 4. Web en Cloudflare Pages

La web ya está publicada en **https://app-b20.pages.dev** con integración Git. El despliegue
del commit `59d17a7` terminó en **Success** y se comprobó la pantalla real de acceso de B20.
Los detalles están en [`cloudflare-pages.md`](cloudflare-pages.md). El subdominio gratuito no
requiere DNS ni Custom Domains.

- Repositorio `CodeZap47/AppB20`, rama de producción **`codex/pages-spacetimeauth`**. `main`
  conserva la versión anterior; no se fusiona automáticamente.
- Raíz `/`, comando `npm run build:pages`, salida `apps/web/dist`, preset **None**.
- Node.js `22` en `.nvmrc`.
- Variables públicas en **`wrangler.jsonc → vars`**, incluyendo `VITE_DATA_MODE=demo`.
  Edita ese archivo y envía el commit; las variables `VITE_*` del panel no sustituyen el archivo.
- `VITE_WEB_ORIGIN=https://app-b20.pages.dev` fija el dominio estable en modo `pages`; las
  nuevas compilaciones llevan los alias allí antes del login. Los callbacks permanecen vacíos
  y sus URLs exactas ya están guardadas en SpacetimeAuth. Los despliegues anteriores son
  inmutables. `VITE_API_URL` queda vacío mientras la API esté pendiente.
- Para compilar localmente, `.env.pages` se crea desde `.env.pages.example`; está ignorado por
  Git y no llega a Cloudflare.

El Worker `appb20` creado desde el flujo inicial con `npx wrangler deploy`, sin build y desde la
rama antigua no es el proyecto Pages preparado. La publicación correcta compila el monorepo y
sirve `apps/web/dist`. La guía explica este error y el fallo inicial por variables ausentes.
El ZIP local queda como alternativa para otro proyecto de subida directa; `app-b20` se
actualiza mediante Git.

### 5. OpenMAIC

Mismo patrón que el backend: su imagen en Artifact Registry y `gcloud run deploy b20-maic`, con
sus variables de su propia documentación. Agrega su dirección a lo que la app tenga configurado
para abrirlo.

### 6. Dominio (opcional)

El subdominio gratuito `*.pages.dev` ya sirve la web sin este paso. Si más adelante compras
un dominio propio, conecta `app.` en Pages y `api.` /
`maic.` en Cloud Run (*Domain mappings*), siguiendo las instrucciones DNS de cada servicio.
Después agrega los callbacks del nuevo dominio en SpacetimeAuth y actualiza `CORS_ORIGINS` y
`VITE_API_URL` cuando corresponda, y cambia `VITE_WEB_ORIGIN` al nuevo dominio estable. Las
nuevas compilaciones usarán ese origen para el login. Si se habilitó Google, su callback
federado sigue en SpacetimeAuth.
