# App B20

**Un espacio para organizar el trabajo del grupo y aprender entre compañeros.**

App B20 es una plataforma colaborativa en desarrollo para el grupo B20 de Ingeniería en
Desarrollo de Software. Reúne tareas, actividades, apuntes, guías y dudas para que los recursos
académicos sean fáciles de encontrar y la ayuda entre compañeros tenga un lugar propio.

## Qué es App B20

- **Un archivo académico compartido:** materiales organizados por materia, cuatrimestre y
  parcial, con autoría e historial según el recurso.
- **Una comunidad del grupo:** comunicación, preguntas, apoyo y herramientas para estudiar
  juntos. En el modo de datos reales, el acceso requiere invitación y membresía activa.
- **Colaboración con espacios personales:** las consignas se editan entre compañeros; los
  trabajos conservan sus autores, y los mensajes directos y el avance personal tienen
  permisos propios.

La gestión académica es compartida; los creadores mantienen los servicios y administran las
membresías. La app sirve de apoyo entre compañeros y complementa las indicaciones docentes;
las entregas, calificaciones y asistencia oficiales siguen en los sistemas de la universidad.

## Estado actual

El proyecto tiene una interfaz compartida, autenticación con SpacetimeAuth y una implementación
de datos y archivos privados en SpacetimeDB. Las comprobaciones automatizadas incluyen tipos,
pruebas, compilaciones y transferencia de archivos contra un servidor local persistente.
La [web publicada](https://app-b20.pages.dev/) reúne la cuarta entrega, Exámenes EX-2,
Guías y la navegación y mensajería de Untitled UI. La [sincronización del 21 de octubre
de 2026](docs/sincronizacion-2026-10-21.md) registra la versión, las pruebas y la conservación
de los datos. Los recorridos de aceptación con compañeros siguen pendientes.

Hay dos modos de datos, ambos con inicio de sesión:

- **`demo`:** ejemplos ficticios en memoria, separados por cuenta. Los cambios se reinician
  al recargar, cerrar sesión o cambiar de cuenta; no se importan a la base real.
- **`spacetime`:** datos persistentes, invitaciones y permisos de membresía. Es el modo
  publicado en producción, con datos y archivos en Maincloud.

La [tercera entrega](docs/tercera-entrega.md) incorpora Gemini con claves personales
(BYOK), borradores privados y publicación expresa; bandeja de avisos, recordatorios y Web Push;
y papelera con recuperación durante 30 días. El servicio compartido de IA y el programador
de avisos están publicados; la generación requiere consentimiento y clave personal.
Las llamadas reales a Gemini y la recepción push en dispositivos conservan su validación pendiente.

La [matriz de estado](docs/estado-del-proyecto.md) detalla lo implementado, lo pendiente y
la evidencia necesaria para cerrar cada entrega.

## Funciones principales

Esta tabla resume la implementación actual, no una lista de funciones terminadas en producción.
**Parcial** indica que falta parte del alcance o su validación; **manual** identifica una
primera versión sin IA que también requiere comprobación con cuentas reales.

| Función | Implementación y pendientes |
| --- | --- |
| **Tareas y Actividades** | **Parcial.** Consignas compartidas, trabajos por alumno o equipo, avance privado, estados, revisiones, comentarios e historial de trabajos. Incluye actividades de clase y evidencias. Falta cerrar la validación de permisos, coautorías y archivos con el grupo. |
| **Archivos privados** | Subidas por fragmentos, reanudación, cancelación y descarga con permisos, hasta **50 MiB por archivo**. Hay pruebas locales con servidor persistente; queda pendiente comprobar el recorrido en producción. |
| **Mensajes** | Canal general y canales de materia/tema/proyecto, directos con adjuntos privados, menciones, lectura, silencio, bloqueo y reportes selectivos; stickers nativos de SpacetimeDB. |
| **Notas de clase** | Editor estructurado, sesión y parcial, relaciones, adjuntos e historial recuperable. Publicar una nota personal crea una copia independiente para el grupo. |
| **Preguntas y respuestas** | Adjuntos privados, aclaraciones, utilidad por integrante y enlaces a notas/guías compartidas; aceptación y reapertura. |
| **Guías de estudio** | Fuentes, cobertura, revisiones e historial recuperable; preparación local de PDF textual, DOCX, TXT, Markdown y código, con transcripción revisable y citas. Borradores privados con Gemini y publicación expresa; los formatos no admitidos se muestran como omisiones. |
| **Exámenes EX-2** | Generación, revisión y versiones; práctica, simulacro y resultados privados. Incluye preguntas de opción única y verdadero/falso. La preparación inicial usa las fuentes de EX-1 y sus adjuntos de texto UTF-8 compatibles; la extracción PDF/DOCX de Guías no se incorpora automáticamente a Exámenes. |
| **Ayuda entre compañeros** | **Manual.** Ofertas y solicitudes de ayuda, contactos privados y conversación al aceptar el contacto. Pendiente de validación real. |
| **Aprende enseñando** | Explicaciones, preguntas de un compañero invitado o propuestas por Gemini, reflexión privada y publicación voluntaria de una nota. Los borradores de IA requieren revisión y aceptación. |
| **Repaso espaciado** | Colecciones, tarjetas, cola e historial privado; recordatorios y borradores revisables de Gemini con fuente/versiones. Los intervalos existentes se conservan. |
| **Retos y revisión de código** | Problemas, pistas progresivas, soluciones explicadas, versiones de código y observaciones por líneas con resolución del autor. Sin ejecutar código. |
| **Museo y oportunidades** | Fichas de errores dentro de Preguntas; oportunidades manuales con fuente, plazos, interés privado, búsqueda voluntaria de equipo y reportes. |
| **Exposiciones** | Ensayos por texto, preguntas, observaciones privadas y revisor voluntario. Audio y generación con Gemini siguen pendientes. |
| **Votaciones y contribuciones** | Votaciones nominales con participantes elegibles y reglas de cierre; puntos con reglas y desglose de aportes. Falta validar con datos reales y acordar la puntuación con el grupo. |
| **Perfiles y cumpleaños** | Presentación voluntaria, foto privada bajo demanda, portafolio y archivo de trabajos; calendario mensual/anual y recordatorios con preferencias y zona horaria. El planificador está publicado y configurado; queda pendiente validar la recepción en dispositivos. |
| **Avisos y papelera** | Bandeja privada, lectura y Web Push configurable; recuperación de contenido retirado antes de 30 días y purga programada con limpieza de referencias y bytes sin uso. |
| **¿Qué me perdí?** | Novedades de materiales, guías, votaciones abiertas, ayuda y repaso compartido; lectura de chats separada. Excluye contenido privado y retirado. |

Salas de estudio está implementada y publicada sin IA: acceso abierto o privado,
materiales, chat, temporizador y resumen. Sus pruebas locales y la comprobación publicada
se distinguen de la aceptación con varios compañeros. Consulta [su documentación](docs/salas-de-estudio.md).

La [cuarta entrega](docs/cuarta-entrega.md) está publicada con Retos, Revisión de código,
Museo de bugs y Radar de oportunidades, además de versiones e historial en Ayuda y Aprende
enseñando y borradores de IA de estudio. La [definición del proyecto](docs/definicion-del-proyecto.md)
conserva el alcance completo, incluidas las ampliaciones pendientes.

## Trabajo pendiente

Quedan tres módulos sin implementar, previstos para la quinta entrega:

- **3.11 Lenguaje de señales.**
- **7.6 Microproyectos.**
- **7.11 Préstamo de materiales.**

En módulos existentes, siguen pendientes estas ampliaciones:

- **Exposiciones:** audio y generación con Gemini.
- **¿Qué me perdí?:** resumen de novedades con IA.
- **Revisión de código:** revisión asistida por IA.
- **Exámenes EX-3:** fuentes adicionales; extracción de PDF/documentos y OCR; banco
  reutilizable y variantes; respuestas abiertas, rúbricas y evaluación asistida por IA.
  Estas ampliaciones quedan fuera del recorrido EX-2 ya publicado y se detallan en
  [el plan de Exámenes](docs/examenes-ia.md).

La publicación del código no cierra la aceptación humana. Siguen pendientes la prueba real
de Gemini con clave personal y confirmación, los recorridos con varias cuentas del grupo,
la recepción push y las comprobaciones en dispositivos, y el acuerdo de puntuación de
contribuciones. La matriz de estado y los recibos distinguen estas validaciones del alcance
todavía sin implementar.

## Segunda entrega: colaboración

Canales, adjuntos directos privados, lectura por conversación, bloqueo y reportes selectivos;
notas con editor e historial, publicación voluntaria de copias personales y guías recuperables;
aclaraciones y utilidad en preguntas, perfiles con fotos privadas, calendario anual y novedades.
Los retiros conservan archivos y versiones; el ranking excluye borradores, retirados y duplicados.
Consulta el [alcance y la validación de la segunda entrega](docs/segunda-entrega.md).

## Tercera entrega: IA, avisos y conservación

Gemini BYOK usa claves cifradas por persona en SpacetimeDB y una clave maestra en Cloudflare
Secrets. La vista previa muestra fuentes, versiones y omisiones antes de confirmar el envío;
las guías y explicaciones quedan privadas hasta su publicación expresa. La bandeja de avisos
funciona sin push; el Worker y su programación de avisos están publicados y configurados.
La recepción Web Push requiere permiso y suscripción del dispositivo y sigue pendiente
de validación real.
La papelera conserva contenido durante 30 días y después elimina los datos dependientes,
respetando las copias publicadas independientes y los archivos que todavía estén referenciados.

Los recorridos locales usan una base real aislada e identidades sintéticas, sin envío real
a Gemini ni dispositivos. La publicación en producción se acredita por separado en la
[sincronización conjunta](docs/sincronizacion-2026-10-21.md). Consulta el
[índice de la tercera entrega](docs/tercera-entrega.md) para conocer el alcance y sus límites.

## Plataformas

Las tres presentaciones comparten la interfaz React y el modelo de datos; cada una necesita
su configuración de acceso y sus comprobaciones antes de distribuirse.

| Plataforma | Estado |
| --- | --- |
| **Web y PWA** | Publicada en Cloudflare Pages. La instalación y las actualizaciones deben comprobarse en dispositivos reales, incluido iPhone. Web Push está implementado y su servicio configurado; quedan pendientes permiso, suscripción y pruebas de recepción en dispositivos. |
| **Extensión de Chrome** | Manifest V3, panel lateral y vista completa incluidos. La compilación puede cargarse descomprimida para desarrollo; acceso, actualizaciones y distribución requieren validación. |
| **Android** | Proyecto Capacitor que reutiliza la web. El comando de compilación prepara y sincroniza el proyecto; generar, firmar y distribuir el APK requiere pasos adicionales y pruebas en Android. El push con la app cerrada está pendiente. |

## Tecnologías

| Pieza | Tecnología y ubicación |
| --- | --- |
| Interfaz compartida | React, TypeScript y Vite; [`packages/app`](packages/app). |
| Reglas de negocio | Módulos, plan de estudios, permisos y reglas con pruebas; [`packages/core`](packages/core). |
| Datos y archivos | SpacetimeDB: tablas privadas, vistas con permisos y archivos por fragmentos; [`packages/spacetime-module`](packages/spacetime-module). |
| Autenticación | SpacetimeAuth, con correo verificado e invitaciones en el modo de datos reales. |
| Web/PWA y alojamiento | [`apps/web`](apps/web) y Cloudflare Pages. |
| Extensión y Android | [`apps/extension`](apps/extension) con Manifest V3 y [`apps/android`](apps/android) con Capacitor. |

Cloudflare Workers ejecuta el cifrado BYOK, las llamadas autorizadas a Gemini y la planificación
y entrega de avisos. La ruta heredada de archivos en R2 se conserva por compatibilidad;
las instalaciones nuevas guardan los archivos en SpacetimeDB. Los detalles están en la
[arquitectura](docs/arquitectura.md).

## Primeros pasos

### Requisitos

- **Node.js 22 o superior y npm 10.** El archivo `.nvmrc` selecciona Node 22.
- **CLI de SpacetimeDB 2.12.0** para trabajar con la base local o generar bindings, en la
  misma versión que el SDK del cliente y del módulo. No se necesita para explorar la demo.
- **Android Studio y JDK 21** solo si vas a preparar el APK.
- Un cliente de **SpacetimeAuth** configurado para iniciar sesión, también en modo demo.

### Ejecutar la web con datos de ejemplo

```bash
git clone https://github.com/CodeZap47/AppB20.git
cd AppB20
nvm use
npm install
cp .env.example .env.local
```

Si usas nvm y aún no tienes Node 22, ejecuta `nvm install` antes de `nvm use`. Si utilizas
otro gestor, selecciona Node 22 o superior antes de instalar las dependencias.

En `.env.local`, conserva `VITE_DATA_MODE=demo` y completa `VITE_SPACETIMEAUTH_CLIENT_ID`
con el ID público de tu cliente. Registra los retornos locales
`http://localhost:5173/auth/callback` y `http://localhost:5173/auth/logout` en SpacetimeAuth.
La [guía de autenticación](docs/spacetimeauth.md) explica la configuración; los secretos
deben permanecer fuera de las variables públicas `VITE_*` y del repositorio.

```bash
npm run dev
```

Abre `http://localhost:5173` e inicia sesión con un correo verificado. En la demo puedes
explorar perfiles ficticios y probar las funciones sin escribir en la base real.

### Trabajar con una base local

Inicia el servidor en otra terminal y déjalo en ejecución:

```bash
spacetime start
```

Desde la raíz del repositorio, publica el módulo en la base local y genera los bindings:

```bash
npm run spacetime:publish
npm run spacetime:generate
```

Configura el emisor, los clientes autorizados y la invitación inicial según la
[guía de autenticación](docs/spacetimeauth.md). Para esta base local, adapta los comandos
de la guía a `-s http://localhost:3000` y a la base `app-b20`. Después cambia `.env.local` a
`VITE_DATA_MODE=spacetime`, conserva la dirección local y el nombre de base de `.env.example`,
y reinicia la web. El inicio de sesión y la membresía son requisitos distintos.

### Comandos esenciales

| Comando | Qué hace |
| --- | --- |
| `npm run typecheck` | Revisa los tipos de los paquetes. |
| `npm test` | Ejecuta las pruebas automatizadas. |
| `npm run build` | Compila web, extensión y Worker de API e integraciones. |
| `npm run build:pages` | Genera la web para Cloudflare Pages. |
| `npm run build:extension` | Genera `apps/extension/dist` para cargarla desde `chrome://extensions` con «Cargar descomprimida». |
| `npm run build:android` | Compila la web y sincroniza Capacitor. Abre Android Studio con `npm run open -w @b20/android` para continuar con el APK. |

Para publicar servicios y configurar producción, sigue la [guía de despliegue](docs/despliegue.md).

## Documentación

- [Definición del proyecto](docs/definicion-del-proyecto.md): propósito y alcance funcional.
- [Estado del proyecto](docs/estado-del-proyecto.md): avances, pendientes y validaciones registradas.
- [Segunda entrega](docs/segunda-entrega.md): colaboración y presentación del grupo.
- [Tercera entrega](docs/tercera-entrega.md): Gemini BYOK, avisos y papelera de 30 días.
- [Cuarta entrega](docs/cuarta-entrega.md): colaboración, práctica de código e IA de estudio.
- [Guías con Gemini](docs/guias-estudio-ia.md): preparación de PDF/DOCX, borradores y publicación.
- [Exámenes EX-2](docs/examenes-entrega.md): recorrido publicado, conservación y aceptación pendiente.
- [Sincronización del 21 de octubre de 2026](docs/sincronizacion-2026-10-21.md): integración y recibo de publicación conjunta.
- [Arquitectura](docs/arquitectura.md): componentes, datos y permisos.
- [Autenticación y acceso](docs/spacetimeauth.md): clientes, retornos e invitaciones.
- [Tareas y Actividades](docs/tareas-actividades.md): consignas, trabajos, evidencias e historial.
- [Exposiciones](docs/exposiciones.md): ensayos por texto, preguntas y siguientes intentos privados.
- [Archivos en SpacetimeDB](docs/archivos-spacetime.md): límites, transferencias y compatibilidad.
- [Cloudflare Pages](docs/cloudflare-pages.md): configuración de la web/PWA.
- [Despliegue](docs/despliegue.md): publicación de servicios y comprobaciones de producción.
