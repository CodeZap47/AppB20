# Sincronización de App B20 — 21 de octubre de 2026

La revisión de las conversaciones recientes y de ambos repositorios locales encontró
Exámenes y mensajería publicados en ramas separadas, además de una copia local antigua
con cambios sin commit. La versión conjunta se publicó en
[app-b20.pages.dev](https://app-b20.pages.dev/).

## Integración y respaldo

- Base de `main`: `79dc8db`, con cuarta entrega, Guías y navegación Slim.
- Exámenes: `88706a0`, integrado mediante `a1fd076`.
- Mensajería Untitled UI: `f1eae75`, integrada mediante `3fbb435`.
- La integración conserva los propósitos de IA de estudio y Exámenes, la navegación de
  todos los módulos y la limpieza de referencias privadas de ambas entregas.
- Los 328 archivos pendientes de la copia antigua se preservaron en `9f0cb56`, rama
  `codex/respaldo-local-2026-10-21`. Se excluyeron secretos y compilados. Ese respaldo
  conserva versiones anteriores y no se incorpora a producción sobre los módulos nuevos.
- `main` y la rama de producción `codex/pages-spacetimeauth` contienen la misma integración.
  Las carpetas locales `appb20-*` siguen siendo repositorios o worktrees independientes.

## Comprobaciones locales

Node.js `22.23.3`, SpacetimeDB CLI/SDK `2.12.0`, Wrangler `4.151.3`.

| Comprobación | Resultado |
| --- | --- |
| Tipos de todos los paquetes | Aprobados |
| Pruebas de interfaz | 717 en 89 archivos |
| Pruebas de dominio | 151 en 22 archivos |
| Pruebas de módulo | 346 en 22 archivos |
| Pruebas de API/Worker | 136 en 20 archivos |
| Pruebas de web | 51 en 3 archivos |
| Total | **1.401 pruebas en 156 archivos** |
| Compilaciones | Web/PWA, extensión, Pages y ambos Workers correctos |
| Recorridos con servidor local | Exámenes, Retos/Revisión/Ayuda, Museo/Oportunidades, IA de estudio y versiones de Aprende enseñando: 31 grupos de verificaciones aprobados |

Los recorridos usan cuentas sintéticas y servidores temporales aislados. Las llamadas
de generación son simuladas; no se consume Gemini real.

## Publicación y conservación

Se publicó primero el módulo de Maincloud con `--delete-data=never`, después el Worker
compartido y finalmente la rama de producción de Pages.

- **Maincloud `app-b20-34245`:** 117 → 139 tablas. Las 117 tablas anteriores conservan
  exactamente sus esquemas y sus 310 registros; las 22 nuevas están vacías. La comparación
  incluye el contenido binario mediante huellas, sin incorporar datos privados a Git.
- **Programa:** el módulo remoto coincide byte a byte con la compilación conjunta.
  SHA-256 `accfd6cb201274d13fa13c22e760e4eb44a1681ac81f553fcc3c2dfa1eba9ad2`.
- **Worker `app-b20-ai`:** versión `a126f5d7-3668-49a6-aa72-3e54136a458a`.
  Se conservan variables, cuatro secretos y programación de avisos. Salud HTTP 200,
  rechazo anónimo HTTP 401 y CORS del dominio estable comprobados.
- **Pages:** despliegue de la integración `81c14651-9768-4714-81c6-b847bbbbb69e`,
  código `3fbb435`, rama `codex/pages-spacetimeauth`. El commit de este recibo actualiza
  documentación y conserva el mismo código de ejecución. Los 16 archivos públicos del
  dominio estable coinciden byte a byte con la compilación validada y responden HTTP 200.
- **Cierre documental verificado:** revisión `f16e8f5`, despliegue de producción
  `43f95ed2-418c-430e-be41-311a53b85968`, completado y comprobado a las 15:17 del
  21 de octubre de 2026 (`America/Tijuana`). Conserva el mismo código de ejecución de
  `3fbb435`; los 16 archivos públicos del dominio estable y el alias de ese despliegue
  coinciden con la compilación. Las actualizaciones posteriores de documentación no
  sustituyen este recibo ni acreditan nuevas funciones.

Los recibos de conservación, esquemas, huellas y despliegues se guardan localmente bajo
`artifacts/sincronizacion-2026-10-21/`, excluidos de Git. No se guardan valores de secretos
en este documento. Los registros de despliegues anteriores se conservan como antecedentes.

## Límites de la comprobación

La publicación del código no cierra la aceptación del grupo con varias cuentas,
la recepción push en un dispositivo ni la prueba de Gemini con clave personal.
Esas comprobaciones mantienen sus decisiones y requisitos previos. Los módulos de la
quinta entrega no se declaran terminados por esta sincronización.
