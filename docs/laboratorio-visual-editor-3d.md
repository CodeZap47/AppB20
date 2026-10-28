# Editor 3D del Laboratorio visual

Esta etapa añade escenas, selección de piezas, etiquetas, vistas y recorridos manuales a los proyectos del catálogo. Está implementada localmente; no sustituye la publicación del catálogo que ya está en b20.mx. La publicación de servidor y clientes se preparará por separado.

## Uso

La ficha conserva sus datos y portada. **Escena 3D** abre la exploración; su autor puede entrar en **Editar escena** mientras el proyecto esté activo. Importa archivos GLB autocontenidos, incluidos Draco, Meshopt y texturas KTX2. Se admiten hasta diez archivos y veinte instancias, con un máximo de 50 MiB por archivo y 150 MiB de archivos únicos utilizados por el proyecto.

La cámara permite órbita, zoom y desplazamiento; mover, girar o escalar una pieza son herramientas distintas. Las piezas pueden seleccionarse en el modelo o en el árbol mediante teclado. Se conservan los nombres originales y se permiten alias. Una malla fusionada sigue siendo una pieza; no se segmentan modelos automáticamente.

Las etiquetas se anclan en coordenadas locales de la pieza y la acompañan al moverla. Las vistas y pasos contienen capturas independientes de cámara, modelos, posiciones, visibilidad, resaltado y etiquetas. Editar un paso no cambia los demás. Los pasos tienen explicación, se pueden duplicar y reordenar, y se recorren manualmente. No hay reproducción de animaciones importadas, audio, IA ni simulación física en esta etapa.

**Guardar escena** confirma el documento completo. Deshacer/rehacer conserva hasta cincuenta cambios. El borrador local se identifica por usuario y proyecto; un conflicto conserva los cambios locales y ofrece revisar la escena guardada. La demostración conserva sus proyectos visuales, modelos, portadas y escenas en IndexedDB, sin enviar ese contenido al grupo real.

## Datos y almacenamiento

Las tablas privadas `visual_scene`, `visual_model_asset` y `visual_asset_expiry` separan el documento de escena, los archivos inmutables y su vencimiento. La escena tiene su propia versión; importar modelos o guardar una escena no incrementa la versión de la ficha. Editar desde un cliente anterior no puede borrar la escena.

Las operaciones nuevas consultan escenas a demanda, registran activos idempotentes, guardan con versión esperada y descartan archivos sin uso. No se suscriben tablas binarias ni documentos completos desde la galería. El resumen de la ficha proyecta `hasScene`, `sceneVersion` y la mayor fecha de actualización entre escena y ficha.

El destino nativo nuevo `visual_model` usa el identificador del activo y su versión, con el transporte existente de fragmentos de 1 MiB, SHA-256, reanudación y cancelación. `visual_project` continúa reservado para portadas. El servidor valida los bytes originales por rangos y deriva su manifiesto: estructura GLB 2.0, recursos incrustados, jerarquía, índices, imágenes, extensiones y longitudes declaradas. Incluye los buffers de reserva válidos de Meshopt; no confía en estadísticas de validez del cliente.

Los componentes se identifican por instancia, activo e índice original de nodo glTF, sin depender de nombres o UUID del motor. Cambiar de archivo crea otro activo y no reasigna etiquetas por semejanza.

Solo el autor modifica e importa. Los demás integrantes pueden consultar escenas guardadas y sus modelos según la visibilidad del proyecto. Los archivos recién preparados son privados del autor hasta incorporarse a una escena guardada. Cambiar a privado o archivar revoca el acceso de los demás; el visor se desmonta al perder acceso. Estas comprobaciones preceden a las excepciones genéricas por referencias y reportes.

La cuota compartida del grupo no aumenta automáticamente. La interfaz consulta el espacio disponible antes de importar y el servidor reserva y comprueba la capacidad. Los 150 MiB por escena no garantizan disponibilidad. Las importaciones pendientes conservan la caducidad del transporte; los registros y activos sin referencias guardadas caducan después de siete días. **Liberar modelos sin uso** solicita confirmación sobre archivos y bytes concretos y vuelve a comprobar versiones y la unión de referencias de escena, piezas ocultas, vistas y pasos. Nunca elimina portadas, archivos anteriores ni modelos utilizados por proyectos archivados; libera la capacidad exactamente una vez.

## Renderizado y compatibilidad

Three.js se carga al abrir la escena, con un solo lienzo y renderizado bajo demanda. Se liberan geometrías, materiales, texturas, bitmaps, URLs y trabajos pendientes al cambiar de proyecto. Los modelos privados no se añaden al precaché público de la PWA.

