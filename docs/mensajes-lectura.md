# Área de escritura al leer mensajes anteriores

En el salón, los canales y los directos, desplazarse hacia mensajes anteriores oculta el cuadro de escritura, sus herramientas y las tarjetas de escritura en vivo. Desplazarse hacia mensajes recientes vuelve a mostrar el bloque sin abrir automáticamente el teclado.

Si se estaba escribiendo, la ocultación cierra el teclado y detiene el indicador y el texto provisional compartido. El borrador local, las referencias y los archivos se conservan: el compositor permanece montado y las transferencias no se cancelan.

Mientras el bloque está oculto, **Escribir mensaje** lo recupera y enfoca el campo conservando el punto de lectura. **Ir al último mensaje** recupera el bloque y vuelve al final. Responder, editar, recibir una publicación para compartir y los errores que necesitan atención también recuperan los controles.

## Interacción y accesibilidad

- La dirección se reconoce con desplazamiento real del historial y un umbral de 12 píxeles. Las ruedas, paneles táctiles, gestos, teclado y barra de desplazamiento comparten la misma regla.
- Los movimientos programáticos, la llegada de mensajes y los cambios de altura no se interpretan como una nueva dirección del usuario. Al estar dentro de los últimos 80 píxeles, el bloque permanece visible.
- La lectura conserva su mensaje de referencia y su posición durante la transición. El espacio inferior temporal evita que el límite de desplazamiento provoque saltos cerca del final.
- El bloque oculto no recibe interacción ni tabulación. La transición dura 180 ms y se omite con movimiento reducido. No se oculta durante una composición de texto IME ni con una herramienta de diálogo abierta.
- Los reportes y avisos operativos permanecen fuera del área plegable. Los recibos siguen requiriendo un segundo de visibilidad real con la ventana activa.

## Entrega

Esta actualización modifica únicamente la interfaz compartida. No incorpora cambios del servidor, operaciones de base de datos ni esquemas nuevos. Se prepara una compilación aislada para conservar las demás funciones y los cambios locales existentes.

Publicado el **28 de octubre de 2026** en [B20 · Mensajes](https://b20.mx/#/m/mensajes). Entrega de Pages: `86241dbe-c7ef-42d7-82b2-15b50de0faad`.

La copia de entrega parte de las fuentes de la última versión publicada de presencia y añade únicamente los archivos de esta mejora. Los trabajos locales de otros módulos quedan conservados y excluidos de esta publicación.

## Comprobaciones realizadas

- **1,389 pruebas aprobadas en 168 archivos** de la interfaz. Incluyen dirección y umbral, cambios de altura, historiales cortos, recuperación manual, bloqueo por IME/herramientas, borradores, archivos, foco, salón/canales/directos y recibos de lectura.
- Una regresión comprueba que la confirmación tardía de un mensaje propio no saque al usuario del punto de lectura elegido después de enviarlo.
- Tipos aprobados para interfaz, web y extensión; compilaciones aprobadas de Pages, extensión y recursos web de Android. La publicación corresponde únicamente a Pages; no se distribuyó un APK nuevo.
- Revisión en navegador a **1061 × 774**, **390 × 844** y **320 × 740**. Se comprobó el borrador conservado, la recuperación por dirección sin enfocar el campo, el botón que sí lo enfoca y el salto al final. La recuperación manual mantuvo exactamente el desplazamiento del mensaje visible (`−30.390625 px` antes y después).
- Se corrigió además el desbordamiento de etiquetas accesibles absolutas fuera del historial: la cabecera permanece fija y el desplazamiento queda dentro del historial.
- Los **31 archivos públicos comprobados coinciden** con la compilación. Inicio, retorno de autenticación e invitaciones responden correctamente, al igual que la comprobación de disponibilidad de la API.
- El programa del servidor y las **195 tablas** conservan su esquema. Esta entrega no publicó servidor ni ejecutó escrituras en la base de datos.

Las comprobaciones móviles se realizaron con tamaños de navegador; no equivalen a una prueba en un teléfono físico con teclado de Android.

## Evidencia visual

Capturas con datos ficticios, sin enviar mensajes reales:

- [Escritorio: bloque oculto](evidencia/mensajes-lectura/escritorio-oculto.png).
- [Escritorio: borrador recuperado](evidencia/mensajes-lectura/escritorio-visible.png).
- [Móvil: bloque oculto](evidencia/mensajes-lectura/movil-oculto.png).
- [Móvil: borrador recuperado](evidencia/mensajes-lectura/movil-visible.png).

Los registros de pruebas, compilaciones, huellas de fuentes y archivos, comprobación pública y comparación del servidor se conservan en `artifacts/mensajes-lectura-2026-10-26/`.
