# Segunda entrega: colaboración y presentación del grupo

La implementación utiliza el módulo TypeScript, las vistas y los archivos privados de
SpacetimeDB. La web continúa preparada para Cloudflare Pages. No requiere activar R2,
D1, un proveedor de mensajes, una base de datos adicional ni facturación para sus pruebas locales.

## Mensajes y stickers

Los adjuntos de mensajes utilizan archivos privados de SpacetimeDB. Los stickers también
guardan sus bytes en tablas privadas, con un máximo de 1 MiB por imagen y 30 por paquete;
se comprueban las firmas PNG, JPEG, GIF y WebP. Importar conserva un identificador de
intento para reanudar respuestas perdidas sin duplicar paquetes, imágenes ni capacidad.
Las imágenes comparten la reserva de capacidad configurada para los archivos del grupo.

Las suscripciones reciben metadatos y los bytes se descargan al mostrarlos. Un sticker
enviado únicamente por directo es visible para sus participantes; usarlo no lo publica
para todo el grupo ni para un administrador ajeno al chat. Al retirar un paquete se
liberan los bytes sin usar y se conservan los que forman parte de mensajes existentes.

## Mensajes, notas y preguntas

Los canales de materia, tema o proyecto son espacios del grupo activo; los directos solo
permiten leer mensajes y descargar archivos a sus dos participantes. Los estados de lectura
y silencio se guardan por persona y conversación. El bloqueo impide nuevos envíos en ambos
sentidos, conservando el historial. Los reportes comparten únicamente el texto y los adjuntos
seleccionados expresamente, sin abrir el resto de la conversación a la administración.

El editor de notas admite listas, tablas y código sin interpretar HTML. Las imágenes se
adjuntan en SpacetimeDB y se muestran bajo demanda; no se cargan imágenes remotas del texto.
Cada versión conserva clasificación, sesión, relaciones y adjuntos. Publicar una versión
personal crea una nota independiente para el grupo; el original y sus futuras ediciones
permanecen privados. Las guías conservan contenido, fuentes y archivos al restaurar, incluida
la autoría y fecha originales de sus fuentes. Las preguntas separan las aclaraciones de las
respuestas y de la aceptación, y admiten utilidad y enlaces al material compartido.

## Perfiles y cumpleaños

Cada integrante puede guardar su presentación, nombre preferido, intereses, objetivos,
conocimientos, temas de apoyo, enlaces HTTPS de portafolio y materias. Son campos
voluntarios. Las ediciones comprueban la versión del perfil y solo modifican la identidad
de quien ejecuta la acción.

La foto admite PNG, JPEG y WebP de hasta 5 MiB. El servidor comprueba el formato y los
bytes; los datos se suben por el transporte privado de SpacetimeDB. La página del perfil
descarga la foto al pulsar «Ver foto», crea una URL Blob local y la libera al desmontarse.
No se publica una dirección externa ni se envía la foto a Gemini.

Las pestañas reúnen notas y guías compartidas, trabajos de equipo mediante referencias
al registro original y el desglose de contribuciones. El archivo de trabajos tiene filtros
por materia, parcial, tema, fecha y tipo. Los microproyectos corresponden a una entrega
posterior y no se inventan proyectos ni personas para completar el perfil.

El calendario muestra doce meses del año además de la vista mensual y los próximos
cumpleaños. Solo guarda día y mes; el año de la vista es el de celebración. El 29 de
febrero conserva su fecha original y se celebra el 28 en años no bisiestos. Los avisos
automáticos, la configuración de zona y el control de duplicados de recordatorios
corresponden a la tercera entrega.

## Novedades y contribuciones

«¿Qué me perdí?» incorpora guías, votaciones abiertas, publicaciones de ayuda y
colecciones de repaso compartidas. No resume notas personales, prácticas privadas,
progreso de estudio ni contactos de ayuda. Tampoco anuncia borradores o contenido
retirado. El inicio y cada conversación mantienen sus estados de lectura por separado;
los contadores muestran cantidades, sin copiar el texto de los chats al resumen.

