# Gemini con clave personal

La tercera entrega permite preparar texto autorizado, generar una guía de ocho secciones
u obtener una explicación, guardar el borrador privado y publicarlo mediante una acción
expresa. SpacetimeDB conserva permisos, versiones, borradores, reservas de consumo y
claves cifradas. El Worker de Cloudflare cifra y descifra las claves y llama a Gemini.
Gemini es el proveedor elegido por el usuario; no se incorporan otros proveedores,
bases de datos ni servidores.

La generación comienza desactivada. Esta implementación y sus pruebas locales no
habilitan facturación ni publican servicios.

La [cuarta entrega](gemini-estudio.md) amplía este mismo servicio con preguntas clarificadoras
y tarjetas de Repaso, manteniendo los borradores privados y la aceptación manual. El
consentimiento vigente incluye esas finalidades.

## Configuración del operador

El Worker existente de `apps/api` utiliza estos valores:

| Valor | Dónde se configura | Uso |
| --- | --- | --- |
| `AI_ENABLED` | Variable de Cloudflare | Solo `true` permite generar. El valor incluido es `false`. |
| `GEMINI_MODEL` | Variable de Cloudflare | Modelo compatible con salida JSON estructurada, elegido por el operador. Comienza vacío. |
| `AI_MASTER_VERSION` | Variable de Cloudflare | Versión de la clave maestra activa; inicialmente `v1`. |
| `AI_MASTER_KEYS_JSON` | Cloudflare Secret | Objeto JSON de versiones a claves AES de 32 bytes codificadas en base64. |
| `AI_SERVICE_TOKEN` | Cloudflare Secret | Token de una identidad técnica exclusiva para IA en SpacetimeDB. |

Los secretos se introducen mediante `wrangler secret put` o el panel de Cloudflare;
no se incluyen en Git, variables `VITE_*`, archivos del cliente ni almacenamiento del
navegador. La clave maestra se genera con un generador criptográfico seguro. Una
rotación conserva las versiones antiguas hasta que sus claves personales se hayan
sustituido: una clave cifrada referencia su versión maestra.

En SpacetimeDB, el propietario registra la identidad técnica mediante `set_ai_service`
y establece un presupuesto diario de tokens estimados por persona. Esa identidad no
puede ser propietario, alumno ni servicio de archivos, notificaciones o mantenimiento.
El consentimiento de cada alumno y la habilitación del grupo son requisitos separados.
El operador confirma la elegibilidad del grupo antes de habilitar el servicio.

Después de configurar los secretos y el modelo, la app permite guardar la primera
clave personal. La disponibilidad de generación exige simultáneamente el flag del
Worker, la habilitación en SpacetimeDB, configuración completa, membresía vigente,
consentimiento vigente y una clave personal.

## Recorrido del alumno

1. En Ajustes, registrar el consentimiento y guardar la clave de Gemini. Guardarla no
   realiza una llamada de prueba. El formulario se limpia al enviar, cancelar o cambiar
   de cuenta y la clave no vuelve a mostrarse.
2. Elegir materia, parcial, temas y fuentes. También se puede iniciar desde una nota o
   guía. Preparar la vista previa no llama a Gemini y no requiere clave.
3. Revisar los fragmentos exactos, versiones, correspondencia con temas y omisiones.
   Los nombres detectables de miembros, correos y patrones de credenciales se retiran.
   La revisión humana sigue siendo necesaria para datos que no detectan esos patrones.
4. Confirmar expresamente el envío y su posible consumo de cuota o cargos del proyecto
   de Google. La app muestra el presupuesto de tokens; no afirma un precio monetario.
5. Revisar el borrador privado y sus citas. Se conserva al recargar o reiniciar el servidor
   y aparece en «Mis borradores guardados» sin preparar otro material.
6. Publicar para el grupo solo después de revisar el resultado. La publicación crea una
   nota o guía independiente, marcada como generada con Gemini, con historial y enlaces
   a las versiones utilizadas. Repetir la publicación no crea otra copia.

