# App B20

**App B20 es una plataforma colaborativa para el grupo B20 de Ingeniería en Desarrollo de
Software.** Su propósito es fortalecer la convivencia entre compañeros, organizar los recursos
académicos del grupo y usar inteligencia artificial como apoyo para comprender, practicar y
desarrollar software.

Centraliza tareas, actividades, apuntes, guías y dudas en un solo espacio, para que los
materiales importantes no se pierdan entre conversaciones o archivos dispersos. Ayuda tanto a
mantenerse al corriente como a ayudar a otros compañeros, sin sustituir el trabajo individual
ni las indicaciones de los docentes.

La definición completa está en [`docs/definicion-del-proyecto.md`](docs/definicion-del-proyecto.md)
y la arquitectura en [`docs/arquitectura.md`](docs/arquitectura.md). Este repositorio es la base
de la **Etapa 0** (prototipo técnico) y del **MVP** (Etapa 1).

## Versión temporal para probar la interfaz

La web usa **SpacetimeAuth real por enlace al correo** y **datos simulados**. Cualquier persona
con correo verificado puede entrar sin invitación en esta fase. `VITE_DATA_MODE=demo` es el
valor predeterminado y el configurado para Pages; no se conecta ni escribe en Maincloud.
La prueba completa del acceso por correo todavía está pendiente.

Los cambios de prueba viven en memoria por la cuenta autenticada: una renovación de sesión
los conserva; recargar, cerrar sesión o cambiar de cuenta los reinicia. No se guardan datos
simulados en `localStorage`. Los perfiles y roles ficticios del selector se identifican como
simulación; **Ajustes** muestra por separado la cuenta real que inició sesión.

El modo futuro `VITE_DATA_MODE=spacetime` conserva la conexión y la validación de invitaciones
para los datos reales del grupo. Al activarlo se reutilizarán las cuentas de SpacetimeAuth;
los cambios temporales de la simulación no se convierten automáticamente en datos reales.


## Qué es la app

- **En el modo de datos reales, acceso exclusivo para el grupo** por invitación y validación
  de membresía. Perfiles,
  trabajos y espacios de coordinación son visibles dentro del grupo, nunca públicos en internet.
- **Transparencia interna:** trabajos publicados, conversaciones del grupo, revisiones y
  votaciones nominales son visibles para los compañeros. Los mensajes 1 a 1 solo los ven sus
  dos participantes.
- **Administración colaborativa:** los creadores de la app se encargan de la operación técnica
  (despliegue, servicios, altas y bajas); la gestión académica es de todos. Los autores editan
  su perfil y sus trabajos, y los cambios importantes quedan con responsable, fecha e historial.
- **Organización común:** grupo → materia → parcial o unidad → tema → trabajos y recursos. El
  plan de estudios tiene nueve cuatrimestres de cinco materias, cada uno con tres parciales
  ([`packages/core/src/curriculum.ts`](packages/core/src/curriculum.ts)).
- **Gemini con clave propia (BYOK):** cada alumno configura su clave y el consumo corre a cargo
  de quien solicita la generación. Todas las funciones comunitarias siguen disponibles sin IA.
- **No es un sistema oficial** de entregas, calificaciones ni asistencia de la universidad.

## Módulos

### Módulos base

| Módulo | Qué hace |
| --- | --- |
| **¿Qué me perdí?** | Pantalla de inicio con las novedades desde tu última visita: publicaciones, cambios de fecha, respuestas aceptadas y votaciones abiertas. |
| **Mensajes** | Canal general del salón, canales por materia o proyecto y conversaciones 1 a 1 con adjuntos, código, stickers, no leídos y silenciado. |
| **Tareas y Actividades** | Cada tarea, actividad, exposición o examen tiene una página principal editable como wiki (con historial y restauración) y, aparte, los trabajos que subió cada alumno o equipo, con quién ya subió y quién falta. Incluye las actividades de clase, con vistas por materia y por fecha. |
| **Notas de clase** | Biblioteca de apuntes por materia, tema y sesión, con notas personales, publicación voluntaria, comentarios e historial. |
| **Preguntas y respuestas** | Dudas por materia y tema, respuestas, respuesta aceptada, estados abierta/resuelta y búsqueda de preguntas similares. |
| **Perfiles** | Foto, nombre, presentación y archivo de trabajos por materia y parcial, como portafolio interno. Los trabajos de equipo aparecen en el perfil de cada autor sin duplicarse. |
| **Cumpleaños** | Calendario del salón con día y mes compartidos voluntariamente, próximos cumpleaños y recordatorios opcionales. Nunca guarda el año. |
| **Guías de estudio** | Guías integrales por materia y parcial, manuales o asistidas por Gemini, con índice de fuentes, cobertura del temario y omisiones visibles. |
| **Votaciones** | Encuestas nominales de opción única o múltiple, con participantes elegibles, fecha de cierre y registro del acuerdo adoptado. |
| **Contribuciones** | Estadísticas y leaderboard que reconocen aportes útiles (no volumen de mensajes), con reglas visibles y desglose de cada punto. |

