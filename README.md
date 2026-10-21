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

## Primera entrega: archivos en SpacetimeDB

La arquitectura elegida utiliza **SpacetimeAuth + SpacetimeDB** para autenticación,
membresía, datos, permisos y archivos privados; **Cloudflare Pages** sirve la web/PWA.
Las subidas nuevas se almacenan como fragmentos privados de **1 MiB**, hasta **50 MiB
(52,428,800 bytes)** por archivo, con reanudación y descarga bajo demanda. No se requiere
un bucket R2 ni una tarjeta para preparar esta entrega. Cloudflare Workers queda reservado
para integraciones que lo necesiten, como el cifrado BYOK en una entrega posterior.

Tareas y Actividades incorpora avance personal privado, borrador compartido/final,
revisión por otro compañero, historial recuperable con archivos, comentarios, vínculos
explícitos y filtros. La cuenta invitada se une con su nombre real; en Ajustes puede importar
el plan de estudios e invitar a los demás. La simulación no se importa a los datos reales.

La configuración de producción apunta a `VITE_DATA_MODE=spacetime`. La entrega local no
prueba por sí sola que el módulo actualizado esté publicado ni que se hayan completado
los recorridos con tres cuentas. Consulta [estado y criterios de cierre](docs/estado-del-proyecto.md),
[archivos en SpacetimeDB](docs/archivos-spacetime.md) y
[funcionamiento del módulo](docs/tareas-actividades.md).

Para desarrollar con ejemplos sigue disponible `VITE_DATA_MODE=demo`: exige inicio de sesión,
conserva cambios en memoria por cuenta y los reinicia al recargar. Las integraciones anteriores
con R2 se mantienen solo para recuperar archivos existentes; no se borran ni migran datos
remotos como efecto de compilar o ejecutar pruebas.

## Segunda entrega: colaboración

Canales, adjuntos directos privados, lectura por conversación, bloqueo y reportes selectivos;
notas con editor e historial, publicación voluntaria de copias personales y guías recuperables;
aclaraciones y utilidad en preguntas, perfiles con fotos privadas, calendario anual y novedades.
Los retiros conservan archivos y versiones; el ranking excluye borradores, retirados y duplicados.
Consulta el [alcance y la validación de la segunda entrega](docs/segunda-entrega.md).

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
  EX-1 implementa su base y validación local; la activación real y la interfaz completa de Exámenes siguen pendientes.
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
| **Lenguaje de señales — 3.11** | Diccionario versionado para los tres medios del documento, prácticas individuales y en parejas y fichas con fuente. Pendiente de la etapa 3. |
| **Exámenes con IA (BYOK) — 3.12** | Autoevaluaciones y simulacros con preguntas, respuestas explicadas y fuentes de notas, tareas, actividades, trabajos y guías. Borrador privado revisable, publicación voluntaria y resultados personales privados. EX-1 implementado localmente; interfaz completa EX-2 y ampliaciones EX-3 pendientes, con Gemini real desactivado. |

### Funciones adicionales

| Función | Qué hace | Etapa |
| --- | --- | --- |
| [Salas de estudio](docs/salas-de-estudio.md) | Implementado sin IA: sesiones abiertas o privadas, materiales, conversación, temporizador y resumen publicable. | 2 |
| Puedo ayudarte / necesito ayuda | Ofertas y solicitudes de ayuda por tema, voluntarias y sin exponer datos personales. | 2 |
| Retos de programación | Problemas cortos con pistas progresivas y soluciones explicadas; se prioriza la comprensión, no la velocidad. | 2 |
| Revisión de código | Fragmentos o enlaces con comentarios por línea y estado de cada observación. | 2 |
| Museo de bugs | Fichas de errores reales: intención, comportamiento, causa, corrección y aprendizaje. | 2 |
| Aprende enseñando | Prácticas privadas con preguntas guía, compañero invitado y publicación voluntaria de la explicación revisada en Notas de clase. Primera versión manual. | 2 |
| Repaso espaciado | Colecciones personales o compartidas desde notas y guías, con programación de revisiones e historial privado. | 2 |
| Radar de oportunidades | Talleres, hackatones, becas y concursos, con la opción «busco equipo». | 2 |
| Microproyectos | Equipos para proyectos pequeños, con pendientes, demostraciones y reconocimiento. | 3 |
| Simulador de exposiciones | Ensayar una explicación y responder preguntas antes de exponer. | 3 |
| Préstamo de materiales | Catálogo de libros, cables y herramientas con préstamos acordados, sin pagos. | 3 |