Los borradores con fuentes personales siguen privados. Para compartirlos primero se
publican voluntariamente las fuentes y se prepara un nuevo borrador con esas versiones
grupales. La interfaz y el servidor bloquean publicar directamente un resultado basado
en fuentes personales.

## Fuentes y archivos

Se admiten notas, tareas, actividades, trabajos, evidencias y guías actualmente
legibles por la persona. El servidor resuelve el contenido; el cliente no puede enviar
texto arbitrario como si fuera una fuente autorizada. Se excluyen retirados, mensajes,
perfiles y otras fuentes ajenas al material académico.

Los archivos nuevos se leen directamente desde los fragmentos privados de SpacetimeDB,
únicamente después de autorizar su entidad. Se extrae texto UTF8 válido de archivos de
texto y código compatibles de hasta 256 KiB por archivo. PDF, imágenes, documentos
binarios, archivos incompletos, demasiado grandes y adjuntos heredados sin bytes
nativos producen omisiones explícitas. No se envían sus bytes ni se declara que fueron
procesados. No hay OCR ni interpretación de PDF/DOCX en esta entrega.

El manifiesto del archivo forma parte de la huella de la fuente. Cambiar texto,
versión, archivo, visibilidad o acceso invalida la preparación. El servidor revalida
antes de reservar, reclamar y entregar resultados, y de nuevo al publicar. Un borrador
cuyo material ya no esté disponible deja de entregarse.

Cada sección generada exige citas a fragmentos realmente preparados. Las guías
publicadas registran como procesadas únicamente las fuentes citadas; las omisiones y
la falta de cobertura se conservan en la publicación. Las validaciones de estructura
y citas no sustituyen la comprobación académica del contenido.

## Consumo y seguridad

Los límites son 10 fuentes, 40 000 caracteres por preparación, 8 000 tokens máximos de
salida, una operación simultánea por persona, cinco solicitudes por hora y diez por
día. El presupuesto diario inicial es de 100 000 tokens estimados por persona y lo
controla SpacetimeDB. Las reservas se realizan antes del envío y el consumo registrado
nunca reduce la reserva por debajo de lo estimado. El proveedor puede aplicar límites
o precios propios.

Las operaciones usan UUID idempotentes. Un reintento consulta la misma operación y no
repite una inferencia ya reclamada. Ante un resultado incierto se conserva ese estado;
crear otra solicitud requiere reconocer expresamente el riesgo de consumo adicional.
No hay reintentos automáticos del SDK. Los cuerpos, tiempos y respuestas están limitados;
las rutas privadas usan `Cache-Control: private, no-store` y no registran claves ni
contenido académico.

Las claves personales usan AES-GCM con un nonce independiente y datos autenticados
que vinculan identidad, proveedor, identificador de clave y versión maestra. Las tablas
cifradas y los borradores no se incluyen en suscripciones públicas. Eliminar la clave
borra inmediatamente su registro cifrado y cancela trabajo pendiente. Una petición ya
enviada a Gemini puede continuar, pero no permite volver a usar la clave eliminada.

## Validación local

`node scripts/smoke-spacetime-ai.mjs` inicia una base real aislada y persistente,
genera identidades y claves sintéticas, y usa un proveedor simulado. Comprueba
cifrado y aislamiento, archivo UTF8 real, versiones, explicación privada, guía publicada
con referencias, idempotencia, reinicio, retiro y borrado de clave. No llama a Gemini,
no usa claves personales y no toca Maincloud.

Las pruebas del Worker se ejecutan en Miniflare con las solicitudes al proveedor
interceptadas. Incluyen la revocación de acceso durante la inferencia, errores de
proveedor, respuestas inválidas, límites de cuerpo y ausencia de reenvío automático.
La aceptación del modelo elegido y de las cuotas de una cuenta real se realiza al
configurarlo expresamente; no forma parte de estas pruebas sin facturación.
