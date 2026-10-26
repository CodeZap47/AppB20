# Pendientes de App B20

Revisión del 26 de octubre de 2026, basada en la documentación y el estado local del
proyecto. El orden es una propuesta de prioridad; no asigna fechas ni responsables.
Las validaciones pendientes se conservan abiertas aunque el código ya esté publicado.

## 1. Prioridad inmediata: cerrar la versión actual

- [ ] **Integrar en la rama de producción el código que está publicado.** El despliegue
  del 24 de octubre incluye cambios locales; el commit registrado por Pages no basta
  para reconstruirlo. Guardar e integrar ese estado antes de otra publicación automática.
- [ ] **Actualizar la documentación de estado y autenticación.** Alinear README, matriz
  de requisitos y documentos anteriores con el recibo del 24 de octubre, que confirma
  Supabase y Administración publicados. Conciliar también los estados de Feed y Agente
  personal antes de dar sus publicaciones por pendientes o terminadas.
- [ ] **Validar acceso y Administración con cuentas reales.** Probar incorporación,
  creación/copia/revocación de enlaces, caducidad, cupo, bajas, bloqueos y reincorporación;
  comprobar los permisos de administrador, integrante y cuenta sin acceso.
- [ ] **Probar Tareas y Actividades con compañeros.** Verificar trabajos individuales y
  de equipo, coautorías, avance privado, versiones, comentarios y permisos.
- [ ] **Validar archivos y Papelera en producción.** Comprobar subida, interrupción y
  reanudación, descarga autorizada, retirada y restauración con archivos reales.
- [ ] **Completar los recorridos del grupo en los módulos publicados.** Incluir mensajes
  y adjuntos privados, notas, preguntas, guías, EX-2, salas, ayuda, retos, revisión de
  código, museo de bugs, exposiciones, repaso y oportunidades; registrar incidencias.
- [ ] **Realizar la prueba real de Gemini con su titular.** Verificar clave personal,
  consentimiento, vista previa, generación, límites y aceptación de borradores en los
  recorridos habilitados de Guías, Exámenes, Aprende enseñando y Repaso.
- [ ] **Comprobar Web Push y recordatorios en dispositivos reales.** Probar permiso,
  suscripción, recepción y apertura del contenido; incluir cumpleaños, votaciones,
  preferencias y zona horaria.
- [ ] **Acordar las reglas del ranking con el grupo.** Validar qué aportes puntúan,
  ponderaciones, límites y duplicados; ajustar las reglas según el acuerdo.
- [ ] **Medir el uso real de recursos.** Registrar almacenamiento, transferencias,
  procesamiento y consumo de IA para revisar cuotas y presupuestos.

Fuentes: [publicación de Administración](administracion-produccion-2026-10-24.md),
[control de accesos](control-accesos-administracion.md),
[matriz de estado](estado-del-proyecto.md) y [autenticación Supabase](supabase-auth.md).

## 2. Módulos nuevos: quinta entrega

- [ ] **Lenguaje de señales:** diccionario versionado, constructor, ejercicios
  individuales y en parejas, historial privado y fuentes.
- [ ] **Microproyectos:** propuestas, equipos, responsabilidades, tablero, materiales,
  código, demostración y cierre con contribuciones; integrar perfiles y oportunidades.
- [ ] **Préstamo de materiales:** catálogo, disponibilidad, solicitudes y acuerdos
  privados, reserva, entrega y devolución; evitar préstamos activos duplicados.

Fuente: [módulos pendientes en la matriz de estado](estado-del-proyecto.md).

## 3. Ampliaciones de funciones existentes

Exámenes y Exposiciones tienen implementación local: [entrega y validación](examenes-exposiciones-ampliaciones.md). Su publicación y prueba con titulares de cuentas/dispositivos siguen pendientes.

- [x] **Exposiciones (implementación local):** añadir generación con Gemini y, después, audio con consentimiento
  y reglas de conservación.
- [ ] **¿Qué me perdí?:** incorporar un resumen opcional con IA de las novedades autorizadas.
- [ ] **Revisión de código:** añadir asistencia opcional con IA y revisión final del autor.
- [x] **Exámenes EX-3A (implementación local):** conectar Preguntas, Repaso y Aprende enseñando; permitir convertir
  errores en tarjetas privadas por elección del usuario.
- [x] **Exámenes EX-3B (implementación local):** incorporar extracción de PDF/documentos y, después, imágenes y OCR,
  con límites, citas y revisión del texto reconocido.
- [x] **Exámenes EX-3C (implementación local):** crear un banco reutilizable de preguntas y variantes con fuentes,
  versiones y permisos.
- [x] **Exámenes EX-3D (implementación local):** añadir respuestas abiertas, rúbricas y corrección manual;
  incorporar después evaluación asistida opcional con IA.
- [ ] **Feed:** añadir avisos por comentarios/reacciones, reportes de publicaciones e imágenes.
- [ ] **Agente personal:** cerrar las decisiones sobre activación gradual de IA y alerta
  de parecido alto al publicar; definir el alcance del plug-in de subida de tareas AG-5
  antes de diseñarlo o implementarlo.

Cada ampliación necesita validación propia antes de activarse. Fuentes:
[matriz de estado](estado-del-proyecto.md), [plan de Exámenes](examenes-ia.md),
[Feed](primera-vista-feed.md) y [Agente personal](agente-personal-ia.md).

## 4. Plataformas y distribución

- [ ] **Web/PWA:** comprobar instalación, actualización, renovación y cierre de sesión en
  dispositivos reales, incluido iPhone.
- [ ] **Extensión de Chrome:** validar acceso, retornos de autenticación, avisos,
  actualización y preparar su distribución.
- [ ] **Android:** confirmar la identidad de la app, generar y firmar un APK de prueba;
  validar acceso, archivos, avisos internos y recordatorios en un dispositivo real.
- [ ] **Push nativo Android con la app cerrada:** definir e implementar una solución
  compatible con las restricciones de proveedores del proyecto.

Fuentes: [plataformas y requisitos compartidos](estado-del-proyecto.md) y
[definición del proyecto](definicion-del-proyecto.md).

## 5. Ideas por definir y priorizar con el grupo

- [ ] Biblioteca externa/extracurricular y wiki del grupo.
- [ ] Presentación de las reglas y acciones del ranking.
- [ ] Votación de decisiones y reglas del grupo.
- [ ] Propuestas de nuevas funciones con aceptación o rechazo.
- [ ] Pool mensual: definir participación, criterio para ganar y gestión antes de desarrollarlo.
- [ ] Proveedor de IA compartido «Kevin»: definir límites, costos y consentimiento.

Estas ideas todavía no tienen alcance ni prioridad acordados.
Fuente: [ideas pendientes](ideas-pendientes.md).
