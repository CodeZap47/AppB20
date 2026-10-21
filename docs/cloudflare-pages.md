# B20 en Cloudflare Pages

El proyecto **Pages `app-b20`** ya está creado y conectado al repositorio
`CodeZap47/AppB20`. La web está publicada en **https://app-b20.pages.dev**. El historial de
**Deployments** identifica cada publicación y el commit que sirve el dominio estable. El acceso
por enlace al correo y la visualización de datos de prueba se confirmaron el 20 de octubre
de 2026. También se comprobó que Ajustes separa la cuenta real de los perfiles simulados.
La configuración temporal
usa autenticación real y datos simulados, sin invitaciones ni conexiones a Maincloud. Los
retornos de producción ya están
guardados en SpacetimeAuth. La URL recomendada para entrar y compartir es siempre
**https://app-b20.pages.dev**. SpacetimeDB ya está publicado en
Maincloud como `app-b20-34245`, reservado para el modo de datos reales con invitaciones;
`VITE_DATA_MODE=demo` no se conecta a esa base.

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
| `VITE_DATA_MODE` | `demo` |
| `VITE_WEB_ORIGIN` | `https://app-b20.pages.dev` |
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

El modo `pages` usa `VITE_WEB_ORIGIN=https://app-b20.pages.dev` como origen canónico. En las
nuevas compilaciones, abrir un alias de Pages lleva a ese dominio estable antes de iniciar
autenticación. Los callbacks vacíos añaden `/auth/callback` o `/auth/logout` al origen
estable. No hace falta autorizar cada nueva URL con hash de despliegue ni usar comodines.
Si se abre un callback en otro origen con `code` o `state`, no se trasladan esos parámetros:
se vuelve al dominio estable y se inicia un acceso limpio.

Las URLs de despliegues anteriores son inmutables: conservan el código compilado en su
publicación y no reciben los ajustes posteriores, incluido el login obligatorio de la simulación.
Por compatibilidad con un enlace
ya compartido, se autorizó expresamente `https://af0dd1ec.app-b20.pages.dev`; usa el dominio
estable para los próximos accesos.

Se incluyen dos reglas explícitas en `_redirects` para los retornos; Pages
resuelve el resto mediante su fallback de aplicación de una sola página. No agregues una regla
global `/* /index.html 200`: Wrangler la rechaza como un bucle.
[Fallback de Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/).

La compilación en modo `pages` rechaza URLs de producción que apunten a localhost.
El service worker propio completa el comportamiento `autoUpdate`: activa la nueva versión
y toma el control de las pestañas abiertas para que no se siga mostrando el acceso anterior
desde su caché. La recarga de actualización reinicia los cambios simulados en memoria, como
cualquier otra recarga de la app. Se omite la recarga mientras se procesa un retorno OAuth
para no interrumpir el canje del código de acceso o el cierre de sesión.
SpacetimeAuth debe estar configurado en ambos modos; en `spacetime` también se necesita URI y
nombre de base. `VITE_DATA_MODE` admite `demo` o `spacetime`, con `demo` como predeterminado.
`.env.pages` sirve para probar o compilar localmente, pero está ignorado por Git y no llega a
la compilación de Cloudflare.

## Retornos ya guardados en SpacetimeAuth

En **SpacetimeAuth → Clients → `client_034jL0AHYYQ1bps8SupHU0`** ya están guardadas estas
URL exactas de entrada y salida. Se conservaron los retornos locales y se añadieron el dominio
estable y un despliegue anterior para que el enlace ya compartido siga funcionando.

| Entorno | Redirect URI | Post Logout Redirect URI |
| --- | --- | --- |
| Local | `http://localhost:5173/auth/callback` | `http://localhost:5173/auth/logout` |
| Producción recomendada | `https://app-b20.pages.dev/auth/callback` | `https://app-b20.pages.dev/auth/logout` |
| Enlace anterior conservado | `https://af0dd1ec.app-b20.pages.dev/auth/callback` | `https://af0dd1ec.app-b20.pages.dev/auth/logout` |

No hace falta modificar `auth_config` por estos retornos del mismo cliente. Comparte y abre
**https://app-b20.pages.dev**. Los futuros alias deben llevar al dominio estable; no registres
cada hash ni comodines. El error previo `invalid_redirect_uri` se debía a que únicamente
estaban registrados los retornos de localhost; esa configuración ya se corrigió.

