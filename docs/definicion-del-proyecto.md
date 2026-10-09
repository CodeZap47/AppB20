## 1. Definición del proyecto

**App B20 es una plataforma colaborativa para estudiantes de Ingeniería en Desarrollo de Software.** Su propósito es fortalecer la convivencia entre compañeros, organizar los recursos académicos del grupo y utilizar inteligencia artificial como apoyo para comprender, practicar y desarrollar software.

Este documento define el alcance funcional del proyecto. El acceso exclusivo para compañeros, la administración colaborativa, el intercambio amplio de trabajos, Gemini y el leaderboard son decisiones confirmadas. La arquitectura recomendada debe validarse mediante un prototipo; las condiciones pendientes se reúnen en la sección 9.

### Necesidad que busca resolver

Centralizar tareas, actividades, apuntes, guías y dudas en un espacio organizado, evitando que los materiales importantes se pierdan entre conversaciones o archivos dispersos. La aplicación debe facilitar tanto mantenerse al corriente como ayudar a otros compañeros.

### Objetivo general

Crear una comunidad digital de acceso exclusivo para compañeros, con transparencia interna, donde puedan colaborar, recopilar sus trabajos por materia y aprender software con apoyo de Gemini. La aplicación deberá ayudar a comprender y realizar tareas y producir guías integrales para los parciales, sin sustituir el trabajo individual ni las indicaciones de los docentes.

### Objetivos específicos

- Organizar la información por grupo, materia y tema.
- Facilitar el intercambio de materiales y la resolución de dudas.
- Dar seguimiento personal a tareas y actividades.
- Transformar apuntes y explicaciones en recursos de estudio reutilizables.
- Reconocer las contribuciones útiles sin convertir el aprendizaje en una competencia obligatoria.
- Ofrecer Gemini como IA principal mediante claves personales: **BYOK, Bring Your Own Key**, sujeto a elegibilidad y condiciones de la API.
- Distribuir la misma app como web, PWA instalable en iPhone con push visible, APK para Android con notificaciones y extensión de Chrome para escritorio.

### Alcance confirmado

Acceso exclusivo para compañeros del grupo, mediante invitación y validación de membresía. Los perfiles, trabajos publicados y espacios de coordinación serán visibles dentro del grupo, no públicos en internet. La aplicación será un apoyo entre compañeros, no un sistema oficial de entregas, calificaciones o asistencia de la universidad.

## 2. Organización común y permisos

El contenido académico se organizará como **grupo → materia → parcial o unidad → tema → trabajos y recursos**. Además de navegar por materia, se podrá entrar al perfil de un alumno y consultar sus trabajos con la misma organización.

Una consigna puede tener varios trabajos con temas o enfoques distintos. No se excluirá un proyecto porque su tema sea diferente al de otros equipos; se conservarán su consigna específica, autores y clasificación.

| Responsable | Facultades |
| --- | --- |
| Creadores de la app | Administración técnica, despliegue, configuración de servicios, altas y bajas del grupo y atención de incidentes. |
| Todos los compañeros | Gestión colaborativa de materiales, propuestas de organización, revisiones, reportes y participación en acuerdos y votaciones. |
| Autor o coautores | Edición y publicación de su perfil y sus trabajos, conservando autoría e historial. |

**Transparencia interna:** los trabajos publicados, las conversaciones del grupo, las revisiones y las votaciones nominales serán visibles para los compañeros. Los mensajes 1 a 1 serán un espacio separado, accesible únicamente para sus dos participantes. Los cambios importantes tendrán responsable, fecha e historial. Administrar entre todos no implica leer indiscriminadamente conversaciones directas, borrar trabajos ajenos sin registro o modificar puntajes a voluntad.

**Protección técnica mínima:** claves de Gemini, contraseñas, tokens de sesión, tokens de dispositivos y credenciales de infraestructura nunca serán contenido compartido. Las prácticas personales que todavía no se publican no se expondrán automáticamente. La transparencia académica no equivale a hacer públicos todos los datos del sistema.

## 3. Módulos funcionales

### 3.1. Mensajería del grupo, conversaciones 1 a 1 y stickers

**Propósito:** combinar la comunicación de todo el salón con conversaciones directas entre dos compañeros.

#### Mensajes del grupo

- Canal general para todos los integrantes y canales por materia, tema o proyecto.
- Mensajes, imágenes, archivos, código, menciones, respuestas y enlaces a materiales de la app.
- Conversaciones comunitarias consultables por los miembros autorizados del salón.

#### Mensajes 1 a 1

- Iniciar una conversación desde el perfil de un compañero o desde una lista de integrantes.
- Bandeja de conversaciones directas separada de los canales del grupo.
- Texto, imágenes, adjuntos, fragmentos de código y stickers.
- Contador de mensajes no leídos, notificaciones configurables y opción de silenciar una conversación.
- Bloqueo y reporte de mensajes concretos; el participante elige qué evidencia compartir al reportar.

**Permisos:** una conversación directa tiene dos integrantes del grupo. La autorización de lectura, suscripción, envío y descarga de adjuntos se comprobará en el servidor. El resto del salón no puede consultar esos mensajes. La administración del grupo no concede lectura indiscriminada de conversaciones directas; tampoco se promete cifrado de extremo a extremo sin diseñarlo y validarlo.

**Relación con el archivo académico:** un archivo enviado por mensaje directo no se publica automáticamente como tarea ni aparece en el perfil o en una guía. Para compartirlo con todo el grupo, el autor debe publicarlo expresamente en el módulo correspondiente.

#### Stickers y convivencia

Biblioteca personal y paquetes de stickers utilizables tanto en el grupo como en mensajes directos. La importación de stickers obtenidos legítimamente desde WhatsApp seguirá sujeta a formatos y métodos compatibles; no supone importar conversaciones ni extraer automáticamente archivos de otra app.

Los mensajes y felicitaciones no generarán puntos por volumen. Las claves, tokens y credenciales no deben publicarse en ningún chat. Los mensajes directos no se enviarán automáticamente a Gemini.

**Criterios de aceptación:** un alumno puede escribir al salón y, por separado, conversar con otro compañero. Un tercero no puede leer ni descargar adjuntos de esa conversación directa. Al abrir una notificación se accede al chat correcto, sujeto a autenticación.

### 3.2. Tareas y Actividades

**Propósito:** recopilar todos los tipos de trabajos de los compañeros y permitir consultarlos tanto por materia como por autor.

**Funciones**

- Cada tarea, actividad, exposición o examen tiene una **página principal** con lo que se pidió. Cualquier integrante la edita, como en un wiki; cada edición guarda una versión con su responsable y se puede restaurar una anterior.
- En esa misma página, por separado, están **los trabajos que subió cada alumno o equipo**, con la lista de quién ya subió y quién falta. Solo sus autores modifican un trabajo.
- Cada página indica su tipo: **tarea, actividad, exposición o examen**. El archivo se puede filtrar por dos familias: «Tareas y actividades» y «Exposiciones y exámenes».
- Consigna con título, materia, parcial o unidad, instrucciones, fechas y recursos.
- Trabajos asociados con uno o varios autores, tema específico, descripción, archivos, código, enlaces y versiones.
- Publicaciones individuales y de equipo, aunque los equipos desarrollen temas o proyectos diferentes.
- Vista de todos los aportes de una consigna y reflejo automático de cada trabajo en los perfiles de sus autores.
- Filtros por materia, parcial, tema, tipo de trabajo, autor y fecha.
- Estado personal de avance independiente; estado del trabajo publicado como borrador compartido, versión final o revisado.
- Acciones para solicitar una explicación a Gemini, resumir un trabajo o incorporarlo a una guía del parcial.

**Reglas:** todos los tipos de tareas y proyectos podrán compartirse dentro del grupo, conservando autoría y permisos sobre materiales de terceros. Un trabajo con varios autores será un único registro enlazado a sus perfiles, no copias independientes. Compartir no implica que otro estudiante pueda presentarlo como propio ni que la app registre una entrega oficial.