### Funciones adicionales

| Función | Qué hace | Etapa |
| --- | --- | --- |
| Salas de estudio | Sesiones con tema, horario, objetivo, temporizador compartido y registro de resultados. | 2 |
| Puedo ayudarte / necesito ayuda | Ofertas y solicitudes de ayuda por tema, voluntarias y sin exponer datos personales. | 2 |
| Retos de programación | Problemas cortos con pistas progresivas y soluciones explicadas; se prioriza la comprensión, no la velocidad. | 2 |
| Revisión de código | Fragmentos o enlaces con comentarios por línea y estado de cada observación. | 2 |
| Museo de bugs | Fichas de errores reales: intención, comportamiento, causa, corrección y aprendizaje. | 2 |
| Aprende enseñando | Explicar un concepto con palabras propias y recibir preguntas de un compañero o de la IA. | 2 |
| Repaso espaciado | Tarjetas de preguntas a partir de notas y guías, con cola personal de repaso. | 2 |
| Radar de oportunidades | Talleres, hackatones, becas y concursos, con la opción «busco equipo». | 2 |
| Microproyectos | Equipos para proyectos pequeños, con pendientes, demostraciones y reconocimiento. | 3 |
| Simulador de exposiciones | Ensayar una explicación y responder preguntas antes de exponer. | 3 |
| Préstamo de materiales | Catálogo de libros, cables y herramientas con préstamos acordados, sin pagos. | 3 |

El catálogo que usa la interfaz para la navegación está en
[`packages/core/src/modules.ts`](packages/core/src/modules.ts).

## Gemini con clave propia (BYOK)

| Área | Uso de Gemini |
| --- | --- |
| Tareas y Actividades | Explicar instrucciones, planear un enfoque, dar pistas y ayudar a depurar código. |
| Archivo de trabajos | Resumir documentos y comparar enfoques conservando sus fuentes. |
| Guías de parciales | Sintetizar materiales y temario, indicar cobertura y generar ejercicios revisables. |
| Notas y actividades | Aclarar conceptos y generar ejemplos. |
| Preguntas y revisiones | Preparar borradores de respuestas que el alumno revisa antes de publicar. |
| Práctica personal | Preguntas de repaso, aprender enseñando y simulación de exposiciones. |

Reglas de uso:

- Las solicitudes pasan por el backend; ninguna clave vive en la web, la extensión o el APK.
- Antes de generar se muestra qué recursos se enviarán, qué clave asume el consumo y que puede
  haber costos.
- Se retiran nombres, correos, fotos y credenciales de lo que se envía a la API.
- Los resultados quedan como borrador y se marcan como generados con IA hasta que el usuario
  los publica.
- Los chats 1 a 1 y el calendario de cumpleaños nunca se envían a Gemini automáticamente.
- **Condición previa:** confirmar que el grupo cumple los requisitos de edad de los términos de
  la API (18 años o más) antes de habilitar la integración.

## Presentaciones

La misma cuenta y los mismos datos del grupo en tres formas de distribución:

- **Web y PWA para iPhone:** se instala con «Añadir a pantalla de inicio» y recibe
  notificaciones Web Push (iOS 16.4 o superior).
- **Extensión de Chrome (Manifest V3):** la app completa en el panel lateral y en una vista
  amplia, con todas sus dependencias empaquetadas y permisos mínimos.
- **APK para Android:** empaquetada con Capacitor, firmada y con notificaciones FCM.

Las notificaciones cubren mensajes 1 a 1, menciones, nuevos trabajos, cambios de fecha,
respuestas, votaciones por cerrar, guías disponibles y cumpleaños, con preferencias por
categoría. Los mensajes directos muestran por defecto un aviso genérico, sin el texto.

## Etapas

| Etapa | Contenido |
| --- | --- |
| **0. Prototipo técnico** | Validar React, SpacetimeDB, autenticación y permisos en las tres presentaciones; PWA con push en iPhone, APK firmado con FCM y extensión con panel lateral. |
| **1. MVP** | Acceso exclusivo, perfiles, Tareas y Actividades, notas, preguntas, ¿Qué me perdí?, mensajería del grupo y 1 a 1, cumpleaños y Gemini para explicar y generar borradores de guía. |
| **2. Colaboración y estudio** | Guías integrales, búsqueda, repaso espaciado, salas de estudio, ayuda entre compañeros, retos, revisión de código, museo de bugs, votaciones y radar de oportunidades. |
| **3. Comunidad** | Stickers, leaderboard verificable, microproyectos, simulador de exposiciones y préstamo de materiales. |

