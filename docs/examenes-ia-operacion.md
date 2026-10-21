# Operación local de EX-1: BYOK y fuentes

Implementación local del 21 de octubre de 2026. Gemini real y la política de grupo permanecen
desactivados por defecto. La validación usa datos e identidades sintéticas y un proveedor
inyectado; no requiere una clave real ni consume Gemini. La publicación y la elegibilidad
real del grupo se verifican por separado. Consultar el [alcance y tareas](examenes-ia.md).

## Configuración

El Worker de archivos continúa arrancando sin secretos de IA. Para preparar fuentes hace
falta un modelo configurado y acceso autenticado a la base. Para guardar claves hace falta
además la identidad técnica de IA, las maestras y el consentimiento individual vigente.

| Configuración del Worker | Uso |
| --- | --- |
| `AI_ENABLED` | `false` por defecto. Solo `true`, junto con la política de grupo habilitada, permite enviar a Gemini. |
| `GEMINI_MODEL` | Modelo explícito, sin valor predeterminado ni cambios automáticos de proveedor. Su nombre forma parte de la vista previa. |
| `AI_MASTER_VERSION` | Identificador de la versión activa de cifrado, inicialmente `v1`. No contiene una clave. |
| `AI_MASTER_KEYS_JSON` | Secreto: objeto JSON que relaciona cada versión con una maestra aleatoria de 32 bytes codificada en base64. Nunca se publica como variable de la web. |
| `AI_SERVICE_TOKEN` | Secreto de una identidad SpacetimeDB exclusiva para IA. No usar el token del propietario, de un alumno ni del servicio de archivos. |
| `SPACETIMEDB_URI`, `SPACETIMEDB_MODULE` y OIDC | Se reutilizan para la base y la verificación de sesión/membresía. |

El propietario configura `set_ai_service(identity, enabled, dailyTokenBudget?)` en la base,
con el identificador correspondiente al token técnico. La operación rechaza identidades
de propietario, miembros y servicio de archivos. El presupuesto predeterminado es 100 000
tokens estimados diarios por persona. Registrar la elegibilidad real del grupo antes de
habilitar la política; el consentimiento individual no demuestra esa elegibilidad.

Los secretos se configuran mediante Cloudflare Secrets o el archivo local ignorado de
desarrollo. No incluirlos en documentos, capturas, argumentos de ejemplos ni archivos
versionados. La configuración pública solo contiene indicadores y nombres de modelo.

## Recorrido y contratos

En Ajustes se administra el consentimiento y la clave y se abre «Preparar material para IA».
La preparación no necesita una clave y no hace llamadas a Gemini. La simulación funciona
sin solicitudes de red y sustituye el material por texto ficticio.

- `GET /ai/status` informa estado efectivo, modelo, límites, consentimiento y configuración
  técnica; `configured` indica presencia de clave propia, `serviceConfigured` configuración
  técnica. No se prueba la validez de una clave haciendo una llamada oculta.
- `GET/PUT/DELETE /ai/key` consulta, sustituye y elimina la clave personal. El valor completo
  solo se acepta en la escritura y nunca aparece en la respuesta.
- `PUT /ai/consent` registra `{ version, accepted }` por identidad SpacetimeDB.
- `POST /ai/preparations` recibe `{ subjectId, termId?, topics, sources, config? }`. Cada fuente
  tiene `{ kind, refId, topics, includeUnplaced }`; los IDs numéricos son cadenas decimales.
  Devuelve fragmentos, procedencias, cobertura, omisiones, huella y vencimiento de 30 minutos.
- `config` fija cantidad, tipos y dificultad; por defecto son 10 preguntas, tipos `single`
  y `boolean`, dificultad `intermediate`. Cambiarla exige otra preparación.
- `POST /ai/generations` recibe `{ id, preparationId, fingerprint, config, confirmed: true }`.
  El UUID pertenece al solicitante y al contenido exacto: repetirlo consulta la misma
  operación; reutilizarlo con otros parámetros da conflicto. El resultado es privado y
  todavía no constituye un examen con intentos; esa interfaz pertenece a EX-2.
- `GET /ai/generations/:id` revalida membresía, propiedad y vigencia de las fuentes. Retirar
  o cambiar una fuente impide servir el contenido preparado o generado antiguo.

Todas las rutas están autenticadas, limitan sus cuerpos y usan `private, no-store`. Las
tablas internas de claves, preparaciones y generaciones no admiten suscripciones del cliente.
Los textos se redactan mediante patrones conservadores: revisar la vista previa sigue
siendo necesario; no existe una garantía de detectar todos los datos sensibles o errores.

## Consumo, incertidumbre y rotación

Los límites iniciales son 10 fuentes, 40 000 caracteres, 20 preguntas y 8 000 tokens máximos
de salida; una generación simultánea, cinco por hora y diez por día por persona. Se reservan
tokens estimados antes de reclamar la generación. Las estimaciones son controles de la app,
no cargos exactos ni cuotas de Google. Los usos conocidos se conservan en la operación.

El proveedor se llama una vez por operación reclamada, con timeout de 60 segundos y sin
reintentos automáticos del SDK. Un timeout o fallo de transporte puede ocurrir después del
envío. En ese caso el estado es `unknown`, la reserva se conserva y repetir el UUID no
reenvía. Un `running` abandonado pasa a `unknown` al consultar después de 90 segundos.
Para autorizar otra operación durante las 24 horas siguientes se exige
`acknowledgeUnknown: true`, tras advertir el posible consumo adicional. Los fallos de salida
posteriores al envío también conservan presupuesto; no equivalen a una llamada gratuita.

Una respuesta recibida puede volver a confirmarse idempotentemente en la base sin repetir
Gemini. Si no puede comprobarse su guardado, consultar el estado antes de otra acción. Borrar
o sustituir la clave invalida intenciones y generaciones todavía pendientes; no cancela
consumo que ya hubiera comenzado en el proveedor.

Para rotar la maestra, añadir una nueva versión al conjunto secreto, cambiar la versión
activa y mantener las anteriores mientras existan claves que las utilicen. Las nuevas
escrituras usan la activa; las lecturas usan la versión de su sobre. EX-1 no incluye un
recifrado masivo: cada usuario puede sustituir su clave para pasarla a la versión activa.
Una versión desconocida falla cerrada y permite sustituir o eliminar la clave afectada.
El vencimiento de una preparación impide utilizarla; no supone una limpieza automática del
historial almacenado. La política de conservación posterior debe registrarse por separado.

## Verificación sin consumo

Usar Node 22 o superior y CLI/SDK SpacetimeDB 2.12.0:

```sh
npm run typecheck
npm test
npm run build
npm run build:pages
npm run spacetime:generate
npm run test:spacetime:ai
```

La última prueba inicia su propio servidor en `127.0.0.1:3353`, falla si el puerto está ocupado,
publica únicamente una base temporal aislada, usa tokens sintéticos y comprueba acceso,
cifrado, preparación, generación simulada, concurrencia, retiro y persistencia tras reinicio.
Elimina el entorno temporal al pasar y conserva diagnóstico local si falla. Puede cambiarse
el puerto con `B20_SMOKE_AI_PORT`. No modifica cuentas, secretos ni bases de producción.

Las pruebas de runtime del Worker usan Miniflare y transporte/proveedor simulados; incluyen
autenticación, criptografía, límites, fallos antes/después de confirmar y respuestas inválidas.
Para cerrar la activación real siguen pendientes: elegibilidad del grupo, configuración de
servicio/modelo/secretos, publicación aditiva, clave propia y prueba elegida por su dueño.
