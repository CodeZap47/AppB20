# B20 — cambios locales del 22 de octubre de 2026

Trabajo sobre `main`, base `b94506f`. **Sin commits, push ni despliegue.**

## Dos ediciones

- **Studio:** lavanda, ciruela y lima; tipografía Manrope; geometría y composición inspiradas en las referencias Learnora y Kids’ Language School proporcionadas por el usuario.
- **Campus:** azul y verde inspirados en el sitio de CESUN; tipografía Figtree; conserva la identidad B20 y no se presenta como un producto oficial de la universidad.

Las fuentes se alojan localmente y conservan sus licencias OFL. Ambas ediciones comparten comportamiento, datos y permisos. Se cambian desde el acceso o Ajustes. Las preferencias visuales respetan movimiento reducido.

`npm run build:variants` crea `build/studio` y `build/campus`, ignorados por Git. Cada carpeta contiene el acceso normal y `design-preview.html`, una entrada separada con datos ficticios para comparar pantallas. Esa entrada no se incluye en el build normal. Su código siempre instancia la demo, nunca una conexión a producción.

Para desarrollo normal: `npm run dev`, puerto 5173. La vista de diseño está en `/design-preview.html?theme=studio#/m/calendario`; `theme=campus` abre la otra edición. Los controles de la esquina permiten saltar entre pantallas y reproducir el tutorial.

## Funciones

### Acceso y sesión

La sesión OIDC puede conservarse al cerrar el navegador, con una casilla para elegirlo. Se solicita `offline_access`, soportado por los metadatos públicos actuales del proveedor, y se reutiliza la renovación de `oidc-client-ts`. Los tokens vencidos siguen sin dar acceso. Cerrar sesión elimina las copias persistente y temporal; las pestañas web sincronizan el cierre. La extensión dispone de almacenamiento persistente y temporal según la preferencia.

**Pendiente externo:** se comprobó la pantalla real de B20 en SpacetimeAuth: actualmente solo ofrece magic link. Los accesos sociales se muestran deshabilitados hasta que se configuren sus credenciales OAuth en ese proyecto. `VITE_SOCIAL_AUTH_ENABLED=true` solo debe establecerse después de comprobar esa configuración. No se solicitan ni se guardan contraseñas locales.

La [documentación de SpacetimeAuth](https://spacetimedb.com/docs/core-concepts/authentication/spacetimeauth/) no enumera passkeys entre sus métodos actuales. SpacetimeDB acepta otros proveedores OIDC, pero integrarlos requiere una decisión adicional sobre proveedor e identidades. No se implementó ni se anuncia un acceso por passkey.

El callback local del cliente sigue siendo `http://localhost:5173/auth/callback`. Servir los builds de comparación en otros puertos permite revisar su diseño; iniciar sesión en esos puertos requeriría registrar sus callbacks. Las vistas ficticias no requieren login.

### Primer recorrido

Tutorial de cuatro pasos para usuarios reales sin registro de finalización: colaboración, calendario/materias, personalización y publicación. Se guarda mediante `complete_onboarding` y la vista privada `my_onboarding`; es idempotente y sobrevive al reinicio. Ajustes permite repetirlo. La última pantalla puede abrir directamente el editor del perfil. La demo preexistente representa usuarios ya incorporados y permite abrir el recorrido manualmente.

### Perfiles

Se mantienen foto, portada, presentación, intereses, habilidades y enlaces con los límites existentes. El encabezado tiene nueva distribución y la presentación se mueve a una columna propia. Las secciones del archivo se muestran como navegación horizontal con contadores discretos; se conserva su comportamiento y sus filtros.

El distintivo dorado «lamerapoya» exige membresía activa y el rol de creador ya concedido por el servidor. Reconoce los nombres Luis Flores Bojorquez, Gamaliel Seefoo y Kevin Alcaraz; Christian se reconoce por su primer nombre hasta conocer el apellido. Se usa `member.displayName`, no el apodo personal del perfil. Esto **no concede ni modifica permisos**. Para una asignación inmutable futura deben confirmarse los IDs de las cuatro cuentas.

### Calendario y materias

- `/m/calendario`: mes de lunes a domingo, tareas en su fecha de entrega, filtros de materia, agenda del día y lista separada de consignas sin fecha. Las fechas son días locales y se validan, incluidos años bisiestos.
- `/m/materias` y `/m/materias/:subjectId`: materias por cuatrimestre, consignas, búsqueda y apuntes compartidos. Los apuntes vinculados aparecen bajo su tarea; el formulario puede recibir esa relación ya seleccionada. Las notas personales y retiradas no se incluyen como referencias compartidas.

### Escribiendo en mensajes

`set_typing` y `typing_presence` cubren grupo, canales y directos. Solo se guarda quién escribe, en qué conversación y hasta cuándo; no se transmite el borrador. El cliente limita la frecuencia, detiene la presencia al enviar, perder foco, cambiar de pantalla o quedar inactivo, y oculta los registros vencidos. El servidor revalida membresía, destino, bloqueo y canal archivado. Un administrador ajeno a un directo tampoco puede leer su presencia.

El cambio de esquema es aditivo. Se regeneraron los bindings con la CLI oficial SpacetimeDB **2.12.0**. Para activar estas funciones en datos reales, primero debe publicarse el módulo actualizado sin borrar datos y después el frontend; esta tarea no publica ninguno.

## Validación

La suite completa verifica 1.538 pruebas: interfaz 767, dominio 183, módulo 391, API 146 y web 51. El recorrido que abre todos los módulos tiene un timeout explícito de 15 segundos, porque navega el catálogo completo y sus paneles animados; no se cambió el timeout global.

`npm run test:spacetime:engagement` ejecuta un servidor temporal aislado, identidades sintéticas y cinco grupos de comprobaciones: finalización privada/idempotente del tutorial; presencia directa sin excepción administrativa; bloqueo y detención; canales/grupo; persistencia y revocación después de reiniciar. No usa cuentas, Gemini, push ni bases de producción.

La CLI descargada para este checkout está en `artifacts/tooling/spacetimedb-cli`. Puede seleccionarse con `B20_SPACETIME_CLI`; el script usa `spacetime` del PATH en otras instalaciones.

Se revisaron escritorio y móvil a 390 px. Las capturas y los resultados locales están en `artifacts/design`, ignorado por Git. El detector de diseño no señaló hallazgos. Las pruebas automatizadas y los builds no sustituyen la aceptación con usuarios reales ni verifican que un proveedor OAuth haya sido habilitado.
