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

## Qué es la app

- **Acceso exclusivo para el grupo**, por invitación y validación de membresía. Perfiles,
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
    └── definicion-del-proyecto.md   Alcance funcional completo
```

Las tres presentaciones son la misma app con los mismos datos; solo cambia el empaquetado. La
interfaz recibe la presentación como `platform` para adaptarse (por ejemplo, navegación compacta
en el panel lateral).

**Pila técnica:** React + TypeScript + Vite, SpacetimeDB para datos en tiempo real, inicio de
sesión con Google (OIDC) más lista autorizada, Google Cloud Storage para archivos (máximo 50 MB
por archivo), backend con `@google/genai` y almacén de secretos para Gemini, Web Push y FCM para
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
npm run spacetime:publish             # publica packages/spacetime-module como "app-b20"
npm run spacetime:generate            # genera bindings en packages/app/src/module_bindings
```

Quien publica el módulo por primera vez queda como creador inicial y puede invitar correos
con el reducer `invite_member`.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run typecheck` | Revisa tipos en todos los paquetes. |
| `npm test` | Pruebas de `core` y `api` (Vitest). |
| `npm run build` | Compila web, extensión y backend. |
| `npm run build:extension` | Genera `apps/extension/dist`, que se carga en `chrome://extensions` con «Cargar descomprimida». |
| `npm run build:android` | Compila la web en modo Capacitor y sincroniza el proyecto Android. Después: `npm run open -w @b20/android`. |

## Reglas que el código ya respeta

- Las tablas de SpacetimeDB son privadas; los clientes solo leen vistas que comprueban
  membresía activa. Los mensajes 1 a 1 solo los ven sus dos participantes.
- Acceso por invitación: unirse requiere sesión de Google con correo verificado que esté en la
  lista autorizada.
- Ningún secreto vive en el cliente. Las claves de Gemini se guardan cifradas en el backend y
  solo se informa si existen.
- Los cumpleaños guardan día y mes, nunca el año, y son voluntarios.
- Los cambios importantes quedan en un historial con responsable y fecha.

## Pendientes por validar

- **Edad y acceso a Gemini:** confirmar que el grupo cumple los términos antes de desplegar la
  integración.
- **Costos y límites:** infraestructura, archivos, cuotas de API y presupuesto de cada clave.
- **Instalación y push:** PWA en iPhone, APK firmado con FCM y avisos de la extensión, probados en
  dispositivos reales.
- **Guías:** temarios, formatos de archivo y cómo señalar fuentes no procesadas.
- **Puntuación:** qué aportes cuentan, ponderación, límites y duplicados.

## Fuera de alcance

El módulo 3.11 (lenguaje de señales y respuestas preparadas para evaluaciones) no forma parte de
este proyecto.
