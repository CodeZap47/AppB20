# Despliegue

Cómo subir App B20 a internet. Nada de esto crea cuentas ni cobra por sí solo: cada paso
que necesita una cuenta lo hace una persona del grupo.

## Qué va a dónde

| Pieza | Dónde | Por qué |
| --- | --- | --- |
| Base de datos en tiempo real (`packages/spacetime-module`) | SpacetimeDB **Maincloud** | Es el servicio administrado de los creadores de SpacetimeDB; se publica con la misma CLI que en local y tiene plan gratuito. |
| Web/PWA (`apps/web`) | **Cloudflare Pages** | Es un sitio estático (rutas hash, sin servidor). Gratis, HTTPS y dominio propio incluidos. |
| Backend (`apps/api`) | **Google Cloud Run** con `apps/api/Dockerfile` | Vive en el mismo proyecto de Google Cloud que el inicio de sesión, Secret Manager, Cloud Storage y Gemini. Se apaga cuando no hay uso. |
| OpenMAIC | **Google Cloud Run**, servicio aparte con su imagen Docker | Decisión previa: contenedor propio en un subdominio propio, junto al backend. |
| Extensión (`apps/extension`) | Chrome Web Store | Pago único de registro de desarrollador. |
| Android (`apps/android`) | APK firmado (después Google Play) | Necesita el proyecto de Firebase para FCM. |

Con dominio propio quedaría, por ejemplo: `app.<dominio>` (web), `api.<dominio>` (backend) y
`maic.<dominio>` (OpenMAIC). Sin dominio todo funciona con las direcciones que da cada servicio
(`*.pages.dev`, `*.run.app`).

## Autenticación

**Iniciar sesión con Google (OIDC)** y la lista de invitaciones del módulo. Es lo que ya validan
el módulo (`verifiedEmail` en `packages/spacetime-module/src/index.ts`) y el backend
(`requireAuth` en `apps/api/src/lib/auth.ts`):

1. La app obtiene un *ID token* de Google.
2. Ese mismo token se usa para conectarse a SpacetimeDB (`withToken`) y como `Bearer` al backend.
3. SpacetimeDB acepta tokens OIDC de cualquier emisor, así que no hace falta otro servicio de
   cuentas; el módulo solo deja entrar correos verificados que estén invitados.

No se guardan contraseñas en ningún lado. Cada presentación necesita su propio *client ID* en
Google Cloud (Web, extensión de Chrome y Android), así que la audiencia debe aceptar los tres.
El token de Google dura una hora: la app tiene que renovarlo en silencio.

## Lo que falta antes del primer despliegue real

1. **Conectar la app a SpacetimeDB.** Hoy la interfaz usa `DemoDataSource` (datos de prueba en
   memoria). Si se despliega así, cada quien ve la demo y nada se guarda. Falta la
   implementación de `DataSource` sobre `SpacetimeDBProvider`.
2. **Botón de inicio de sesión con Google** en la web (Google Identity Services) y renovación del
   token.
3. **Guardar las claves BYOK fuera de la memoria.** `EncryptedMemoryStore` las pierde cada vez que
   el contenedor se reinicia, y Cloud Run reinicia seguido. Antes de producción hay que usar
   Secret Manager (o guardarlas cifradas en una base) como dice la arquitectura.
4. **Validar la audiencia en el módulo** (el `TODO(Etapa 0)` de `verifiedEmail`).

La web sí se puede subir ya como demo pública para enseñarla al grupo.

## Pasos

### 0. Cuentas (una sola vez)

- Proyecto en Google Cloud con facturación activada (Cloud Run lo pide aunque se quede en la
  capa gratuita).
- Cuenta en Cloudflare.
- CLI de SpacetimeDB instalada y `spacetime login`.

### 1. Google: client ID de OAuth

En Google Cloud Console → *APIs y servicios* → *Pantalla de consentimiento de OAuth* (tipo
externo) → *Credenciales* → *ID de cliente de OAuth* tipo **Aplicación web**. En *Orígenes de
JavaScript autorizados* agrega `http://localhost:5173` y la dirección pública de la web
(`https://<proyecto>.pages.dev` o tu dominio). Ese ID va en `VITE_GOOGLE_CLIENT_ID` y en
`OIDC_AUDIENCE`.

### 2. SpacetimeDB en Maincloud

Antes de publicar, pon el *client ID* en `GOOGLE_CLIENT_IDS` de
`packages/spacetime-module/src/index.ts`. El módulo rechaza cualquier token de Google emitido para
otra app, así que sin ese valor nadie puede entrar.

```sh
spacetime publish -s maincloud --project-path packages/spacetime-module app-b20
npm run spacetime:generate

# Quien publica queda como dueño con la identidad de la CLI, no con su cuenta de Google.
# Por eso la primera invitación (la tuya, como creador) se hace una vez desde la terminal:
spacetime call -s maincloud app-b20 invite_member '"tu-correo@gmail.com"' true
```

Después entras a la web con ese correo, te unes al grupo y las demás invitaciones se hacen desde
Ajustes. Del lado del cliente: `VITE_SPACETIME_URI=wss://maincloud.spacetimedb.com` y
`VITE_SPACETIME_DB=app-b20`.

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
  --set-env-vars "^;^SECRET_STORE=gcp;GCP_PROJECT_ID=<proyecto>;OIDC_AUDIENCE=<client-id>;GEMINI_MODEL=<modelo>;CORS_ORIGINS=https://<web>,capacitor://localhost,https://localhost"
```

Cada alumno queda con un secreto `byok-<hash>` (sin su correo ni su id en el nombre). Al cambiar
su clave se destruye la versión anterior y al quitarla se borra el secreto. La condición del rol
deja crear secretos en el proyecto pero solo leer, cambiar o borrar los `byok-*`. Costo
aproximado: 0.06 USD al mes por secreto activo y 0.03 USD por cada 10 000 lecturas; el backend
recuerda cada clave 5 minutos para no leerla en cada generación.

`--allow-unauthenticated` solo abre la puerta de Cloud Run; cada ruta de `/ai` sigue exigiendo el
token de Google. `/health` responde `{"ok":true}` para comprobar que quedó arriba.

### 4. Web en Cloudflare Pages

*Workers & Pages* → *Create* → *Pages* → conectar el repo `codezap47/appb20`:

- Comando de compilación: `npm run build:web`
- Carpeta de salida: `apps/web/dist`
- Variables: `NODE_VERSION=22`, `VITE_SPACETIME_URI`, `VITE_SPACETIME_DB`, `VITE_API_URL` (la
  dirección de Cloud Run), `VITE_GOOGLE_CLIENT_ID`, `VITE_VAPID_PUBLIC_KEY`.

Cada push a `main` vuelve a publicar; cada PR recibe su propia dirección de vista previa.

### 5. OpenMAIC

Mismo patrón que el backend: su imagen en Artifact Registry y `gcloud run deploy b20-maic`, con
sus variables de su propia documentación. Agrega su dirección a lo que la app tenga configurado
para abrirlo.

### 6. Dominio (opcional)

Compra el dominio donde prefieras, pon sus DNS en Cloudflare, y conecta `app.` en Pages y `api.` /
`maic.` en Cloud Run (*Domain mappings*). Luego actualiza los orígenes autorizados de Google,
`CORS_ORIGINS` y `VITE_API_URL`.