Las etapas no son fechas comprometidas; las fechas y costos se estimarán después del prototipo.

## Estructura del repositorio

```
app-b20/
├── apps/
│   ├── web/              Web + PWA instalable en iPhone (Vite, service worker con Web Push)
│   ├── extension/        Extensión de Chrome Manifest V3: panel lateral y vista completa
│   ├── android/          APK Android con Capacitor (usa la compilación de apps/web)
│   └── api/              Backend Node (Hono): Gemini BYOK, y luego archivos y envío de push
├── packages/
│   ├── app/              Interfaz React compartida por web, extensión y Android
│   ├── core/             Catálogo de módulos, plan de estudios y reglas de negocio (con pruebas)
│   └── spacetime-module/ Módulo de servidor SpacetimeDB: tablas, reducers y vistas
└── docs/
    ├── arquitectura.md   Cómo encajan las piezas y qué falta validar
    ├── spacetimeauth.md  Panel de autenticación, variables e invitación inicial
    ├── cloudflare-pages.md   Web en el subdominio gratuito de Cloudflare Pages
    ├── despliegue.md     Publicación de web, base de datos y backend
    └── definicion-del-proyecto.md   Alcance funcional completo
```

Las tres presentaciones son la misma app con los mismos datos; solo cambia el empaquetado. La
interfaz recibe la presentación como `platform` para adaptarse (por ejemplo, navegación compacta
en el panel lateral).

**Pila técnica:** React + TypeScript + Vite, SpacetimeDB para datos en tiempo real, inicio de
sesión con SpacetimeAuth y datos simulados en esta fase; modo SpacetimeDB con invitaciones
conservado para activar después, Google Cloud Storage
para archivos (máximo 50 MB por archivo), backend con `@google/genai` y almacén de secretos para Gemini, Web Push y FCM para
notificaciones.

## Requisitos

