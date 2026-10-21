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
para adoptar la base vacía ya se retiró. La web y el backend aún no están alojados.

## Autenticación

**SpacetimeAuth con acceso por correo e invitación.** Google es un proveedor opcional. El cliente recibe un ID
token de SpacetimeAuth, lo usa en la conexión a SpacetimeDB y lo envía como `Bearer` al backend.
La base comprueba emisor, audiencias y correo verificado al unirse; sus vistas y acciones
requieren membresía activa. El backend comprueba firma, emisor, audiencia y membresía mediante
el reducer `assert_active_member`.

La guía completa del panel, los callbacks de las tres presentaciones y la invitación inicial está
en [`spacetimeauth.md`](spacetimeauth.md). La app solo recibe client IDs públicos. Si se habilita
Google, su client secret se guarda únicamente en el proveedor de SpacetimeAuth.

## Pendientes para publicar el piloto

1. **Publicar la web y registrar sus callbacks HTTPS.** Los callbacks locales ya están
   guardados y el formulario de correo abre sin error. La primera invitación de administrador
   está guardada; completar el acceso con esa cuenta sigue pendiente. Sigue la
   [guía de Cloudflare Pages](cloudflare-pages.md).
2. **Probar la base publicada.** `auth_config` ya tiene el emisor y client ID correctos. Faltan las
   pruebas con dos usuarios, persistencia, privacidad, rechazo de no invitados y bajas.
3. **Integrar y publicar la API de IA.** La interfaz de IA/BYOK todavía no conecta con la API.
   Para habilitarla, configurar el servicio y Secret Manager en Cloud Run;
   `SECRET_STORE=memory` pierde las claves cuando el proceso se reinicia. Los adjuntos y push
   también requieren servicios pendientes. Ninguno bloquea alojar la web estática en Pages.
4. **Probar las presentaciones reales.** HTTPS y PWA instalada, extensión con su ID definitivo
   y APK firmado con retorno del navegador. Registrar todos sus client IDs en módulo y API.

La demo explícita permite revisar la interfaz con datos de prueba; no equivale al entorno real.

## Pasos

### 0. Cuentas (una sola vez)

- Cuenta en Cloudflare para publicar la web.
- Proyecto en Google Cloud con facturación activada solo cuando se publique la API en Cloud Run.
- CLI de SpacetimeDB instalada y `spacetime login`.

### 1. Proyecto SpacetimeAuth

El proyecto y el cliente `client_034jL0AHYYQ1bps8SupHU0` ya existen. Los retornos locales
están guardados y el formulario de acceso por correo abre sin error. Conserva esos retornos y,
cuando Pages muestre la dirección asignada, agrega `https://<web>/auth/callback` y
`https://<web>/auth/logout` en sus campos correspondientes. El correo debe estar verificado e
invitado para unirse a B20. Google es opcional; no hace falta configurarlo para este piloto.

Sigue los detalles de [`spacetimeauth.md`](spacetimeauth.md). Si vas a distribuir la extensión o
Android, registra también sus retornos y client IDs correspondientes.

### 2. SpacetimeDB en Maincloud

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

Si solo publicas la web, registra únicamente su client ID en la lista. Después entras a la web
con ese correo, te unes al grupo y las demás invitaciones se hacen desde Ajustes. La identidad
OIDC no es la identidad de la CLI que administra la base.

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

La preparación concreta, el ZIP para subir y los valores del panel están en
[`cloudflare-pages.md`](cloudflare-pages.md). El subdominio gratuito se asigna al crear el
proyecto: `app-b20.pages.dev` es el nombre propuesto y depende de su disponibilidad. No requiere
DNS ni Custom Domains.

- Compilación local: `npm run build:pages`, con `.env.pages` creado desde `.env.pages.example`.
- Subida directa: `artifacts/cloudflare-pages/app-b20-pages.zip`, que contiene solo la web
  compilada. El panel no vuelve a compilar un ZIP.
- Alternativa Git: repositorio `CodeZap47/AppB20`, raíz del repositorio sin subcarpeta,
  comando `npm run build:pages`, salida `apps/web/dist`, preset **None** y `NODE_VERSION=22`.
- Dejar vacías o sin definir las variables de callback: la app las deriva del origen HTTPS
  desde el que se abre. Registrar esas direcciones exactas en SpacetimeAuth.
- `VITE_API_URL` puede quedar vacío mientras la API esté pendiente. No usar una URL local
  para un despliegue público.

Elige antes de crear el proyecto si usarás subida directa o integración Git: un proyecto de
Direct Upload no se convierte después en un proyecto con integración Git. Los cambios locales
requieren commit y push antes de que Cloudflare pueda compilarlos desde Git.

### 5. OpenMAIC

Mismo patrón que el backend: su imagen en Artifact Registry y `gcloud run deploy b20-maic`, con
sus variables de su propia documentación. Agrega su dirección a lo que la app tenga configurado
para abrirlo.

### 6. Dominio (opcional)

El subdominio gratuito `*.pages.dev` ya sirve la web sin este paso. Si más adelante compras
un dominio propio, conecta `app.` en Pages y `api.` /
`maic.` en Cloud Run (*Domain mappings*), siguiendo las instrucciones DNS de cada servicio.
Después agrega los callbacks del nuevo dominio en SpacetimeAuth y actualiza `CORS_ORIGINS` y
`VITE_API_URL` cuando corresponda. Con callbacks vacíos en el modo `pages`, la web deriva el
retorno del dominio actual. Si se habilitó Google, su callback federado sigue en SpacetimeAuth.
