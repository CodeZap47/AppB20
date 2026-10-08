# App B20

Plataforma colaborativa del grupo B20 de Ingeniería en Desarrollo de Software: archivo de
trabajos por materia y parcial, mensajería del grupo y 1 a 1, perfiles, cumpleaños, guías de
estudio y Gemini con clave propia (BYOK).

La definición completa está en `../docs/app-b20-definicion-del-proyecto.md`. Este repositorio
es la base de la **Etapa 0** (prototipo técnico) y del **MVP** (Etapa 1).

## Estructura

```
app-b20/
├── apps/
│   ├── web/              Web + PWA instalable en iPhone (Vite, service worker con Web Push)
│   ├── extension/        Extensión de Chrome Manifest V3: panel lateral y vista completa
│   ├── android/          APK Android con Capacitor (usa la compilación de apps/web)
│   └── api/              Backend Node (Hono): Gemini BYOK, y luego archivos y envío de push
├── packages/
│   ├── app/              Interfaz React compartida por web, extensión y Android
│   ├── core/             Catálogo de módulos, reglas de permisos y cumpleaños (con pruebas)
│   └── spacetime-module/ Módulo de servidor SpacetimeDB: tablas, reducers y vistas
└── docs/
    └── arquitectura.md   Cómo encajan las piezas y qué falta validar
```

Las tres presentaciones (web/PWA, extensión, APK) son la misma app con los mismos datos; solo
cambia el empaquetado. La interfaz recibe la presentación como `platform` para adaptarse
(por ejemplo, navegación compacta en el panel lateral).

## Requisitos

- Node.js 22 o superior y npm 10.
- [CLI de SpacetimeDB](https://spacetimedb.com/install) para publicar el módulo y generar bindings.
- Android Studio y JDK 21 solo para compilar el APK.

## Primeros pasos

```bash
npm install
cp .env.example .env        # llena los valores; nunca subas claves reales
npm run dev                 # web en http://localhost:5173
npm run dev:api             # backend en http://localhost:8787
```

Base de datos local:

```bash
spacetime start                       # servidor local en ws://localhost:3000
npm run spacetime:publish             # publica packages/spacetime-module como "app-b20"
npm run spacetime:generate            # genera bindings en packages/app/src/module_bindings
```

Quien publica el módulo por primera vez queda como creador inicial y puede invitar correos
con el reducer `invite_member`.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run typecheck` | Revisa tipos en todos los paquetes. |
| `npm test` | Pruebas de `core` y `api` (Vitest). |
| `npm run build` | Compila web, extensión y backend. |
| `npm run build:extension` | Genera `apps/extension/dist`, que se carga en `chrome://extensions` con «Cargar descomprimida». |
| `npm run build:android` | Compila la web en modo Capacitor y sincroniza el proyecto Android. Después: `npm run open -w @b20/android`. |

## Reglas que el código ya respeta

- Las tablas de SpacetimeDB son privadas; los clientes solo leen vistas que comprueban
  membresía activa. Los mensajes 1 a 1 solo los ven sus dos participantes.
- Acceso por invitación: unirse requiere sesión de Google con correo verificado que esté en la
  lista autorizada.
- Ningún secreto vive en el cliente. Las claves de Gemini se guardan cifradas en el backend y
  solo se informa si existen.
- Los cumpleaños guardan día y mes, nunca el año, y son voluntarios.
- Los cambios importantes quedan en un historial con responsable y fecha.

## Fuera de alcance

El módulo 3.11 (lenguaje de señales y respuestas preparadas para evaluaciones) no forma parte de
este proyecto.