El catálogo que usa la interfaz para la navegación está en
[`packages/core/src/modules.ts`](packages/core/src/modules.ts).
La base EX-1 ya está disponible en Ajustes; Exámenes con intentos todavía no está incorporado a ese catálogo. Su alcance,
fuentes candidatas, criterios de aceptación y tareas están en
[`docs/examenes-ia.md`](docs/examenes-ia.md).

## Gemini con clave propia (BYOK)

| Área | Uso de Gemini |
| --- | --- |
| Tareas y Actividades | Explicar instrucciones, planear un enfoque, dar pistas y ayudar a depurar código. |
| Archivo de trabajos | Resumir documentos y comparar enfoques conservando sus fuentes. |
| Guías de parciales | Sintetizar materiales y temario, indicar cobertura y generar ejercicios revisables. |
| Exámenes con IA | Generar o regenerar preguntas con su explicación y fuentes; resolver y corregir exámenes guardados de la primera versión no requiere IA ni clave del participante. |
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

- **Web y PWA para iPhone:** instalación prevista mediante «Añadir a pantalla de inicio»
  y Web Push en sistemas compatibles; recepción pendiente de pruebas en dispositivos reales.
- **Extensión de Chrome (Manifest V3):** la app completa en el panel lateral y en una vista
  amplia, con todas sus dependencias empaquetadas y permisos mínimos.
- **APK para Android:** empaquetada con Capacitor y firmada. Con la restricción actual de
  proveedores se planifican avisos internos y recordatorios locales; el push nativo con la app
  cerrada permanece pendiente y no se presenta como resuelto.

Las notificaciones previstas cubrirán mensajes 1 a 1, menciones, nuevos trabajos, cambios de
fecha, respuestas, votaciones por cerrar, guías disponibles y cumpleaños, con preferencias por
categoría. Los mensajes directos mostrarán por defecto un aviso genérico, sin el texto.

## Etapas

| Etapa | Contenido |
| --- | --- |
| **0. Prototipo técnico** | Validar React, SpacetimeDB, autenticación y permisos en las tres presentaciones; PWA con push en iPhone, APK firmado y extensión con panel lateral. Push nativo Android pendiente bajo la restricción de proveedores. |
| **1. MVP** | Acceso exclusivo, perfiles, Tareas y Actividades, notas, preguntas, ¿Qué me perdí?, mensajería del grupo y 1 a 1, cumpleaños y Gemini para explicar y generar borradores de guía. |
| **2. Colaboración y estudio** | Guías integrales, Exámenes con IA (3.12, condicionado a BYOK), búsqueda, repaso espaciado, salas de estudio, ayuda entre compañeros, retos, revisión de código, museo de bugs, votaciones y radar de oportunidades. |
| **3. Comunidad** | Stickers, leaderboard verificable, microproyectos, simulador de exposiciones, préstamo de materiales y lenguaje de señales (3.11). |

Las etapas no son fechas comprometidas; las fechas y costos se estimarán después del prototipo.

Exámenes con IA se divide en **EX-1** (base BYOK y selección/lectura de fuentes reutilizable
con Guías), **EX-2** (primera versión desde texto, revisión, práctica y simulacro, corrección
sin IA, historial privado y publicación voluntaria) y **EX-3** (más fuentes, adjuntos,
preguntas abiertas, banco reutilizable e integración con Repaso). EX-1 está implementado y
verificado localmente; EX-2/EX-3 y la activación real siguen pendientes. Tienen su [desglose de tareas](docs/examenes-ia.md); no renumeran las entregas
generales del proyecto.