**Flujo:** publicar → clasificar por materia y parcial → consultar desde el archivo del grupo o un perfil → comentar y aprender → reutilizar como fuente de estudio.

**Criterio de aceptación:** al publicar un trabajo, aparece en su materia y en los perfiles correspondientes. Los proyectos con temas distintos conservan su contexto y no se confunden como versiones de una misma solución.

### 3.3. Actividades de clase

**Propósito:** documentar ejercicios, prácticas, laboratorios y dinámicas realizadas durante una sesión de clase.

**Funciones propuestas**

- Registro con materia, tema, fecha, objetivo e instrucciones.
- Asociación de participantes o equipos cuando la actividad sea grupal.
- Publicación de evidencias: código, capturas, documentos, observaciones y resultados.
- Comentarios para comparar enfoques y explicar dificultades.
- Relación con una tarea posterior o con las notas de la sesión.

**Diferencia respecto a tareas:** una actividad registra una experiencia de clase; una tarea organiza trabajo por realizar y su fecha límite. Ambas pueden relacionarse, pero no deben confundirse.

**Reglas:** identificar autores y participantes, permitir varias soluciones y solicitar permiso antes de compartir imágenes o datos personales de compañeros.

**Criterio de aceptación:** una actividad conserva sus instrucciones y las evidencias de cada equipo sin sobrescribir las de otro.

### 3.4. Notas de clase

**Propósito:** construir una biblioteca de apuntes organizada, consultable y enriquecida por el grupo.

**Funciones propuestas**

- Editor con texto estructurado, listas, tablas, imágenes y bloques de código.
- Clasificación por materia, tema y sesión; etiquetas para facilitar la búsqueda.
- Notas personales y publicación voluntaria de una versión para el grupo.
- Comentarios y propuestas de corrección sin modificar silenciosamente el contenido de otro autor.
- Historial de cambios para notas colaborativas, conservando la autoría.
- Enlaces a tareas, actividades y preguntas relacionadas.

**Reglas:** diferenciar apuntes del estudiante, material del docente y contenido generado con IA. Una nota compartida no se considerará automáticamente correcta ni autorizada para redistribuir cualquier archivo adjunto.

**Flujo principal:** crear un apunte → clasificarlo → decidir su visibilidad → recibir comentarios → mejorar la versión compartida.

**Criterio de aceptación:** un compañero encuentra una nota por materia o tema y distingue su autor, versión y visibilidad.

### 3.5. Guías integrales de estudio para parciales

**Propósito:** reunir lo aprendido en tareas, proyectos, actividades y notas para construir una guía completa del material disponible de cada parcial.

**Funciones**

- Seleccionar materia, parcial, temario y todos los trabajos y recursos pertinentes del grupo.
- Incluir trabajos de distintos alumnos y equipos, incluso con temas diferentes, sin asumir que todos responden a una consigna idéntica.
- Crear una guía manual o un borrador asistido por Gemini.
- Estructura: temario, objetivos, conceptos, explicaciones, ejemplos, código comentado cuando corresponda, errores comunes, ejercicios, preguntas de práctica y respuestas razonadas.
- Índice de fuentes con enlaces a cada trabajo, actividad o nota utilizada y su versión.
- Registro de revisión entre compañeros y nuevas versiones cuando cambie el material de origen.
- Compendio del periodo que reúna guías de varias materias, manteniendo cada una separada.

**Proceso de generación con Gemini**

1. Revisar la selección y mostrar qué archivos se enviarán, qué clave se utilizará y que puede haber consumo asociado.
2. Extraer el contenido de los archivos compatibles; señalar escaneos ilegibles, formatos no admitidos o extracción fallida.
3. Preparar resúmenes por recurso y tema en lotes, sin depender de que todo quepa en una sola solicitud.
4. Comparar los temas identificados con el temario aportado; agrupar coincidencias sin eliminar enfoques distintos.
5. Generar las explicaciones y ejercicios con referencias al material seleccionado.
6. Mostrar cobertura, fuentes procesadas y temas o archivos pendientes. No afirmar que el parcial está cubierto si falta evidencia.
7. Revisar el borrador, corregirlo y publicar una versión para el grupo.

**Reglas:** la guía no promete conocer el examen ni reemplaza el temario del docente. Los nombres, fotos, correos y otros datos personales no son necesarios para generar explicaciones y se retirarán de las solicitudes a la API. Las fórmulas, respuestas y ejemplos de código se revisarán antes de tratarlos como material validado.

**Criterio de aceptación:** toda fuente seleccionada figura como procesada o pendiente con una razón; cada tema del temario tiene cobertura indicada; la guía mantiene enlaces al material de origen y no oculta omisiones.

### 3.6. Estadísticas de contribución y leaderboard

**Propósito confirmado:** reconocer aportes útiles y motivar la colaboración del grupo, sin medir calificaciones ni valor personal.

**Funciones**

- Resumen de trabajos, notas, guías, revisiones de código y respuestas publicados.
- Señales de utilidad, como respuestas aceptadas, recursos revisados y correcciones que mejoren materiales.
- Leaderboard del grupo por periodo y resumen de contribuciones en cada perfil.
- Desglose de los eventos que generaron puntos, con reglas visibles.
- Reconocimientos por buenas explicaciones, constancia y apoyo entre compañeros.

**Puntuación propuesta:** premiar calidad y utilidad, no número de mensajes. Excluir duplicados y aportes retirados por incumplimiento; limitar acciones repetitivas. Los puntos concretos y sus límites siguen pendientes de una prueba con el grupo.

**Convivencia:** no puntuar calificaciones, historial de consultas personales, dificultad al estudiar ni disponibilidad para prestar objetos. El reconocimiento no condicionará el acceso a los materiales.

**Criterio de aceptación:** cada puntuación tiene una explicación verificable y los usuarios no pueden asignarse puntos directamente ni inflar el ranking con publicaciones repetidas.

### 3.7. Preguntas y respuestas

**Propósito:** convertir las dudas y sus soluciones en conocimiento que otros estudiantes puedan reutilizar.

**Funciones propuestas**

- Preguntas clasificadas por materia y tema, con descripción, código, imágenes y materiales relacionados.
- Respuestas y comentarios para pedir aclaraciones.
- Estados: abierta y resuelta; opción de reabrir si la explicación necesita corregirse.
- Selección de una respuesta aceptada por quien preguntó.
- Señales de utilidad y búsqueda de preguntas similares antes de publicar una nueva.
- Enlaces a notas y guías que amplíen la explicación.

**Reglas:** promover respuestas que expliquen el razonamiento. Una respuesta aceptada significa que ayudó al autor, no que sea infalible. Diferenciar las propuestas generadas con IA y mantener la responsabilidad de quien las publica.

**Flujo principal:** buscar una duda existente → formular la pregunta → recibir explicaciones → probarlas → aceptar una respuesta o solicitar más ayuda.

**Criterio de aceptación:** una duda conserva su contexto y respuestas, y puede localizarse después para resolver una pregunta semejante.

### 3.8. Votaciones y encuestas transparentes

**Propósito:** facilitar decisiones y consultas visibles para los compañeros.

**Funciones**

- Pregunta, descripción, opciones, participantes elegibles y fecha de cierre.
- Voto de opción única o múltiple según la configuración.
- Votación nominal: nombre del participante, opción elegida y resultados visibles dentro del grupo.
- Prevención de votos duplicados y cambio de voto antes del cierre si se anuncia desde el inicio.
- Registro del resultado y del acuerdo adoptado, distinguiendo la consulta de la decisión final.

**Reglas:** no modificar las opciones después de recibir votos sin cancelar y reiniciar la consulta. La primera versión no tendrá votaciones anónimas; cualquier cambio a esa regla deberá acordarse expresamente. Los resultados no serán públicos fuera del grupo.

