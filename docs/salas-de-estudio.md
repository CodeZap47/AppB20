# Salas de estudio

La primera versión funciona sin Gemini. Una sala reúne una agenda, notas y guías de una
materia, conversación, dudas, conclusiones, temporizador compartido y resumen colaborativo.
Se encuentra en **Salas de estudio** (`/m/salas`) y utiliza los mismos permisos en demo y
SpacetimeDB. La demo conserva su aviso de datos temporales y se reinicia al recargar.

## Organizar y participar

- **Abiertas:** cualquier integrante activo puede consultar la ficha e inscribirse mientras
  haya cupo. Solo los inscritos ven participantes, materiales, chat, temporizador y resumen.
- **Privadas:** únicamente los inscritos y quienes tienen una invitación pendiente ven la
  ficha. Aceptar la invitación concede acceso y ocupa una plaza; rechazarla no inscribe.
- El organizador cuenta para el cupo. Las invitaciones pendientes no reservan plazas y el
  servidor comprueba la última plaza al inscribirse o aceptar.
- La visibilidad y materia quedan fijadas al crear la sala. Los horarios se capturan en la
  zona local, se guardan en UTC y se presentan en la zona del dispositivo.
- Los estados son **Programada**, **En curso**, **Finalizada** y **Cancelada**. El organizador
  comienza y finaliza explícitamente la sesión; alcanzar su horario no la inicia automáticamente.

Todos los inscritos pueden cambiar el horario, cupo, título, tema y objetivo, gestionar
materiales, controlar el temporizador y editar el resumen. Una versión desactualizada no
sobrescribe cambios de otra persona: el formulario conserva su borrador para revisarlo.

El organizador invita y retira integrantes, finaliza o cancela y publica el resumen. Quien
sale pierde acceso al contenido. Una retirada exige otra invitación para volver a entrar.
El organizador cancela en lugar de abandonar la sala; su baja del grupo cancela las salas
activas y detiene sus temporizadores. Los demás inscritos conservan el historial.

## Estudiar y conservar resultados

La conversación admite mensajes de texto, dudas y conclusiones con autoría. Los archivos se
consultan a través de las notas y guías enlazadas; no se copian al chat de la sala. La
conversación permanece separada de los canales públicos de Mensajes.

El temporizador comienza con bloques de **25 minutos de estudio y 5 de descanso**, ajustables.
Cualquier inscrito puede iniciar, pausar, continuar y reiniciar. Cuando termina un bloque
permanece en cero hasta que alguien inicia la siguiente fase. El servidor conserva fase,
tiempo y versión; los clientes calculan la cuenta desde una referencia horaria del servidor,
sin escribir en la base cada segundo. Recargar o reconectar recupera ese estado.

El resumen es común y editable por los inscritos. Al finalizar la sala, el chat queda de
consulta y el resumen puede seguir completándose. Cancelar deja la sala de consulta.

El organizador puede revisar la vista previa y **publicar el resumen como una nota del grupo**.
La nota lleva su autoría y origen «Apunte de alumno». Solo se publica el texto del resumen;
no se agregan mensajes, dudas, participantes ni datos del contacto de Ayuda automáticamente.
La creación de la nota y su identificador en el resumen son una sola operación. Reintentar
abre la misma nota. Los cambios posteriores de la nota y del resumen son independientes.

## Integración con los módulos

- **Ayuda:** un contacto aceptado ofrece «Organizar sesión». Se precargan materia y tema,
  se propone una sala privada y la otra persona recibe una invitación que debe aceptar.
  Solo puede existir una sala activa por contacto; se puede organizar otra tras finalizar o
  cancelar. La relación con el contacto es privada de las dos personas. No se copian el
  mensaje inicial, la conversación ni la disponibilidad. Cerrar el contacto no cancela la sala.
- **Notas y Guías:** «Estudiar en una sala» permite crear una sesión o añadir el material a
  una sala de la misma materia en la que ya se participa. Se conserva referencia y versión,
  sin copiar contenido. Solo se admiten notas compartidas y guías accesibles al grupo.
  Una nota personal requiere publicar primero una copia explícita desde Notas. Retirar una
  fuente impide seguir entregando su referencia y contenido en la sala.
- **Aprende enseñando:** cada participante puede comenzar una práctica privada con el tema
  de la sala y, opcionalmente, una nota o guía seleccionada. La explicación empieza vacía.
  La sala no recibe la práctica, sus preguntas, reflexión ni fuentes personales. El autor
  mantiene el control de su único revisor. Para compartir la explicación se publica primero
  como nota y después se añade esa nota a los materiales de la sala.

## Privacidad y validación

Las tablas son privadas y las vistas comprueban membresía e inscripción. Administrar la
aplicación no concede acceso al contenido de salas privadas ni de salas abiertas sin
inscripción. Salir, ser retirado o perder membresía elimina el contenido de la suscripción
y desmonta los formularios y borradores del cliente.

La actividad interna no genera puntos ni novedades públicas. Una nota publicada sigue las
reglas normales de Notas, Perfiles, Novedades y Contribuciones.

Las pruebas abarcan permisos, cupo, invitaciones, conflictos, temporizador, fuentes,
publicación única y recorridos entre módulos. El ensayo `scripts/smoke-spacetime-rooms.mjs`
usa un servidor persistente temporal y tres identidades sintéticas, sin cuentas ni datos de
producción. Las comprobaciones locales se registran por separado del despliegue y del piloto
con cuentas reales. La publicación en Maincloud y Cloudflare Pages y su comprobación con
la cuenta autorizada se registran más adelante. No sincroniza Android ni activa Gemini o push.