El formulario ofrece acceso por enlace al correo de SpacetimeAuth. En esta fase cualquier
correo verificado puede entrar a la interfaz con datos simulados, sin una lista de invitación.
Google es opcional. `AuthProvider` se utiliza siempre, también si la URL contiene `?demo`:
la falta de configuración no abre una demo sin sesión.

## Datos de la versión temporal

`VITE_DATA_MODE=demo` está configurado para Pages. Después del login se crea una fuente de
datos simulados para el `subject` autenticado; no se monta la conexión a Maincloud ni se
realizan lecturas o escrituras contra esa base. La interfaz conserva los ejemplos actuales y
el selector de perfiles y roles ficticios, identificados como simulación. **Ajustes** muestra
por separado la cuenta real que inició sesión.

Los cambios viven en memoria: renovar el token de la misma cuenta conserva la simulación;
recargar, cerrar sesión o cambiar de identidad la reinicia. No se guardan datos simulados en
`localStorage` ni se comparten entre personas. Para activar datos persistentes más adelante,
se compilará con `VITE_DATA_MODE=spacetime` y se validarán conexión y membresía por invitación.
Las cuentas de SpacetimeAuth se conservarán; la simulación no migra sus cambios automáticamente.

## Comprobar después de compilar

1. En **Pages → app-b20 → Deployments**, confirmar **Success** en el commit esperado y abrir
   la URL HTTPS estable.
2. Abrir directamente `/auth/callback` y `/auth/logout`: deben cargar B20 y manejar la ruta,
   en lugar de mostrar un 404 del hosting.
3. El acceso humano por enlace al correo y la visualización de la simulación se confirmaron el
   20 de octubre de 2026. Esa cuenta ya tenía una invitación guardada: todavía falta la prueba
   humana con un correo verificado sin invitación.
4. Se comprobó que **Ajustes** identifica la cuenta real separada de los perfiles y roles
   ficticios de simulación. Cambiar un perfil ficticio no debe cambiar la cuenta autenticada.
5. Modificar datos simulados, verificar que la renovación de sesión los conserva y que
   recargar, salir o cambiar de cuenta los reinicia. No deben aparecer conexiones a Maincloud.
   La renovación esperando la expiración y el cambio a otra cuenta siguen pendientes de prueba
   humana; esos casos y el acceso sin invitación cuentan con pruebas automatizadas.

Antes de cambiar a `VITE_DATA_MODE=spacetime`, probar con dos cuentas la persistencia,
invitaciones, bajas y privacidad del grupo real. Más información en
[SpacetimeAuth y modos de datos](spacetimeauth.md).

## Resolver los errores encontrados

### Worker creado desde el flujo inicial

El intento del Worker `appb20` usaba la rama antigua `main`, sin comando de compilación, y
`npx wrangler deploy` desde la raíz del monorepo. Esa configuración no construye ni publica
esta web de Pages. El proyecto preparado es **Pages `app-b20`**, con la rama y los campos de
la primera tabla. No uses `npx wrangler deploy` como comando de despliegue de este proyecto
Pages con integración Git; Cloudflare publica la carpeta `apps/web/dist` al terminar el build.

### Variables ausentes durante `build:pages`

Comprueba que el commit compilado contiene los valores públicos en `wrangler.jsonc →
vars`. Las variables `VITE_*` añadidas solo al panel no sustituyen esa configuración. Mantén
`.nvmrc` en la raíz con Node.js `22`; tras corregir el archivo y enviar el commit, revisa el
nuevo despliegue. No pongas una dirección local de API o callback en producción.

### `invalid_redirect_uri` al iniciar sesión

Los retornos exactos de localhost, del dominio estable y de `af0dd1ec.app-b20.pages.dev` ya
están guardados. Abre **https://app-b20.pages.dev** para iniciar una sesión nueva. Las URLs de
un despliegue anterior conservan su código original; no se actualizan al publicar otra versión.
Si aparece el error en otro alias, vuelve al dominio estable y comprueba que la compilación
actual incorpora `VITE_WEB_ORIGIN`; no autorices cada hash nuevo ni comodines.

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
