# B20 en Cloudflare Pages

El proyecto **Pages `app-b20`** ya está creado y conectado al repositorio
`CodeZap47/AppB20`. La web ya está publicada en **https://app-b20.pages.dev**: el despliegue
`af0dd1ec-a2a9-4cf5-81c4-e27411ad5331`, correspondiente al commit `59d17a7`, terminó en
**Success** el 20 de octubre de 2026 y muestra la pantalla real de acceso de B20. El acceso
completo con una cuenta invitada aún requiere prueba. SpacetimeDB ya está publicado en
Maincloud como `app-b20-34245`; alojar la web no cambia esa base ni el acceso por invitación.

El subdominio `pages.dev` se entrega con HTTPS y no requiere comprar un dominio, configurar
DNS ni entrar a **Custom Domains**. El nombre del proyecto define la URL asignada por
[Pages](https://developers.cloudflare.com/pages/get-started/git-integration/).

## Configuración actual del proyecto

| Campo | Valor |
| --- | --- |
| Servicio | **Pages**, proyecto `app-b20` |
| Repositorio | `CodeZap47/AppB20` |
| Production branch | `codex/pages-spacetimeauth` |
| Framework preset | **None** |
| Root directory | `/`, raíz del repositorio |
| Build command | `npm run build:pages` |
| Build output directory | `apps/web/dist` |
| Node.js | `22`, indicado en `.nvmrc` |

La rama de producción es temporalmente `codex/pages-spacetimeauth` porque contiene la versión
avanzada preparada; `main` todavía contiene la versión anterior. Los cambios enviados a la
rama de producción disparan otro despliegue. No se fusionan automáticamente con `main`.
Cuando se decida adoptar esa versión en `main`, primero hay que integrar el código y después
cambiar la rama de producción de Pages. [Integración Git](https://developers.cloudflare.com/pages/get-started/git-integration/).

La carpeta local avanzada se llama `appb20-stdb`, pero es un repositorio independiente. No
pongas `appb20-stdb` ni `apps/web` en **Root directory**: `package.json`, `.nvmrc`,
`wrangler.jsonc` y los workspaces están en la raíz del repositorio remoto.
[Configuración de compilación](https://developers.cloudflare.com/pages/configuration/build-configuration/).

Para crear una instalación adicional desde la interfaz actual: **Workers & Pages → Create
application → Continue to Pages → Import Git → AppB20**. La opción **Continue to Pages** puede
aparecer marcada como “legacy”. El proyecto que sirve esta web es de Pages; un Worker creado
desde el flujo inicial usa otra configuración de despliegue.

## Variables públicas: editar `wrangler.jsonc`

Pages toma la configuración del archivo `wrangler.jsonc` como fuente de verdad. Las variables
públicas de compilación están en su objeto `vars`; para modificarlas, edita el archivo y envía
el cambio a la rama de producción. No hace falta duplicarlas en el panel.

| Variable en `vars` | Valor |
| --- | --- |
| `VITE_SPACETIME_URI` | `wss://maincloud.spacetimedb.com` |
| `VITE_SPACETIME_DB` | `app-b20-34245` |
| `VITE_SPACETIMEAUTH_AUTHORITY` | `https://auth.spacetimedb.com/oidc` |
| `VITE_SPACETIMEAUTH_CLIENT_ID` | `client_034jL0AHYYQ1bps8SupHU0` |
| `VITE_SPACETIMEAUTH_REDIRECT_URI` | `""` |
| `VITE_SPACETIMEAUTH_POST_LOGOUT_REDIRECT_URI` | `""` |
| `VITE_API_URL` | `""` mientras la API no esté desplegada |

El primer intento de compilación de Pages falló porque faltaban estas variables en
`wrangler.jsonc`: agregarlas únicamente al panel no las aportó al build que usa este archivo.
El commit `59d17a7` incorpora los valores públicos de B20 a `vars`; revisa el resultado de ese
commit o uno posterior en **Deployments**. El despliegue de `59d17a7` ya terminó en
**Success**. No se debe volver a una revisión anterior a ese cambio. [Configuración de Pages con Wrangler](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).

El Client ID y la dirección de la base son públicos. Ninguna variable `VITE_*` debe contener
un Client Secret, una clave de Gemini ni claves de administración. Vite incorpora estos valores
al compilar; después de cambiarlos, espera un nuevo despliegue. `VITE_API_URL` podrá apuntar a
la URL HTTPS real de la API cuando esté publicada y conectada con la interfaz.

Con los callbacks vacíos, B20 usa el origen del sitio abierto y añade `/auth/callback` o
`/auth/logout`. Se incluyen dos reglas explícitas en `_redirects` para esas rutas; Pages
resuelve el resto mediante su fallback de aplicación de una sola página. No agregues una regla
global `/* /index.html 200`: Wrangler la rechaza como un bucle.
[Fallback de Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/).

La compilación en modo `pages` rechaza URLs de producción que apunten a localhost y exige URI,
nombre de base y Client ID. `.env.pages` sirve para probar o compilar localmente, pero está
ignorado por Git y no llega a la compilación de Cloudflare.

## Registrar el dominio en SpacetimeAuth

**Pendiente confirmado:** al probar el acceso desde producción, SpacetimeAuth respondió
`invalid_redirect_uri` porque `https://app-b20.pages.dev/auth/callback` aún no está autorizado.
Los retornos locales sí funcionan. La web y sus rutas HTTPS ya responden correctamente; este
ajuste se hace en el cliente de autenticación.

Abre **SpacetimeAuth → Clients → `client_034jL0AHYYQ1bps8SupHU0`** y conserva los retornos
locales ya registrados. Para la URL estable del proyecto `app-b20`, agrega:

| Campo | Nueva dirección |
| --- | --- |
| Redirect URIs | `https://app-b20.pages.dev/auth/callback` |
| Post Logout Redirect URIs | `https://app-b20.pages.dev/auth/logout` |

Usa HTTPS, sin `#`, sin comodines y con la ruta exacta. No necesitas crear otro cliente ni
modificar `auth_config` para añadir el dominio al cliente existente. Si usas vistas previas,
registra únicamente URLs exactas de entornos que controles y necesites probar; para este piloto
usa la URL estable de producción.

El formulario actual ofrece acceso por correo. Google es opcional. La persona debe usar su
correo invitado y verificado, y completar el registro para obtener membresía; crear una cuenta
en SpacetimeAuth no concede acceso por sí solo. La primera invitación de administrador ya está
guardada. Más información en [SpacetimeAuth y acceso por invitación](spacetimeauth.md).

## Comprobar después de compilar

1. En **Pages → app-b20 → Deployments**, confirmar **Success** en el commit esperado y abrir
   la URL HTTPS estable.
2. Abrir directamente `/auth/callback` y `/auth/logout`: deben cargar B20 y manejar la ruta,
   en lugar de mostrar un 404 del hosting.
3. Iniciar sesión con el correo invitado, completar el perfil y recargar para comprobar la
   persistencia en Maincloud. Probar también cierre de sesión y nuevo acceso.
4. Verificar con una segunda cuenta que las invitaciones y la privacidad se mantienen; una
   cuenta sin invitación no debe poder unirse ni leer datos del grupo.

## Resolver los errores encontrados

### Worker creado desde el flujo inicial

El intento del Worker `appb20` usaba la rama antigua `main`, sin comando de compilación, y
`npx wrangler deploy` desde la raíz del monorepo. Esa configuración no construye ni publica
esta web de Pages. El proyecto preparado es **Pages `app-b20`**, con la rama y los campos de
la primera tabla. No uses `npx wrangler deploy` como comando de despliegue de este proyecto
Pages con integración Git; Cloudflare publica la carpeta `apps/web/dist` al terminar el build.

### Variables ausentes durante `build:pages`

Comprueba que el commit compilado contiene los siete valores públicos en `wrangler.jsonc →
vars`. Las variables `VITE_*` añadidas solo al panel no sustituyen esa configuración. Mantén
`.nvmrc` en la raíz con Node.js `22`; tras corregir el archivo y enviar el commit, revisa el
nuevo despliegue. No pongas una dirección local de API o callback en producción.

### `invalid_redirect_uri` al iniciar sesión

Comprueba las dos URLs HTTPS en el cliente de SpacetimeAuth, incluyendo `/auth/callback` y
`/auth/logout`. Los retornos de localhost no autorizan el dominio público. Con callbacks vacíos
en `vars`, la app enviará el dominio real desde el que se abre.

## Compilación y prueba local

Desde la raíz del repositorio avanzado:

```sh
npm ci
cp .env.pages.example .env.pages
npm run build:pages
npm run pages:dev
```

Si `.env.pages` ya contiene tus ajustes, consérvalo en vez de reemplazarlo. Su plantilla usa los
mismos valores públicos que `wrangler.jsonc`. Para cambiar un valor, mantén coherentes la
configuración remota en `vars` y la copia local según el entorno que quieras probar.

`artifacts/cloudflare-pages/app-b20-pages.zip` conserva una compilación local para subida
directa en **otro proyecto** si se necesita; contiene solo `apps/web/dist`, sin archivos de
entorno. El proyecto actual ya tiene integración Git y no acepta arrastrar un ZIP en el panel.
No es necesario crear otro proyecto ni usar el ZIP para actualizar `app-b20`.
[Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/).

El script `npm run pages:deploy` compila y publica con Wrangler usando la rama Git actual.
Para actualizar producción manualmente, ejecútalo desde `codex/pages-spacetimeauth` con acceso
a tu cuenta de Cloudflare. Otras ramas generan vistas previas. El flujo habitual del proyecto
es enviar los cambios a su rama de producción en GitHub.

La web puede publicarse mientras se completan las funciones pendientes. La interfaz de IA/BYOK
aún no conecta con la API; el alojamiento de la API, archivos y envío de notificaciones push
requieren trabajo propio. Publicar la web en Pages no activa esos servicios automáticamente.

Fuentes oficiales consultadas el 20 de octubre de 2026; los enlaces de cada apartado respaldan
las opciones y campos del servicio.