**Criterio de aceptación:** solo votan integrantes elegibles, se respeta el cierre y cualquier compañero puede consultar el resultado nominal y sus condiciones.

### 3.9. Perfil detallado de cada alumno

**Propósito:** identificar a cada compañero y mostrar su archivo de trabajos compartidos, organizado por materia y parcial, como un portafolio académico interno.

#### Identidad y presentación

| Campo | Uso |
| --- | --- |
| Foto de perfil | Imagen subida o elegida por el alumno; avatar con iniciales mientras no exista foto. |
| Nombre | Nombre del alumno y nombre preferido opcional. |
| Grupo y rol | Membresía del grupo y responsabilidades de colaboración. |
| Cumpleaños compartido | Día y mes, opcionales, enlazados al calendario del salón; sin año de nacimiento ni edad pública. |
| Presentación | Descripción breve, intereses y objetivos de aprendizaje; opcional. |
| Materias | Materias asociadas a sus trabajos y materias que indique cursar. |
| Conocimientos y ayuda | Temas que puede explicar y temas en los que solicita apoyo; opcional. |
| Enlaces de portafolio | Repositorios o demostraciones que decida compartir. |

No se solicitarán domicilio, teléfono, fecha de nacimiento completa, documentos oficiales ni calificaciones para completar este perfil. Cada alumno podrá compartir voluntariamente el día y mes de su cumpleaños, sin año de nacimiento. El correo utilizado para iniciar sesión no necesita mostrarse a todo el grupo.

#### Pestañas del perfil

- **Trabajos por materia:** sección principal, con materias y filtros por parcial, tema, fecha y tipo.
- **Notas y guías:** aportes publicados por el alumno o en coautoría.
- **Proyectos:** trabajos de equipo, microproyectos, responsabilidades y demostraciones compartidas.
- **Colaboración:** respuestas, revisiones, sesiones y ofertas de ayuda que haya publicado.
- **Contribuciones:** desglose de aportes reconocidos y posición en el leaderboard cuando corresponda.

#### Organización del archivo académico

**Alumno → materia → parcial o unidad → trabajo compartido.**

Cada tarjeta mostrará título, tema específico, autores, fecha de publicación, versión, tipo de trabajo, archivos o enlace al código y comentarios. Un mismo proyecto de equipo aparecerá en todos los perfiles de sus autores mediante una referencia al registro original.

Los trabajos sin parcial asignado aparecerán como **sin clasificar**, para no incorporarlos automáticamente a una guía incorrecta. Las materias relacionadas podrán enlazarse sin duplicar el trabajo.

#### Acciones principales

- Publicar un trabajo desde el perfil, seleccionando materia, parcial y autores.
- Abrir, descargar o consultar un trabajo y sus versiones.
- Solicitar una explicación, resumen o revisión del contenido mediante Gemini.
- Seleccionar trabajos para una guía del parcial; ampliar la selección a todos los recursos pertinentes del grupo, no solo a los de ese perfil.
- Abrir un mensaje 1 a 1 con el compañero, mencionarlo en el grupo o acordar una sesión de ayuda.
- Consultar su cumpleaños si decidió compartirlo y enviarle una felicitación en privado o en el grupo.

#### Permisos y criterios de aceptación

- Todos los compañeros autorizados pueden consultar los perfiles y trabajos publicados.
- Cada alumno modifica su identidad y presentación; los cambios de autoría de un trabajo compartido requieren acuerdo de los afectados.
- Las fotos no se reutilizan fuera del grupo ni se envían a Gemini para generar resúmenes.
- El perfil no publica claves, tokens ni historial personal de estudio.
- Al publicar un trabajo, queda visible en su materia y en los perfiles de sus autores; al actualizarlo, todas las vistas muestran la misma versión.
- Estos son requisitos del perfil dentro de la app. Los registros reales necesitarán nombres, fotos y trabajos proporcionados por cada alumno; no se inventarán identidades ni imágenes.

### 3.10. Calendario de cumpleaños del salón

**Propósito:** conocer los cumpleaños de los compañeros y facilitar felicitaciones sin recopilar datos personales innecesarios.

**Funciones**

- Cada alumno registra voluntariamente día y mes desde su perfil y decide compartirlos con el salón.
- Calendario mensual, vista del año y lista de próximos cumpleaños, con foto, nombre y enlace al perfil.
- Tarjeta de cumpleaños del día en el inicio y avisos opcionales el día del cumpleaños o con anticipación.
- Recurrencia anual: no es necesario crear manualmente un evento cada año.
- Acción para abrir un mensaje 1 a 1 o escribir una felicitación en el grupo; nunca publicar mensajes en nombre del alumno de forma automática.
- Preferencias para activar o silenciar recordatorios; actualizar o retirar la fecha compartida en cualquier momento.

**Datos mínimos:** identificador del alumno, día, mes y permiso para compartir. No guardar ni mostrar el año de nacimiento o la edad en este módulo. La elegibilidad de Gemini debe comprobarse por separado, no exponiendo fechas completas en el calendario.

**Reglas:** solo los integrantes autorizados ven el calendario. Nadie añade o modifica el cumpleaños de otro sin su consentimiento. Los cumpleaños no forman parte de las fuentes automáticas de las guías ni se envían a Gemini para producir avisos. No se requieren contactos del teléfono, Gmail ni calendarios externos.

**Casos especiales:** validar fechas reales, admitir el 29 de febrero y acordar el recordatorio en años no bisiestos sin cambiar la fecha original. Propuesta de zona del calendario: America/Tijuana, configurable para el grupo.

**Criterios de aceptación:** la fecha compartida aparece en el perfil y en el calendario como un mismo registro; los avisos no se duplican durante el mismo año; al retirar el consentimiento deja de mostrarse y no se programan nuevos recordatorios.

### 3.11. Lenguaje de señales y recursos para intercambiar respuestas

**Idea del módulo:** crear y aprender un lenguaje compartido para comunicar respuestas breves mediante lápices o plumas, zapateadas y golpes de nudillos. Incluir un apartado de respuestas preparadas, como anotaciones en borradores.

**Advertencia de uso:** compartir respuestas o llevar anotaciones durante una evaluación puede incumplir sus reglas si no está autorizado. Este módulo no acredita autorización ni garantiza que las señales pasen inadvertidas. Es una función experimental separada del archivo académico principal.

#### A. Diccionario de señales del grupo

- Crear convenciones con nombre, significado, medio físico, ejemplo y versión.
- Definir señales para opciones de respuesta, números, solicitud de repetición, confirmación y final del mensaje.
- Mantener un diccionario común para evitar que cada compañero interprete una señal de manera distinta.
- Revisar cambios y señalar qué versión está aprendiendo cada participante.

**Medios contemplados**

- **Lápices o plumas:** posiciones y movimientos visuales definidos por el grupo.
- **Zapateadas:** secuencias de contactos del pie con el suelo, distinguidas por cantidad y pausas.
- **Nudillos sobre la mesa:** secuencias de golpes, con separaciones claras entre elementos.

**Ejemplo de convención para opciones múltiples:** un golpe representa A, dos representan B, tres representan C y cuatro representan D. Para lápices o plumas puede acordarse una correspondencia visual: horizontal, vertical, diagonal derecha y diagonal izquierda. Es una convención de ejemplo, no un estándar; debe comprobarse que todos la interpretan igual.

#### B. Estructura de los mensajes

Definir un formato que distinga **referencia de la pregunta → respuesta → confirmación**, con separadores y una señal de repetición. No interpretar una secuencia aislada como respuesta sin saber a qué pregunta corresponde.

La aplicación permitirá construir un mensaje, consultar su representación y practicar su interpretación. Para respuestas extensas, conservar el desarrollo en los materiales de estudio: una señal breve no transmite por sí sola toda una explicación.

