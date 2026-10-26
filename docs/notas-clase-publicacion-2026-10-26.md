# Notas de clase: publicación del 26 de octubre de 2026

Publicado en [b20.mx](https://b20.mx/#/m/notas): biblioteca visual, lectura y comentarios reorganizados, editor adaptable y elección **V1 / Versión final**. Las tarjetas finales muestran «Versión final» y conservan el historial de cambios.

## Versión publicada

- Maincloud `app-b20-34245`: bundle SHA-256 `98444131eb6efb3535f406ce5d1e58a4155ac89b334f1b7252e57e0816a36298`, comprobado contra el programa remoto después de publicar con `--delete-data=never`.
- Migración aditiva: tabla privada `note_edition`, vista autorizada `note_editions` y operación `save_note_v3`. Los 179 esquemas de tablas, 201 reducers, 60 procedures y 121 vistas anteriores se conservan.
- Cloudflare Pages: producción `2a2cc401-5c76-4a93-9b22-0d31ec8adb93`, [despliegue inmutable](https://2a2cc401.app-b20.pages.dev), rama `main` y dominio `b20.mx`.
- Los 20 archivos públicos servidos por `b20.mx` coinciden con el paquete validado. Entrada `assets/index-DUvYedEB.js`; estilos `assets/index-DtRnWSrW.css`.

La carga directa se preparó en un snapshot aislado basado en `618b07414d77d623903cb61a474692f4d06e78fc`, con los archivos de Notas y los cambios de invitaciones que ya estaban publicados. El metadato Git de esa carga conserva ese commit y `commit_dirty=true`; el commit por sí solo no representa esta versión. Este registro acompaña la integración de las fuentes publicadas a `main`. El manifiesto exacto, las huellas y el recibo de sincronización con GitHub están en `artifacts/notes-publicacion-2026-10-26/`.

## Conservación y validación

- 1,102 pruebas de interfaz/datos y 494 del módulo aprobadas en el snapshot aislado, comprobaciones de tipos y compilación de producción correctas.
- Ensayo local poblado desde el programa remoto anterior: 26 filas sintéticas y 179 tablas conservadas tras migrar y reiniciar. Creación final, edición V3/V2, copia, restauración y segundo reinicio aprobados.
- Producción: 179 → 180 tablas y 498 filas antes y después. Las huellas de las 178 tablas no operativas anteriores son idénticas; solo cambia el cursor de `notification_planner_state`, conservando su esquema y una fila. La nueva tabla está vacía al comprobarla.
- Configuración de Pages, dominios y variables existentes conservados. No se publicó ni modificó el Worker de la API.
- Navegador: la app real carga los archivos nuevos después de actualizar la caché. No había una sesión autenticada para recorrer las notas reales; las comprobaciones funcionales usaron datos sintéticos y no crearon publicaciones en producción.
