# Administración: publicación del 24 de octubre de 2026

Los controles de enlaces, integrantes, correos y aportes están publicados en [b20.mx](https://b20.mx). Se conservó la autenticación Supabase vigente y la API `https://api.b20.mx`.

## Publicación

- Maincloud `app-b20-34245`: actualización con `--delete-data=never`; 157 → 168 tablas, sin retirar ni modificar la estructura de las anteriores. El programa remoto coincide con el bundle validado: SHA-256 `ebff46d5625f134c4b4d5c316f570a4b5ba250d53c0682f324e3862cdff805a8`.
- API `b20-api`: versión `0510d467-850b-4800-9260-281eef1cabf5`, dominio `api.b20.mx`. Se conservan variables previas, los cinco secretos existentes y la programación de avisos.
- Pages: despliegue de producción `ceef5f43-41f8-44c3-abc0-df66bbb8650e`, rama configurada `codex/pages-spacetimeauth`. Los 20 archivos públicos de `b20.mx` coinciden con la compilación local. Entrada `assets/index-CuM5qlsf.js`, SHA-256 `cec1f32f4788457aaec8b593592af87e74c6b5f03f9931bc582c2181387c2fce`.

La publicación de Pages fue una carga directa del artefacto validado desde el checkout con cambios locales. Su metadato Git es `834fcb4` con `commit_dirty=true`; ese commit por sí solo no representa el código publicado. Se incorporaron las funciones que ya estaban publicadas en `195df61` para conservar activación de cuentas, enlaces anteriores, avisos y presentación. Antes de otra publicación automática, integrar este estado en su rama de producción; no reconstruir desde el commit indicado sin los cambios locales.

## Conservación comprobada

Se capturaron huellas de las 157 tablas anteriores y sus 475 filas, incluidos los binarios de archivos, sin guardar su contenido en Git. Después de publicar, se conservan las 475 filas y todos los esquemas previos. Las huellas de 156 tablas son idénticas. La excepción es `notification_planner_state`, cuya única fila conserva su estructura y avanza `last_member` mediante el cron existente; no es contenido de integrantes.

Los 10 integrantes, los dos enlaces anteriores y sus ocho registros de canje se conservan. Los enlaces históricos aparecen en Administración y pueden desactivarse sin retirar integrantes. Sus secretos no pueden recuperarse porque la versión anterior guardaba únicamente una huella. No se reconstruyeron correos ni orígenes por aproximación.

La migración añade nueve tablas de Administración y dos tablas de la integración Moodle que ya existía en el checkout; estas dos están vacías. No se ejecutaron operaciones de moderación, bajas, bloqueos ni purgas sobre datos reales. La Papelera conserva su plazo de 30 días.

## Cifrado y configuración

`INVITATION_MASTER_KEYS_JSON` está instalado como secreto del Worker, con una clave dedicada aleatoria de 32 bytes y versión `v1`. Se guardó una copia local privada fuera del repositorio, con permisos `0600`, para conservarla al rotar claves. Las claves previas de IA y notificaciones mantienen sus versiones.

Además, la credencial de Supabase que Pages conservaba como variable de texto se convirtió en un secreto administrado, conservando su valor, las demás variables y el despliegue activo. Ningún valor privado se incluye en este recibo.

La web usa `VITE_INVITATION_API_URL=https://api.b20.mx`; las descargas heredadas mantienen su configuración independiente. Los valores públicos actuales están en `wrangler.jsonc` y `.env.pages.example`.

## Validación

- 1.868 pruebas aprobadas: interfaz 975, dominio 194, módulo 457, API 178 y web 64; comprobación de tipos de todos los paquetes y compilaciones correctas.
- Migración real aislada desde `195df61`, con datos sintéticos y `--delete-data=never`: tablas, integrantes, enlace histórico, canje, materia y publicación conservados.
- Cinco grupos de comprobaciones con servidor aislado: caducidad/cupo, idempotencia, revocación sin bajas, reincorporación, aliases, concurrencia y persistencia tras reinicio.
- Producción: API saludable, rechazo de sesiones ausentes o inválidas, CORS y respuestas sin caché comprobados; clave dedicada presente y variables/secretos anteriores conservados.
- Navegador: escritorio y móvil de 390 × 844, sin errores de consola ni desbordamiento horizontal, con acceso Supabase vigente.

Los recorridos de crear/copiar/revocar y moderar se probaron con cuentas sintéticas aisladas. No había una sesión administrativa abierta en el navegador de producción; no se inició sesión ni se modificaron datos reales para repetir esos recorridos.

La evidencia técnica, esquemas y huellas se conservan en `artifacts/administracion-2026-10-24/`, excluido de Git. Las reglas funcionales se detallan en [Control de accesos](control-accesos-administracion.md), [Control de contenido](control-contenido-administracion.md) y [API de enlaces](enlaces-invitacion-api.md).