Draco, Meshopt y KTX2 usan Workers estáticos locales. El par Basis JS/WASM se compiló desde fuente fijada con Emscripten 6.0.9 y `NO_DYNAMIC_EXECUTION=ON`, conservando licencias y huellas en el manifiesto del proveedor. La política MV3 admite código propio y WASM sin habilitar `unsafe-eval`, CDN o Workers de blobs.

Los límites adicionales están centralizados: documento de 1 MiB, cincuenta vistas, cien pasos y cien etiquetas por captura. El renderizador verifica la geometría realmente decodificada y las texturas antes de incorporarlas. En dispositivos limitados reduce la calidad y ofrece una exploración individual identificada; sin WebGL 2 o tras pérdida de contexto conserva ficha, pasos y borrador. Un archivo comprimido pequeño no garantiza un consumo pequeño de memoria.

## Validación reproducible

```sh
npm run typecheck
npm run test:spacetime:visual-projects
npm run build:web
npm run build:extension
node scripts/create-visual-scene-fixture.mjs
```

La prueba nativa usa exclusivamente un servidor temporal y cuentas sintéticas. Verifica privacidad incluso frente a otro administrador, portadas intactas, separación de versiones, guardados idempotentes, conflictos, referencias conservadas por vistas y pasos, reinicio de SpacetimeDB y liberación exacta de bytes.

Las pruebas de demostración recrean fuentes y estados con IndexedDB real simulado: modelos, portadas, etiquetas y capturas sobreviven; se rechazan conflictos entre pestañas y se comprueba la cuota otra vez después de leer el archivo. Las pruebas de interfaz cubren selección, transformaciones, etiquetas ancladas, capturas independientes, recuperación y liberación explícita.

El generador produce hardware sintético con placa, CPU, RAM y almacenamiento. Los cuatro archivos pequeños de prueba del motor incluyen los tres tipos de compresión. El banco de prueba independiente comprueba su carga bajo CSP estricta, incluidas texturas KTX2 realmente decodificadas, sin confundirse con el fallback de textura del cargador.

La entrada de comparación `design-preview.html?visual-review=1&scene-review=1#/m/laboratorio-visual` habilita la persistencia de escenas de prueba en un espacio separado. Esta entrada y el banco de prueba no forman parte de la publicación normal.

La ejecución física de Android debe distinguirse de su compilación: el entorno dispone de SDK y JDK, pero no tiene dispositivo ni emulador conectado. El informe final de validación recoge las comprobaciones realizadas y esa limitación.

## Evidencia de entrega · 28 de octubre de 2026

La revisión de la interfaz utilizó exclusivamente datos sintéticos, en una vista previa local separada. Tras reiniciar el servidor de vista previa y recargar, se recuperaron el GLB de hardware, la etiqueta de CPU, una vista y dos pasos con posiciones independientes de la CPU (Y = 0.5 y Y = 1.75). Se recuperó y guardó un borrador local. En escritorio se comprobó la jerarquía de piezas; en móvil, un ancho de 390 px sin desbordamiento horizontal. El visor no registró errores ni advertencias en esta comprobación.

Las capturas y registros están en `artifacts/laboratorio-visual-editor-3d/`. La validación nativa usa una base temporal; no se modificó producción. El banco de renderizado conserva además evidencia en `artifacts/visual3d-toolchain/`: GLB normal, Draco, Meshopt y tres variantes de Basis/KTX2 cargaron en Chrome bajo la política estricta de la extensión, verificando texturas decodificadas.

El cierre final pasó 275 pruebas de core, 575 de servidor y 1,465 de la interfaz compartida (2,315 en total), además de diez comprobaciones nativas de SpacetimeDB. La comprobación de tipos de todos los espacios de trabajo y las compilaciones de web/PWA, extensión, Capacitor y APK finalizaron correctamente. El recibo `artifacts/laboratorio-visual-editor-3d/validation/validation-summary.json` enlaza registros, inventarios de archivos y huellas de los decodificadores. Se corrigió una notificación inicial vacía en la demostración que invalidaba innecesariamente otras instantáneas.

La revisión automática rechazó abrir `chrome://extensions/` porque la navegación permitida se limita a HTTP/HTTPS. No se intentó eludir ese bloqueo: la ejecución dentro de una extensión instalada queda pendiente, al igual que WebView Android en un dispositivo o emulador. Compilar esos clientes y ejecutar el banco con su política de seguridad no equivale a comprobar ambos entornos instalados.

La actualización está preparada de forma aditiva. La publicación posterior debe conservar el orden servidor → clientes y `--delete-data=never`. Esta implementación no se publicó en b20.mx.
