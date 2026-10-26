# EX-3: preparación documental y OCR

La preparación permite extraer PDF con texto, DOCX, texto UTF-8 y código sin subirlos a Gemini. Conserva el original, su SHA-256, la versión de la fuente, las páginas/párrafos/líneas y las omisiones. El lector compartido mantiene el comportamiento de Guías y permite seleccionar secciones de archivos grandes en Exámenes sin recortes automáticos.

## Límites y revisión

- Documento original: 10 MiB; PDF: 200 páginas; DOCX: 32 MiB descomprimidos.
- Exámenes: hasta 40 000 caracteres seleccionados en total; cada selección conserva sus localizadores y exige revisión expresa.
- OCR opcional: PDF e imágenes PNG/JPEG/WebP; de una a cinco páginas por operación. El Worker crea un PDF reducido con las páginas elegidas; el resto no se envía.
- La vista previa muestra el modelo, las páginas y los tokens estimados de entrada y máximos de salida. El consumo final puede variar. No hay solicitudes automáticas.
- El OCR devuelve texto privado pendiente de revisión. Una respuesta parcial, truncada, inválida o que cambie localizadores no se acepta.

## Acceso y operaciones

`document_preparation` expone preparación, consulta, cancelación y aceptación del texto revisado por la sesión del alumno. Las tablas `document_transcription`, `document_ocr_draft` y `document_file_verification` son privadas; no tienen vistas de grupo. Administrar el grupo no abre el texto privado ajeno.

Los archivos nativos se vinculan al SHA-256 que el servidor confirmó al completar sus bloques. Los heredados se descargan desde el almacenamiento autorizado, se comprueban con su identidad/ETag y se acreditan con una huella calculada en el Worker; no se acredita una huella recibida solamente del cliente. La preparación/generación y las operaciones de uso de Exámenes y del banco vuelven a verificar los originales heredados. Si cambian, la acreditación se invalida y el uso se rechaza.

Una versión compartida puede reutilizar sus citas documentales si el lector conserva acceso al original. Eso no abre la operación de consulta de la transcripción privada. Retirar el material o cambiar el original impide reutilizarlo; eliminar definitivamente su fuente también elimina las copias privadas de preparación y OCR.

El OCR reutiliza BYOK cifrado, consentimiento vigente, cuotas y presupuesto compartidos con los demás módulos. El identificador del envío permite consultar la operación y evita nuevas llamadas en reintentos. Los resultados inciertos se conservan y requieren reconocer el posible consumo adicional antes de otra operación. Cancelar impide aceptar resultados tardíos.

## Verificación realizada

- Pruebas de contratos: límites, localizadores, lotes y prohibición de recortes silenciosos.
- Extracción: archivos grandes, líneas largas, conservación íntegra y compatibilidad con los casos de Guías.
- Servidor: privacidad frente a compañeros y administración, huellas nativas y heredadas, cambios de versión, clave rotada, cuotas, reclamación única y cancelación con resultado tardío.
- Worker: selección real de páginas PDF, preparación sin consumo, confirmación, respuesta inválida, timeout, confirmación perdida, reintento sin reenvío, bloques autenticados e invalidación de originales heredados.
- Recorrido local ampliado en `scripts/smoke-spacetime-documents.client.ts`, integrado al de Exámenes: almacenamiento nativo, cita documental compartida y OCR con respuestas sintéticas. La ejecución final queda registrada junto a las comprobaciones generales de entrega.

No se usan claves reales en estas pruebas. La calidad del OCR con documentos reales y el consumo real de Gemini requieren una comprobación con el titular de la clave antes de publicar.
