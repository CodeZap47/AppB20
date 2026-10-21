# B20 en Cloudflare Pages

El proyecto **Pages `app-b20`** está conectado al repositorio `CodeZap47/AppB20` y su
dirección estable es **https://app-b20.pages.dev**. El repositorio está preparado para
publicar `VITE_DATA_MODE=spacetime`: autenticación por SpacetimeAuth, membresía por invitación,
datos y archivos nuevos en SpacetimeDB. Este estado del código no acredita una publicación.
Consultar **Deployments** para identificar el commit que sirve el dominio estable y registrar
el resultado en [estado-del-proyecto.md](estado-del-proyecto.md).

El registro histórico del 20 de octubre de 2026 corresponde a una web con autenticación real
y datos simulados. Se comprobó el acceso por correo y la separación de la cuenta real frente
a los perfiles de prueba. Maincloud ya tenía la base `app-b20-34245`, pero aquella web en
modo `demo` no se conectaba a ella. La actualización con archivos nativos requiere publicar
primero el módulo compatible, conservando sus datos, y después la web.

El subdominio `pages.dev` se entrega con HTTPS y no requiere comprar un dominio, configurar
DNS ni entrar a **Custom Domains**. El nombre del proyecto define la URL asignada por
[Pages](https://developers.cloudflare.com/pages/get-started/git-integration/).

## Configuración registrada del proyecto

| Campo | Valor |
| --- | --- |
| Servicio | **Pages**, proyecto `app-b20` |
| Repositorio | `CodeZap47/AppB20` |
| Production branch registrada | `codex/pages-spacetimeauth`; consultar Pages antes de publicar |
| Framework preset | **None** |
| Root directory | `/`, raíz del repositorio |
| Build command | `npm run build:pages` |
| Build output directory | `apps/web/dist` |
| Node.js | `22`, indicado en `.nvmrc` |

El registro anterior usa `codex/pages-spacetimeauth` como rama de producción. La rama local
o el último commit de GitHub no determinan por sí solos qué sirve Pages: consultar la rama
de producción y el despliegue activo antes de enviar cambios o usar Wrangler. Publicar desde
otra rama puede crear una vista previa. Un cambio de rama de producción debe acompañar la
integración del código que se quiere servir. [Integración Git](https://developers.cloudflare.com/pages/get-started/git-integration/).

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
| `VITE_DATA_MODE` | `spacetime` |
| `VITE_WEB_ORIGIN` | `https://app-b20.pages.dev` |
| `VITE_SPACETIME_URI` | `wss://maincloud.spacetimedb.com` |
| `VITE_SPACETIME_DB` | `app-b20-34245` |
| `VITE_SPACETIMEAUTH_AUTHORITY` | `https://auth.spacetimedb.com/oidc` |
| `VITE_SPACETIMEAUTH_CLIENT_ID` | `client_034jL0AHYYQ1bps8SupHU0` |
| `VITE_SPACETIMEAUTH_REDIRECT_URI` | `""` |
| `VITE_SPACETIMEAUTH_POST_LOGOUT_REDIRECT_URI` | `""` |
| `VITE_API_URL` | `https://app-b20-api.sucanasta1.workers.dev`, solo compatibilidad R2 anterior |

Esta tabla refleja la configuración preparada en `wrangler.jsonc`, no las variables del
último despliegue confirmado. Los archivos nuevos usan SpacetimeDB directamente. Para una
instalación sin objetos R2 anteriores, `VITE_API_URL` puede quedar vacío; conservarlo si hay
archivos históricos que aún dependen del Worker.

El primer intento de compilación de Pages falló porque faltaban estas variables en
`wrangler.jsonc`: agregarlas únicamente al panel no las aportó al build que usa este archivo.
El commit `59d17a7` incorpora los valores públicos de B20 a `vars`; revisa el resultado de ese
commit o uno posterior en **Deployments**. El despliegue de `59d17a7` ya terminó en
**Success**. No se debe volver a una revisión anterior a ese cambio. [Configuración de Pages con Wrangler](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).

El Client ID y la dirección de la base son públicos. Ninguna variable `VITE_*` debe contener
un Client Secret, una clave de Gemini ni claves de administración. Vite incorpora estos valores
al compilar; después de cambiarlos, comprobar un nuevo despliegue. `VITE_API_URL` es una
ruta opcional para descargar objetos heredados; no determina dónde se suben los archivos
académicos nuevos. Ver [archivos-spacetime.md](archivos-spacetime.md).

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

El formulario ofrece acceso por enlace al correo de SpacetimeAuth. La compilación preparada
en modo `spacetime` exige además una invitación para unirse al grupo; un correo verificado
por sí solo no autoriza consultar sus datos. `AuthProvider` se utiliza siempre, también si
la URL contiene `?demo`: la falta de configuración no abre una demo sin sesión.

## Registro histórico de la versión de prueba

La publicación de prueba usaba `VITE_DATA_MODE=demo`. Después del login se creaba una fuente de
datos simulados para el `subject` autenticado; no se monta la conexión a Maincloud ni se
realizan lecturas o escrituras contra esa base. La interfaz conserva los ejemplos actuales y
el selector de perfiles y roles ficticios, identificados como simulación. **Ajustes** muestra
por separado la cuenta real que inició sesión.

En ese modo, los cambios viven en memoria: renovar el token de la misma cuenta conserva la simulación;
recargar, cerrar sesión o cambiar de identidad la reinicia. No se guardan datos simulados en
`localStorage` ni se comparten entre personas. La configuración preparada ahora usa
`VITE_DATA_MODE=spacetime`; hay que validar conexión, persistencia y membresía por invitación
en la publicación correspondiente. Las cuentas de SpacetimeAuth se conservan; la simulación
no importa sus ejemplos ni cambios al grupo real.

## Comprobar después de compilar

1. En **Pages → app-b20 → Deployments**, confirmar **Success** en el commit esperado y abrir
   la URL HTTPS estable.
2. Abrir directamente `/auth/callback` y `/auth/logout`: deben cargar B20 y manejar la ruta,
   en lugar de mostrar un 404 del hosting.
3. Confirmar que la compilación usa datos reales: una persona invitada puede unirse y un
   correo verificado sin invitación no puede consultar contenido del grupo.
4. Probar con autor y compañero autorizado: publicar, adjuntar un archivo, recargar y
   descargar desde la otra sesión. Comprobar también avance privado, coautoría e historial.
5. Probar una tercera identidad sin acceso y dar de baja a una cuenta que ya tenía sesión:
   la consulta y descarga deben rechazarse. Verificar renovación, cierre y cambio de cuenta.
6. Interrumpir y reanudar una subida, cancelar otra y comprobar conflictos de versión.
   Registrar los resultados y el commit publicado; las pruebas locales y la antigua demo
   no sustituyen estas comprobaciones.

Los pasos completos están en [Tareas y Actividades](tareas-actividades.md),
[archivos privados](archivos-spacetime.md) y [SpacetimeAuth y modos de datos](spacetimeauth.md).

## Resolver los errores encontrados

### Worker creado desde el flujo inicial

El Worker `appb20` tenía una integración independiente con `main`, sin comando de
compilación y con `npx wrangler deploy` desde la raíz del monorepo. Su log del 21 de octubre
de 2026 confirma: «The Cloudflare application detection logic has been run in the root of
a workspace instead of targeting a specific project.» La raíz contiene la configuración
de **Pages `app-b20`**, no una entrada desplegable del Worker `appb20`.

La corrección operativa quedó guardada y comprobada tras recargar el panel: **Disable
builds** de producción está activado y **Builds for Preview branches** está desactivado.
Se conservan el servicio y su historial. No se modifica el comando de Pages ni se
despliega `apps/api` con el nombre `appb20`. El Worker de archivos anterior es otro
servicio: **`app-b20-api`**. El inventario,
las comprobaciones y el resultado final se registran en [worker-heredado.md](worker-heredado.md).

Pages mantiene la integración Git, la rama y los campos de la primera tabla. Cloudflare
publica `apps/web/dist` después de `npm run build:pages`; `npx wrangler deploy` desde la
raíz no sustituye ese flujo.

La corrección documental se aplica por separado a `main` y a la revisión publicada de
`codex/pages-spacetimeauth`. En esta revisión, `main` ya contiene la tercera entrega aún
sin publicar; no se incorpora a producción para resolver la configuración de `appb20`.
Consultar el registro antes de comparar SHA de ramas o ampliar el despliegue.

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
Antes de actualizar producción manualmente, comprobar qué rama tiene configurada Pages y
seleccionar ese destino explícitamente o ejecutar desde esa rama, con los cambios integrados
y acceso de escritura a Pages. No asumir que ejecutar el script desde `main` actualiza el
dominio estable. El flujo habitual del proyecto es enviar los cambios a su rama de producción
en GitHub y comprobar el resultado de **Deployments**.

Publicar primero el módulo compatible de SpacetimeDB con `--delete-data=never` y después
la web. La interfaz de IA/BYOK y los avisos siguen pendientes de sus entregas; publicar Pages
no los activa. El Worker R2 anterior se mantiene únicamente mientras se necesite recuperar
archivos existentes y no es requisito para las subidas nuevas.

Fuentes oficiales consultadas el 20 de octubre de 2026; los enlaces de cada apartado respaldan
las opciones y campos del servicio.
