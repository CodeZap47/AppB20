# Publicación del Laboratorio visual — 26 de octubre de 2026

Disponible en [b20.mx/#/m/laboratorio-visual](https://b20.mx/#/m/laboratorio-visual).

## Versión publicada

- Pages: `bd90c09b-e427-4ee1-a256-68904e0a0961`, rama de producción `main` del proyecto `app-b20`.
- URL inmutable: <https://bd90c09b.app-b20.pages.dev>.
- SpacetimeDB: `app-b20-34245` en Maincloud; SHA-256 del paquete `fa6b162f961f865ae8375d43d92bef2cdab8be0d9d113f654043ff3488735fc1`.
- Publicación del servidor completada a las `2026-10-27T04:34:55Z`; web a las `2026-10-27T04:36:55Z` (noche del 26 de octubre en Tijuana).
- Fuente aislada: `artifacts/laboratorio-visual-publicacion-2026-10-26/rebased-source`, con manifiesto `rebased-source-manifest.json`.

Durante la preparación se publicó una actualización de Mensajes. Se descartó el primer candidato del Laboratorio y se tomó como base esa versión nueva: servidor `e64d8fd30af299206a093ab076e251105c5d38b49370ce3d58cf24c1c918c64e`, Pages `272bdd04-176e-4166-b3f4-87674e7f6cad`. Las once integraciones compartidas del Laboratorio se comprobaron mediante transformación inversa exacta, sin diferencias ajenas. Se conservaron Mensajes, sus confirmaciones y opciones para compartir, Señales, Notas y el resto de funciones publicadas.

## Conservación de información

El servidor se publicó desde el paquete congelado con `--delete-data=never`, sin restablecer la base de datos, modificar variables del servidor ni permitir ruptura de contratos. La comprobación inmediatamente anterior impidió sobrescribir una versión remota distinta de la revisada.

La comparación estructural resolvió los tipos completos y comprobó índices, restricciones, acceso y contratos: las 192 tablas existentes permanecen iguales. Solo se añadió la tabla privada `visual_project`, las tres operaciones del Laboratorio y su vista filtrada `visual_projects`.

Las huellas anteriores y posteriores a la actualización confirmaron **513 registros**, ninguna tabla eliminada y ninguna modificación de contenido existente. Las 191 tablas restantes tuvieron huellas idénticas; la única variación fue `notification_planner_state.last_member`, el cursor que rota el servicio de recordatorios ya existente. La tabla nueva empezó vacía. No se insertaron ejemplos ni se guardaron fichas o archivos de prueba en el grupo.

La captura final, después de revisar la interfaz con la sesión real, conservó todos los registros anteriores. El total llegó a 517 por cuatro confirmaciones de entrega/lectura de Mensajes en una tabla que antes estaba vacía; además volvió a rotar el cursor de recordatorios. Las demás huellas de contenido y los esquemas permanecieron idénticos. El Laboratorio continuó con cero fichas guardadas.

Las capturas de comprobación contienen esquema, cantidades y huellas criptográficas; no guardan contenido personal ni credenciales. No constituyen una copia de recuperación de los registros.

## Validación

- Comprobación de tipos de todos los paquetes.
- 75 pruebas específicas de core, servidor, adaptador, demostración e interfaz.
- Siete escenarios con SpacetimeDB local y SDK real: privacidad de fichas y portadas, permisos ante otro administrador, referencias retiradas, conflictos, ciclo de publicación/archivo/restauración y persistencia tras reiniciar.
- Ensayo de actualización desde el paquete de producción exacto con 40 registros sintéticos, incluidas confirmaciones de mensajes: las 192 tablas y todos sus registros de prueba se conservaron tras actualizar y reiniciar.
- 407 archivos de conexión regenerados sin diferencias.
- Compilaciones web/PWA para producción y extensión correctas. La extensión no se publicó en una tienda.
- Los 31 archivos públicos verificables coinciden por SHA-256 tanto en la URL inmutable como en `b20.mx`; `_headers` y `_redirects` se revisan como configuración.
- `/`, `/auth/callback`, `/invitacion` y la salud de `api.b20.mx` responden correctamente. Se conservaron proyecto, rama, dominios y huellas de variables de Pages; no se desplegó el Worker de API.

En el navegador se revisó la sesión real: acceso directo después de Estudio, catálogo vacío, recorrido Crear → Explorar → Comprender → Practicar, materias y notas reales, filtros combinados y eliminación de selecciones incompatibles. El directorio mostró los ocho proveedores y se comprobó la transferencia de una referencia al formulario nuevo con autor, formato y licencia vacíos. Se salió del formulario sin guardarlo.

Las operaciones de escritura y los conflictos se probaron en el servidor local aislado con identidades y contenido sintéticos. En producción se comprobaron lectura, navegación y preparación de formularios.

## Evidencia y recuperación

La evidencia local está en `artifacts/laboratorio-visual-publicacion-2026-10-26` y `artifacts/lab-release-audit/rebased`: manifiestos, resultados, ensayo de actualización, publicación, verificación pública y captura `produccion.png`.

La versión estática anterior permanece identificada como `272bdd04-176e-4166-b3f4-87674e7f6cad`. Recuperar la web no revierte datos del servidor. Para corregir el servidor se debe conservar la tabla añadida y publicar una corrección compatible; volver a un paquete que omita esa tabla no es una recuperación de datos.
