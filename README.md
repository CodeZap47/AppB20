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
Según el registro de estado, el despliegue público conserva una versión anterior.
**La publicación de esta entrega y los recorridos completos con cuentas reales en producción
siguen pendientes de validación.**

Hay dos modos de datos, ambos con inicio de sesión:

- **`demo`:** ejemplos ficticios en memoria, separados por cuenta. Los cambios se reinician
  al recargar, cerrar sesión o cambiar de cuenta; no se importan a la base real.
- **`spacetime`:** datos persistentes, invitaciones y permisos de membresía. Es el modo previsto
  en la configuración de producción; su disponibilidad debe comprobarse con la versión publicada.

**Gemini está deshabilitado y pendiente de integración.** Se prevé utilizar claves personales
(BYOK, «trae tu propia clave»), con consentimiento y control del consumo. También están
pendientes los avisos, recordatorios y notificaciones push completos.

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
| **Mensajes** | **Parcial.** Canal general, conversaciones directas, reacciones y herramientas de stickers. Los canales por materia o proyecto, adjuntos con archivos reales, lectura por conversación, menciones y silenciado siguen pendientes. |
| **Notas de clase** | **Parcial.** Apuntes personales y del grupo, revisiones y comentarios. El editor enriquecido, la organización por sesión y la restauración completa requieren trabajo adicional. |
| **Preguntas y respuestas** | **Parcial.** Dudas, respuestas, aceptación, reapertura y búsqueda de preguntas similares. Faltan adjuntos y otras herramientas para relacionarlas con materiales. |
| **Guías de estudio** | **Manual.** Fuentes, cobertura del temario, revisiones y compendio imprimible. La extracción de archivos, el historial recuperable y los borradores con Gemini están pendientes. |
| **Ayuda entre compañeros** | **Manual.** Ofertas y solicitudes de ayuda, contactos privados y conversación al aceptar el contacto. Pendiente de validación real. |
| **Aprende enseñando** | **Manual.** Explicaciones, preguntas de un compañero invitado, reflexión privada y publicación voluntaria de una nota. Pendiente de validación real y asistencia con IA. |
| **Repaso espaciado** | **Manual.** Colecciones, tarjetas, cola de repaso e historial privado. Pendientes la validación real, los recordatorios y los borradores con Gemini. |
| **Votaciones y contribuciones** | Votaciones nominales con participantes elegibles y reglas de cierre; puntos con reglas y desglose de aportes. Falta validar con datos reales y acordar la puntuación con el grupo. |
| **Perfiles y cumpleaños** | **Parcial.** Identidad, trabajos compartidos y cumpleaños voluntarios con día y mes. Las fotos, el portafolio completo, la vista anual y los recordatorios están pendientes. |
| **¿Qué me perdí?** | **Parcial.** Novedades y última visita. Falta completar la cobertura de módulos y separar la lectura de chats de las novedades generales. |

Salas de estudio, retos, revisión de código, museo de bugs, oportunidades, microproyectos,
simulador de exposiciones, préstamos y lenguaje de señales pertenecen al alcance futuro.
Consulta la [definición del proyecto](docs/definicion-del-proyecto.md) para conocer su propósito.

## Plataformas

Las tres presentaciones comparten la interfaz React y el modelo de datos; cada una necesita
su configuración de acceso y sus comprobaciones antes de distribuirse.

| Plataforma | Estado |
| --- | --- |
| **Web y PWA** | Compilación web/PWA disponible y alojamiento previsto en Cloudflare Pages. La instalación y las actualizaciones deben comprobarse en dispositivos reales, incluido iPhone; Web Push sigue pendiente. |
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

Cloudflare Workers queda como complemento para integraciones posteriores. La ruta heredada
de archivos en R2 se conserva por compatibilidad; las instalaciones nuevas guardan los archivos
en SpacetimeDB. Los detalles están en la [arquitectura](docs/arquitectura.md).

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
| `npm run build` | Compila web, extensión y API de compatibilidad. |
| `npm run build:pages` | Genera la web para Cloudflare Pages. |
| `npm run build:extension` | Genera `apps/extension/dist` para cargarla desde `chrome://extensions` con «Cargar descomprimida». |
| `npm run build:android` | Compila la web y sincroniza Capacitor. Abre Android Studio con `npm run open -w @b20/android` para continuar con el APK. |

Para publicar servicios y configurar producción, sigue la [guía de despliegue](docs/despliegue.md).

## Documentación

- [Definición del proyecto](docs/definicion-del-proyecto.md): propósito y alcance funcional.
- [Estado del proyecto](docs/estado-del-proyecto.md): avances, pendientes y validaciones registradas.
- [Arquitectura](docs/arquitectura.md): componentes, datos y permisos.
- [Autenticación y acceso](docs/spacetimeauth.md): clientes, retornos e invitaciones.
- [Tareas y Actividades](docs/tareas-actividades.md): consignas, trabajos, evidencias e historial.
- [Exposiciones](docs/exposiciones.md): ensayos por texto, preguntas y siguientes intentos privados.
- [Archivos en SpacetimeDB](docs/archivos-spacetime.md): límites, transferencias y compatibilidad.
- [Cloudflare Pages](docs/cloudflare-pages.md): configuración de la web/PWA.
- [Despliegue](docs/despliegue.md): publicación de servicios y comprobaciones de producción.
