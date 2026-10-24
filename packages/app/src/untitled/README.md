# Untitled UI para la navegación y mensajería de B20

La navegación parte del componente gratuito oficial [Sidebar Slim de Untitled
UI](https://www.untitledui.com/react/components/sidebar-navigations#slim) y sus
auxiliares del [repositorio público de Untitled UI
React](https://github.com/untitleduico/react/tree/main/components/application/app-navigation).
Las fuentes gratuitas conservan la licencia MIT incluida en `LICENSE`.

El código de navegación vive en `components/application/app-navigation` y usa el
alias `@b20-ui/*`. Las adaptaciones conservan el rail de 68 px y el submenú de
256 px superpuesto; incluyen marca B20, cuenta actual, etiquetas en español y
enlaces de React Router compatibles con la navegación por hash. La selección de
ruta es independiente del grupo abierto temporalmente y reconoce páginas hijas
y los alias de Inicio, Perfiles y Tareas y Actividades.

La propiedad `compact` fuerza la cabecera y el cajón usados también en móvil.
Las animaciones usan `motion` y respetan la preferencia de movimiento reducido.
El cajón usa un diálogo de React Aria con retorno del foco al cerrar.

Las bases de mensajería son componentes gratuitos generados con
`untitledui@0.1.69`, biblioteca v8, desde `packages/app`:

```sh
npx untitledui@latest add button avatar textarea dropdown tooltip --include-all-components
```

`components.json` dirige el código a este directorio mediante `@b20-ui/*`.
Los componentes auxiliares son dependencias de estas cinco bases. Las burbujas,
cabeceras y adaptadores de B20 viven en `components/messaging`; no se usa el
componente PRO `messaging` ni sus ejemplos.

Los estilos se comparten entre web/PWA, extensión y Capacitor. `foundation.css`
carga Tailwind sin Preflight global y limita la detección de clases a este
directorio y a los componentes y páginas de mensajería indicados en `@source`.
El reset solo afecta `.b20-navigation`, `.b20-navigation-overlay`,
`.b20-messaging` y `.b20-messaging-overlay`, incluidos sus portales. El tema
conserva el azul B20, las fuentes del sistema y el modo oscuro automático.
Los estilos de los demás módulos conservan su ámbito.

Adaptaciones locales a los componentes generados: portales de menús/tooltips con
el ámbito de estilos, nombres accesibles en español y combinación de `style` en
`TextAreaBase`. Los tooltips compartidos conservan ambos ámbitos de portal.
Revisar estas adaptaciones antes de regenerar; no sobrescribir archivos con
`--yes` ni `--overwrite` sin revisar sus diferencias.

Documentación: [Untitled UI React](https://www.untitledui.com/react/docs/installation).

Las subidas usan la base gratuita oficial `file-upload-base`, con `ButtonUtility`,
`ProgressBar`, `FeaturedIcon` y `@untitledui/file-icons`. Se conservaron sus fuentes
MIT bajo `components/application/file-upload` y sus auxiliares. La adaptación B20
usa `File[]` directamente para selección y arrastre, traduce las etiquetas y añade
estados de preparación/confirmación, nombres accesibles y cancelación. Los archivos
reales, el progreso, los reintentos y las versiones los gestionan los adaptadores de
`components/uploads`; los ejemplos de progreso simulado no forman parte de la app.
El reset y las utilidades del cargador quedan acotados a `.b20-upload`, también en
los formularios que conservan los estilos anteriores.
