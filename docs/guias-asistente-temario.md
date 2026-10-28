# Creación de guías con materiales agregados

Implementación local del 26 de octubre de 2026.

## Recorrido compartido

Nueva guía y el asistente de IA usan el mismo selector. El alcance puede ser un parcial o todo el cuatrimestre de una materia. El parcial de la guía y los parciales explorados son controles distintos: se puede agregar expresamente material de otros parciales sin cambiar el objetivo de la guía.

La composición comienza como borrador privado. La lista agregada, archivos elegidos, título, temario y ocho secciones manuales se guardan por cuenta en el servidor. El enlace solo conserva el identificador opaco del borrador, sin texto personal. Se puede pasar del editor manual a la IA y volver conservando estos datos.

## Explorar, seleccionar y agregar

El selector ofrece filtros combinables por procedencia (propios, compañeros, ambos), personas, tipo (Notas, Tareas, Actividades, Exámenes), parciales (uno, varios, todos, sin parcial), privacidad y búsqueda por título, tema, persona o archivo. Las preguntas del grupo anteriores siguen disponibles como tipo adicional.

Los resultados se agrupan por persona, tipo o parcial, con casillas de selección parcial y completa. Se puede elegir todo por grupo o todos los resultados filtrados entre páginas. Marcar resultados prepara la selección; **Agregar materiales a la guía** los incorpora a la lista persistente. Cambiar filtros nunca quita lo agregado. Los trabajos de equipo coinciden con todos sus autores y se almacenan una sola vez.

La lista agregada muestra contadores por tipo y materiales personales. Permite consultar previews, quitar materiales y elegir sus archivos de forma individual. Los archivos elegidos se revisan en una cola; los retirados o no disponibles requieren quitarlos explícitamente para continuar.

## Exámenes y permisos

Se incluyen tanto consignas y trabajos registrados como examen en Tareas y actividades como exámenes del módulo Exámenes. El catálogo del módulo se consulta mediante una operación autorizada independiente de los intentos. Se fijan versión y origen sin convertir UUID en identificadores ficticios.

Los exámenes aportan preguntas y opciones. Las soluciones se incluyen solo mediante selección expresa y cuando el alumno tiene permiso para consultarlas. No se consultan ni modifican respuestas o calificaciones de compañeros. Una preparación con soluciones o materiales personales se conserva privada y no puede publicarse para el grupo hasta resolver esas fuentes.

Las notas y exámenes personales propios están disponibles; los personales ajenos permanecen excluidos. El acceso, versiones y dependencias se comprueban al consultar, preparar, reanudar y publicar. Las guías manuales con materiales se crean de manera atómica e idempotente, sin proveedor IA ni clave.

## Procesamiento y continuidad

La preparación admite hasta 1000 fuentes y cuatro millones de caracteres, sin recortes silenciosos. Se procesa por lotes de hasta diez fuentes y 40 000 caracteres. Las selecciones grandes se resumen por lotes antes del diagnóstico y la síntesis, conservando citas de los fragmentos originales. Cada envío requiere confirmación; las cuotas pueden pausar el trabajo conservando los pasos completados.

El diagnóstico compara el temario con los materiales agregados, identifica temas superficiales o ausentes y formula preguntas antes de generar. Las respuestas anteriores se conservan al renovar fuentes y pueden reutilizarse explícitamente por tema. Los borradores anteriores conservan compatibilidad.

La extracción admite PDF textual, DOCX, TXT, Markdown y código, hasta 10 MiB por documento y 200 páginas PDF. Imágenes y escaneos pueden consultarse; no tienen lectura automática. El diálogo mantiene foco, cierra con Escape y devuelve el foco al botón de origen.

## Datos y validación

La tabla privada aditiva `guide_material_selection` guarda la composición por actor con revisión optimista. El procedimiento `guide_materials` expone catálogo, previews y guardar/recuperar/listar selecciones. Las referencias de exámenes se conservan en la procedencia autorizada, compatible con las fuentes antiguas.

Se verifican filtros combinados, selección global entre páginas, duplicados de equipo, recarga y cambio manual/IA, privacidad, soluciones autorizadas, archivos pendientes, cuotas, citas, publicación manual idempotente y regresiones del flujo anterior. Las pruebas no consumen Gemini real. La entrega es local y todavía no se ha publicado en b20.mx.

La prueba de integración real se ejecutó contra un servidor temporal en `127.0.0.1:3367`, con base aislada. Sus 12 grupos comprobaron recuperación después de reiniciar, archivos y transcripciones conservados, revisiones optimistas, aislamiento entre cuentas, creación manual idempotente y exámenes con UUID. Preparó 31 materiales y más de 120 000 caracteres sin recortes, con ocho operaciones sintéticas y cero llamadas a Gemini. El servidor temporal y sus datos se retiraron al terminar.

Validación dirigida: 97 pruebas de la app, 21 de core, 25 de API y 34 del módulo de datos aprobadas (177 en total). Las comprobaciones de tipos de core, API y módulo de datos también pasan. La comprobación global de tipos de la app sigue encontrando tres errores previos en `components/visual3d/decoders.test.ts` (tipos de Node y una conversión de `FunctionConstructor`); no corresponden a Guías.

La compilación web final con `design-preview` y la compilación del servicio API en modo `dry-run` finalizaron correctamente. La vista previa permanece en `http://127.0.0.1:4174/design-preview.html#/m/guias/nueva`; sus materiales son ficticios y no usa Gemini real.
