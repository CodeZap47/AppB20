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
con cuentas reales. La publicación autorizada en Maincloud y Cloudflare Pages se prepara
por separado; no sincroniza Android ni activa Gemini o push.

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
  Capacitor aprobadas. No se ejecutó sincronización de Android ni despliegue.
- Ensayo real de Salas aprobado con tres identidades y un reinicio; las pruebas de
  aplicación cubren Ayuda, Notas, Guías, prácticas privadas, publicación y revocación.
- Sin errores bloqueantes. Persisten advertencias de empaquetado por bloques JavaScript
  superiores a 500 kB y la opción obsoleta `inlineDynamicImports` usada por PWA.
- Evidencia visual local: `artifacts/rooms/mobile-published-summary.png` y
  `artifacts/rooms/side-panel.png`. Los archivos temporales de la revisión y su servidor
  local fueron retirados al terminar.

### Preparación del despliegue — 21 de octubre de 2026

La integración parte de `2691430`, revisión de la rama de producción de Pages que conserva
Tareas y archivos nativos, e incorpora `5f2e91f`, revisión de `main` con Salas y la segunda
entrega. Se prepara en una copia aislada para conservar los cambios de IA que siguen en
desarrollo en la carpeta original. Los resultados de 814 pruebas anteriores corresponden a
la implementación local; la versión integrada requiere sus propias comprobaciones.

La publicación en Maincloud debe usar `--delete-data=never`. Antes y después se comparan
conteos y huellas SHA-256 de todas las tablas existentes, sin guardar valores privados en
la evidencia. No se reinicia la base ni se importan ejemplos de la demo. Pages se actualiza
después del backend mediante su rama de producción, `codex/pages-spacetimeauth`.

El despliegue y la comprobación con la cuenta real se consideran pendientes hasta registrar
la revisión del backend, el resultado de Pages, los assets del dominio estable y los
recorridos verificados. Las pruebas locales con tres identidades sintéticas no acreditan
participación entre varias cuentas reales. La comprobación de producción utilizará la
cuenta autorizada y registrará por separado cualquier escenario que requiera otra persona.