#### C. Entrenamiento dentro de la app

- Tarjetas para aprender el significado de cada señal.
- Ejercicios de reconocer una secuencia y seleccionar su interpretación.
- Ejercicios inversos: recibir un mensaje y elegir las señales correspondientes.
- Práctica entre dos compañeros, alternando emisor y receptor.
- Registro personal de aciertos, confusiones y convenciones que requieren repaso.

**Primera versión:** simulación mediante botones y representaciones en pantalla. La app no detectará automáticamente zapateadas o nudillos ni grabará el salón; cualquier reconocimiento por sensores sería un proyecto técnico distinto.

#### D. Respuestas preparadas y anotaciones en borradores

Documentar la idea de colocar respuestas abreviadas en borradores como un tipo de recurso preparado. Cada ficha tendrá materia, tema, pregunta o referencia, anotación breve, autor y fecha de revisión.

- Crear la ficha a partir de apuntes o trabajos y enlazar el material de origen.
- Preparar un resumen compacto y revisar que no pierda condiciones, unidades o pasos importantes.
- Registrar el soporte previsto —por ejemplo, borrador— y el contenido de la anotación.
- Distinguir una ficha de repaso de un material permitido durante una evaluación; preparar una anotación no la vuelve autorizada.
- Mantener pendiente la lista de otros métodos: no se incorporan técnicas adicionales que todavía no se hayan definido.

#### E. Integración y datos

Vincular diccionarios, prácticas y fichas a materias y temas. Reutilizar perfiles para formar parejas de práctica, sin presentar su desempeño como calificación académica ni otorgar puntos por intercambiar respuestas durante un examen.

**Entidades:** diccionario, versión, señal, medio físico, significado, mensaje de práctica, intento de interpretación y ficha de anotación preparada.

**Criterios de aceptación:** los participantes consultan la misma versión, pueden practicar los tres medios, distinguen pregunta y respuesta, identifican secuencias ambiguas y conservan el origen de las fichas. El módulo no anuncia que una respuesta es correcta solo porque haya sido recibida mediante una señal.

## 4. Gemini como IA principal mediante BYOK