La puntuación se calcula desde registros verificables. No cuenta borradores ni aportes
retirados. Las copias idénticas del mismo autor y contexto no vuelven a sumar aunque se
publiquen con otro identificador. La comparación solo normaliza finales de línea y
espacios exteriores; conserva mayúsculas, código y espacios internos. Se usan referencias
de archivos o sus hashes reales, sin deducir que dos archivos de igual nombre y tamaño
contienen los mismos bytes. Los orígenes calculados conservan el primer crédito y su
fecha incluso al retirar el original; el cliente recibe únicamente identificadores y
fechas de registros consultables, sin textos ni firmas del material oculto.

Una fuente agregada de nuevo a la misma guía no vuelve a sumar y los límites contra
acciones repetitivas se aplican antes de filtrar por periodo. Retirar y restaurar conserva
el mismo registro y recupera sus puntos originales. Los valores siguen siendo una propuesta que debe probarse con
el grupo; no condicionan el acceso a materiales.

La retirada conserva texto, archivos y versiones. El autor puede restaurar su retirada
voluntaria. La moderación de contenido compartido requiere un motivo y solo un
administrador puede revertir una retirada de moderación. Administrar no concede acceso
a notas personales ajenas ni a conversaciones privadas. La limpieza definitiva y la
papelera con plazo de 30 días corresponden a la tercera entrega.

## Verificación

Las pruebas de componentes comprueban campos voluntarios, descarga de foto solicitada,
privacidad de notas y calendario anual con el 29 de febrero. Las pruebas del módulo
ejecutan los handlers de perfil y retirada con autores, coautores, administradores y una
cuenta dada de baja; verifican permisos, conflictos de versión e historial preservado.

Con Node 22 y Spacetime CLI 2.12 disponibles en `PATH`,
`node scripts/smoke-spacetime-delivery2.mjs` inicia una base local aislada con claves
temporales y tres identidades sintéticas. Su recorrido comprueba publicación explícita
de notas con adjuntos, directos y reportes selectivos, canales y lectura, foto privada,
preguntas, historial de guías, retirada y recuperación de puntos, reinicio y revocación
de acceso. El script informa sus resultados al terminar; su existencia no implica haberlo
ejecutado correctamente.

El 21 de octubre de 2026 este recorrido terminó con `result: passed`, tres identidades
sintéticas y un reinicio del servidor. Comprobó los nueve grupos de verificaciones que
enumera el resultado del script, incluida la revocación de bytes y la recuperación exacta
de la puntuación tras restaurar una nota. Durante la prueba se corrigió la validación de
enlaces de perfil para ejecutarse en el runtime del módulo, que no proporciona el objeto
`URL` del navegador.

También comprobó importación nativa idempotente de stickers, igualdad de sus bytes y
aislamiento de un sticker enviado por directo frente a un administrador ajeno. La prueba
de contribuciones retiró el original, publicó una copia idéntica con otro identificador
y confirmó que no sumaba; restaurar el original recuperó únicamente sus ocho puntos.

El recorrido de archivos de la primera entrega volvió a pasar con la implementación
conjunta: confirmó 50 MiB, SHA-256, reanudación y persistencia tras reinicios, reserva de
capacidad y revocación de acceso. La coordinación con Salas conservó sus rutas, tablas,
permisos e integración con Ayuda; su recorrido real aislado también pasó.

La suite conjunta final aprobó 814 pruebas: app 463, core 72, módulo SpacetimeDB 184,
API 50 y web 45. Los bindings se regeneraron con CLI/SDK 2.12.0 y los tipos globales
pasaron. El registro incluye las seis regresiones finales sobre fuentes retiradas de
Aprende enseñando, añadidas durante la coordinación con Salas.
Las compilaciones finales de web/PWA, extensión y Cloudflare Pages pasaron; el Worker
heredado se verificó en modo `--dry-run`, y `git diff --check` terminó sin errores.

La publicación en Maincloud y Cloudflare Pages, así como la aceptación con las cuentas y
los datos reales del grupo, deben registrarse por separado de las pruebas locales.
