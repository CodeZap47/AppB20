# Corrección de la integración del Worker heredado `appb20`

## Diagnóstico — 21 de octubre de 2026

El check `Workers Builds: appb20` falló en el commit
`cda8030cb2899a26db9aaee82517139abacb51f8`, con build
`de091261-5ab8-4168-b4d9-e8d6a970a7ac` y check GitHub `119389333487`.
La integración tenía directorio raíz `/`, ningún comando de compilación y despliegue
`npx wrangler deploy`. El log muestra:

> The Cloudflare application detection logic has been run in the root of a workspace instead of targeting a specific project.

El repositorio es un monorepo. Su `wrangler.jsonc` raíz configura Pages con
`pages_build_output_dir: ./apps/web/dist`. No define un Worker ejecutable llamado
`appb20`. La configuración de la API en `apps/api/wrangler.jsonc` pertenece a otro
servicio, `app-b20-api`, con su propio binding R2 y secreto. Cambiar el destino del
build hacia esa API no corresponde al servicio accidental.

## Servicios y conservación

| Servicio | Función y configuración que se conserva |
| --- | --- |
| Pages `app-b20` | Web en `https://app-b20.pages.dev`, integración Git con `codex/pages-spacetimeauth`, build `npm run build:pages`, salida `apps/web/dist`. |
| Worker `app-b20-api` | Compatibilidad de archivos R2 en `https://app-b20-api.sucanasta1.workers.dev`; mantiene código, bindings y secretos. |
| Maincloud `app-b20-34245` | Datos y backend de la app; no requiere publicación ni migración para corregir este build. |
| Worker `appb20` | Servicio accidental sin URL ni dominios, bindings, triggers o invocaciones durante las 24 horas observadas. Se conserva su código e historial. |

El inventario del panel de `appb20` no encontró variables de entorno, bindings ni
triggers. Su único despliegue listo era el bootstrap manual `7b213d6d`; los intentos
de Git eran builds fallidos y no habían sustituido código operativo de la app.

## Corrección operativa

Se guardaron y comprobaron de nuevo tras recargar Settings → Builds del Worker
`appb20` estos controles:

- Producción: **Disable builds**, activado.
- Vistas previas: **Builds for Preview branches**, desactivado.

Esto detiene la integración automática errónea y conserva el servicio, su código, la
conexión Git y el historial de los fallos anteriores. No se desconecta ni elimina el
Worker y no se despliegan nuevos bytes de runtime.

Los checks fallidos históricos conservan su resultado. La verificación del arreglo
requiere que un push posterior no cree otro build de `appb20`, mientras Pages sí
complete su publicación. Si en el futuro se asigna una función real a `appb20`, crear
primero una configuración y una entrada propias, comprobar sus recursos y seleccionar
ese proyecto explícitamente antes de reactivar sus builds.

## Código publicado y ramas

Al comenzar la corrección, Pages servía la revisión
`cda8030cb2899a26db9aaee82517139abacb51f8`. Durante la revisión llegó a `main` el commit
`609bc4467ed94ec0d5bdd2505fd70843ede03fc4`, que integra una tercera entrega aún sin
desplegar, con IA, avisos y conservación. Esta entrega queda fuera del arreglo del
Worker accidental.

La misma corrección documental se registra sobre cada base por separado: el código
publicado de `codex/pages-spacetimeauth` se conserva y `main` mantiene el trabajo nuevo
sin activarlo. Las ramas conservan sus SHA y sus entregas respectivas; se comparan las secciones de
esta corrección y, para cada commit, se comprueba
que el código y las configuraciones sean idénticos a los de su padre.

## Comprobaciones de la corrección

- **Confirmado antes del cambio:** el dominio de Pages respondió HTTP 200. La API
  anterior respondió HTTP 200 en `/health` con `{"ok":true,"files":"r2","ai":false}`.
- **Confirmado:** ambos controles de builds quedaron guardados y se verificaron tras
  recargar el panel. El servicio y su bootstrap manual siguen presentes.
- **Confirmado después de guardar:** las 88 tablas existentes y sus 290 registros
  conservaron sus hashes y su esquema. El programa de Maincloud conservó sus
  2.642.385 bytes y SHA-256 `d3b08b3953bf196f06669092a916ef1a32922fe3a604aa7b3bca614f84222a0d`.
  La API devolvió HTTP 200 con la misma respuesta antes y después.
- Tras enviar los commits documentales, comprobar el check de Pages y la ausencia de
  un nuevo build automático de `appb20`; registrar las revisiones de ambas ramas y
  comparar las secciones de esta corrección en las dos ramas.
- Comparar la configuración y el código remotos de Maincloud y el contenido público
  de Pages antes y después. Verificar de nuevo el dominio web y `/health` de la API.
- La corrección cambia configuración del servicio accidental y documentación.
  No modifica código de la app, paquetes, lockfile, configuración de Pages/API ni
  esquema de SpacetimeDB. Se comprueba el diff y los identificadores de esos árboles;
  repetir las pruebas funcionales del código sin cambios no aporta evidencia del
  control de builds remoto.

## Cierre posterior de la tercera entrega

Después de esta corrección se integró y publicó la tercera entrega junto con Guías y los
cambios posteriores de `main`. La revisión operativa comprobada es `e75edfbe`, con ambas
ramas remotas sincronizadas al verificarla. Este despliegue utilizó Maincloud, el Worker
dedicado `app-b20-ai` y Pages; los builds automáticos de `appb20` continúan desactivados y
no fue necesario modificarlos. Se conserva íntegro el historial anterior del arreglo.

El [registro común de la tercera entrega](tercera-entrega.md#publicación-verificada-del-21-de-octubre-de-2026)
documenta la conservación de datos, las versiones publicadas y las comprobaciones posteriores.
