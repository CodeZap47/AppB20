# Publicar B20 en Cloudflare Pages

La web está preparada para publicarse en el subdominio gratuito de Pages, por ejemplo
`https://app-b20.pages.dev`. El nombre es una propuesta: solo Cloudflare confirma la dirección
asignada al crear el proyecto. SpacetimeDB ya está publicado en Maincloud como
`app-b20-34245`; alojar la web no cambia esa base ni el acceso por invitación.

Esta guía prepara la publicación; no afirma que el sitio ya esté publicado. El subdominio
`pages.dev` se entrega con HTTPS y no requiere comprar un dominio, configurar DNS ni entrar
a **Custom Domains**. El nombre del proyecto define la URL asignada por
[Pages](https://developers.cloudflare.com/pages/get-started/direct-upload/).

## Qué está preparado

| Archivo o comando | Uso |
| --- | --- |
| `wrangler.jsonc` | Proyecto Pages propuesto `app-b20`, salida `./apps/web/dist`. |
| `.env.pages.example` | Valores públicos de Maincloud y SpacetimeAuth para compilar la web. |
| `.env.pages` | Copia local ignorada por Git; no se sube. |
| `npm run build:pages` | Compila Vite en modo `pages`. |
| `npm run pages:dev` | Sirve la compilación con Pages local. |
| `npm run pages:deploy` | Compila y sube la carpeta de salida con Wrangler a la rama `main`. |
| `artifacts/cloudflare-pages/app-b20-pages.zip` | Paquete local para arrastrar al panel de Cloudflare; contiene solo la web compilada. |

El modo `pages` evita heredar los callbacks locales: si se dejan vacíos, B20 usa el origen del
sitio abierto y añade `/auth/callback` o `/auth/logout`. La compilación incluye dos reglas
explícitas en `_redirects` para esas rutas; Pages resuelve el resto mediante su fallback de
aplicación de una sola página. No agregues una regla global `/* /index.html 200`: Wrangler la
rechaza como un bucle. [Fallback de Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/).
Se incluyen también cabeceras para evitar referidores en callbacks y
caché de las respuestas de autenticación.

La compilación rechaza URLs de producción que apunten a localhost y exige URI, nombre de base
y Client ID. Las variables de callback vacías permiten usar la URL final asignada sin tener
que conocerla al generar el ZIP.

## Elegir cómo publicar

- **Subir el ZIP:** permite publicar la compilación actual sin conectar GitHub.
- **Integración Git:** Cloudflare compila y publica los cambios enviados al repositorio.

Elige antes de crear el proyecto. Un proyecto creado con Direct Upload no puede convertirse
después en uno con integración Git; habría que crear otro. El panel admite ZIP y Wrangler
publica una carpeta. [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/).

## Opción A: subir el ZIP preparado

1. En tu cuenta de Cloudflare, abre **Workers & Pages** y crea una aplicación de tipo **Pages**.
   Elige la opción de **Direct Upload / Drag and drop your files**.
2. Escribe `app-b20` como nombre propuesto. Si no está disponible, usa el nombre que acepte
   Cloudflare y conserva la dirección que finalmente muestre el panel.
3. Sube `artifacts/cloudflare-pages/app-b20-pages.zip` y publica el sitio. No subas el repositorio,
   `.env`, `.env.pages` ni `node_modules`.
4. Copia la URL estable que entrega Pages, por ejemplo `https://app-b20.pages.dev`, y registra
   sus dos callbacks en SpacetimeAuth siguiendo el apartado siguiente.

El ZIP ya lleva los valores públicos compilados. No necesitas configurar variables de
compilación en el panel para subirlo. Cambiar variables en Cloudflare después de subir el ZIP
no modifica sus archivos: hay que volver a compilar y subir una nueva versión.

Para reconstruir la web desde la raíz de este repositorio:

```sh
npm ci
cp .env.pages.example .env.pages
npm run build:pages
npm run pages:dev
```

Si `.env.pages` ya contiene tus ajustes, consérvalo en vez de reemplazarlo. Para una nueva
subida manual, usa el contenido de `apps/web/dist` o crea un ZIP con sus archivos en la raíz:
`index.html` debe quedar en la raíz del ZIP, sin una carpeta `dist` envolviéndolo.

Si prefieres subir desde la terminal, entra en Cloudflare con `npx wrangler login`, crea el
proyecto `app-b20` con rama de producción `main` y ejecuta `npm run pages:deploy`. Si elegiste
otro nombre, ajusta `name` en `wrangler.jsonc` antes de publicar. Los scripts necesitan las
credenciales de tu cuenta; no se guardan dentro de la web.

## Opción B: conectar GitHub

Usa esta opción desde el principio si quieres publicar automáticamente. Primero los cambios
preparados deben estar en el repositorio remoto: Cloudflare no puede compilar archivos que
solo existan en tu equipo. [Integración Git de Pages](https://developers.cloudflare.com/pages/get-started/git-integration/).

En **Workers & Pages → Create application → Pages → Connect to Git**, autoriza el acceso al
repositorio y usa estos valores:

| Campo | Valor |
| --- | --- |
| Repositorio | `CodeZap47/AppB20` |
| Project name | `app-b20`, si está disponible |
| Production branch | `main` |
| Framework preset | **None** |
| Root directory | Raíz del repositorio; dejar sin subcarpeta |
| Build command | `npm run build:pages` |
| Build output directory | `apps/web/dist` |

La carpeta local avanzada se llama `appb20-stdb`, pero es un repositorio independiente. No
pongas `appb20-stdb` ni `apps/web` en **Root directory**: `package.json` y los workspaces están
en la raíz del repositorio remoto. Los campos de compilación y salida se ajustan a este
monorepo. [Configuración de compilación](https://developers.cloudflare.com/pages/configuration/build-configuration/).

Agrega estas variables de compilación al entorno de **Production**:

| Variable | Valor |
| --- | --- |
| `NODE_VERSION` | `22` |
| `VITE_SPACETIME_URI` | `wss://maincloud.spacetimedb.com` |
| `VITE_SPACETIME_DB` | `app-b20-34245` |
| `VITE_SPACETIMEAUTH_AUTHORITY` | `https://auth.spacetimedb.com/oidc` |
| `VITE_SPACETIMEAUTH_CLIENT_ID` | `client_034jL0AHYYQ1bps8SupHU0` |
| `VITE_SPACETIMEAUTH_REDIRECT_URI` | Dejar vacía o sin definir |
| `VITE_SPACETIMEAUTH_POST_LOGOUT_REDIRECT_URI` | Dejar vacía o sin definir |
| `VITE_API_URL` | Vacía mientras la API no esté desplegada |

El Client ID y la dirección de la base son públicos. Ninguna variable `VITE_*` debe contener
un Client Secret, una clave de Gemini ni claves de administración. Vite incorpora estos valores
al compilar; después de cambiarlos, ejecuta otro despliegue. `VITE_API_URL` podrá apuntar a la
URL HTTPS real de la API cuando esté publicada y conectada con la interfaz.

Con Git integrado, los cambios enviados a la rama de producción disparan el despliegue. Si
habilitas vistas previas, no registres comodines en autenticación: solo URLs exactas de entornos
que controles y necesites probar. Para este piloto usa la URL estable de producción.

## Registrar el dominio en SpacetimeAuth

Abre **SpacetimeAuth → Clients → `client_034jL0AHYYQ1bps8SupHU0`** y conserva los retornos
locales ya registrados. Si Cloudflare asignó `app-b20.pages.dev`, agrega:

| Campo | Nueva dirección |
| --- | --- |
| Redirect URIs | `https://app-b20.pages.dev/auth/callback` |
| Post Logout Redirect URIs | `https://app-b20.pages.dev/auth/logout` |

Si la URL asignada es otra, sustituye el dominio en ambas filas. Usa HTTPS, sin `#`, sin
comodines y con la ruta exacta. No necesitas crear otro cliente ni modificar `auth_config`
para añadir el dominio al cliente existente.

El formulario actual ofrece acceso por correo. Google es opcional. La persona debe usar su
correo invitado y verificado, y completar el registro para obtener membresía; crear una cuenta
en SpacetimeAuth no concede acceso por sí solo. La primera invitación de administrador ya está
guardada. Más información en [SpacetimeAuth y acceso por invitación](spacetimeauth.md).

## Comprobar después de publicar

1. Abrir la URL HTTPS estable y confirmar que muestra B20.
2. Abrir directamente `/auth/callback` y `/auth/logout`: deben cargar la app y manejar la ruta,
   en lugar de mostrar un 404 del hosting.
3. Iniciar sesión con el correo invitado, completar el perfil y recargar para comprobar la
   persistencia en Maincloud. Probar también cierre de sesión y nuevo acceso.
4. Verificar con una segunda cuenta que las invitaciones y la privacidad se mantienen; una
   cuenta sin invitación no debe poder unirse ni leer datos del grupo.

La web puede publicarse mientras se completan las funciones pendientes. La interfaz de IA/BYOK
aún no conecta con la API; el alojamiento de la API, archivos y envío de notificaciones push
requieren trabajo propio. Publicar la web en Pages no activa esos servicios automáticamente.

Fuentes oficiales consultadas el 20 de octubre de 2026; los enlaces de cada apartado respaldan
las opciones y campos del servicio. La disponibilidad del nombre se comprueba al crear el
proyecto en la cuenta de Cloudflare.