Para repetir las comprobaciones, selecciona primero Node 22 con `nvm use` y ejecuta:

```sh
npm run typecheck
npm test
npm run test:spacetime:rooms
npm run build
npm run build:pages
npm run build -w @b20/web -- --mode capacitor
```

El último comando compila únicamente la web para Capacitor; no ejecuta `cap sync` ni
modifica el proyecto Android. El ensayo real de Salas cubre tres identidades y un reinicio,
incluidos permisos privados, retirada inmediata de acceso, control simultáneo del
temporizador, última plaza concurrente y publicación única. Los recorridos de la aplicación
usan `DemoDataSource` y las acciones reales, con la sesión de acceso simulada. Se revisaron
también el panel lateral, el ancho móvil de 390 píxeles y acciones mediante Tab/Enter.

### Resultado local del 21 de octubre de 2026

- Node 22.23.3: revisión de tipos global y **814 pruebas aprobadas** (App 463, Core 72,
  servidor 184, API 50 y Web 45).
- Compilaciones Web/PWA, extensión, API heredada en modo dry-run, Pages y web en modo
  Capacitor aprobadas. En esa validación local no se ejecutó sincronización de Android ni
  despliegue.
- Ensayo real de Salas aprobado con tres identidades y un reinicio; las pruebas de
  aplicación cubren Ayuda, Notas, Guías, prácticas privadas, publicación y revocación.
- Sin errores bloqueantes. Persisten advertencias de empaquetado por bloques JavaScript
  superiores a 500 kB y la opción obsoleta `inlineDynamicImports` usada por PWA.
- Evidencia visual local: `artifacts/rooms/mobile-published-summary.png` y
  `artifacts/rooms/side-panel.png`. Los archivos temporales de la revisión y su servidor
  local fueron retirados al terminar.

### Integración y despliegue — 21 de octubre de 2026

La integración parte de `2691430`, revisión de la rama de producción de Pages que conserva
Tareas y archivos nativos, e incorpora `5f2e91f`, revisión de `main` con Salas y la segunda
entrega. Se realizó en una copia aislada para conservar los cambios de IA que siguen en
desarrollo en la carpeta original. La revisión de código publicada es `1640d53`; `main` y
`codex/pages-spacetimeauth` quedaron sincronizadas con esa revisión.

- La integración pasó **814 pruebas**, revisión global de tipos y compilaciones web/PWA,
  extensión y Pages. Los ensayos persistentes de Salas, segunda entrega y archivos nativos
  aprobaron. Los **218 bindings** coinciden semánticamente con el módulo.
- Maincloud se actualizó con `--delete-data=never`. El programa publicado coincide byte
  por byte con el generado localmente: **2.566.289 bytes**, SHA-256
  `a482b6c32628f57e2f4bfcd0d607efbae755ef83f52aab90919ae76e4353ca25`.
- Se conservaron las huellas y conteos de las **60 tablas anteriores y sus 257 registros**.
  Se añadieron 23 tablas y quedaron 83 en total. No se reinició la base ni se importaron
  ejemplos de la demo. La evidencia de conservación no guarda valores privados de filas.
- Pages terminó correctamente en el despliegue `4c0df8d0-e065-4d8e-9d9f-e439ef7c6dc7`.
  Los **13 archivos de ejecución** del dominio estable coinciden por SHA-256 con la
  compilación preparada. El cliente usa datos reales de `app-b20-34245` en Maincloud e
  incluye Salas. Inicio, retornos de acceso y `/m/salas` responden con HTTP 200 y la app.

Las evidencias operativas están en `artifacts/rooms-release/`: comparación de datos,
verificación del programa de Maincloud, comparación de bindings, resultados de pruebas y
`pages-public-verification.json`. Esta carpeta permanece fuera de Git.

### Comprobación con datos reales — 21 de octubre de 2026

El recorrido en la web publicada utiliza una única cuenta autorizada. Se comprobó crear y
editar una sala privada, recargar y conservar los cambios, iniciarla y usar el temporizador:
cambiar de 25 a 1 minuto, iniciar, pausar, continuar, recargar, terminar el bloque en cero,
iniciar manualmente el descanso y reiniciar. Se guardaron un mensaje, una duda y una
conclusión. El resumen persistió y se publicó como una nota que contiene únicamente su
texto. Tras finalizar la sala, la conversación quedó de consulta.

La integración con Aprende enseñando precargó la materia y el tema, dejando la explicación
vacía; no se guardó una práctica de prueba. Se creó una segunda sala desde la nota publicada,
con materia y tema precargados, y se comprobó retirar y volver a añadir ese material. La
nota de prueba se retiró de forma recuperable, con motivo, versión e historial conservados;
su referencia desapareció inmediatamente de los materiales de la sala.

La segunda sala se inició con un temporizador de 25 minutos. Al confirmar su cancelación
quedó de consulta, con el temporizador detenido y sin formularios de conversación ni resumen
editable. La primera sala quedó finalizada y la segunda cancelada; no quedaron salas de
prueba activas. La vista móvil de **390 × 844 píxeles** mantuvo el ancho de la página y del
contenido en 390 píxeles, sin desbordamiento horizontal. Evidencia de la web real:
`artifacts/rooms-release/real-mobile-material.png`.

Los permisos entre participantes, invitaciones, cupo concurrente y revocación se comprobaron
con tres identidades sintéticas en un servidor local persistente. La prueba de producción
con una cuenta no sustituye la validación entre varias personas reales; ese recorrido y la
creación de una sala desde un contacto aceptado de Ayuda siguen pendientes de otra cuenta
autorizada. No se activó IA ni se sincronizó Android.