- Node.js 22 o superior y npm 10.
- [CLI de SpacetimeDB](https://spacetimedb.com/install) para publicar el módulo y generar bindings.
- Android Studio y JDK 21 solo para compilar el APK.

## Primeros pasos

```bash
npm install
cp .env.example .env        # llena los valores; nunca subas claves reales
npm run dev                 # web en http://localhost:5173
npm run dev:api             # backend en http://localhost:8787
```

Base de datos local:

```bash
spacetime start                       # servidor local en ws://localhost:3000
spacetime publish -s http://localhost:3000 --module-path packages/spacetime-module app-b20
npm run spacetime:generate            # genera bindings en packages/app/src/module_bindings
```

La base elegida para Maincloud es **`app-b20-34245`**; `app-b20` en el ejemplo anterior
es únicamente la base local. Para producción usa `VITE_SPACETIME_DB=app-b20-34245` y
`SPACETIMEDB_MODULE=app-b20-34245`, con las URLs de Maincloud indicadas en la
[guía de despliegue](docs/despliegue.md).

Este repositorio ya contiene la aplicación. No ejecutes aquí `spacetime init` ni un comando de
creación con `--template chat-react-ts`: esos pasos son para crear otra app de ejemplo. Para
trabajar con B20 usa `npm run dev`; para publicar, sigue la guía sobre el módulo existente.

El módulo ya está publicado en esa base, con `auth_config` y la primera invitación de
administrador preparados. Los callbacks locales, del dominio estable `app-b20.pages.dev` y
del enlace anterior `af0dd1ec.app-b20.pages.dev` ya están registrados en el cliente
`client_034jL0AHYYQ1bps8SupHU0`. La primera prueba humana completa por correo y las
pruebas con dos cuentas siguen pendientes. La versión temporal no requiere invitación.
La web ya está publicada en
https://app-b20.pages.dev; la API todavía no está desplegada.

Para futuras actualizaciones del módulo, `npm run spacetime:publish:maincloud` apunta a
`app-b20-34245` con `--delete-data=never`; `npm run spacetime:publish` conserva el destino local
`app-b20`.

Consulta los callbacks ya registrados y ambos modos en
[`docs/spacetimeauth.md`](docs/spacetimeauth.md). Para esta fase basta SpacetimeAuth con correo
verificado y `VITE_DATA_MODE=demo`. No se monta la conexión a Maincloud ni el control de
invitaciones. La configuración de autenticación es obligatoria: si falta, aparece el error
de configuración; ni siquiera `?demo` permite saltarse el inicio de sesión.

Cuando se active `VITE_DATA_MODE=spacetime`, quien administra la base conservará las
invitaciones mediante `invite_member` y Ajustes. Ese modo exige membresía para consultar y
modificar datos del grupo; las cuentas de autenticación se conservan.

## Publicar la web en Cloudflare Pages

La web ya está publicada en **https://app-b20.pages.dev** mediante Pages y GitHub: el
despliegue del commit `59d17a7` terminó en **Success** y muestra el acceso real de B20. Su rama
de producción actual es `codex/pages-spacetimeauth`; `main` todavía contiene la versión
anterior. Sigue la [guía de Cloudflare Pages](docs/cloudflare-pages.md).

```sh
cp .env.pages.example .env.pages
npm run build:pages
npm run pages:dev
```

`build:pages` compila en modo `pages` con `VITE_DATA_MODE=demo` y
`VITE_WEB_ORIGIN=https://app-b20.pages.dev` para usar el dominio estable. Las nuevas
compilaciones llevan los alias a ese origen antes del login; no se trasladan parámetros de
retorno de autenticación entre dominios. No publiques `.env`; el ZIP solo contiene la web.
Para Cloudflare, los valores públicos viven en `wrangler.jsonc → vars`; `.env.pages` solo se
usa localmente y no se sube. Los retornos HTTPS de producción y del enlace anterior ya están
autorizados en SpacetimeAuth. Usa siempre **https://app-b20.pages.dev**; no hace falta
autorizar cada alias de despliegue. El subdominio `pages.dev` no necesita DNS ni Custom Domains.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run spacetime:publish` | Publica el módulo en la base local `app-b20`. |
| `npm run spacetime:publish:maincloud` | Actualiza `app-b20-34245` en Maincloud con `--delete-data=never`. |
| `npm run typecheck` | Revisa tipos en todos los paquetes. |
| `npm test` | Pruebas de reglas, sesiones y permisos (Vitest). |
| `npm run build` | Compila web, extensión y backend. |
| `npm run build:pages` | Compila la web para Cloudflare Pages en `apps/web/dist`. |
| `npm run pages:dev` | Prueba la web compilada con el servidor local de Pages. |
| `npm run pages:deploy` | Compila y sube con Wrangler usando la rama Git actual; la producción está vinculada a `codex/pages-spacetimeauth`. |
| `npm run build:extension` | Genera `apps/extension/dist`, que se carga en `chrome://extensions` con «Cargar descomprimida». |
| `npm run build:android` | Compila la web en modo Capacitor y sincroniza el proyecto Android. Después: `npm run open -w @b20/android`. |

## Reglas que el código ya respeta

- En `VITE_DATA_MODE=spacetime`, las tablas de SpacetimeDB son privadas; los clientes leen
  vistas que comprueban
  membresía activa. Los mensajes 1 a 1 solo los ven sus dos participantes.
- El modo `demo` exige una sesión de SpacetimeAuth con correo verificado y permite entrar
  sin invitación. Conserva los cambios simulados en memoria, separados por identidad, sin
  conexiones ni escrituras a Maincloud.
- El modo `spacetime` exige una invitación para unirse. Módulo y backend limitan la confianza
  al emisor y client IDs configurados; sus rutas protegidas requieren membresía activa.
- Ningún secreto vive en el cliente. Las claves de Gemini se guardan cifradas en el backend y
  solo se informa si existen.
- Los cumpleaños guardan día y mes, nunca el año, y son voluntarios.
- Los cambios importantes quedan en un historial con responsable y fecha.

## Pendientes por validar

- **SpacetimeAuth y simulación:** completar el enlace por correo, probar una cuenta verificada
  sin invitación y comprobar renovación, cierre, cambio de cuenta y reinicio de los datos al
  recargar. Los callbacks ya están guardados. Antes de activar `spacetime`, probar invitación,
  baja, persistencia y privacidad con dos cuentas. Extensión y Android requieren sus pruebas
  propias. Pasos en [`docs/spacetimeauth.md`](docs/spacetimeauth.md).
- **IA y BYOK:** la interfaz aún no conecta con la API, que requiere despliegue y configuración
  propios. Confirmar los requisitos de edad antes de habilitar Gemini. Esto no impide publicar
  la web y revisar la interfaz con datos simulados.
- **Archivos:** falta el almacenamiento remoto para adjuntos y stickers.
- **Costos y límites:** infraestructura, archivos, cuotas de API y presupuesto de cada clave.
- **Instalación y push:** PWA en iPhone, APK firmado con FCM y avisos de la extensión, probados en
  dispositivos reales.
- **Guías:** temarios, formatos de archivo y cómo señalar fuentes no procesadas.
- **Puntuación:** qué aportes cuentan, ponderación, límites y duplicados.

## Fuera de alcance

El módulo 3.11 (lenguaje de señales y respuestas preparadas para evaluaciones) no forma parte de
este proyecto.