## Estructura del repositorio

```
app-b20/
├── apps/
│   ├── web/              Web + PWA instalable en iPhone (Vite, service worker con Web Push)
│   ├── extension/        Extensión de Chrome Manifest V3: panel lateral y vista completa
│   ├── android/          APK Android con Capacitor (usa la compilación de apps/web)
│   └── api/              Worker Hono: compatibilidad de archivos R2 anteriores; futuras integraciones
├── packages/
│   ├── app/              Interfaz React compartida por web, extensión y Android
│   ├── core/             Catálogo de módulos, plan de estudios y reglas de negocio (con pruebas)
│   └── spacetime-module/ Módulo de servidor SpacetimeDB: tablas, reducers y vistas
└── docs/
    ├── arquitectura.md   Cómo encajan las piezas y qué falta validar
    ├── spacetimeauth.md  Panel de autenticación, variables e invitación inicial
    ├── cloudflare-pages.md   Web en el subdominio gratuito de Cloudflare Pages
    ├── despliegue.md     Publicación de web, base de datos e integraciones opcionales
    ├── archivos-spacetime.md   Subidas privadas por fragmentos y migración conservadora
    ├── estado-del-proyecto.md  Matriz de requisitos y comprobaciones pendientes
    ├── examenes-ia.md     Alcance, fuentes y tareas de Exámenes con IA (pendiente)
    └── definicion-del-proyecto.md   Alcance funcional completo
```

Las tres presentaciones son la misma app con los mismos datos; solo cambia el empaquetado. La
interfaz recibe la presentación como `platform` para adaptarse (por ejemplo, navegación compacta
en el panel lateral).

**Pila técnica:** React + TypeScript + Vite; SpacetimeAuth y SpacetimeDB para sesiones, datos
y archivos privados; Cloudflare Pages para web/PWA. Cloudflare Workers será un complemento
cuando una integración lo requiera. Gemini, push y papelera de 30 días corresponden a entregas
posteriores. No se requieren Supabase, D1, Google Cloud Storage ni Secret Manager.

## Requisitos