**Decisión confirmada:** Gemini será el proveedor principal de IA. Se conserva BYOK: cada alumno configura una clave propia, y el consumo de una generación corresponde al proyecto asociado a la clave de quien la solicita, no automáticamente a los autores de los archivos utilizados. Las claves de Gemini pertenecen a proyectos de Google Cloud y comparten la cuota y facturación de su proyecto. [[1]](https://ai.google.dev/gemini-api/docs/api-key)[[2]](https://ai.google.dev/gemini-api/docs/billing)

### Acceso con cuentas estudiantiles

Google AI Studio permite acceso con cuentas de Workspace, pero el administrador puede activar o desactivar el servicio. En Workspace for Education, los menores de 18 años no pueden utilizar AI Studio, incluso si el servicio está activado. Tener correo estudiantil no confirma por sí solo la elegibilidad de cada cuenta. [[3]](https://ai.google.dev/gemini-api/docs/workspace)

La API tiene niveles gratuitos y de pago con condiciones y límites propios; no se presupone uso ilimitado por utilizar Gmail o contar con una oferta estudiantil de la aplicación Gemini. La disponibilidad y el costo se verificarán en el proyecto de cada usuario. [[2]](https://ai.google.dev/gemini-api/docs/billing)

**Condición previa a habilitar la integración:** confirmar que el grupo cumple los requisitos de edad. Los términos de la API exigen 18 años o más y excluyen clientes dirigidos a menores o que probablemente sean utilizados por ellos. Si hay menores en el grupo, deberá reevaluarse la integración antes de desplegarla. [[4]](https://ai.google.dev/gemini-api/terms)

### Capacidades centrales

| Área | Uso de Gemini |
| --- | --- |
| Tareas y Actividades | Explicar instrucciones, planear un enfoque, dar pistas, revisar razonamientos y ayudar a depurar código. |
| Archivo de trabajos | Resumir documentos y comparar enfoques relacionados, conservando sus fuentes. |
| Guías de parciales | Sintetizar el conjunto de materiales seleccionado y el temario, indicar cobertura y producir ejercicios y respuestas revisables. |
| Notas y actividades | Aclarar conceptos, generar ejemplos y apoyar reflexiones sobre evidencias. |
| Preguntas y revisiones | Preparar borradores de respuestas o comentarios técnicos que el alumno revise antes de publicar. |
| Práctica personal | Preguntas de repaso, aprender enseñando y simulación de exposiciones, según las funciones previstas. |

### Seguridad, consentimiento y costos

- Ejecutar las solicitudes mediante un servicio backend autenticado; no incrustar claves en el código distribuido de la web o de la app móvil. Google recomienda un proxy backend y un almacén seguro de secretos para producción. [[1]](https://ai.google.dev/gemini-api/docs/api-key)
- Conservar la clave de cada usuario en un almacén de secretos o un mecanismo cifrado con controles de acceso del servicio. La app mostrará solo que existe una clave configurada y permitirá sustituirla o retirarla.
- Antes de una generación, mostrar proveedor, recursos seleccionados, clave que asumirá el consumo y advertencia de posibles costos. Aplicar límites de solicitudes y presupuesto configurables; las estimaciones no se presentarán como cargos exactos.
- Enviar contenido académico autorizado, retirando nombres, correos, fotos, credenciales y otros datos personales. En servicios no pagados, Google puede usar entradas y respuestas para mejorar productos y realizar revisión humana; sus términos indican no enviar información personal, sensible o confidencial. [[4]](https://ai.google.dev/gemini-api/terms)
- No asumir que las protecciones de una cuenta educativa en otras aplicaciones de Gemini se transfieren a una solicitud de API. Los términos distinguen el servicio de API pagado por la facturación activa del proyecto. [[4]](https://ai.google.dev/gemini-api/terms)
- Mantener los resultados como borrador hasta que el usuario los publique para el grupo. Señalar el contenido generado con IA y los materiales utilizados.
- No analizar automáticamente las conversaciones ni generar contenido con la clave de otra persona sin una acción autorizada. Los chats 1 a 1 y el calendario de cumpleaños no se incorporan automáticamente a las fuentes de las guías.
- Mantener las funciones comunitarias disponibles para quien no configure IA.

**Prioridad de producto:** además de explicar una nota, validar la generación de una guía por materia y parcial a partir del archivo completo de trabajos seleccionados, con fuentes y omisiones visibles.

## 5. Base técnica y arquitectura recomendada

### Framework y SDK seleccionados para el prototipo

**Recomendación: React + TypeScript + Vite como interfaz compartida, con SpacetimeDB para datos en tiempo real.** El SDK oficial de TypeScript funciona en navegador y Node.js e incluye integración para React mediante `spacetimedb/react`. El paquete actual es `spacetimedb`; el antiguo `@clockworklabs/spacetimedb-sdk` está deprecado. [[5]](https://spacetimedb.com/docs/clients/typescript)

### Formas de distribución confirmadas

La misma cuenta y los mismos datos del grupo estarán disponibles en las siguientes presentaciones. Cada instalación puede requerir iniciar sesión; no se asume que las sesiones se comparten automáticamente entre la web, la extensión y el APK.

#### Web y PWA para iPhone

- Aplicación React adaptable, servida por HTTPS, con manifiesto, iconos, rutas de entrada y service worker.
- Instalación en iPhone mediante «Añadir a pantalla de inicio», con instrucciones dentro de la web; no es descargar un APK ni publicar necesariamente en App Store.
- Manifiesto con presentación independiente, por ejemplo `display: standalone`, para abrir como app desde su icono. WebKit documenta este comportamiento para las apps de pantalla de inicio. [[1]](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados)
- Funciones completas: perfiles, trabajos, guías, chats del grupo y 1 a 1, cumpleaños y las demás funciones previstas.

#### Extensión de Chrome para escritorio

- Paquete **Manifest V3** con la interfaz de la app, no solo un botón que redirija a la web.
- Apertura desde el icono de la extensión como panel lateral; opción de abrir una vista amplia en una pestaña de la propia extensión.
- El panel lateral utiliza una página incluida en el paquete y el permiso `sidePanel`, según la API oficial de Chrome. [[2]](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- Navegación a todos los módulos y conexión al mismo backend. Adaptar la interfaz al espacio reducido del panel sin eliminar funciones.
- Empaquetar React, el SDK de SpacetimeDB y todas las dependencias ejecutables; Manifest V3 no permite cargar JavaScript o WASM remoto como código de la extensión. Consultar datos del backend es distinto de descargar código para ejecutarlo. [[3]](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)
- Permisos mínimos: no leer historial, páginas abiertas o contenido de otras webs para las funciones básicas del proyecto. Validar autenticación, política de contenido y dominios necesarios.

La extensión se plantea para Chrome de escritorio. En iPhone la vía de instalación será la PWA, no una extensión de Chrome móvil.

#### APK para Android

- Empaquetar la interfaz React con **Capacitor para Android**, con acceso a plugins nativos. [[4]](https://capacitorjs.com/docs)
- Compilar una versión release y producir un **APK firmado**: Android requiere firma digital para instalar o actualizar APKs. Proteger el keystore y conservar la firma necesaria para las actualizaciones. [[5]](https://developer.android.com/studio/publish/app-signing)
- Distribuir el APK mediante una página de descarga controlada, con versión, instrucciones y registro de cambios. Android permite distribución desde un sitio o servidor y exige que el usuario autorice la instalación desde la fuente correspondiente. [[6]](https://developer.android.com/distribute/marketing-tools/alternative-distribution)
- Incluir notificaciones nativas, registro del dispositivo y acceso a todos los módulos. El usuario no tendrá que mantener abierta la interfaz para el diseño normal de avisos push.

**Cambio respecto a la propuesta anterior:** Capacitor se prioriza para Android; iPhone se entrega inicialmente como PWA. Una app nativa iOS o un ejecutable de escritorio con Tauri pueden evaluarse después, pero no son necesarios para cumplir estas tres formas de distribución.

Estos son objetivos de implementación; aún requieren código, compilación, pruebas y publicación. Una PWA instalable no implica por sí sola funcionamiento sin conexión de todos los módulos.

### Autenticación

Propuesta: **inicio de sesión con Google mediante OIDC más invitación o lista autorizada del grupo**. SpacetimeDB admite tokens OIDC y contempla proveedores como Google y Firebase; autenticar no reemplaza comprobar permisos y membresía en el módulo. [[9]](https://spacetimedb.com/docs/core-concepts/authentication)

Validar emisor, audiencia, identidad y pertenencia antes de permitir lectura o escritura. No solicitar acceso a Gmail ni leer correos para iniciar sesión o usar Gemini. SpacetimeAuth con acceso Google es una opción para el prototipo, pero su documentación específica advierte estado beta; debe evaluarse antes de elegirlo para producción. [[10]](https://spacetimedb.com/docs/core-concepts/authentication/spacetimeauth)

### Archivos y fotos

Propuesta: **Google Cloud Storage para fotos, documentos, imágenes y otros adjuntos**, con metadatos y referencias en SpacetimeDB. El backend comprobará membresía y emitirá accesos de duración limitada cuando corresponda. Las URLs firmadas permiten acceso temporal, pero cualquiera que tenga una puede utilizarla mientras siga activa; no se tratarán como autorización permanente del grupo. [[11]](https://docs.cloud.google.com/storage/docs/access-control/signed-urls)

**Límite confirmado: 50 MB por archivo**, igual para adjuntos de trabajos, mensajes, evidencias y fotos. La interfaz avisa antes de subir y el servidor lo vuelve a comprobar.

Mantener el almacenamiento cerrado al público general, definir los tipos de archivo permitidos, evitar duplicados y conservar versiones. Costos, cuotas, región y política de eliminación quedan por verificar antes de contratar o desplegar servicios.

### Gemini y secretos

Propuesta: servicio backend en TypeScript con el SDK `@google/genai`, claves BYOK separadas por usuario y un almacén de secretos, por ejemplo Google Cloud Secret Manager. La documentación de Gemini muestra este SDK y recomienda mantener claves fuera del cliente de producción. [[1]](https://ai.google.dev/gemini-api/docs/api-key)

### Notificaciones push por presentación

#### iPhone: notificaciones visibles desde la PWA

WebKit incorporó Web Push para apps añadidas a la pantalla de inicio desde **iOS 16.4**. La solicitud de permiso debe responder a una acción directa del usuario, como pulsar «Activar notificaciones». Una vez autorizado, los avisos pueden aparecer en la pantalla bloqueada y el centro de notificaciones. Abrir solamente una pestaña de la web no cumple el requisito de instalación de esta modalidad. [[1]](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados)

**Implementación propuesta:** Push API + Notifications API + service worker, suscripción Web Push por instalación y backend de envío compatible, con claves VAPID protegidas. El Web Push de iPhone utiliza la infraestructura de APNs, pero no es el registro nativo de Capacitor ni un token APNs obtenido por una app iOS. WebKit indica que no se requiere pertenecer al Apple Developer Program para usar este Web Push. [[1]](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados)

Añadir una pantalla para comprobar instalación y compatibilidad, solicitar el permiso, enviar un aviso de prueba y explicar cómo revisar los ajustes. Los modos de concentración y las preferencias del usuario pueden silenciar avisos; no prometer visibilidad inmediata en todas las condiciones. [[1]](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados)

#### Android: notificaciones del APK

Usar `@capacitor/push-notifications` con **Firebase Cloud Messaging**. El plugin documenta registro FCM en Android y la solicitud de permisos requerida para Android 13 o superior. [[7]](https://capacitorjs.com/docs/apis/push-notifications)

Configurar canales, registro del dispositivo y apertura del contenido desde el aviso. Diseñar avisos visibles, no depender exclusivamente de mensajes de datos para ejecutar código con la app terminada: Capacitor documenta límites en ese escenario. Probar primer plano, segundo plano y cierre en dispositivos reales. [[7]](https://capacitorjs.com/docs/apis/push-notifications)

#### Web de escritorio y extensión

En la web/PWA, usar Web Push en navegadores compatibles, con detección de capacidades y permisos. La extensión tendrá su bandeja de avisos y actualizará la interfaz al conectarse al backend. Sus avisos del sistema y recepción en segundo plano deben implementarse y probarse con mecanismos propios de extensión; no asumir que registrar el service worker de la PWA dentro de Manifest V3 resuelve ese caso. No se promete recepción con Chrome completamente cerrado.

#### Eventos y controles comunes

- Nuevos mensajes 1 a 1, menciones, nuevos trabajos, cambios de fecha, respuestas, sesiones próximas, votaciones por cerrar, guías disponibles y cumpleaños compartidos.
- Preferencias por categoría y conversación, silenciamiento, horarios de descanso y desactivación de recordatorios de cumpleaños.
- En mensajes directos, vista previa configurable; por defecto un aviso genérico para no exponer el texto en una pantalla bloqueada.
- Al pulsar una notificación, abrir el contenido correcto y volver a comprobar identidad y permisos.

**Flujo:** evento autorizado o recordatorio programado → notificación pendiente → servicio backend que envía por Web Push o FCM según la instalación → apertura autenticada del contenido. Las suscripciones Web Push, los tokens FCM y las credenciales de envío no son datos visibles para el grupo.

Guardar preferencias, eliminar suscripciones inválidas, controlar reintentos y duplicados y limitar avisos repetidos. No mantener una conexión SpacetimeDB permanente en segundo plano como sustituto de push. Si se deniega el permiso, la app seguirá funcionando con avisos dentro de su interfaz.

### Modelo de datos mínimo

- Usuario, perfil de alumno, grupo, membresía y materia.
- Cumpleaños compartido: día, mes, consentimiento y configuración de recordatorios, enlazado al perfil.
- Parcial o unidad, temario, consigna, trabajo compartido, coautoría, versión y archivo.
- Actividad, nota, guía, fuentes de guía y revisión.
- Pregunta, respuesta, canal, conversación y participantes; mensajes del grupo o directos con autorización diferenciada.
- Encuesta, voto y evento de contribución.
- Diccionario de señales, versión, convención por medio físico, práctica y ficha de anotación preparada.
- Instalación o dispositivo, suscripción Web Push o token FCM, preferencias y notificación pendiente; datos técnicos protegidos del acceso comunitario.
- Referencia al secreto de Gemini y solicitud de generación, sin exponer la clave.

Cada trabajo enlazará materia, parcial y autores para reutilizarse en el archivo, los perfiles y las guías. Un adjunto de chat directo tendrá permisos de su conversación, no los del archivo académico compartido. Puntajes, votos, roles, pertenencia y acceso a mensajes se validarán en el servidor.

## 6. Plan de implementación propuesto

El alcance reúne once módulos base —incluidos perfiles, cumpleaños y el módulo experimental de señales— y las doce funciones adicionales de la sección 7. La prioridad es el archivo colaborativo y el aprendizaje, con comunicación del grupo y 1 a 1. Web/PWA para iPhone, APK Android y extensión Chrome son formas de acceso al mismo producto, no tres proyectos con datos separados.

### Etapa 0. Validación y prototipo técnico

- Mantener la comprobación de edad y acceso a Google AI Studio antes de habilitar Gemini.
- Probar React, el SDK oficial de SpacetimeDB, autenticación y autorización en los tres entornos.
- Validar perfil, archivos, conversación del grupo y chat directo con pruebas de acceso de un tercero.
- Probar una PWA instalada en iPhone compatible y un aviso visible con permiso concedido.
- Compilar un APK Android firmado de prueba y validar una notificación FCM.
- Probar el panel lateral y la vista completa de la extensión con dependencias empaquetadas.
- Validar una guía con fuentes y un cumpleaños de prueba identificado como dato de prueba, sin inventar información real de compañeros.

### Etapa 1. MVP: perfiles, archivo, comunicación y cumpleaños

- Acceso exclusivo al grupo y administración colaborativa con controles técnicos.
- Perfil con foto, nombre y trabajos por materia y parcial.
- Tareas, actividades y notas compartidas; preguntas y respuestas y panel de novedades.
- Mensajería básica del grupo y 1 a 1, con adjuntos y notificaciones configurables.
- Calendario de cumpleaños con participación voluntaria y recordatorios.
- Gemini para explicar materiales y generar un borrador de guía con fuentes y cobertura, únicamente si se cumplen sus condiciones.
- Piloto web/PWA para iPhone, APK Android y extensión Chrome, con los mismos módulos básicos y datos del grupo.

### Etapa 2. Colaboración y estudio

- Guías integrales, búsqueda, revisión de materiales y repaso espaciado.
- Salas de estudio, intercambio de ayuda, retos, revisión de código y museo de bugs.
- Votaciones nominales, radar de oportunidades y mejoras de recordatorios.
- Fortalecer actualización de versiones, compatibilidad de archivos y notificaciones de las tres presentaciones.
- Validar reglas del leaderboard con aportes reales.

### Etapa 3. Funciones avanzadas de comunidad

- Biblioteca completa de stickers y mejoras de mensajería.
- Leaderboard verificable y contribuciones visibles en perfiles.
- Microproyectos, simulador de exposiciones y préstamo de materiales.
- Módulo experimental de lenguaje de señales, prácticas y fichas de anotaciones preparadas; su uso en evaluaciones depende de las reglas aplicables.
- Evaluar una app nativa iOS o ejecutables Tauri solo si el grupo los necesita; no sustituyen los requisitos ya definidos de PWA, APK y extensión.

### Validación del MVP

Un alumno puede publicar y consultar trabajos por materia y perfil, conversar con todos o con un compañero y ver los cumpleaños que el grupo decidió compartir. Las tres presentaciones acceden a los mismos registros sin duplicar identidades.

Las guías muestran fuentes y omisiones. Las pruebas de iPhone incluyen instalación en pantalla de inicio y permiso de avisos; las de Android incluyen instalación del APK y push visible. Una cuenta externa o un tercero del grupo no puede leer una conversación 1 a 1 ajena. Ninguna vista publica claves o tokens.

Las fechas, costos y alcance final de cada entrega se estimarán después del prototipo y de conocer el equipo disponible.

## 7. Funciones adicionales del proyecto

Las siguientes doce ideas quedan incorporadas al alcance ampliado. Algunas serán espacios nuevos y otras ampliarán los módulos existentes; no es necesario convertirlas en doce módulos independientes. Su propósito es fortalecer la colaboración, la práctica del desarrollo de software y la convivencia del grupo.

### 7.1. Panel «¿Qué me perdí?»

**Propósito:** ayudar a cada estudiante a ponerse al corriente desde su última visita.

**Funciones propuestas**

- Listado de nuevas publicaciones, cambios de fecha, respuestas aceptadas y votaciones abiertas.
- Filtros por materia y tipo de novedad, con enlaces al contenido original.
- Distinción entre novedades consultadas y pendientes de revisar.
- Resumen opcional con IA, solicitado por el usuario y basado únicamente en información que pueda consultar.

**Ejemplo:** «Desde tu última visita se publicaron dos apuntes y cambió la fecha de una actividad».

**Primera versión:** listado de eventos sin IA. Se integrará como pantalla de inicio, no como un repositorio duplicado.

**Criterio de aceptación:** el panel muestra novedades relevantes y no revela publicaciones privadas de otros usuarios.

### 7.2. Salas de estudio y programación en pareja

**Propósito:** facilitar sesiones de trabajo entre compañeros con un objetivo concreto.

**Funciones propuestas**

- Crear una sesión con tema, materia, horario, objetivo y cupo opcional.
- Inscribirse, cancelar participación y consultar los materiales necesarios.
- Temporizador compartido para bloques de estudio y descansos.
- Espacio de conversación de la sesión y registro de dudas, resultados y recursos utilizados.
- Enlaces a notas, retos o proyectos que se trabajarán durante la sesión.

**Ejemplo:** una sesión para practicar ciclos y revisar juntos varios ejercicios.

**Primera versión:** coordinación, temporizador y resultados; sin videollamadas ni editor de código en vivo. La programación en pareja podrá realizarse con herramientas externas elegidas por los participantes.

**Criterio de aceptación:** los inscritos conocen el objetivo y horario de la sesión y pueden conservar sus resultados como material del grupo.

### 7.3. «Puedo ayudarte / necesito ayuda»

**Propósito:** conectar a compañeros que quieren aprender un tema con quienes desean explicarlo.

**Funciones propuestas**

- Publicar ofertas de ayuda y solicitudes con tema, nivel de conocimiento y modalidad preferida.
- Indicar disponibilidad de forma voluntaria.
- Buscar coincidencias por materia o tema y enviar una solicitud de contacto.
- Aceptar, rechazar o cerrar una solicitud; convertir un encuentro acordado en una sesión de estudio.

**Ejemplo:** «Puedo explicar condicionales» y «Necesito practicar conversiones entre sistemas numéricos».

**Reglas:** no clasificar a los estudiantes como buenos o malos ni publicar su disponibilidad sin consentimiento. La participación será voluntaria y no garantizará atención inmediata.

**Criterio de aceptación:** un estudiante encuentra una oferta pertinente y acuerda ayuda sin exponer datos personales innecesarios.

### 7.4. Retos cortos de programación

**Propósito:** fomentar la práctica frecuente mediante problemas pequeños y discusiones sobre distintas soluciones.

**Funciones propuestas**

- Retos clasificados por tema y dificultad, con objetivo, instrucciones y ejemplos de entrada y salida cuando correspondan.
- Pistas progresivas y publicación de soluciones con explicación del razonamiento.
- Comentarios para comparar enfoques y casos no considerados.
- Cierre o revisión colectiva del reto y enlaces a conceptos relacionados.

**Ejemplo:** construir una calculadora sencilla y explicar cómo valida las entradas.

**Reglas:** priorizar comprensión y claridad, no velocidad. Los retos serán de práctica y no sustituirán entregas individuales calificadas.

**Primera versión:** publicación y revisión manual de código. Ejecutar código de usuarios dentro de la aplicación requerirá posteriormente un entorno aislado y controles de seguridad.

**Criterio de aceptación:** un participante comprende el reto, comparte su solución y puede revisar otros enfoques con sus explicaciones.

### 7.5. Revisión de código entre compañeros

**Propósito:** practicar la lectura de código, la comunicación técnica y la mejora conjunta de soluciones.

**Funciones propuestas**

- Compartir un fragmento o enlace a un repositorio e indicar qué se desea revisar.
- Publicar revisiones visibles para el grupo y asociarlas a una materia, equipo o proyecto.
- Comentarios relacionados con líneas o fragmentos, distinguiendo errores, sugerencias y preguntas.
- Registro de cambios y estado de las observaciones: pendiente, aplicada o descartada con explicación.
- Revisión opcional con IA, manteniendo la decisión final en el autor.

**Ejemplo:** revisar si un programa valida entradas correctamente o si sus nombres de variables son comprensibles.

**Reglas:** comentar el código, no descalificar a la persona. No publicar credenciales, información sensible ni código ajeno sin autorización.

**Primera versión:** código pegado y enlaces; sin integración automática con Git ni ejecución de código.

**Criterio de aceptación:** el autor puede relacionar las observaciones con una versión concreta y decidir qué cambios aplicar.

### 7.6. Laboratorio de microproyectos

**Propósito:** formar equipos para terminar proyectos pequeños y construir un portafolio de aprendizaje.

**Funciones propuestas**

- Propuestas con problema, objetivo, alcance y resultado esperado.
- Solicitud de participación y definición de integrantes y responsabilidades acordadas.
- Tablero de pendientes del proyecto, distinto del avance personal en tareas académicas.
- Enlaces a código, notas, revisiones y demostraciones.
- Cierre con resultados, aprendizajes y reconocimiento de las contribuciones.

**Ejemplos:** calculadora de promedios, inventario sencillo o herramienta para organizar sesiones de estudio.

**Reglas:** limitar el alcance para terminar una primera versión. La publicación externa del proyecto o de sus integrantes requerirá autorización; inicialmente, la vitrina será interna al grupo.

**Criterio de aceptación:** un equipo puede pasar de una propuesta a una demostración y conservar evidencia de lo aprendido y de quién participó.

### 7.7. «Museo de bugs»

**Propósito:** convertir errores reales en explicaciones reutilizables para otros estudiantes.

**Funciones propuestas**

- Ficha con intención original, comportamiento observado, causa, corrección y aprendizaje.
- Fragmento mínimo de código o evidencia que ayude a entender el problema.
- Etiquetas por lenguaje, tema y tipo de error.
- Comentarios, correcciones y enlaces a preguntas o notas relacionadas.

**Ejemplo:** «Mi ciclo nunca terminaba porque no actualizaba la variable».

**Integración:** será una colección dentro de preguntas y respuestas, con una plantilla específica; no necesitará otro foro.

**Reglas:** retirar claves y datos personales de ejemplos y capturas. Si la causa no está confirmada, identificarla como hipótesis.

**Criterio de aceptación:** otro estudiante entiende cómo se detectó el error y por qué la corrección propuesta funciona en ese contexto.

### 7.8. Modo «Aprende enseñando»

**Propósito:** ayudar a detectar vacíos de comprensión al explicar un concepto con palabras propias.

**Funciones propuestas**

- Seleccionar un tema y explicar su significado, un ejemplo y sus límites.
- Recibir preguntas de un compañero o de una IA configurada para pedir aclaraciones.
- Identificar partes que necesitan ejemplos o una explicación más precisa.
- Guardar una reflexión personal y, voluntariamente, publicar una explicación revisada.

**Ejemplo:** explicar qué es una variable a alguien que nunca ha programado.

**Integración:** actividad de práctica vinculada a notas y guías, con apoyo opcional de BYOK.

**Reglas:** la retroalimentación de IA puede equivocarse y no será una calificación ni una validación definitiva. Las sesiones personales permanecerán privadas por defecto.

**Criterio de aceptación:** el estudiante puede revisar su explicación después de responder preguntas y señalar qué necesita repasar.

### 7.9. Repaso espaciado

**Propósito:** facilitar la revisión periódica de conceptos mediante tarjetas de preguntas y respuestas.

**Funciones propuestas**

- Crear tarjetas manualmente a partir de notas y guías, conservando el enlace a su origen.
- Generar borradores con IA y revisarlos antes de incorporarlos a una colección compartida.
- Responder antes de mostrar la explicación y marcar si se recordó, se necesitó una pista o se debe repasar.
- Programar próximas revisiones a partir de esas respuestas; el método de programación deberá definirse y probarse.
- Separar las colecciones compartidas del historial personal de repaso.

**Ejemplo:** «¿Cuál es la diferencia entre un compilador y un intérprete?».

**Integración:** ampliación del módulo de guías de estudio, no un sistema independiente de apuntes.

**Criterio de aceptación:** cada estudiante tiene su propia cola de repaso sin revelar sus respuestas o dificultades al leaderboard.

### 7.10. Simulador de exposiciones y preguntas

**Propósito:** ensayar explicaciones y preparar respuestas antes de una exposición o, posteriormente, una entrevista técnica.

**Funciones propuestas**

- Definir tema, público, duración deseada y puntos que se deben cubrir.
- Practicar una explicación y recibir preguntas de un compañero o de la IA.
- Revisar claridad, ejemplos, justificación de decisiones y limitaciones.
- Conservar observaciones y realizar un nuevo intento.

**Ejemplos de preguntas:** «¿Puedes dar un ejemplo?», «¿Por qué elegiste ese enfoque?» y «¿Qué limitaciones tiene?».

**Primera versión:** texto. El audio se evaluará después, con consentimiento y reglas de almacenamiento y eliminación.

**Reglas:** ensayos privados por defecto y retroalimentación orientativa, sin sustituir los criterios del docente.

**Criterio de aceptación:** el estudiante puede practicar, recibir preguntas pertinentes y mejorar una segunda explicación.

### 7.11. Préstamo de materiales

**Propósito:** facilitar préstamos voluntarios de recursos entre compañeros.

**Funciones propuestas**

- Catálogo de libros, cables, adaptadores, herramientas o componentes con propietario y disponibilidad.
- Solicitud de préstamo y aceptación explícita por el propietario.
- Registro de entrega, fecha acordada de devolución y confirmación de retorno.
- Estados: disponible, reservado y prestado; recordatorios configurables.

**Reglas:** no gestionar pagos ni publicar domicilios. Los detalles personales de entrega serán visibles solo para los participantes. La aplicación documentará acuerdos, pero no garantizará devoluciones ni resolverá por sí sola conflictos.

**Criterio de aceptación:** un mismo objeto no puede tener dos préstamos activos y ambos participantes pueden consultar su acuerdo.

### 7.12. Radar de oportunidades

**Propósito:** compartir oportunidades y formar equipos para aprovecharlas juntos.

**Funciones propuestas**

- Publicaciones de talleres, hackatones, becas, concursos y eventos.
- Ficha con fuente, organizador, requisitos, fecha límite y costo cuando se conozca.
- Filtros por tipo, tema y modalidad; identificación de oportunidades vencidas.
- Acción «quiero participar; busco equipo» y enlace a una sesión o microproyecto relacionado.
- Correcciones y reportes de enlaces inválidos o información desactualizada.

**Primera versión:** publicaciones manuales de los integrantes, sin recopilación automática de servicios externos.

**Reglas:** distinguir la fuente original de comentarios del grupo y verificar requisitos antes de inscribirse. Publicar una oportunidad no implica respaldo institucional.

**Criterio de aceptación:** un estudiante puede consultar la fuente, conocer los requisitos y contactar a compañeros interesados.

## 8. Integración de las nuevas funciones

### Ubicación y etapas propuestas

Todas las ideas están incluidas en el proyecto. La siguiente distribución organiza su implementación sin ampliar indiscriminadamente el MVP; las fases no son fechas comprometidas.

| Función | Ubicación propuesta | Primera incorporación propuesta |
| --- | --- | --- |
| ¿Qué me perdí? | Pantalla de inicio transversal | Etapa 1: novedades sin IA. |
| Salas de estudio | Espacio de coordinación | Etapa 2: horarios, inscripción y temporizador. |
| Puedo ayudarte / necesito ayuda | Espacio de apoyo entre compañeros | Etapa 2: ofertas y solicitudes manuales. |
| Retos de programación | Práctica vinculada a materias | Etapa 2: retos y revisión manual. |
| Revisión de código | Espacio compartido por tema o proyecto | Etapa 2: fragmentos y comentarios. |
| Microproyectos | Espacio de proyectos colaborativos | Etapa 3: equipos, pendientes y demostraciones. |
| Museo de bugs | Colección de preguntas y respuestas | Etapa 2: plantilla y etiquetas. |
| Aprende enseñando | Práctica vinculada a notas y guías | Etapa 2: texto y preguntas. |
| Repaso espaciado | Guías de estudio | Etapa 2: tarjetas e historial personal. |
| Simulador de exposiciones | Práctica vinculada a materiales de estudio | Etapa 3: ensayo por texto antes de evaluar audio. |
| Préstamo de materiales | Espacio de convivencia y recursos | Etapa 3: catálogo y acuerdos sin pagos. |
| Radar de oportunidades | Tablón del grupo | Etapa 2: publicaciones manuales y búsqueda de equipo. |

### Reutilización de datos y reglas

- Reutilizar usuarios, materias, publicaciones, archivos y permisos existentes para evitar duplicados.
- Incorporar, cuando corresponda, sesiones de estudio, ofertas y solicitudes de ayuda, retos, revisiones de código, proyectos, tarjetas e historial de repaso, ensayos, artículos y préstamos, y oportunidades.
- Mantener privados los ensayos, el historial de repaso y las solicitudes que no se hayan compartido expresamente.
- Aplicar a todas las funciones con IA las reglas de BYOK, consentimiento, costos y revisión de la sección 4.
- Evaluar qué aportes públicos podrían contar como contribuciones útiles; no dar puntos por prestar objetos, revelar disponibilidad ni compartir dificultades personales.
- Definir criterios de eliminación, moderación y conservación de datos antes de habilitar cada función.

## 9. Decisiones confirmadas y pendientes técnicos

### Decisiones confirmadas

| Tema | Definición |
| --- | --- |
| Acceso | Exclusivo para compañeros del grupo. |
| Administración | Creadores a cargo de la operación técnica; gestión académica colaborativa entre todos. |
| Trabajos | Compartir tareas y proyectos de cualquier tema, conservando materia, consigna y autores. |
| Transparencia | Contenido académico y conversaciones del grupo visibles para los compañeros; chats 1 a 1 accesibles solo a sus participantes y credenciales protegidas. |
| Mensajería | Canal del salón y conversaciones directas entre dos compañeros, con bandejas y permisos separados. |
| Cumpleaños | Calendario anual del salón basado en día y mes compartidos voluntariamente desde el perfil. |
| Distribución | Extensión Chrome de escritorio, PWA instalable en iPhone y APK Android; push visible en iPhone compatible y Android con permisos. |
| IA | Gemini como proveedor principal, conservando BYOK y comprobando elegibilidad y consumo. |
| Motivación | Leaderboard incluido; reglas de puntos pendientes de validación. |
| Perfil | Foto, nombre y archivo de trabajos por materia y parcial, con coautorías y versiones. |
| Archivos | Máximo 50 MB por archivo subido a la app. |
| Páginas principales | Lo que se pidió vive en una página que todo el grupo edita como wiki, con historial y restauración; los trabajos de cada alumno se suben aparte en esa página. Aplica también a las actividades de clase. |
| Tipos de trabajo | Tarea, actividad, exposición o examen; se elige al publicar y se filtra por «Tareas y actividades» o «Exposiciones y exámenes». |
| Módulo unido | «Actividades de clase» vive dentro de «Tareas y Actividades», con dos vistas de las mismas publicaciones: por materia y por fecha. |
| Calendario de parciales | En Ajustes, los administradores (creadores de la app) fijan cuándo empieza y termina cada parcial de cada cuatrimestre. Con eso la app sabe cuál está en curso y abre así los formularios de «Registrar actividad» y «Nueva tarea o actividad». |
| Plan de estudios | Nueve cuatrimestres de cinco materias; cada cuatrimestre se divide en tres parciales. La lista de materias está en `packages/core/src/curriculum.ts`. |
| Resultado educativo | Ayudar a comprender y realizar tareas y construir guías integrales de los parciales a partir de los materiales del grupo. |

### Recomendaciones técnicas por validar

- React + TypeScript + Vite y SDK oficial `spacetimedb`; compilaciones adaptadas para web/PWA, extensión Manifest V3 y Capacitor Android. Tauri y una app nativa iOS quedan como opciones posteriores.
- Inicio de sesión Google/OIDC con acceso autorizado al grupo.
- Google Cloud Storage para archivos y backend con almacén de secretos para Gemini.
- Web Push para la PWA de iPhone y web compatible; FCM para el APK Android. La recepción y avisos del sistema de la extensión requieren implementación específica y pruebas.

### Pendientes que no deben darse por resueltos

- **Edad y acceso a Gemini:** confirmar que el grupo cumple los términos antes de desplegar la integración.
- **Cuenta institucional:** probar Google AI Studio y creación de clave en una cuenta autorizada, sin solicitar claves en chats o documentos compartidos.
- **Costos y límites:** infraestructura, archivos, cuotas de API y presupuesto de cada clave BYOK.
- **Integración real:** SDK y autenticación en PWA, WebView Android y páginas de extensión; callbacks por presentación y permisos de lectura de mensajes.
- **Instalación y push:** iPhone compatible con PWA añadida a inicio y autorización; APK firmado, permisos Android y registro FCM; funcionamiento de la extensión y políticas de distribución.
- **Cumpleaños:** fechas aportadas voluntariamente, zona de recordatorios, preferencias y tratamiento del 29 de febrero.
- **Guías:** temarios, identificación de parciales, formatos de archivo y mecanismo para señalar fuentes no procesadas.
- **Puntuación:** aportes que cuentan, ponderación, límites y tratamiento de duplicados.

**Principio rector confirmado:** una herramienta útil para aprender y colaborar, recopilar los trabajos compartidos y convertirlos en apoyo para tareas y preparación de parciales. La transparencia del grupo debe coexistir con protección técnica básica y autoría clara.

**Estado de las entregas:** estas definiciones son requisitos del proyecto, no paquetes ya compilados o publicados. Para entregar la extensión y el APK y habilitar la PWA con push se necesitarán el código de la app, infraestructura y pruebas en dispositivos reales.

---
