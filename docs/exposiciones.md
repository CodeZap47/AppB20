# Exposiciones por texto

El simulador vive en `/m/exposiciones`. Permite preparar una explicación, recibir preguntas
y mejorar otro intento, sin publicar el ensayo en el grupo. Esta versión funciona sin
Gemini; las preguntas de apoyo son plantillas locales identificadas como tales. La
retroalimentación es orientativa, no una calificación ni una evaluación del docente.

## Recorrido

1. Crear una práctica con título, materia, parcial opcional, tema, público, duración deseada
   de 1 a 120 minutos y uno o más puntos a cubrir. Una nota o guía accesible de la misma
   materia puede servir como referencia; se conserva su versión.
2. Crear el primer intento y escribir el ensayo. Guardar el borrador no lo comparte. La
   estimación de tiempo usa 120 palabras por minuto como referencia, no mide el habla.
3. Guardar autoobservaciones sobre claridad, ejemplos, decisiones y limitaciones, junto con
   siguientes pasos. Estos campos siempre son privados del autor.
4. Concluir el intento. Su texto y contexto quedan fijos y aparecen cinco preguntas de
   apoyo. Se pueden agregar preguntas propias y guardar respuestas.
5. Opcionalmente, invitar a un compañero activo desde la práctica. Antes de confirmar se
   explica que podrá leer los intentos concluidos, sus preguntas y respuestas, y hacer
   preguntas y observaciones. No recibe borradores ni autoobservaciones o siguientes pasos.
6. Crear otro intento. Se copia la explicación anterior para revisarla; el intento anterior,
   sus preguntas y sus observaciones se conservan. La configuración vigente se copia al
   nuevo intento y no modifica los anteriores.

El autor puede cambiar o retirar al revisor y archivar o restaurar la práctica. Archivar
conserva el historial y retira el acceso del revisor. Los filtros de materia y parcial y
las listas de prácticas propias o invitadas evitan mezclar ambas responsabilidades.

## Privacidad y conservación

- Las cinco tablas son privadas. Las lecturas se realizan mediante vistas que requieren
  membresía activa. No existe una excepción para que un administrador lea ensayos ajenos.
- El autor recibe sus borradores e intentos concluidos. El revisor asignado solo recibe
  intentos concluidos de prácticas no archivadas. Su vista de la configuración corresponde
  al último intento concluido, para no revelar cambios preparados para otro intento.
- Las referencias personales o ya inaccesibles no revelan contenido al revisor. La app no
  envía automáticamente el texto de las fuentes ni llama a proveedores de IA.
- Las autoobservaciones y siguientes pasos tienen su propia tabla y vista exclusiva del
  autor. Los comentarios de un revisor anterior se conservan para el autor; un nuevo revisor
  no hereda esos comentarios privados.
- Una baja, cambio de revisor o archivo revoca las lecturas y escrituras correspondientes.
- No se generan puntos, novedades comunitarias ni entradas en el registro público.
- Los guardados comprueban versiones. Crear prácticas, intentos y preguntas conserva un
  identificador de petición para reintentar sin duplicados. Concluir dos veces no duplica
  las preguntas de apoyo. Solo se permite un borrador abierto por práctica.
- Los límites de texto se comparten entre demo y servidor. Los ensayos no se borran al
  crear otro intento ni al archivar la práctica.

## Datos e integración

`PresentationActions` y `PresentationsSnapshot` definen el contrato compartido. La demo
aplica las mismas reglas, con ejemplos ficticios y temporales. SpacetimeDB incorpora:

| Tabla privada | Vista |
| --- | --- |
| `presentation_practice` | `presentation_practices` |
| `presentation_attempt` | `presentation_attempts` |
| `presentation_personal` | `my_presentation_personal` |
| `presentation_question` | `presentation_questions` |
| `presentation_feedback_entry` | `presentation_feedback` |

La configuración y referencia se copian por intento. Los intentos concluidos conservan su
texto aunque cambie la práctica o su fuente. No se toma un cambio de fuente como una
autorización para sustituir la explicación de un ensayo.

## Validación y publicación

Las pruebas cubren reglas compartidas, equivalencia demo/servidor, permisos de autor,
revisor y administrador, borradores y observaciones privadas, cambio de revisor, baja,
archivo, versiones y reintentos. El smoke del servidor real usa una base local aislada,
claves temporales e identidades sintéticas; nunca usa cuentas ni datos de producción.

```sh
npm run test:spacetime:presentations
```

Para publicar: ejecutar pruebas, tipos, compilación web/Pages y módulo, regenerar bindings
con CLI y SDK 2.12.0, publicar el módulo con `--delete-data=never` y después actualizar la
web principal. Comparar esquema y conteos antes y después sin imprimir contenido privado.
Una compilación o push no sustituye la confirmación del dominio principal ni el recorrido
autenticado. El audio y la generación con Gemini quedan para sus integraciones posteriores.