- Node.js 22 o superior y npm 10.
- [CLI de SpacetimeDB](https://spacetimedb.com/install) compatible con el SDK `spacetimedb`
  **2.12.0**, fijado tanto en cliente como módulo, para publicar y generar bindings.
- Android Studio y JDK 21 solo para compilar el APK.

## Primeros pasos

```bash
nvm use                     # selecciona Node 22 para esta terminal, según .nvmrc
npm install
cp .env.example .env        # llena los valores; nunca subas claves reales
npm run dev                 # web en http://localhost:5173
npm run dev:api             # opcional: compatibilidad con archivos R2 anteriores
```

Si Node 22 aún no está instalado, ejecuta `nvm install` y después `nvm use` desde esta
carpeta. Repite `nvm use` al abrir otra terminal antes de instalar dependencias, ejecutar
pruebas o compilar. Esto solo cambia la terminal actual; no modifica la versión global de
otros proyectos. Sin nvm, selecciona Node 22 o superior con tu gestor de versiones.

`npm run build` y `npm run build:pages` comprueban la versión antes de compilar. Con Node 20
se detienen de inmediato con las instrucciones para corregirla; la API de archivos requiere
Node 22 o superior para empaquetarse con Wrangler.

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

El registro del despliegue anterior indica el módulo en esa base, con `auth_config` y la
primera invitación de administrador preparados; no confirma la publicación del módulo actualizado. Los callbacks locales, del dominio estable `app-b20.pages.dev` y
del enlace anterior `af0dd1ec.app-b20.pages.dev` ya están registrados en el cliente
`client_034jL0AHYYQ1bps8SupHU0`. El acceso humano por enlace al correo y la separación entre
cuenta real y perfiles simulados se comprobaron el 20 de octubre de 2026. Siguen pendientes
las pruebas humanas con un correo sin invitación, renovación al vencer la sesión y cambio de
cuenta. La versión temporal no requiere invitación.
Direcciones históricas registradas: web https://app-b20.pages.dev y Worker R2
https://app-b20-api.sucanasta1.workers.dev. No confirman que la versión de esta entrega esté
publicada; su despliegue y comprobación se registran por separado.

Para futuras actualizaciones del módulo, `npm run spacetime:publish:maincloud` apunta a
`app-b20-34245` con `--delete-data=never`; `npm run spacetime:publish` conserva el destino local
`app-b20`.

Consulta los callbacks y ambos modos en [`docs/spacetimeauth.md`](docs/spacetimeauth.md).
En producción se usa `VITE_DATA_MODE=spacetime` y se exige una invitación para unirse al grupo.
El modo de desarrollo `demo` conserva ejemplos en memoria sin escribir en Maincloud; ningún
modo permite saltarse el inicio de sesión mediante la URL.

## Publicar la web en Cloudflare Pages

El despliegue anterior registrado está en **https://app-b20.pages.dev** mediante Pages y
GitHub: el commit `59d17a7` terminó en **Success**. La configuración registrada usa
`codex/pages-spacetimeauth` como rama de producción; verificarla antes de publicar esta entrega.
Ese registro no acredita que los archivos por fragmentos estén activos. Sigue la
[guía de Cloudflare Pages](docs/cloudflare-pages.md).

```sh
cp .env.pages.example .env.pages
npm run build:pages
npm run pages:dev
```

`build:pages` compila en modo `pages` con `VITE_DATA_MODE=spacetime` y
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
- Gemini real permanece deshabilitado. EX-1 implementa claves personales cifradas en
  SpacetimeDB mediante un Worker y muestra solo su estado; su activación real sigue pendiente.
- Los cumpleaños guardan día y mes, nunca el año, y son voluntarios.
- Los cambios importantes quedan en un historial con responsable y fecha.

## Pendientes por validar

- **SpacetimeAuth y simulación:** el acceso por correo y la separación de la cuenta real ya se
  comprobaron. Probar manualmente un correo sin invitación, la renovación al vencer la sesión,
  cierre, cambio de cuenta y reinicio de datos al recargar. Los casos de acceso sin invitación,
  renovación y cambio de cuenta tienen pruebas automatizadas; su prueba humana sigue
  pendiente. Para cerrar esta entrega, probar invitación,
  baja, persistencia y privacidad con autor, compañero autorizado y tercero. Extensión y Android requieren sus pruebas
  propias. Pasos en [`docs/spacetimeauth.md`](docs/spacetimeauth.md).
- **IA y BYOK:** EX-1 está implementado y probado localmente con un proveedor simulado.
  Configuración, elegibilidad del grupo, publicación y prueba con Gemini real siguen pendientes.
- **Archivos:** la primera entrega incorpora archivos académicos privados en SpacetimeDB.
  Deben comprobarse los recorridos reales y la preservación de archivos anteriores; stickers y
  adjuntos de mensajes utilizarán el mismo almacenamiento al completar sus módulos.
- **Costos y límites:** infraestructura, archivos, cuotas de API y presupuesto de cada clave.
- **Instalación y push:** probar PWA en iPhone, APK firmado y avisos de la extensión en
  dispositivos reales. El push nativo Android sigue pendiente bajo la restricción de proveedores.
- **Guías:** temarios, formatos de archivo y cómo señalar fuentes no procesadas.
- **Puntuación:** qué aportes cuentan, ponderación, límites y duplicados.

## Alcance pendiente

El módulo **3.11 sí está incluido** y se mantiene pendiente en el catálogo de la etapa 3, sin
marcarlo como disponible. La [matriz de requisitos](docs/estado-del-proyecto.md) distingue
implementación local, pruebas automatizadas y validación real.

La configuración y las pruebas sin consumo de EX-1 están en
[operación de Exámenes con IA](docs/examenes-ia-operacion.md).
